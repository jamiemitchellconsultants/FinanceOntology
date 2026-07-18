import type {
  SystemDef,
  IngestionResult,
  IngestionMapping,
  Concept,
  SystemMapping,
  FieldMapping,
} from '../ontology/types.js';
import type { OntologyManager } from '../ontology/manager.js';
import type { LlmService, IngestionMappingProposal } from '../services/llm.js';
import { HIGH_CONFIDENCE_THRESHOLD } from '../services/llm.js';

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

/**
 * Flatten the first record of a JSON payload to a list of dot-notation field paths.
 * Used to identify what fields are present in an API response for LLM mapping.
 */
function extractFieldPaths(payload: unknown, maxDepth = 2, prefix = ''): string[] {
  if (typeof payload !== 'object' || payload === null) return prefix ? [prefix] : [];
  if (Array.isArray(payload)) {
    const item = payload[0];
    return item !== undefined ? extractFieldPaths(item, maxDepth, prefix) : [];
  }
  const fields: string[] = [];
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    fields.push(path);
    if (maxDepth > 1 && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      fields.push(...extractFieldPaths(value, maxDepth - 1, path));
    }
  }
  return fields;
}

export class ApiConnector {
  private manager: OntologyManager;
  private llmService?: LlmService;

  constructor(manager: OntologyManager, llmService?: LlmService) {
    this.manager = manager;
    this.llmService = llmService;
  }

  /**
   * Ingest data from a registered system's REST API.
   * When an LlmService is available, field names are proposed against existing
   * ontology concepts using gpt-4o-mini (workhorse tier) before the configured
   * ingestionConfig mappings are applied as a supplementary pass.
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

    const endpoint = system.ingestionConfig.endpoint ?? system.baseUrl;
    if (!endpoint) {
      return this.errorResult(systemId, `System ${system.name} has no endpoint configured`);
    }

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

      const timeoutMs = system.ingestionConfig.timeoutMs ?? 30_000;
      const response = await fetch(endpoint, {
        headers: mergedHeaders,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const payload: unknown = await response.json();

      if (this.llmService?.isAvailable()) {
        await this.applyLlmFieldMappings(system, payload, result);
      }

      // Always apply operator-configured mappings (these are trusted)
      const mappings = system.ingestionConfig.mappings ?? [];
      if (mappings.length > 0) {
        this.applyMappings(system, payload, mappings, result);
      }

      this.manager.updateSystem(systemId, { status: 'active', lastIngestedAt: result.timestamp });
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
   * Register a new system from an OpenAPI/Swagger-like schema object and
   * auto-generate concept candidates.
   *
   * When an LlmService is available, each entity schema is mapped to existing
   * ontology concepts using gpt-4o (architect tier):
   * - confidence >= 0.85  → update the existing concept with a SystemMapping
   * - confidence <  0.85  → report a gap; the entity remains unmapped
   * Entities not covered by any LLM proposal fall through to deterministic
   * concept creation (confidence 0.4, flagged for review).
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

      if (this.llmService?.isAvailable()) {
        const handled = new Set<string>();
        const gapped = new Set<string>();

        const incomingFields = Object.entries(schemas).map(([entityName, entitySchema]) => ({
          name: entityName,
          description: (entitySchema as Record<string, unknown>).description as string | undefined,
        }));

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

            if (proposal.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
              if (concept) {
                const entitySchema = schemas[proposal.incomingField] as Record<string, unknown> | undefined;
                this.applySchemaMapping(concept, system, proposal.incomingField, entitySchema, result);
                handled.add(proposal.incomingField);
              } else {
                // High confidence but mappedConceptId doesn't exist — the LLM
                // hallucinated an ID. Report it distinctly from a genuinely
                // low-confidence mapping, and deliberately do NOT add it to
                // `gapped` so the deterministic fallback below still creates
                // the concept instead of losing the entity entirely.
                this.reportHallucinatedProposal(system.id, proposal, result);
              }
            } else {
              this.reportLlmGap(system.id, proposal, result);
              gapped.add(proposal.incomingField);
            }
          }
        } catch (err) {
          result.errors.push(`LLM proposal failed: ${String(err)}`);
        }

        // Deterministic fallback for entities the LLM did not handle
        for (const [entityName, entitySchema] of Object.entries(schemas)) {
          if (handled.has(entityName) || gapped.has(entityName)) continue;
          this.createConceptDeterministic(entityName, entitySchema as Record<string, unknown>, system, result);
        }
      } else {
        // Deterministic path — unchanged behaviour when LLM is unavailable
        for (const [entityName, entitySchema] of Object.entries(schemas)) {
          this.createConceptDeterministic(entityName, entitySchema as Record<string, unknown>, system, result);
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

  // ─── LLM helpers ──────────────────────────────────────────────────────────

  /**
   * Extract field paths from the API payload, ask gpt-4o-mini to map them to
   * existing concepts, then apply the threshold logic.
   */
  private async applyLlmFieldMappings(
    system: SystemDef,
    payload: unknown,
    result: IngestionResult
  ): Promise<void> {
    if (!this.llmService) return; // Only reachable via an isAvailable() guard, but make it explicit

    const fieldPaths = extractFieldPaths(payload);
    if (fieldPaths.length === 0) return;

    const incomingFields = fieldPaths.map((f) => ({ name: f }));
    const existingConcepts = this.manager.listConcepts().map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      description: c.description.slice(0, 120),
    }));

    try {
      const proposals = await this.llmService.proposeMappings(
        'workhorse',
        { systemName: system.name, systemType: system.type, incomingFields },
        existingConcepts
      );

      for (const proposal of proposals) {
        const concept = this.manager.getConcept(proposal.mappedConceptId);

        if (proposal.confidence >= HIGH_CONFIDENCE_THRESHOLD) {
          if (concept) {
            this.applyFieldMapping(concept, system, proposal.incomingField, result);
          } else {
            this.reportHallucinatedProposal(system.id, proposal, result);
          }
        } else {
          this.reportLlmGap(system.id, proposal, result);
        }
      }
    } catch (err) {
      result.errors.push(`LLM proposal failed: ${String(err)}`);
    }
  }

  /**
   * High-confidence schema path: update an existing concept to record its
   * mapping to this system entity, including property-level field mappings.
   */
  private applySchemaMapping(
    concept: Concept,
    system: SystemDef,
    entityName: string,
    entitySchema: Record<string, unknown> | undefined,
    result: IngestionResult
  ): void {
    const fieldMappings: FieldMapping[] = [];
    const props = entitySchema?.properties as Record<string, unknown> | undefined;
    if (props) {
      for (const fieldName of Object.keys(props)) {
        fieldMappings.push({
          ontologyField: this.toOntologyFieldName(fieldName),
          systemField: fieldName,
        });
      }
    }

    const updatedMappings = [...concept.systemMappings];
    const idx = updatedMappings.findIndex(
      (m) => m.systemId === system.id && m.entityName === entityName
    );
    const systemMapping: SystemMapping = { systemId: system.id, entityName, fieldMappings };

    if (idx >= 0) {
      updatedMappings[idx] = systemMapping;
    } else {
      updatedMappings.push(systemMapping);
    }

    this.manager.updateConcept(concept.id, { systemMappings: updatedMappings });
    result.conceptsUpdated++;
  }

  /**
   * High-confidence transactional path: update an existing concept to record
   * that a specific API response field maps to it.
   */
  private applyFieldMapping(
    concept: Concept,
    system: SystemDef,
    fieldPath: string,
    result: IngestionResult
  ): void {
    const entityName = fieldPath.split('.')[0] ?? fieldPath;
    const systemField = fieldPath.split('.').pop() ?? fieldPath;
    const newFieldMapping: FieldMapping = {
      ontologyField: this.toOntologyFieldName(systemField),
      systemField: fieldPath,
    };

    const updatedMappings = [...concept.systemMappings];
    const idx = updatedMappings.findIndex((m) => m.systemId === system.id);

    if (idx >= 0) {
      const existing = { ...updatedMappings[idx] };
      if (!existing.fieldMappings.some((f) => f.systemField === fieldPath)) {
        existing.fieldMappings = [...existing.fieldMappings, newFieldMapping];
      }
      updatedMappings[idx] = existing;
    } else {
      updatedMappings.push({ systemId: system.id, entityName, fieldMappings: [newFieldMapping] });
    }

    this.manager.updateConcept(concept.id, { systemMappings: updatedMappings });
    result.conceptsUpdated++;
  }

  /**
   * Trusted operator-configured path (applyMappings): the target concept already
   * exists, so upsert a SystemMapping/FieldMapping for it rather than dropping the
   * mapping — this ensures repeat ingestion runs keep recording/refreshing the
   * mapping instead of silently no-op'ing once the concept has been created.
   */
  private upsertOperatorMapping(
    concept: Concept,
    system: SystemDef,
    mapping: IngestionMapping,
    result: IngestionResult
  ): void {
    const entityName = mapping.sourcePath.split('.')[0] ?? mapping.sourcePath;
    const ontologyField =
      mapping.targetField ?? this.toOntologyFieldName(mapping.sourcePath.split('.').pop() ?? mapping.sourcePath);
    const newFieldMapping: FieldMapping = { ontologyField, systemField: mapping.sourcePath };

    const updatedMappings = [...concept.systemMappings];
    const idx = updatedMappings.findIndex((m) => m.systemId === system.id);

    if (idx >= 0) {
      const existing = { ...updatedMappings[idx] };
      const fieldIdx = existing.fieldMappings.findIndex((f) => f.systemField === mapping.sourcePath);
      existing.fieldMappings =
        fieldIdx >= 0
          ? existing.fieldMappings.map((f, i) => (i === fieldIdx ? newFieldMapping : f))
          : [...existing.fieldMappings, newFieldMapping];
      updatedMappings[idx] = existing;
    } else {
      updatedMappings.push({ systemId: system.id, entityName, fieldMappings: [newFieldMapping] });
    }

    this.manager.updateConcept(concept.id, { systemMappings: updatedMappings });
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

  /** Create a low-confidence placeholder concept for an entity not handled by LLM. */
  private createConceptDeterministic(
    entityName: string,
    entitySchema: Record<string, unknown>,
    system: SystemDef,
    result: IngestionResult
  ): void {
    const description =
      typeof entitySchema.description === 'string'
        ? entitySchema.description
        : `${entityName} from ${system.name}`;

    const existing = this.manager.listConcepts({ systemId: system.id, search: entityName });
    if (existing.length > 0) return;

    const systemMapping: SystemMapping = { systemId: system.id, entityName, fieldMappings: [] };
    const props = entitySchema.properties as Record<string, unknown> | undefined;
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
      tags: [system.type, system.id],
      confidence: 0.4,
    });
    result.conceptsCreated++;
  }

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
        if (concept) {
          this.upsertOperatorMapping(concept, system, mapping, result);
          continue;
        }

        const created = this.manager.addConcept({
          name: mapping.sourcePath,
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

        this.manager.addGap({
          type: 'incomplete_definition',
          description: `Auto-discovered concept "${created.name}" needs review`,
          affectedConceptIds: [created.id],
          severity: 'low',
          status: 'open',
          source: `api_connector:${system.id}`,
        });
        result.gapsDetected++;
      }
    }
  }

  private toOntologyFieldName(systemField: string): string {
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
