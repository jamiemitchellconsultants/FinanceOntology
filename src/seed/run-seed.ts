/**
 * Run seed script — loads the initial finance ontology data.
 * Usage: node --experimental-strip-types src/seed/run-seed.ts
 */

import { OntologyStore } from '../ontology/store.js';
import { OntologyManager } from '../ontology/manager.js';
import { FINANCE_SEED } from './finance-seed.js';

const store = new OntologyStore();
const manager = new OntologyManager(store);

// Only seed if ontology is empty
const existing = manager.listConcepts();
if (existing.length > 0) {
  console.log(`Ontology already has ${existing.length} concepts. Skipping seed.`);
  console.log('To re-seed, delete data/ontology.json first.');
  process.exit(0);
}

manager.loadSeed(FINANCE_SEED);
manager.save();

const stats = manager.getStats();
console.log('✅ Finance ontology seeded successfully!');
console.log(`   Concepts:      ${stats['totalConcepts']}`);
console.log(`   Relationships: ${stats['totalRelationships']}`);
console.log(`   Systems:       ${stats['totalSystems']}`);
console.log(`   Open Gaps:     ${stats['openGaps']}`);
