/**
 * Finance Ontology MCP Server.
 *
 * Exposes the finance ontology to AI agents (Claude, Copilot, Codex, etc.)
 * via the Model Context Protocol.
 *
 * Tools:
 *   Ontology:    list_concepts, get_concept, add_concept, update_concept, add_relationship, list_relationships
 *   Systems:     list_systems, add_system, register_mcp_system
 *   Ingestion:   ingest_from_api, ingest_from_mcp
 *   Gaps:        list_gaps, report_gap, resolve_gap, analyze_gaps
 *   Orchestration: get_orchestration_context, find_data_path, describe_uncertainty
 *
 * Resources:
 *   ontology://overview          — ontology stats and summary
 *   ontology://concepts/{id}     — concept detail
 *   ontology://gaps              — all open gaps
 *   ontology://systems           — all registered systems
 *
 * Prompts:
 *   finance_task_context   — help an agent understand what systems to call
 *   gap_analysis_report    — structured gap analysis report
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { OntologyStore } from './ontology/store.js';
import { OntologyManager } from './ontology/manager.js';
import { ApiConnector } from './ingestion/api-connector.js';
import { McpConnector } from './ingestion/mcp-connector.js';
import { GapAnalyzer } from './gaps/analyzer.js';
import { FINANCE_SEED } from './seed/finance-seed.js';
import type { ConceptType, RelationshipType, GapSeverity } from './ontology/types.js';

// ─── Server setup ─────────────────────────────────────────────────────────────

export function createServer(dataPath?: string): McpServer {
  const store = new OntologyStore(dataPath);
  const manager = new OntologyManager(store);

  // Seed on first run
  if (manager.listConcepts().length === 0) {
    manager.loadSeed(FINANCE_SEED);
    manager.save();
  }

  const apiConnector = new ApiConnector(manager);
  const mcpConnector = new McpConnector(manager);
  const gapAnalyzer = new GapAnalyzer(manager);

  const server = new McpServer({
    name: 'finance-ontology',
    version: '1.0.0',
  });

  // ─── Resources ─────────────────────────────────────────────────────────────

  server.resource(
    'ontology-overview',
    'ontology://overview',
    async () => {
      const stats = manager.getStats();
      const systems = manager.listSystems();
      const openGaps = manager.listGaps('open');
      const criticalGaps = openGaps.filter((g) => g.severity === 'critical');

      const lines = [
        '# Finance Ontology Overview',
        '',
        '## Statistics',
        `- Concepts: ${stats['totalConcepts']}`,
        `- Relationships: ${stats['totalRelationships']}`,
        `- Systems: ${stats['totalSystems']}`,
        `- Open Gaps: ${stats['openGaps']} (${criticalGaps.length} critical)`,
        `- Average Confidence: ${((stats['averageConfidence'] as number) * 100).toFixed(0)}%`,
        `- Last Updated: ${stats['lastUpdated']}`,
        '',
        '## Registered Systems',
        ...systems.map(
          (s) => `- **${s.name}** (${s.type}) — ${s.status} — ${s.description}`
        ),
        '',
        '## Critical Gaps',
        ...(criticalGaps.length === 0
          ? ['None']
          : criticalGaps.map((g) => `- ${g.type}: ${g.description}`)),
      ];

      return {
        contents: [
          {
            uri: 'ontology://overview',
            mimeType: 'text/markdown',
            text: lines.join('\n'),
          },
        ],
      };
    }
  );

  server.resource(
    'ontology-gaps',
    'ontology://gaps',
    async () => {
      const gaps = manager.listGaps();
      const text = JSON.stringify(gaps, null, 2);
      return {
        contents: [
          {
            uri: 'ontology://gaps',
            mimeType: 'application/json',
            text,
          },
        ],
      };
    }
  );

  server.resource(
    'ontology-systems',
    'ontology://systems',
    async () => {
      const systems = manager.listSystems();
      return {
        contents: [
          {
            uri: 'ontology://systems',
            mimeType: 'application/json',
            text: JSON.stringify(systems, null, 2),
          },
        ],
      };
    }
  );

  server.resource(
    'ontology-concept',
    new ResourceTemplate('ontology://concepts/{id}', { list: undefined }),
    async (uri: URL, variables: Record<string, string | string[]>) => {
      const rawId = variables['id'];
      const id = Array.isArray(rawId) ? (rawId[0] ?? '') : (rawId ?? '');
      const concept = manager.getConcept(id);
      if (!concept) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({ error: `Concept not found: ${id}` }),
            },
          ],
        };
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(concept, null, 2),
          },
        ],
      };
    }
  );

  // ─── Ontology Tools ─────────────────────────────────────────────────────────

  server.tool(
    'list_concepts',
    'List finance ontology concepts with optional filters. Returns concept id, name, type, confidence, and tags.',
    {
      type: z
        .enum(['entity', 'process', 'attribute', 'system', 'report', 'dimension', 'metric'])
        .optional()
        .describe('Filter by concept type'),
      tags: z.array(z.string()).optional().describe('Filter by tags (OR logic)'),
      system_id: z.string().optional().describe('Filter to concepts mapped to this system id'),
      min_confidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe('Minimum confidence score (0-1)'),
      search: z.string().optional().describe('Text search over name and description'),
    },
    async (args) => {
      const concepts = manager.listConcepts({
        type: args.type as ConceptType | undefined,
        tags: args.tags,
        systemId: args.system_id,
        minConfidence: args.min_confidence,
        search: args.search,
      });

      const summary = concepts.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        confidence: c.confidence,
        tags: c.tags,
        systemMappingCount: c.systemMappings.length,
        description: c.description.slice(0, 120) + (c.description.length > 120 ? '…' : ''),
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    'get_concept',
    'Get full details of a specific ontology concept including attributes and system mappings.',
    { concept_id: z.string().describe('Concept ID') },
    async (args) => {
      const concept = manager.getConcept(args.concept_id);
      if (!concept) {
        return {
          content: [{ type: 'text' as const, text: `Concept not found: ${args.concept_id}` }],
          isError: true,
        };
      }
      const related = manager.findRelatedConcepts(args.concept_id, 1);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                concept,
                relatedConcepts: related.map((r) => ({
                  id: r.concept.id,
                  name: r.concept.name,
                  type: r.concept.type,
                  distance: r.distance,
                  via: r.via.map((rel) => rel.type),
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    'add_concept',
    'Add a new finance concept to the ontology.',
    {
      name: z.string().describe('Concept name'),
      type: z.enum(['entity', 'process', 'attribute', 'system', 'report', 'dimension', 'metric']),
      description: z.string().describe('Human-readable description'),
      tags: z.array(z.string()).optional().default([]),
      confidence: z.number().min(0).max(1).optional().default(0.5),
      parent_id: z.string().optional().describe('Parent concept ID (for hierarchies)'),
    },
    async (args) => {
      const concept = manager.addConcept({
        name: args.name,
        type: args.type as ConceptType,
        description: args.description,
        attributes: {},
        systemMappings: [],
        tags: args.tags ?? [],
        confidence: args.confidence ?? 0.5,
        parentId: args.parent_id,
      });
      manager.save();
      return {
        content: [
          {
            type: 'text' as const,
            text: `Created concept "${concept.name}" with id: ${concept.id}`,
          },
        ],
      };
    }
  );

  server.tool(
    'update_concept',
    'Update an existing ontology concept.',
    {
      concept_id: z.string(),
      name: z.string().optional(),
      description: z.string().optional(),
      confidence: z.number().min(0).max(1).optional(),
      tags: z.array(z.string()).optional(),
    },
    async (args) => {
      try {
        const { concept_id, ...patch } = args;
        const updated = manager.updateConcept(concept_id, patch);
        manager.save();
        return {
          content: [
            {
              type: 'text' as const,
              text: `Updated concept "${updated.name}" (${updated.id})`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: String(err) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'add_relationship',
    'Define a semantic relationship between two ontology concepts.',
    {
      from_concept_id: z.string().describe('Source concept ID'),
      to_concept_id: z.string().describe('Target concept ID'),
      type: z.enum([
        'is_a', 'has_a', 'relates_to', 'processed_by',
        'approves', 'references', 'aggregates', 'feeds_into',
        'triggers', 'equivalent_to',
      ]),
      description: z.string().optional(),
      cardinality: z.enum(['1:1', '1:N', 'N:1', 'N:M']).optional(),
      confidence: z.number().min(0).max(1).optional().default(0.8),
    },
    async (args) => {
      try {
        const rel = manager.addRelationship({
          fromConceptId: args.from_concept_id,
          toConceptId: args.to_concept_id,
          type: args.type as RelationshipType,
          description: args.description,
          cardinality: args.cardinality,
          confidence: args.confidence ?? 0.8,
        });
        manager.save();
        return {
          content: [
            {
              type: 'text' as const,
              text: `Created relationship id: ${rel.id}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: String(err) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'list_relationships',
    'List relationships in the ontology with optional filters.',
    {
      concept_id: z.string().optional().describe('Return relationships involving this concept (either side)'),
      type: z
        .enum(['is_a', 'has_a', 'relates_to', 'processed_by', 'approves', 'references', 'aggregates', 'feeds_into', 'triggers', 'equivalent_to'])
        .optional(),
    },
    async (args) => {
      const rels = manager.listRelationships({
        conceptId: args.concept_id,
        type: args.type as RelationshipType | undefined,
      });
      const data = manager.getData();
      const enriched = rels.map((r) => ({
        ...r,
        fromConceptName: data.concepts[r.fromConceptId]?.name ?? r.fromConceptId,
        toConceptName: data.concepts[r.toConceptId]?.name ?? r.toConceptId,
      }));
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(enriched, null, 2) }],
      };
    }
  );

  server.tool(
    'find_related_concepts',
    'Find concepts related to a given concept via graph traversal.',
    {
      concept_id: z.string(),
      max_depth: z.number().int().min(1).max(5).optional().default(2),
      relationship_types: z
        .array(
          z.enum([
            'is_a', 'has_a', 'relates_to', 'processed_by',
            'approves', 'references', 'aggregates', 'feeds_into',
            'triggers', 'equivalent_to',
          ])
        )
        .optional(),
    },
    async (args) => {
      const related = manager.findRelatedConcepts(
        args.concept_id,
        args.max_depth ?? 2,
        args.relationship_types as RelationshipType[] | undefined
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              related.map((r) => ({
                id: r.concept.id,
                name: r.concept.name,
                type: r.concept.type,
                distance: r.distance,
                path: r.via.map((rel) => `${rel.type}`),
              })),
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.tool(
    'find_data_path',
    'Find the semantic relationship path between two concepts in the ontology.',
    {
      from_concept_id: z.string(),
      to_concept_id: z.string(),
      max_depth: z.number().int().min(1).max(6).optional().default(4),
    },
    async (args) => {
      const path = manager.findPath(
        args.from_concept_id,
        args.to_concept_id,
        args.max_depth ?? 4
      );
      if (!path) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No path found between ${args.from_concept_id} and ${args.to_concept_id} within ${args.max_depth ?? 4} hops`,
            },
          ],
        };
      }
      const data = manager.getData();
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              path.map((r) => ({
                from: data.concepts[r.fromConceptId]?.name ?? r.fromConceptId,
                relationship: r.type,
                to: data.concepts[r.toConceptId]?.name ?? r.toConceptId,
                confidence: r.confidence,
              })),
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // ─── System Tools ───────────────────────────────────────────────────────────

  server.tool(
    'list_systems',
    'List all registered external finance systems.',
    {},
    async () => {
      const systems = manager.listSystems();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(systems, null, 2) }],
      };
    }
  );

  server.tool(
    'add_system',
    'Register a new external finance system.',
    {
      name: z.string(),
      type: z.enum(['erp', 'ap', 'ar', 'banking', 'procurement', 'budgeting', 'reporting', 'payroll', 'expense', 'tax', 'mcp', 'other']),
      description: z.string(),
      base_url: z.string().optional(),
      auth_type: z.enum(['oauth2', 'api_key', 'basic', 'mcp', 'none']).optional(),
      mcp_endpoint: z.string().optional(),
    },
    async (args) => {
      const system = manager.addSystem({
        name: args.name,
        type: args.type,
        description: args.description,
        baseUrl: args.base_url,
        authType: args.auth_type,
        mcpEndpoint: args.mcp_endpoint,
        status: 'unknown',
        ingestionConfig: args.mcp_endpoint
          ? { type: 'mcp', endpoint: args.mcp_endpoint }
          : args.base_url
          ? { type: 'rest_api', endpoint: args.base_url }
          : undefined,
      });
      manager.save();
      return {
        content: [
          {
            type: 'text' as const,
            text: `Registered system "${system.name}" with id: ${system.id}`,
          },
        ],
      };
    }
  );

  server.tool(
    'register_mcp_system',
    'Register another MCP server as a system. The server can be ingested later.',
    {
      name: z.string(),
      description: z.string(),
      mcp_endpoint: z.string().describe('Command or URL to connect to the MCP server'),
      system_type: z
        .enum(['erp', 'ap', 'ar', 'banking', 'procurement', 'budgeting', 'reporting', 'payroll', 'expense', 'tax', 'mcp', 'other'])
        .optional()
        .default('mcp'),
    },
    async (args) => {
      const system = mcpConnector.registerMcpSystem(
        args.name,
        args.description,
        args.mcp_endpoint,
        args.system_type ?? 'mcp'
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: `Registered MCP system "${system.name}" with id: ${system.id}`,
          },
        ],
      };
    }
  );

  // ─── Ingestion Tools ────────────────────────────────────────────────────────

  server.tool(
    'ingest_from_api',
    'Trigger ingestion from a registered REST API system to discover and map concepts.',
    {
      system_id: z.string().describe('ID of the system to ingest from'),
      auth_header: z.string().optional().describe('Authorization header value (e.g. ******'),
    },
    async (args) => {
      const headers: Record<string, string> = {};
      if (args.auth_header) headers['Authorization'] = args.auth_header;
      const result = await apiConnector.ingest(args.system_id, headers);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    }
  );

  server.tool(
    'ingest_from_api_schema',
    'Ingest an OpenAPI/Swagger schema to auto-discover concepts for a system.',
    {
      system_id: z.string().describe('ID of the system'),
      schema: z.record(z.unknown()).describe('OpenAPI/Swagger schema object'),
    },
    async (args) => {
      const result = await apiConnector.discoverFromSchema(
        args.system_id,
        args.schema as Record<string, unknown>
      );
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    }
  );

  server.tool(
    'ingest_from_mcp',
    'Connect to an external MCP server and ingest its resources and tools into the ontology.',
    {
      system_id: z.string().describe('ID of the registered MCP system'),
      command: z.string().describe('Command to spawn the MCP server process'),
      args: z.array(z.string()).optional().describe('Command arguments'),
    },
    async (params) => {
      const result = await mcpConnector.ingestFromMcpServer(params.system_id, {
        command: params.command,
        args: params.args,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    }
  );

  // ─── Gap Tools ──────────────────────────────────────────────────────────────

  server.tool(
    'list_gaps',
    'List ontology gaps and uncertainties.',
    {
      status: z.enum(['open', 'in_progress', 'resolved']).optional(),
      severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    },
    async (args) => {
      let gaps = manager.listGaps(args.status);
      if (args.severity) gaps = gaps.filter((g) => g.severity === args.severity);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(gaps, null, 2) }],
      };
    }
  );

  server.tool(
    'report_gap',
    'Report a new gap or uncertainty in the ontology.',
    {
      type: z.enum([
        'missing_concept', 'missing_relationship', 'missing_mapping',
        'ambiguous_mapping', 'incomplete_definition', 'conflicting_data',
        'unknown_system', 'stale_data',
      ]),
      description: z.string(),
      affected_concept_ids: z.array(z.string()).optional().default([]),
      severity: z.enum(['critical', 'high', 'medium', 'low']).optional().default('medium'),
      source: z.string().optional(),
    },
    async (args) => {
      const gap = manager.addGap({
        type: args.type,
        description: args.description,
        affectedConceptIds: args.affected_concept_ids ?? [],
        severity: (args.severity ?? 'medium') as GapSeverity,
        status: 'open',
        source: args.source,
      });
      manager.save();
      return {
        content: [
          {
            type: 'text' as const,
            text: `Reported gap with id: ${gap.id}`,
          },
        ],
      };
    }
  );

  server.tool(
    'resolve_gap',
    'Mark an ontology gap as resolved.',
    {
      gap_id: z.string(),
      resolution: z.string().describe('Description of how the gap was resolved'),
    },
    async (args) => {
      try {
        const gap = manager.resolveGap(args.gap_id, args.resolution);
        manager.save();
        return {
          content: [
            {
              type: 'text' as const,
              text: `Gap ${gap.id} resolved: ${args.resolution}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: String(err) }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'analyze_gaps',
    'Run automated gap analysis to detect new gaps in the ontology.',
    {},
    async () => {
      const report = gapAnalyzer.analyze();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(report, null, 2) }],
      };
    }
  );

  server.tool(
    'describe_uncertainty',
    'Get a human-readable uncertainty report for a concept or the whole ontology.',
    {
      concept_id: z.string().optional().describe('Specific concept ID, or omit for global summary'),
    },
    async (args) => {
      const report = manager.describeUncertainty(args.concept_id);
      return {
        content: [{ type: 'text' as const, text: report }],
      };
    }
  );

  // ─── Orchestration Tools ────────────────────────────────────────────────────

  server.tool(
    'get_orchestration_context',
    'Given a finance task description, return relevant concepts, systems, data flow steps, and gaps to help an AI agent orchestrate calls across systems.',
    {
      task: z.string().describe('Natural language description of the finance task'),
    },
    async (args) => {
      const context = manager.buildOrchestrationContext(args.task);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(context, null, 2) }],
      };
    }
  );

  // ─── Prompts ────────────────────────────────────────────────────────────────

  server.prompt(
    'finance_task_context',
    'Generate context for an AI agent to understand which systems and concepts are relevant for a finance task.',
    {
      task: z.string().describe('The finance task to analyse'),
    },
    async (args) => {
      const context = manager.buildOrchestrationContext(args.task);
      const systems = context.relevantSystems;
      const gaps = context.gaps;

      const lines = [
        `You are assisting with the following finance task: **${args.task}**`,
        '',
        '## Relevant Ontology Concepts',
        ...context.relevantConcepts.map(
          (c) => `- **${c.name}** (${c.type}, confidence: ${(c.confidence * 100).toFixed(0)}%): ${c.description.slice(0, 100)}`
        ),
        '',
        '## Systems to Query',
        ...systems.map(
          (s) => `- **${s.name}** (${s.type}): ${s.baseUrl ?? 'no base URL configured'}`
        ),
        '',
        '## Suggested Data Flow',
        ...context.dataFlow.map(
          (step) =>
            `${step.step}. **${step.systemName}**: ${step.action}` +
            (step.endpoint ? ` → \`${step.endpoint}\`` : '') +
            (step.notes ? ` _(${step.notes})_` : '')
        ),
        '',
        '## Known Gaps & Uncertainties',
        ...(gaps.length === 0
          ? ['None']
          : gaps.map((g) => `- [${g.severity.toUpperCase()}] ${g.type}: ${g.description}`)),
        '',
        `Overall ontology confidence for this task: **${(context.confidence * 100).toFixed(0)}%**`,
        ...(context.warnings.length > 0
          ? ['', '## Warnings', ...context.warnings.map((w) => `- ⚠️ ${w}`)]
          : []),
      ];

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: lines.join('\n'),
            },
          },
        ],
      };
    }
  );

  server.prompt(
    'gap_analysis_report',
    'Generate a structured gap analysis report of the finance ontology.',
    {},
    async () => {
      const report = manager.describeUncertainty();
      const gapAnalyzerReport = gapAnalyzer.analyze();

      return {
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: [
                report,
                '',
                '## Automated Analysis Results',
                `New gaps detected this run: ${gapAnalyzerReport.newGapsCreated}`,
                gapAnalyzerReport.summary,
              ].join('\n'),
            },
          },
        ],
      };
    }
  );

  return server;
}
