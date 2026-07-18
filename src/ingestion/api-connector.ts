/**
 * REST API Ingestion Connector.
 *
 * Fetches data from a REST endpoint and maps the response
 * to ontology concepts using the system's IngestionConfig.
 */

import type {
  SystemDef,
  IngestionResult,
  IngestionMapping,
  Concept,
  SystemMapping,
} from '../ontology/types.js';
import type { OntologyManager } from '../ontology/manager.js';

/** Resolve a dot-notation / bracket-notation path in an object */
function resolvePath(obj: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export class ApiConnector {
  private manager: OntologyManager;

  constructor(manager: OntologyManager) {
    this.manager = manager;
  }

  /**
   * Ingest data from a registered system's REST API.
   * Uses the system's ingestionConfig to fetch and map data.
   *
   * @param systemId - ID of the SystemDef to ingest from
   * @param headers  - Additional request headers (e.g. auth tokens)
   */
  async ingest(
    systemId: string,
    headers: Record<string, string> = {}
  ): Promise<IngestionResult> {
    const system = this.manager.getSystem(systemId);
    if (!system) {
      return this.errorResult(systemId, `System not found: ${systemId}`);
    }
    if (!system.ingestionConfig) {
      return this.errorResult(systemId, `System ${system.name} has no ingestion config`);
    }
    if (system.ingestionConfig.type !== 'rest_api') {
      return this.errorResult(
        systemId,
        `System ${system.name} ingestion type is not rest_api (got: ${system.ingestionConfig.type})`
      );
    }

    const endpoint =
      system.ingestionConfig.endpoint ??
      system.baseUrl;

    if (!endpoint) {
      return this.errorResult(systemId, `System ${system.name} has no endpoint configured`);
    }

    // Mark as ingesting
    this.manager.updateSystem(systemId, { status: 'ingesting' });

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

    try {
      const mergedHeaders: Record<string, string> = {
        'Accept': 'application/json',
        ...(system.ingestionConfig.headers ?? {}),
        ...headers,
      };

      const response = await fetch(endpoint, { headers: mergedHeaders });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const payload: unknown = await response.json();
      const mappings = system.ingestionConfig.mappings ?? [];

      this.applyMappings(system, payload, mappings, result);

      // Update system last-ingested timestamp
      this.manager.updateSystem(systemId, {
        status: 'active',
        lastIngestedAt: result.timestamp,
      });
      result.success = true;
    } catch (err) {
      result.errors.push(String(err));
      this.manager.updateSystem(systemId, { status: 'active' });
    }

    this.manager.recordIngestionResult(result);
    this.manager.save();
    return result;
  }

  /**
   * Register a new system from an OpenAPI/Swagger-like schema object
   * and auto-generate concept candidates.
   */
  async discoverFromSchema(
    systemId: string,
    schema: Record<string, unknown>
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

    try {
      const components = schema.components as Record<string, unknown> | undefined;
      const schemas = components?.schemas as Record<string, unknown> | undefined;

      if (!schemas) {
        result.errors.push('No schemas found in provided OpenAPI document');
        return result;
      }

      for (const [entityName, entitySchema] of Object.entries(schemas)) {
        const entity = entitySchema as Record<string, unknown>;
        const description =
          typeof entity.description === 'string'
            ? entity.description
            : `${entityName} from ${system.name}`;

        // Check if we already have this concept mapped
        const existing = this.manager.listConcepts({
          systemId,
          search: entityName,
        });

        if (existing.length === 0) {
          const systemMapping: SystemMapping = {
            systemId,
            entityName,
            fieldMappings: [],
          };

          // Extract field mappings from schema properties
          const props = entity.properties as Record<string, unknown> | undefined;
          if (props) {
            for (const [fieldName] of Object.entries(props)) {
              systemMapping.fieldMappings.push({
                ontologyField: this.toOntologyFieldName(fieldName),
                systemField: fieldName,
              });
            }
          }

          this.manager.addConcept({
            name: entityName,
            type: 'entity',
            description,
            attributes: {},
            systemMappings: [systemMapping],
            tags: [system.type, systemId],
            confidence: 0.4, // Low confidence — auto-discovered, needs review
          });
          result.conceptsCreated++;
        }
      }

      result.success = true;
    } catch (err) {
      result.errors.push(String(err));
    }

    this.manager.recordIngestionResult(result);
    this.manager.save();
    return result;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private applyMappings(
    system: SystemDef,
    payload: unknown,
    mappings: IngestionMapping[],
    result: IngestionResult
  ): void {
    const items = Array.isArray(payload) ? payload : [payload];

    for (const item of items) {
      for (const mapping of mappings) {
        const value = resolvePath(item, mapping.sourcePath);
        if (value === undefined) continue;

        const concept = this.manager.getConcept(mapping.targetConceptId ?? '');
        if (!concept) {
          // Auto-create a low-confidence concept placeholder
          const created = this.manager.addConcept({
            name: mapping.targetConceptId ?? mapping.sourcePath,
            type: 'entity',
            description: `Auto-discovered from ${system.name} field: ${mapping.sourcePath}`,
            attributes: {},
            systemMappings: [
              {
                systemId: system.id,
                entityName: mapping.sourcePath.split('.')[0] ?? mapping.sourcePath,
                fieldMappings: [],
              },
            ],
            tags: ['auto-discovered', system.type],
            confidence: 0.3,
          });
          result.conceptsCreated++;

          // Flag a gap for review
          this.manager.addGap({
            type: 'incomplete_definition',
            description: `Auto-discovered concept "${created.name}" needs review`,
            affectedConceptIds: [created.id],
            severity: 'low',
            status: 'open',
            source: `api_connector:${system.id}`,
          });
          result.gapsDetected++;
          continue;
        }

        if (mapping.targetField) {
          // Update a specific attribute value — stored as tag or attribute note for now
          this.manager.updateConcept(concept.id, {
            updatedAt: new Date().toISOString(),
          } as Partial<Concept>);
          result.conceptsUpdated++;
        }
      }
    }
  }

  private toOntologyFieldName(systemField: string): string {
    // Convert camelCase or snake_case to snake_case
    return systemField
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
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
