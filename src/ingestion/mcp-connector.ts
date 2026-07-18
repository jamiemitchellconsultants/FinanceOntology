import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  SystemDef,
  IngestionResult,
  SystemMapping,
  FieldMapping,
} from '../ontology/types.js';
import type { OntologyManager } from '../ontology/manager.js';
import type { LlmService, IngestionMappingProposal } from '../services/llm.js';
import { HIGH_CONFIDENCE_THRESHOLD } from '../services/llm.js';

export interface McpIngestionOptions {
  /** Command to spawn the external MCP server process */
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Max ms to wait for the server to respond */
  timeoutMs?: number;
}

export class McpConnector {
  private manager: OntologyManager;
  private llmService?: LlmService;

  constructor(manager: OntologyManager, llmService?: LlmService) {
    this.manager = manager;
    this.llmService = llmService;
  }

  /**
   * Connect to an external MCP server, enumerate its resources and tools,
   * and map them into the ontology.
   *
   * When an LlmService is available, all resources and tools are batched into
   * a single gpt-4o (architect) call:
   * - confidence >= 0.85 → link to the existing concept via SystemMapping
   * - confidence <  0.85 → report a gap; deterministic fallback creates the concept
   */
  async ingestFromMcpServer(
    systemId: string,
    options: McpIngestionOptions
  ): Promise<IngestionResult> {
    const system = this.manager.getSystem(systemId);
    if (!system) {
      return this.errorResult(systemId, `System not found: ${systemId}`);
    }

    const result: IngestionResult = {
      systemId,
      success: false,
      conceptsCreated: 0,
      conceptsUpdated: 0,
      relationshipsCreated: 0,
      gapsDetected: 0,
      errors: [],
      timestamp: new Date().toISOString(),
    };

    const transport = new StdioClientTransport({
      command: options.command,
      args: options.args ?? [],
      env: options.env,
    });

    const client = new Client(
      { name: 'finance-ontology-ingestor', version: '1.0.0' },
      { capabilities: {} }
    );

    const requestOptions: RequestOptions | undefined =
      options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : undefined;

    try {
      await client.connect(transport, requestOptions);
      this.manager.updateSystem(systemId, { status: 'ingesting' });

      const resourcesResponse = await client.listResources(undefined, requestOptions);
      const toolsResponse = await client.listTools(undefined, requestOptions);

      if (this.llmService?.isAvailable()) {
        const incomingFields = [
          ...resourcesResponse.resources.map((r) => ({ name: r.name, description: r.description })),
          ...toolsResponse.tools.map((t) => ({ name: t.name, description: t.description })),
        ];

        const handled = new Set<string>();

        if (incomingFields.length > 0) {
          const existingConcepts = this.manager.listConcepts().map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
            description: c.description.slice(0, 120),
          }));

          try {
            const proposals = await this.llmService.proposeMappings(
              'architect',
              { systemName: system.name, systemType: system.type, incomingFields },
              existingConcepts
            );

            for (const proposal of proposals) {
              const concept = this.manager.getConcept(proposal.mappedConceptId);

              if (proposal.confidence >= HIGH_CONFIDENCE_THRESHOLD && concept) {
                this.linkConceptToSystem(concept.id, system.id, proposal.incomingField, result);
                handled.add(proposal.incomingField);
              } else {
                // Unlike discoverFromSchema (which tracks a separate `gapped` set to
                // exclude low-confidence entities from its deterministic fallback), a
                // gapped item here is intentionally left out of `handled` only — it
                // still runs through ingestResource/ingestTool below. This keeps every
                // MCP resource/tool represented in the ontology even while its mapping
                // to an existing concept remains open as a gap.
                if (proposal.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
                  // High confidence but mappedConceptId doesn't exist — hallucinated ID.
                  this.reportHallucinatedProposal(system.id, proposal, result);
                } else {
                  this.reportLlmGap(system.id, proposal, result);
                }
              }
            }
          } catch (err) {
            result.errors.push(`LLM proposal failed: ${String(err)}`);
          }
        }

        // Deterministic fallback for items the LLM did not handle
        for (const resource of resourcesResponse.resources) {
          if (!handled.has(resource.name)) {
            await this.ingestResource(system, resource, result);
          }
        }
        for (const tool of toolsResponse.tools) {
          if (!handled.has(tool.name)) {
            await this.ingestTool(system, tool, result);
          }
        }
      } else {
        // Deterministic path — unchanged behaviour when LLM is unavailable
        for (const resource of resourcesResponse.resources) {
          await this.ingestResource(system, resource, result);
        }
        for (const tool of toolsResponse.tools) {
          await this.ingestTool(system, tool, result);
        }
      }

      this.manager.updateSystem(systemId, {
        status: 'active',
        lastIngestedAt: result.timestamp,
        mcpEndpoint: options.command,
      });

      result.success = true;
    } catch (err) {
      result.errors.push(String(err));
      this.manager.updateSystem(systemId, { status: 'active' });
    } finally {
      await client.close();
    }

    this.manager.recordIngestionResult(result);
    this.manager.save();
    return result;
  }

  /**
   * Register an external MCP server as a system without live ingestion.
   * Use when the server is not currently running but you want to declare its existence.
   */
  registerMcpSystem(
    name: string,
    description: string,
    mcpEndpoint: string,
    systemType: SystemDef['type'] = 'mcp'
  ): SystemDef {
    const existing = this.manager
      .listSystems()
      .find((s) => s.mcpEndpoint === mcpEndpoint);

    if (existing) {
      return this.manager.updateSystem(existing.id, {
        name,
        description,
        status: 'unknown',
      });
    }

    const system = this.manager.addSystem({
      name,
      description,
      type: systemType,
      mcpEndpoint,
      authType: 'mcp',
      status: 'unknown',
      ingestionConfig: {
        type: 'mcp',
        endpoint: mcpEndpoint,
      },
    });

    this.manager.addGap({
      type: 'unknown_system',
      description: `MCP system "${name}" registered but not yet ingested`,
      affectedConceptIds: [],
      severity: 'medium',
      status: 'open',
      source: 'mcp_connector:register',
    });

    this.manager.save();
    return system;
  }

  // ─── LLM helpers ──────────────────────────────────────────────────────────

  /**
   * High-confidence path: add a SystemMapping to an existing concept, pointing
   * it at this MCP server entity.
   */
  private linkConceptToSystem(
    conceptId: string,
    systemId: string,
    entityName: string,
    result: IngestionResult
  ): void {
    const concept = this.manager.getConcept(conceptId);
    if (!concept) return;

    const alreadyLinked = concept.systemMappings.some(
      (m) => m.systemId === systemId && m.entityName === entityName
    );
    if (alreadyLinked) return;

    const updatedMappings: SystemMapping[] = [
      ...concept.systemMappings,
      { systemId, entityName, fieldMappings: [], authType: 'mcp' },
    ];
    this.manager.updateConcept(conceptId, { systemMappings: updatedMappings });
    result.conceptsUpdated++;
  }

  /** Low-confidence path: report a gap with the field name and LLM reasoning. */
  private reportLlmGap(
    systemId: string,
    proposal: IngestionMappingProposal,
    result: IngestionResult
  ): void {
    const conceptExists =
      !!proposal.mappedConceptId && !!this.manager.getConcept(proposal.mappedConceptId);

    this.manager.addGap({
      type: 'missing_mapping',
      description: `Low-confidence mapping for "${proposal.incomingField}" (${(proposal.confidence * 100).toFixed(0)}% confidence): ${proposal.reasoning}`,
      affectedConceptIds: conceptExists ? [proposal.mappedConceptId] : [],
      severity: proposal.confidence < 0.5 ? 'high' : 'medium',
      status: 'open',
      source: `llm_ingestion:${systemId}`,
    });
    result.gapsDetected++;
  }

  /**
   * High-confidence proposal pointed at a concept ID that doesn't exist in the
   * ontology (an LLM hallucination). Reported distinctly from a genuinely
   * low-confidence mapping so the gap description doesn't read "low confidence"
   * next to a high confidence score.
   */
  private reportHallucinatedProposal(
    systemId: string,
    proposal: IngestionMappingProposal,
    result: IngestionResult
  ): void {
    this.manager.addGap({
      type: 'missing_mapping',
      description: `LLM proposed non-existent concept ID "${proposal.mappedConceptId}" for entity "${proposal.incomingField}" (${(proposal.confidence * 100).toFixed(0)}% confidence): ${proposal.reasoning}`,
      affectedConceptIds: [],
      severity: 'medium',
      status: 'open',
      source: `llm_ingestion:${systemId}`,
    });
    result.gapsDetected++;
  }

  // ─── Deterministic helpers ─────────────────────────────────────────────────

  private async ingestResource(
    system: SystemDef,
    resource: { uri: string; name: string; description?: string; mimeType?: string },
    result: IngestionResult
  ): Promise<void> {
    const entityName = resource.name;
    const description = resource.description ?? `${entityName} from ${system.name}`;

    const existing = this.manager.listConcepts({ systemId: system.id });
    const alreadyMapped = existing.find((c) =>
      c.systemMappings.some((m) => m.entityName === entityName)
    );

    const systemMapping: SystemMapping = {
      systemId: system.id,
      entityName,
      apiEndpoint: resource.uri,
      fieldMappings: [] as FieldMapping[],
      authType: 'mcp',
    };

    if (alreadyMapped) {
      const updatedMappings = alreadyMapped.systemMappings.map((m) =>
        m.entityName === entityName ? systemMapping : m
      );
      this.manager.updateConcept(alreadyMapped.id, {
        systemMappings: updatedMappings,
        updatedAt: new Date().toISOString(),
      });
      result.conceptsUpdated++;
    } else {
      this.manager.addConcept({
        name: entityName,
        type: resource.mimeType?.includes('json') ? 'entity' : 'report',
        description,
        attributes: {},
        systemMappings: [systemMapping],
        tags: ['mcp', system.type, system.id],
        confidence: 0.6,
      });
      result.conceptsCreated++;
    }
  }

  private async ingestTool(
    system: SystemDef,
    tool: { name: string; description?: string; inputSchema?: unknown },
    result: IngestionResult
  ): Promise<void> {
    const existing = this.manager.listConcepts({ systemId: system.id });
    const alreadyMapped = existing.find((c) =>
      c.systemMappings.some((m) => m.entityName === tool.name)
    );

    const fieldMappings: FieldMapping[] = [];
    const schema = tool.inputSchema as Record<string, unknown> | undefined;
    const properties = schema?.properties as Record<string, unknown> | undefined;
    if (properties) {
      for (const fieldName of Object.keys(properties)) {
        fieldMappings.push({ ontologyField: fieldName, systemField: fieldName });
      }
    }

    const systemMapping: SystemMapping = {
      systemId: system.id,
      entityName: tool.name,
      fieldMappings,
      authType: 'mcp',
    };

    if (alreadyMapped) {
      const updatedMappings = alreadyMapped.systemMappings.map((m) =>
        m.entityName === tool.name ? systemMapping : m
      );
      this.manager.updateConcept(alreadyMapped.id, {
        systemMappings: updatedMappings,
        description: tool.description ?? alreadyMapped.description,
        updatedAt: new Date().toISOString(),
      });
      result.conceptsUpdated++;
      return;
    }

    this.manager.addConcept({
      name: tool.name,
      type: 'process',
      description: tool.description ?? `Process: ${tool.name} in ${system.name}`,
      attributes: {},
      systemMappings: [systemMapping],
      tags: ['mcp', 'process', system.id],
      confidence: 0.7,
    });
    result.conceptsCreated++;
  }

  private errorResult(systemId: string, message: string): IngestionResult {
    return {
      systemId,
      success: false,
      conceptsCreated: 0,
      conceptsUpdated: 0,
      relationshipsCreated: 0,
      gapsDetected: 0,
      errors: [message],
      timestamp: new Date().toISOString(),
    };
  }
}
