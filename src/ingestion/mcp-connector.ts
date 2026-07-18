/**
 * MCP-to-MCP Ingestion Connector.
 *
 * Connects to an external MCP server (a finance system that exposes an MCP
 * interface) and ingests its resources/tools into the ontology.
 *
 * This enables the Finance Ontology to act as a meta-layer over multiple
 * MCP-enabled systems, maintaining semantic mappings between them.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type {
  SystemDef,
  IngestionResult,
  SystemMapping,
  FieldMapping,
} from '../ontology/types.js';
import type { OntologyManager } from '../ontology/manager.js';

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

  constructor(manager: OntologyManager) {
    this.manager = manager;
  }

  /**
   * Connect to an external MCP server, enumerate its resources and tools,
   * and map them into the ontology.
   *
   * @param systemId  - ID of the SystemDef representing the MCP server
   * @param options   - Spawn options for the MCP process
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

    try {
      await client.connect(transport);
      this.manager.updateSystem(systemId, { status: 'ingesting' });

      // ── Ingest Resources ────────────────────────────────────────────────────
      const resourcesResponse = await client.listResources();
      for (const resource of resourcesResponse.resources) {
        await this.ingestResource(system, resource, result);
      }

      // ── Ingest Tools (as process concepts) ─────────────────────────────────
      const toolsResponse = await client.listTools();
      for (const tool of toolsResponse.tools) {
        await this.ingestTool(system, tool, result);
      }

      // ── Update system ───────────────────────────────────────────────────────
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

    // Flag the gap: system is registered but not yet ingested
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

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async ingestResource(
    system: SystemDef,
    resource: { uri: string; name: string; description?: string; mimeType?: string },
    result: IngestionResult
  ): Promise<void> {
    const entityName = resource.name;
    const description =
      resource.description ?? `${entityName} from ${system.name}`;

    // Check if concept exists already (by name + system mapping)
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
      // Update the mapping
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

    if (alreadyMapped) {
      result.conceptsUpdated++;
      return;
    }

    // Extract field mappings from tool input schema
    const fieldMappings: FieldMapping[] = [];
    const schema = tool.inputSchema as Record<string, unknown> | undefined;
    const properties = schema?.properties as Record<string, unknown> | undefined;
    if (properties) {
      for (const fieldName of Object.keys(properties)) {
        fieldMappings.push({
          ontologyField: fieldName,
          systemField: fieldName,
        });
      }
    }

    this.manager.addConcept({
      name: tool.name,
      type: 'process',
      description:
        tool.description ?? `Process: ${tool.name} in ${system.name}`,
      attributes: {},
      systemMappings: [
        {
          systemId: system.id,
          entityName: tool.name,
          fieldMappings,
          authType: 'mcp',
        },
      ],
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
