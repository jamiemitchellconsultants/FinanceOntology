/**
 * Tests for ingestion connectors.
 */

import { OntologyManager } from '../src/ontology/manager.js';
import { OntologyStore } from '../src/ontology/store.js';
import { ApiConnector } from '../src/ingestion/api-connector.js';
import { McpConnector } from '../src/ingestion/mcp-connector.js';
import type { OntologyData } from '../src/ontology/types.js';

function createTestManager(): OntologyManager {
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
  return new OntologyManager(store);
}

describe('ApiConnector', () => {
  test('returns error for unknown system', async () => {
    const manager = createTestManager();
    const connector = new ApiConnector(manager);
    const result = await connector.ingest('nonexistent_system');
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('not found');
  });

  test('returns error for system without ingestion config', async () => {
    const manager = createTestManager();
    manager.addSystem({ name: 'No Config', type: 'other', description: '', status: 'active' });
    const systems = manager.listSystems();
    const connector = new ApiConnector(manager);
    const result = await connector.ingest(systems[0].id);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('no ingestion config');
  });

  test('returns error for system with non-rest_api type', async () => {
    const manager = createTestManager();
    manager.addSystem({
      name: 'MCP System',
      type: 'mcp',
      description: '',
      status: 'unknown',
      ingestionConfig: { type: 'mcp' },
    });
    const systems = manager.listSystems();
    const connector = new ApiConnector(manager);
    const result = await connector.ingest(systems[0].id);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('not rest_api');
  });

  test('discoverFromSchema creates concepts from OpenAPI schemas', async () => {
    const manager = createTestManager();
    const system = manager.addSystem({
      name: 'Test API',
      type: 'erp',
      description: 'test',
      status: 'unknown',
      ingestionConfig: { type: 'rest_api' },
    });

    const connector = new ApiConnector(manager);
    const schema = {
      components: {
        schemas: {
          Invoice: {
            description: 'An invoice entity',
            properties: {
              invoiceId: { type: 'string' },
              amount: { type: 'number' },
            },
          },
          Vendor: {
            description: 'A vendor',
            properties: {
              vendorId: { type: 'string' },
              name: { type: 'string' },
            },
          },
        },
      },
    };

    const result = await connector.discoverFromSchema(system.id, schema);
    expect(result.success).toBe(true);
    expect(result.conceptsCreated).toBe(2);

    const concepts = manager.listConcepts({ systemId: system.id });
    expect(concepts).toHaveLength(2);
    const names = concepts.map((c) => c.name);
    expect(names).toContain('Invoice');
    expect(names).toContain('Vendor');
  });

  test('discoverFromSchema returns error for schema without components', async () => {
    const manager = createTestManager();
    const system = manager.addSystem({
      name: 'Test',
      type: 'other',
      description: '',
      status: 'unknown',
      ingestionConfig: { type: 'rest_api' },
    });

    const connector = new ApiConnector(manager);
    const result = await connector.discoverFromSchema(system.id, {});
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('No schemas');
  });

  test('discoverFromSchema skips already-mapped concepts', async () => {
    const manager = createTestManager();
    const system = manager.addSystem({
      name: 'Test API',
      type: 'erp',
      description: '',
      status: 'unknown',
      ingestionConfig: { type: 'rest_api' },
    });

    // Pre-add a concept mapped to this system with the same name
    manager.addConcept({
      name: 'Invoice',
      type: 'entity',
      description: 'existing',
      attributes: {},
      systemMappings: [{ systemId: system.id, entityName: 'Invoice', fieldMappings: [] }],
      tags: [],
      confidence: 0.9,
    });

    const connector = new ApiConnector(manager);
    const schema = {
      components: {
        schemas: {
          Invoice: { description: 'An invoice', properties: {} },
        },
      },
    };

    const result = await connector.discoverFromSchema(system.id, schema);
    expect(result.success).toBe(true);
    expect(result.conceptsCreated).toBe(0); // Already exists
  });
});

describe('McpConnector', () => {
  test('registerMcpSystem creates a system and a gap', () => {
    const manager = createTestManager();
    const connector = new McpConnector(manager);

    const system = connector.registerMcpSystem(
      'Finance MCP Server',
      'External finance MCP',
      'node finance-server.js'
    );

    expect(system.id).toBeDefined();
    expect(system.name).toBe('Finance MCP Server');
    expect(system.mcpEndpoint).toBe('node finance-server.js');
    expect(system.status).toBe('unknown');

    const gaps = manager.listGaps('open');
    const sysGap = gaps.find((g) => g.type === 'unknown_system');
    expect(sysGap).toBeDefined();
    expect(sysGap?.description).toContain('Finance MCP Server');
  });

  test('registerMcpSystem is idempotent — same endpoint returns existing system', () => {
    const manager = createTestManager();
    const connector = new McpConnector(manager);

    connector.registerMcpSystem('System A', 'desc A', 'node server.js');
    connector.registerMcpSystem('System A Updated', 'desc updated', 'node server.js');

    expect(manager.listSystems()).toHaveLength(1);
    expect(manager.listSystems()[0].name).toBe('System A Updated');
  });

  test('ingestFromMcpServer returns error for unknown system', async () => {
    const manager = createTestManager();
    const connector = new McpConnector(manager);
    const result = await connector.ingestFromMcpServer('nonexistent', {
      command: 'echo',
    });
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('not found');
  });
});
