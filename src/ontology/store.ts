/**
 * JSON file persistence layer for the Finance Ontology.
 * Reads/writes the ontology state to a local JSON file.
 * Replace this implementation with a graph DB or vector store for production.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { OntologyData } from './types.js';

/** Resolve the default data directory relative to the current working directory */
function defaultDataPath(): string {
  return resolve(process.cwd(), 'data', 'ontology.json');
}

const EMPTY_STORE: OntologyData = {
  version: '1.0.0',
  concepts: {},
  relationships: [],
  gaps: [],
  systems: {},
  ingestionHistory: [],
  lastUpdated: new Date().toISOString(),
};

export class OntologyStore {
  private data: OntologyData;
  private readonly filePath: string;

  constructor(filePath: string = defaultDataPath()) {
    this.filePath = filePath;
    this.data = this.load();
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  private load(): OntologyData {
    if (!existsSync(this.filePath)) {
      return structuredClone(EMPTY_STORE);
    }
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw) as OntologyData;
    } catch {
      // Return empty store on parse errors; the manager will re-seed as needed
      return structuredClone(EMPTY_STORE);
    }
  }

  save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.data.lastUpdated = new Date().toISOString();
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  // ─── Raw data access (used by OntologyManager) ─────────────────────────────

  getData(): OntologyData {
    return this.data;
  }

  setData(data: OntologyData): void {
    this.data = data;
  }
}
