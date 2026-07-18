/**
 * OntologyManager — core business logic for the Finance Ontology.
 *
 * Provides CRUD operations, semantic querying (graph traversal,
 * similarity search, path-finding), and helper methods used by
 * the MCP server, ingestion layer, and gap analyser.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  Concept,
  ConceptType,
  Gap,
  GapSeverity,
  GapType,
  OntologyData,
  OrchestrationContext,
  DataFlowStep,
  Relationship,
  RelationshipType,
  SystemDef,
  IngestionResult,
} from './types.js';
import { OntologyStore } from './store.js';

export interface ConceptFilter {
  type?: ConceptType;
  tags?: string[];
  systemId?: string;
  minConfidence?: number;
  search?: string;  // Text search over name + description
}

export interface RelationshipFilter {
  fromConceptId?: string;
  toConceptId?: string;
  type?: RelationshipType;
  conceptId?: string;  // Either side
}

export class OntologyManager {
  private store: OntologyStore;

  constructor(store?: OntologyStore) {
    this.store = store ?? new OntologyStore();
  }

  // ─── Low-level data access ─────────────────────────────────────────────────

  getData(): OntologyData {
    return this.store.getData();
  }

  save(): void {
    this.store.save();
  }

  // ─── Concept CRUD ──────────────────────────────────────────────────────────

  getConcept(id: string): Concept | undefined {
    return this.store.getData().concepts[id];
  }

  listConcepts(filter?: ConceptFilter): Concept[] {
    const concepts = Object.values(this.store.getData().concepts);
    if (!filter) return concepts;

    return concepts.filter((c) => {
      if (filter.type && c.type !== filter.type) return false;
      if (filter.minConfidence !== undefined && c.confidence < filter.minConfidence) return false;
      if (filter.tags?.length) {
        if (!filter.tags.some((t) => c.tags.includes(t))) return false;
      }
      if (filter.systemId) {
        if (!c.systemMappings.some((m) => m.systemId === filter.systemId)) return false;
      }
      if (filter.search) {
        const q = filter.search.toLowerCase();
        if (
          !c.name.toLowerCase().includes(q) &&
          !c.description.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }

  addConcept(
    concept: Omit<Concept, 'id' | 'createdAt' | 'updatedAt'>
  ): Concept {
    const data = this.store.getData();
    const now = new Date().toISOString();
    const newConcept: Concept = {
      ...concept,
      id: uuidv4(),
      createdAt: now,
      updatedAt: now,
    };
    data.concepts[newConcept.id] = newConcept;
    return newConcept;
  }

  updateConcept(
    id: string,
    patch: Partial<Omit<Concept, 'id' | 'createdAt'>>
  ): Concept {
    const data = this.store.getData();
    const existing = data.concepts[id];
    if (!existing) throw new Error(`Concept not found: ${id}`);
    const updated: Concept = {
      ...existing,
      ...patch,
      id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    data.concepts[id] = updated;
    return updated;
  }

  deleteConcept(id: string): boolean {
    const data = this.store.getData();
    if (!data.concepts[id]) return false;
    delete data.concepts[id];
    // Remove orphan relationships
    data.relationships = data.relationships.filter(
      (r) => r.fromConceptId !== id && r.toConceptId !== id
    );
    return true;
  }

  // ─── Relationship CRUD ─────────────────────────────────────────────────────

  getRelationship(id: string): Relationship | undefined {
    return this.store.getData().relationships.find((r) => r.id === id);
  }

  listRelationships(filter?: RelationshipFilter): Relationship[] {
    const rels = this.store.getData().relationships;
    if (!filter) return rels;
    return rels.filter((r) => {
      if (filter.fromConceptId && r.fromConceptId !== filter.fromConceptId) return false;
      if (filter.toConceptId && r.toConceptId !== filter.toConceptId) return false;
      if (filter.type && r.type !== filter.type) return false;
      if (filter.conceptId) {
        if (r.fromConceptId !== filter.conceptId && r.toConceptId !== filter.conceptId) return false;
      }
      return true;
    });
  }

  addRelationship(
    rel: Omit<Relationship, 'id' | 'createdAt'>
  ): Relationship {
    const data = this.store.getData();
    if (!data.concepts[rel.fromConceptId])
      throw new Error(`Source concept not found: ${rel.fromConceptId}`);
    if (!data.concepts[rel.toConceptId])
      throw new Error(`Target concept not found: ${rel.toConceptId}`);
    const newRel: Relationship = {
      ...rel,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
    };
    data.relationships.push(newRel);
    return newRel;
  }

  deleteRelationship(id: string): boolean {
    const data = this.store.getData();
    const idx = data.relationships.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    data.relationships.splice(idx, 1);
    return true;
  }

  // ─── System CRUD ───────────────────────────────────────────────────────────

  getSystem(id: string): SystemDef | undefined {
    return this.store.getData().systems[id];
  }

  listSystems(): SystemDef[] {
    return Object.values(this.store.getData().systems);
  }

  addSystem(system: Omit<SystemDef, 'id'>): SystemDef {
    const data = this.store.getData();
    const newSystem: SystemDef = { ...system, id: uuidv4() };
    data.systems[newSystem.id] = newSystem;
    return newSystem;
  }

  updateSystem(id: string, patch: Partial<Omit<SystemDef, 'id'>>): SystemDef {
    const data = this.store.getData();
    const existing = data.systems[id];
    if (!existing) throw new Error(`System not found: ${id}`);
    const updated = { ...existing, ...patch, id };
    data.systems[id] = updated;
    return updated;
  }

  // ─── Gap CRUD ──────────────────────────────────────────────────────────────

  getGap(id: string): Gap | undefined {
    return this.store.getData().gaps.find((g) => g.id === id);
  }

  listGaps(status?: Gap['status']): Gap[] {
    const gaps = this.store.getData().gaps;
    if (!status) return gaps;
    return gaps.filter((g) => g.status === status);
  }

  addGap(gap: Omit<Gap, 'id' | 'discoveredAt'>): Gap {
    const data = this.store.getData();
    const newGap: Gap = {
      ...gap,
      id: uuidv4(),
      discoveredAt: new Date().toISOString(),
    };
    data.gaps.push(newGap);
    return newGap;
  }

  updateGap(id: string, patch: Partial<Omit<Gap, 'id' | 'discoveredAt'>>): Gap {
    const data = this.store.getData();
    const idx = data.gaps.findIndex((g) => g.id === id);
    if (idx === -1) throw new Error(`Gap not found: ${id}`);
    const updated: Gap = { ...data.gaps[idx], ...patch, id };
    data.gaps[idx] = updated;
    return updated;
  }

  resolveGap(id: string, resolution: string): Gap {
    return this.updateGap(id, {
      status: 'resolved',
      resolvedAt: new Date().toISOString(),
      resolution,
    });
  }

  // ─── Semantic Queries ──────────────────────────────────────────────────────

  /**
   * Find all concepts directly or transitively related to a given concept.
   * Uses BFS up to a configurable depth.
   */
  findRelatedConcepts(
    conceptId: string,
    maxDepth = 2,
    relTypes?: RelationshipType[]
  ): Array<{ concept: Concept; distance: number; via: Relationship[] }> {
    const data = this.store.getData();
    const results = new Map<string, { distance: number; via: Relationship[] }>();
    const queue: Array<{ id: string; depth: number; path: Relationship[] }> = [
      { id: conceptId, depth: 0, path: [] },
    ];
    const visited = new Set<string>([conceptId]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth > 0) {
        results.set(current.id, { distance: current.depth, via: current.path });
      }
      if (current.depth >= maxDepth) continue;

      const connected = data.relationships.filter((r) => {
        const touches =
          r.fromConceptId === current.id || r.toConceptId === current.id;
        if (!touches) return false;
        if (relTypes?.length && !relTypes.includes(r.type)) return false;
        return true;
      });

      for (const rel of connected) {
        const nextId =
          rel.fromConceptId === current.id ? rel.toConceptId : rel.fromConceptId;
        if (!visited.has(nextId)) {
          visited.add(nextId);
          queue.push({
            id: nextId,
            depth: current.depth + 1,
            path: [...current.path, rel],
          });
        }
      }
    }

    return Array.from(results.entries())
      .filter(([id]) => !!data.concepts[id])
      .map(([id, info]) => ({
        concept: data.concepts[id],
        distance: info.distance,
        via: info.via,
      }));
  }

  /**
   * Find the shortest relationship path between two concepts.
   * Returns null if no path exists within maxDepth hops.
   */
  findPath(
    fromId: string,
    toId: string,
    maxDepth = 4
  ): Relationship[] | null {
    if (fromId === toId) return [];
    const data = this.store.getData();

    const queue: Array<{ id: string; path: Relationship[] }> = [
      { id: fromId, path: [] },
    ];
    const visited = new Set<string>([fromId]);

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.path.length >= maxDepth) continue;

      const connected = data.relationships.filter(
        (r) =>
          r.fromConceptId === current.id || r.toConceptId === current.id
      );

      for (const rel of connected) {
        const nextId =
          rel.fromConceptId === current.id ? rel.toConceptId : rel.fromConceptId;
        const newPath = [...current.path, rel];
        if (nextId === toId) return newPath;
        if (!visited.has(nextId)) {
          visited.add(nextId);
          queue.push({ id: nextId, path: newPath });
        }
      }
    }
    return null;
  }

  /**
   * Build orchestration context: given a natural-language task description,
   * find relevant concepts, systems, data flow steps, and any gaps.
   */
  buildOrchestrationContext(task: string): OrchestrationContext {
    const data = this.store.getData();
    const taskLower = task.toLowerCase();

    // Simple keyword match — replace with embedding-based search in production
    const keywords = taskLower.split(/\W+/).filter((w) => w.length > 3);

    const scoredConcepts = Object.values(data.concepts).map((c) => {
      let score = 0;
      for (const kw of keywords) {
        if (c.name.toLowerCase().includes(kw)) score += 3;
        if (c.description.toLowerCase().includes(kw)) score += 1;
        if (c.tags.some((t) => t.toLowerCase().includes(kw))) score += 2;
      }
      return { concept: c, score };
    });

    const relevantConcepts = scoredConcepts
      .filter((sc) => sc.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map((sc) => sc.concept);

    // Collect all systems involved
    const systemIds = new Set<string>();
    for (const concept of relevantConcepts) {
      for (const mapping of concept.systemMappings) {
        systemIds.add(mapping.systemId);
      }
    }
    const relevantSystems = Array.from(systemIds)
      .map((id) => data.systems[id])
      .filter(Boolean);

    // Build data flow steps
    const dataFlow: DataFlowStep[] = [];
    let step = 1;
    for (const concept of relevantConcepts.slice(0, 5)) {
      for (const mapping of concept.systemMappings) {
        const sys = data.systems[mapping.systemId];
        if (!sys) continue;
        dataFlow.push({
          step: step++,
          systemId: sys.id,
          systemName: sys.name,
          action: `Retrieve ${concept.name}`,
          endpoint: mapping.apiEndpoint
            ? `${sys.baseUrl ?? ''}${mapping.apiEndpoint}`
            : undefined,
          conceptIds: [concept.id],
          notes: mapping.notes,
        });
      }
    }

    // Surface open gaps related to relevant concepts
    const relevantIds = new Set(relevantConcepts.map((c) => c.id));
    const relevantGaps = data.gaps.filter(
      (g) =>
        g.status !== 'resolved' &&
        g.affectedConceptIds.some((id) => relevantIds.has(id))
    );

    // Warnings for low-confidence concepts
    const warnings: string[] = [];
    for (const concept of relevantConcepts) {
      if (concept.confidence < 0.5) {
        warnings.push(
          `Concept "${concept.name}" has low confidence (${(concept.confidence * 100).toFixed(0)}%)`
        );
      }
      if (concept.systemMappings.length === 0) {
        warnings.push(`Concept "${concept.name}" has no system mappings`);
      }
    }

    const overallConfidence =
      relevantConcepts.length > 0
        ? relevantConcepts.reduce((sum, c) => sum + c.confidence, 0) /
          relevantConcepts.length
        : 0;

    return {
      task,
      relevantConcepts,
      relevantSystems,
      dataFlow,
      gaps: relevantGaps,
      confidence: Math.round(overallConfidence * 100) / 100,
      warnings,
    };
  }

  // ─── Ingestion History ─────────────────────────────────────────────────────

  recordIngestionResult(result: IngestionResult): void {
    const data = this.store.getData();
    data.ingestionHistory.push(result);
    // Keep last 100 entries
    if (data.ingestionHistory.length > 100) {
      data.ingestionHistory = data.ingestionHistory.slice(-100);
    }
  }

  // ─── Bulk Load (used by seed) ──────────────────────────────────────────────

  loadSeed(seedData: Partial<OntologyData>): void {
    const data = this.store.getData();
    if (seedData.concepts) {
      Object.assign(data.concepts, seedData.concepts);
    }
    if (seedData.relationships) {
      data.relationships.push(...seedData.relationships);
    }
    if (seedData.gaps) {
      data.gaps.push(...seedData.gaps);
    }
    if (seedData.systems) {
      Object.assign(data.systems, seedData.systems);
    }
  }

  // ─── Statistics ────────────────────────────────────────────────────────────

  getStats(): Record<string, number | string> {
    const data = this.store.getData();
    const openGaps = data.gaps.filter((g) => g.status !== 'resolved');
    const avgConfidence =
      Object.values(data.concepts).length > 0
        ? Object.values(data.concepts).reduce((s, c) => s + c.confidence, 0) /
          Object.values(data.concepts).length
        : 0;

    return {
      totalConcepts: Object.keys(data.concepts).length,
      totalRelationships: data.relationships.length,
      totalSystems: Object.keys(data.systems).length,
      totalGaps: data.gaps.length,
      openGaps: openGaps.length,
      criticalGaps: openGaps.filter((g) => g.severity === 'critical').length,
      averageConfidence: Math.round(avgConfidence * 100) / 100,
      lastUpdated: data.lastUpdated,
    };
  }

  // ─── Describe Uncertainty ─────────────────────────────────────────────────

  describeUncertainty(conceptId?: string): string {
    const data = this.store.getData();

    if (conceptId) {
      const concept = data.concepts[conceptId];
      if (!concept) return `Unknown concept: ${conceptId}`;
      const gaps = data.gaps.filter(
        (g) => g.status !== 'resolved' && g.affectedConceptIds.includes(conceptId)
      );
      const related = this.findRelatedConcepts(conceptId, 1);
      const lines: string[] = [
        `## Uncertainty Report: ${concept.name}`,
        ``,
        `**Confidence:** ${(concept.confidence * 100).toFixed(0)}%`,
        `**Type:** ${concept.type}`,
        `**System Mappings:** ${concept.systemMappings.length}`,
        ``,
      ];
      if (gaps.length > 0) {
        lines.push(`### Open Gaps (${gaps.length})`);
        for (const g of gaps) {
          lines.push(`- [${g.severity.toUpperCase()}] ${g.type}: ${g.description}`);
        }
        lines.push('');
      }
      if (concept.systemMappings.length === 0) {
        lines.push('⚠️  No system mappings — agents cannot retrieve this data automatically.');
      }
      if (concept.confidence < 0.5) {
        lines.push('⚠️  Low confidence — definition may be incomplete or contested.');
      }
      if (related.length === 0) {
        lines.push('⚠️  No relationships defined — this concept is isolated in the ontology.');
      }
      return lines.join('\n');
    }

    // Global uncertainty summary
    const concepts = Object.values(data.concepts);
    const openGaps = data.gaps.filter((g) => g.status !== 'resolved');
    const lowConf = concepts.filter((c) => c.confidence < 0.5);
    const noMappings = concepts.filter((c) => c.systemMappings.length === 0);

    const lines = [
      `## Ontology Uncertainty Summary`,
      ``,
      `- **Total Concepts:** ${concepts.length}`,
      `- **Low-Confidence Concepts (<50%):** ${lowConf.length}`,
      `- **Concepts Without System Mappings:** ${noMappings.length}`,
      `- **Open Gaps:** ${openGaps.length}`,
      `  - Critical: ${openGaps.filter((g) => g.severity === 'critical').length}`,
      `  - High: ${openGaps.filter((g) => g.severity === 'high').length}`,
      `  - Medium: ${openGaps.filter((g) => g.severity === 'medium').length}`,
      `  - Low: ${openGaps.filter((g) => g.severity === 'low').length}`,
    ];

    if (openGaps.length > 0) {
      lines.push('', '### Most Severe Open Gaps');
      const topGaps = openGaps
        .sort((a, b) => {
          const order: GapSeverity[] = ['critical', 'high', 'medium', 'low'];
          return order.indexOf(a.severity) - order.indexOf(b.severity);
        })
        .slice(0, 5);
      for (const g of topGaps) {
        lines.push(`- [${g.severity.toUpperCase()}] ${g.type}: ${g.description}`);
      }
    }

    return lines.join('\n');
  }
}
