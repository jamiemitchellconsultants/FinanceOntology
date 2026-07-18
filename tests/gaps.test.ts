/**
 * Tests for GapAnalyzer — automatic gap detection.
 */

import { OntologyManager } from '../src/ontology/manager.js';
import { OntologyStore } from '../src/ontology/store.js';
import { GapAnalyzer } from '../src/gaps/analyzer.js';
import { FINANCE_SEED } from '../src/seed/finance-seed.js';
import type { OntologyData } from '../src/ontology/types.js';

function createTestManager(seed = false): OntologyManager {
  const data: OntologyData = {
    version: '1.0.0',
    concepts: {},
    relationships: [],
    gaps: [],
    systems: {},
    ingestionHistory: [],
    lastUpdated: new Date().toISOString(),
  };
  const store = new OntologyStore('/nonexistent/path.json');
  // @ts-expect-error accessing private for test purposes
  store.data = data;
  store.save = () => {};
  const manager = new OntologyManager(store);
  if (seed) manager.loadSeed(FINANCE_SEED);
  return manager;
}

describe('GapAnalyzer — basic detection', () => {
  test('detects concept with missing system mapping', () => {
    const manager = createTestManager();
    manager.addConcept({
      name: 'Unmapped Concept',
      type: 'entity',
      description: 'Has no system mappings',
      attributes: {},
      systemMappings: [],
      tags: [],
      confidence: 0.8,
    });

    const analyzer = new GapAnalyzer(manager);
    const report = analyzer.analyze();

    expect(report.newGapsCreated).toBeGreaterThan(0);
    const gaps = manager.listGaps('open');
    const mappingGap = gaps.find((g) => g.type === 'missing_mapping');
    expect(mappingGap).toBeDefined();
    expect(mappingGap?.description).toContain('Unmapped Concept');
  });

  test('detects low-confidence concept', () => {
    const manager = createTestManager();
    manager.addConcept({
      name: 'Vague Concept',
      type: 'entity',
      description: 'poorly defined',
      attributes: {},
      systemMappings: [{ systemId: 'sys1', entityName: 'Foo', fieldMappings: [] }],
      tags: [],
      confidence: 0.2,
    });

    const analyzer = new GapAnalyzer(manager);
    analyzer.analyze();

    const gaps = manager.listGaps('open');
    const confGap = gaps.find((g) => g.type === 'incomplete_definition');
    expect(confGap).toBeDefined();
    expect(confGap?.severity).toBe('high'); // 0.2 < 0.25 → high
  });

  test('detects isolated concept with no relationships', () => {
    const manager = createTestManager();
    manager.addConcept({
      name: 'Isolated Node',
      type: 'entity',
      description: 'No relationships',
      attributes: {},
      systemMappings: [{ systemId: 'sys1', entityName: 'Entity', fieldMappings: [] }],
      tags: [],
      confidence: 0.9,
    });

    const analyzer = new GapAnalyzer(manager);
    analyzer.analyze();

    const gaps = manager.listGaps('open');
    const isolatedGap = gaps.find((g) => g.type === 'missing_relationship');
    expect(isolatedGap).toBeDefined();
  });

  test('detects uningestedSystem', () => {
    const manager = createTestManager();
    manager.addSystem({
      name: 'Mystery System',
      type: 'other',
      description: 'Never ingested',
      status: 'unknown',
    });

    const analyzer = new GapAnalyzer(manager);
    analyzer.analyze();

    const gaps = manager.listGaps('open');
    const sysGap = gaps.find((g) => g.type === 'unknown_system');
    expect(sysGap).toBeDefined();
  });

  test('detects missing required finance concepts', () => {
    const manager = createTestManager(false); // Empty ontology
    const analyzer = new GapAnalyzer(manager);
    analyzer.analyze();

    const gaps = manager.listGaps('open');
    const missingConcepts = gaps.filter((g) => g.type === 'missing_concept');
    expect(missingConcepts.length).toBeGreaterThan(0);
    const descriptions = missingConcepts.map((g) => g.description);
    expect(descriptions.some((d) => d.includes('General Ledger'))).toBe(true);
    expect(descriptions.some((d) => d.includes('Invoice'))).toBe(true);
  });

  test('does not create duplicate gaps on re-run', () => {
    const manager = createTestManager();
    manager.addConcept({
      name: 'Unmapped',
      type: 'entity',
      description: '',
      attributes: {},
      systemMappings: [],
      tags: [],
      confidence: 0.8,
    });

    const analyzer = new GapAnalyzer(manager);
    analyzer.analyze();
    const countAfterFirst = manager.listGaps().length;
    analyzer.analyze();
    const countAfterSecond = manager.listGaps().length;

    expect(countAfterSecond).toBe(countAfterFirst);
  });

  test('detects ambiguous mapping for multi-system concept', () => {
    const manager = createTestManager();
    manager.addConcept({
      name: 'Multi-System Concept',
      type: 'entity',
      description: 'Exists in 2 systems',
      attributes: {},
      systemMappings: [
        { systemId: 'sys1', entityName: 'Entity1', fieldMappings: [] },
        { systemId: 'sys2', entityName: 'Entity2', fieldMappings: [] },
      ],
      tags: [],
      confidence: 0.9,
    });

    const analyzer = new GapAnalyzer(manager);
    analyzer.analyze();

    const gaps = manager.listGaps('open');
    const ambiguousGap = gaps.find((g) => g.type === 'ambiguous_mapping');
    expect(ambiguousGap).toBeDefined();
  });
});

describe('GapAnalyzer — with seeded data', () => {
  test('seed data produces a valid analysis report', () => {
    const manager = createTestManager(true);
    const analyzer = new GapAnalyzer(manager);
    const report = analyzer.analyze();

    expect(report.runsAt).toBeDefined();
    expect(typeof report.newGapsCreated).toBe('number');
    expect(typeof report.summary).toBe('string');
    expect(report.summary.length).toBeGreaterThan(0);
  });

  test('seed data already contains known gaps', () => {
    const manager = createTestManager(true);
    const gaps = manager.listGaps();
    expect(gaps.length).toBeGreaterThan(0);
    // Seed includes known vendor ID mismatch gap
    const vendorGap = gaps.find((g) => g.affectedConceptIds.includes('vendor'));
    expect(vendorGap).toBeDefined();
  });
});
