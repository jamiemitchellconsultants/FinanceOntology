/**
 * Tests for OntologyManager — core CRUD, semantic queries, and orchestration.
 */

import { OntologyManager } from '../src/ontology/manager.js';
import { OntologyStore } from '../src/ontology/store.js';
import { FINANCE_SEED } from '../src/seed/finance-seed.js';
import type { OntologyData } from '../src/ontology/types.js';

/** Create an in-memory store backed by a given data object */
function createInMemoryManager(seed = true): OntologyManager {
  const data: OntologyData = {
    version: '1.0.0',
    concepts: {},
    relationships: [],
    gaps: [],
    systems: {},
    ingestionHistory: [],
    lastUpdated: new Date().toISOString(),
  };

  // Patch store to use in-memory object
  const store = new OntologyStore('/nonexistent/path.json');
  // @ts-expect-error accessing private for test purposes
  store.data = data;
  // Override save to no-op
  store.save = () => {};

  const manager = new OntologyManager(store);
  if (seed) {
    manager.loadSeed(FINANCE_SEED);
  }
  return manager;
}

describe('OntologyManager — Concepts', () => {
  let manager: OntologyManager;

  beforeEach(() => {
    manager = createInMemoryManager(false);
  });

  test('add and retrieve a concept', () => {
    const concept = manager.addConcept({
      name: 'Test Account',
      type: 'entity',
      description: 'A test account',
      attributes: {},
      systemMappings: [],
      tags: ['test'],
      confidence: 0.8,
    });

    expect(concept.id).toBeDefined();
    expect(concept.name).toBe('Test Account');
    expect(concept.confidence).toBe(0.8);

    const retrieved = manager.getConcept(concept.id);
    expect(retrieved).toEqual(concept);
  });

  test('list concepts with type filter', () => {
    manager.addConcept({ name: 'Entity A', type: 'entity', description: '', attributes: {}, systemMappings: [], tags: [], confidence: 0.9 });
    manager.addConcept({ name: 'Process B', type: 'process', description: '', attributes: {}, systemMappings: [], tags: [], confidence: 0.7 });

    const entities = manager.listConcepts({ type: 'entity' });
    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe('Entity A');
  });

  test('list concepts with text search', () => {
    manager.addConcept({ name: 'Invoice Processing', type: 'process', description: 'handles invoices', attributes: {}, systemMappings: [], tags: [], confidence: 0.8 });
    manager.addConcept({ name: 'Bank Account', type: 'entity', description: 'banking', attributes: {}, systemMappings: [], tags: [], confidence: 0.9 });

    const results = manager.listConcepts({ search: 'invoice' });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Invoice Processing');
  });

  test('update a concept', () => {
    const concept = manager.addConcept({ name: 'Old Name', type: 'entity', description: 'old', attributes: {}, systemMappings: [], tags: [], confidence: 0.5 });
    const updated = manager.updateConcept(concept.id, { name: 'New Name', confidence: 0.9 });
    expect(updated.name).toBe('New Name');
    expect(updated.confidence).toBe(0.9);
    expect(updated.id).toBe(concept.id);
  });

  test('update throws for unknown concept', () => {
    expect(() => manager.updateConcept('nonexistent', { name: 'x' })).toThrow('not found');
  });

  test('delete a concept removes it and orphan relationships', () => {
    const a = manager.addConcept({ name: 'A', type: 'entity', description: '', attributes: {}, systemMappings: [], tags: [], confidence: 0.9 });
    const b = manager.addConcept({ name: 'B', type: 'entity', description: '', attributes: {}, systemMappings: [], tags: [], confidence: 0.9 });
    manager.addRelationship({ fromConceptId: a.id, toConceptId: b.id, type: 'references', confidence: 0.9 });

    expect(manager.listRelationships().length).toBe(1);
    manager.deleteConcept(a.id);
    expect(manager.getConcept(a.id)).toBeUndefined();
    expect(manager.listRelationships().length).toBe(0);
  });
});

describe('OntologyManager — Relationships', () => {
  let manager: OntologyManager;

  beforeEach(() => {
    manager = createInMemoryManager(false);
  });

  test('add and retrieve relationship', () => {
    const a = manager.addConcept({ name: 'Invoice', type: 'entity', description: '', attributes: {}, systemMappings: [], tags: [], confidence: 0.9 });
    const b = manager.addConcept({ name: 'Vendor', type: 'entity', description: '', attributes: {}, systemMappings: [], tags: [], confidence: 0.9 });
    const rel = manager.addRelationship({ fromConceptId: a.id, toConceptId: b.id, type: 'references', confidence: 0.95 });

    expect(rel.id).toBeDefined();
    expect(manager.getRelationship(rel.id)).toEqual(rel);
  });

  test('throws when adding relationship with nonexistent concept', () => {
    const a = manager.addConcept({ name: 'A', type: 'entity', description: '', attributes: {}, systemMappings: [], tags: [], confidence: 0.9 });
    expect(() =>
      manager.addRelationship({ fromConceptId: a.id, toConceptId: 'nonexistent', type: 'references', confidence: 0.9 })
    ).toThrow('not found');
  });

  test('filter relationships by conceptId', () => {
    const a = manager.addConcept({ name: 'A', type: 'entity', description: '', attributes: {}, systemMappings: [], tags: [], confidence: 0.9 });
    const b = manager.addConcept({ name: 'B', type: 'entity', description: '', attributes: {}, systemMappings: [], tags: [], confidence: 0.9 });
    const c = manager.addConcept({ name: 'C', type: 'entity', description: '', attributes: {}, systemMappings: [], tags: [], confidence: 0.9 });
    manager.addRelationship({ fromConceptId: a.id, toConceptId: b.id, type: 'references', confidence: 0.9 });
    manager.addRelationship({ fromConceptId: b.id, toConceptId: c.id, type: 'references', confidence: 0.9 });

    const aRels = manager.listRelationships({ conceptId: a.id });
    expect(aRels).toHaveLength(1);
    expect(aRels[0].fromConceptId).toBe(a.id);
  });
});

describe('OntologyManager — Gaps', () => {
  let manager: OntologyManager;

  beforeEach(() => {
    manager = createInMemoryManager(false);
  });

  test('add and list gaps', () => {
    manager.addGap({ type: 'missing_mapping', description: 'Test gap', affectedConceptIds: [], severity: 'high', status: 'open' });
    expect(manager.listGaps()).toHaveLength(1);
  });

  test('filter gaps by status', () => {
    manager.addGap({ type: 'missing_mapping', description: 'Open gap', affectedConceptIds: [], severity: 'medium', status: 'open' });
    manager.addGap({ type: 'unknown_system', description: 'Resolved gap', affectedConceptIds: [], severity: 'low', status: 'resolved' });

    expect(manager.listGaps('open')).toHaveLength(1);
    expect(manager.listGaps('resolved')).toHaveLength(1);
  });

  test('resolve a gap', () => {
    const gap = manager.addGap({ type: 'missing_mapping', description: 'Gap', affectedConceptIds: [], severity: 'medium', status: 'open' });
    const resolved = manager.resolveGap(gap.id, 'Fixed by adding mapping');
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolution).toBe('Fixed by adding mapping');
    expect(resolved.resolvedAt).toBeDefined();
  });
});

describe('OntologyManager — Semantic Queries (seeded)', () => {
  let manager: OntologyManager;

  beforeEach(() => {
    manager = createInMemoryManager(true);
  });

  test('seed loads expected number of concepts', () => {
    const concepts = manager.listConcepts();
    expect(concepts.length).toBeGreaterThanOrEqual(12);
  });

  test('findRelatedConcepts from General Ledger', () => {
    const related = manager.findRelatedConcepts('general_ledger', 1);
    const names = related.map((r) => r.concept.name);
    expect(names).toContain('Chart of Accounts');
    expect(names).toContain('Cost Center');
  });

  test('findPath from budget_vs_actuals to cost_center', () => {
    const path = manager.findPath('budget_vs_actuals', 'cost_center');
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
  });

  test('findPath returns null for disconnected concepts', () => {
    // Add an isolated concept
    const isolated = manager.addConcept({ name: 'Isolated', type: 'entity', description: '', attributes: {}, systemMappings: [], tags: [], confidence: 0.5 });
    const path = manager.findPath('general_ledger', isolated.id);
    expect(path).toBeNull();
  });

  test('buildOrchestrationContext returns relevant data', () => {
    const ctx = manager.buildOrchestrationContext('get budget vs actuals for cost center');
    expect(ctx.relevantConcepts.length).toBeGreaterThan(0);
    expect(ctx.confidence).toBeGreaterThanOrEqual(0);
    expect(ctx.confidence).toBeLessThanOrEqual(1);
    // Should find budget and GL concepts
    const names = ctx.relevantConcepts.map((c) => c.name);
    expect(names.some((n) => n.toLowerCase().includes('budget'))).toBe(true);
  });

  test('describeUncertainty returns string', () => {
    const report = manager.describeUncertainty();
    expect(typeof report).toBe('string');
    expect(report).toContain('Uncertainty');
  });

  test('describeUncertainty for specific concept', () => {
    const report = manager.describeUncertainty('general_ledger');
    expect(report).toContain('General Ledger');
    expect(report).toContain('Confidence');
  });

  test('getStats returns expected keys', () => {
    const stats = manager.getStats();
    expect(stats).toHaveProperty('totalConcepts');
    expect(stats).toHaveProperty('totalRelationships');
    expect(stats).toHaveProperty('totalSystems');
    expect(stats).toHaveProperty('openGaps');
    expect(typeof stats['totalConcepts']).toBe('number');
  });
});

describe('OntologyManager — Systems', () => {
  let manager: OntologyManager;

  beforeEach(() => {
    manager = createInMemoryManager(true);
  });

  test('seed loads expected systems', () => {
    const systems = manager.listSystems();
    expect(systems.length).toBeGreaterThanOrEqual(6);
    const names = systems.map((s) => s.name);
    expect(names).toContain('ERP System');
    expect(names).toContain('AP Automation');
  });

  test('add a new system', () => {
    const system = manager.addSystem({
      name: 'New Tax System',
      type: 'tax',
      description: 'Tax compliance',
      status: 'unknown',
    });
    expect(system.id).toBeDefined();
    expect(manager.getSystem(system.id)).toEqual(system);
  });

  test('listConcepts filtered by systemId returns correct concepts', () => {
    const concepts = manager.listConcepts({ systemId: 'erp' });
    expect(concepts.length).toBeGreaterThan(0);
    concepts.forEach((c) => {
      expect(c.systemMappings.some((m) => m.systemId === 'erp')).toBe(true);
    });
  });
});
