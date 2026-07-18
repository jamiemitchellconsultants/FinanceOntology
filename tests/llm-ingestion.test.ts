/**
 * Tests for LLM-enhanced ingestion — threshold logic.
 *
 * All tests use a mock LlmService so no Azure credentials are required.
 * The connectors receive the mock via constructor injection.
 */

import { OntologyManager } from '../src/ontology/manager.js';
import { OntologyStore } from '../src/ontology/store.js';
import { ApiConnector } from '../src/ingestion/api-connector.js';
import { McpConnector } from '../src/ingestion/mcp-connector.js';
import type { LlmService, IngestionMappingProposal } from '../src/services/llm.js';
import type { OntologyData } from '../src/ontology/types.js';

// Mock the MCP SDK client so ingestFromMcpServer can run against a fake
// resources/tools listing without spawning a real subprocess.
const mockConnect = jest.fn();
const mockClose = jest.fn();
const mockListResources = jest.fn();
const mockListTools = jest.fn();

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    close: mockClose,
    listResources: mockListResources,
    listTools: mockListTools,
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => ({})),
}));

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

function mockLlmService(proposals: IngestionMappingProposal[]): LlmService {
  return {
    isAvailable: () => true,
    proposeMappings: async () => proposals,
  } as unknown as LlmService;
}

const BASE_SCHEMA = {
  components: {
    schemas: {
      AP_Invoice: {
        description: 'AP system invoice entity',
        properties: { invoiceId: { type: 'string' }, amount: { type: 'number' } },
      },
    },
  },
};

describe('ApiConnector — LLM threshold logic in discoverFromSchema', () => {
  test('high-confidence proposal updates an existing concept with a system mapping', async () => {
    const manager = createTestManager();
    const concept = manager.addConcept({
      name: 'Invoice',
      type: 'entity',
      description: 'An invoice',
      attributes: {},
      systemMappings: [],
      tags: [],
      confidence: 0.9,
    });
    const system = manager.addSystem({
      name: 'AP System',
      type: 'ap',
      description: 'AP automation',
      status: 'unknown',
      ingestionConfig: { type: 'rest_api' },
    });

    const proposals: IngestionMappingProposal[] = [
      {
        incomingField: 'AP_Invoice',
        mappedConceptId: concept.id,
        confidence: 0.92,
        reasoning: 'AP_Invoice is the canonical invoice entity in AP systems',
      },
    ];

    const connector = new ApiConnector(manager, mockLlmService(proposals));
    const result = await connector.discoverFromSchema(system.id, BASE_SCHEMA);

    expect(result.success).toBe(true);
    expect(result.conceptsUpdated).toBe(1);
    expect(result.conceptsCreated).toBe(0);
    expect(result.gapsDetected).toBe(0);

    const updated = manager.getConcept(concept.id)!;
    expect(
      updated.systemMappings.some((m) => m.systemId === system.id && m.entityName === 'AP_Invoice')
    ).toBe(true);

    // Field mappings from schema properties should be included
    const mapping = updated.systemMappings.find((m) => m.entityName === 'AP_Invoice')!;
    expect(mapping.fieldMappings.some((f) => f.systemField === 'invoiceId')).toBe(true);
    expect(mapping.fieldMappings.some((f) => f.systemField === 'amount')).toBe(true);
  });

  test('low-confidence proposal reports a gap and does not create or update a concept', async () => {
    const manager = createTestManager();
    const concept = manager.addConcept({
      name: 'Invoice',
      type: 'entity',
      description: 'An invoice',
      attributes: {},
      systemMappings: [],
      tags: [],
      confidence: 0.9,
    });
    const system = manager.addSystem({
      name: 'ERP',
      type: 'erp',
      description: '',
      status: 'unknown',
      ingestionConfig: { type: 'rest_api' },
    });

    const proposals: IngestionMappingProposal[] = [
      {
        incomingField: 'AP_Invoice',
        mappedConceptId: concept.id,
        confidence: 0.6,
        reasoning: 'Name suggests invoice but could also be a purchase order in some ERPs',
      },
    ];

    const connector = new ApiConnector(manager, mockLlmService(proposals));
    const result = await connector.discoverFromSchema(system.id, BASE_SCHEMA);

    expect(result.success).toBe(true);
    expect(result.gapsDetected).toBe(1);
    expect(result.conceptsUpdated).toBe(0);
    expect(result.conceptsCreated).toBe(0);

    const gaps = manager.listGaps('open');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].description).toContain('AP_Invoice');
    expect(gaps[0].description).toContain('purchase order in some ERPs');
    expect(gaps[0].source).toContain('llm_ingestion');
  });

  test('high-confidence proposal with a non-existent (hallucinated) concept ID reports a distinct gap and still creates the entity deterministically', async () => {
    const manager = createTestManager();
    const system = manager.addSystem({
      name: 'API',
      type: 'other',
      description: '',
      status: 'unknown',
      ingestionConfig: { type: 'rest_api' },
    });

    const proposals: IngestionMappingProposal[] = [
      {
        incomingField: 'AP_Invoice',
        mappedConceptId: 'hallucinated-concept-id',
        confidence: 0.95,
        reasoning: 'Very confident but the ID does not exist',
      },
    ];

    const connector = new ApiConnector(manager, mockLlmService(proposals));
    const result = await connector.discoverFromSchema(system.id, BASE_SCHEMA);

    expect(result.gapsDetected).toBe(1);
    expect(result.conceptsUpdated).toBe(0);
    // The entity is neither "handled" (no valid concept to map to) nor "gapped"
    // (that set is reserved for genuinely low-confidence proposals), so it still
    // falls through to the deterministic fallback and gets created rather than
    // silently disappearing.
    expect(result.conceptsCreated).toBe(1);

    const gaps = manager.listGaps('open');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].description).toContain('non-existent concept ID');
    expect(gaps[0].description).toContain('hallucinated-concept-id');
    expect(gaps[0].description).toContain('AP_Invoice');
    expect(gaps[0].description).not.toContain('Low-confidence mapping');
  });

  test('entities not covered by any proposal fall through to deterministic creation', async () => {
    const manager = createTestManager();
    const system = manager.addSystem({
      name: 'API',
      type: 'other',
      description: '',
      status: 'unknown',
      ingestionConfig: { type: 'rest_api' },
    });

    // LLM returns no proposals at all
    const connector = new ApiConnector(manager, mockLlmService([]));
    const result = await connector.discoverFromSchema(system.id, BASE_SCHEMA);

    expect(result.success).toBe(true);
    expect(result.conceptsCreated).toBe(1); // AP_Invoice created deterministically
  });

  test('below-threshold boundary: exactly 0.85 is accepted', async () => {
    const manager = createTestManager();
    const concept = manager.addConcept({
      name: 'Invoice',
      type: 'entity',
      description: 'An invoice',
      attributes: {},
      systemMappings: [],
      tags: [],
      confidence: 0.9,
    });
    const system = manager.addSystem({
      name: 'AP',
      type: 'ap',
      description: '',
      status: 'unknown',
      ingestionConfig: { type: 'rest_api' },
    });

    const proposals: IngestionMappingProposal[] = [
      {
        incomingField: 'AP_Invoice',
        mappedConceptId: concept.id,
        confidence: 0.85,
        reasoning: 'Exactly at threshold',
      },
    ];

    const connector = new ApiConnector(manager, mockLlmService(proposals));
    const result = await connector.discoverFromSchema(system.id, BASE_SCHEMA);

    expect(result.conceptsUpdated).toBe(1);
    expect(result.gapsDetected).toBe(0);
  });
});

describe('ApiConnector — LLM threshold logic in ingest()', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetchJson(body: unknown): void {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => body,
    }) as unknown as typeof fetch;
  }

  test('high-confidence proposal from workhorse tier updates the concept via applyFieldMapping', async () => {
    const manager = createTestManager();
    const concept = manager.addConcept({
      name: 'Invoice',
      type: 'entity',
      description: 'An invoice',
      attributes: {},
      systemMappings: [],
      tags: [],
      confidence: 0.9,
    });
    const system = manager.addSystem({
      name: 'AP System',
      type: 'ap',
      description: '',
      status: 'unknown',
      ingestionConfig: { type: 'rest_api', endpoint: 'https://ap.example.com/invoices' },
    });

    mockFetchJson({ invoiceId: 'INV-1', amount: 100 });

    const proposals: IngestionMappingProposal[] = [
      {
        incomingField: 'invoiceId',
        mappedConceptId: concept.id,
        confidence: 0.9,
        reasoning: 'invoiceId is the primary key of the invoice concept',
      },
    ];

    const connector = new ApiConnector(manager, mockLlmService(proposals));
    const result = await connector.ingest(system.id);

    expect(result.success).toBe(true);
    expect(result.conceptsUpdated).toBe(1);
    expect(result.gapsDetected).toBe(0);

    const updated = manager.getConcept(concept.id)!;
    const mapping = updated.systemMappings.find((m) => m.systemId === system.id);
    expect(mapping).toBeDefined();
    expect(mapping!.fieldMappings.some((f) => f.systemField === 'invoiceId')).toBe(true);
  });

  test('low-confidence proposal reports a gap, and operator-configured mappings still run afterward', async () => {
    const manager = createTestManager();
    const concept = manager.addConcept({
      name: 'Vendor',
      type: 'entity',
      description: 'A vendor',
      attributes: {},
      systemMappings: [],
      tags: [],
      confidence: 0.9,
    });
    const system = manager.addSystem({
      name: 'ERP',
      type: 'erp',
      description: '',
      status: 'unknown',
      ingestionConfig: {
        type: 'rest_api',
        endpoint: 'https://erp.example.com/vendors',
        mappings: [{ sourcePath: 'vendorId', targetConceptId: concept.id }],
      },
    });

    mockFetchJson({ vendorId: 'V-1' });

    const proposals: IngestionMappingProposal[] = [
      {
        incomingField: 'vendorId',
        mappedConceptId: concept.id,
        confidence: 0.5,
        reasoning: 'vendorId could refer to a vendor or a customer record in this ERP',
      },
    ];

    const connector = new ApiConnector(manager, mockLlmService(proposals));
    const result = await connector.ingest(system.id);

    expect(result.success).toBe(true);
    expect(result.gapsDetected).toBe(1);
    // The trusted operator-configured mapping still runs and upserts the concept,
    // even though the LLM proposal for the same field was gapped.
    expect(result.conceptsUpdated).toBeGreaterThanOrEqual(1);

    const updated = manager.getConcept(concept.id)!;
    expect(updated.systemMappings.some((m) => m.systemId === system.id)).toBe(true);
  });

  test('LLM failure during ingest() does not prevent operator-configured mappings from running', async () => {
    const manager = createTestManager();
    const concept = manager.addConcept({
      name: 'Vendor',
      type: 'entity',
      description: 'A vendor',
      attributes: {},
      systemMappings: [],
      tags: [],
      confidence: 0.9,
    });
    const system = manager.addSystem({
      name: 'ERP',
      type: 'erp',
      description: '',
      status: 'unknown',
      ingestionConfig: {
        type: 'rest_api',
        endpoint: 'https://erp.example.com/vendors',
        mappings: [{ sourcePath: 'vendorId', targetConceptId: concept.id }],
      },
    });

    mockFetchJson({ vendorId: 'V-1' });

    const failingLlm = {
      isAvailable: () => true,
      proposeMappings: async () => {
        throw new Error('Azure OpenAI 503');
      },
    } as unknown as LlmService;

    const connector = new ApiConnector(manager, failingLlm);
    const result = await connector.ingest(system.id);

    expect(result.success).toBe(true);
    expect(result.errors.some((e) => e.includes('LLM proposal failed'))).toBe(true);
    // The trusted operator-configured mapping still ran despite the LLM error
    const updated = manager.getConcept(concept.id)!;
    expect(updated.systemMappings.some((m) => m.systemId === system.id)).toBe(true);
  });
});

describe('McpConnector — LLM threshold logic in ingestFromMcpServer', () => {
  beforeEach(() => {
    mockConnect.mockReset().mockResolvedValue(undefined);
    mockClose.mockReset().mockResolvedValue(undefined);
    mockListResources.mockReset();
    mockListTools.mockReset();
  });

  test('high-confidence proposal links an existing concept via linkConceptToSystem', async () => {
    const manager = createTestManager();
    const concept = manager.addConcept({
      name: 'Invoice',
      type: 'entity',
      description: 'An invoice',
      attributes: {},
      systemMappings: [],
      tags: [],
      confidence: 0.9,
    });
    const system = manager.addSystem({
      name: 'Finance MCP',
      type: 'mcp',
      description: '',
      status: 'unknown',
      ingestionConfig: { type: 'mcp' },
    });

    mockListResources.mockResolvedValue({
      resources: [{ uri: 'mcp://invoices', name: 'invoices_resource', description: 'Invoice data' }],
    });
    mockListTools.mockResolvedValue({ tools: [] });

    const proposals: IngestionMappingProposal[] = [
      {
        incomingField: 'invoices_resource',
        mappedConceptId: concept.id,
        confidence: 0.91,
        reasoning: 'MCP resource named "invoices_resource" clearly maps to Invoice concept',
      },
    ];

    const connector = new McpConnector(manager, mockLlmService(proposals));
    const result = await connector.ingestFromMcpServer(system.id, {
      command: 'node',
      args: ['server.js'],
    });

    expect(result.success).toBe(true);
    expect(result.conceptsUpdated).toBe(1);
    expect(result.conceptsCreated).toBe(0);
    expect(result.gapsDetected).toBe(0);
    expect(mockClose).toHaveBeenCalled();

    const updated = manager.getConcept(concept.id)!;
    expect(
      updated.systemMappings.some(
        (m) => m.systemId === system.id && m.entityName === 'invoices_resource'
      )
    ).toBe(true);
  });

  test('low-confidence proposal reports a gap and falls through to deterministic ingestResource', async () => {
    const manager = createTestManager();
    const concept = manager.addConcept({
      name: 'Invoice',
      type: 'entity',
      description: 'An invoice',
      attributes: {},
      systemMappings: [],
      tags: [],
      confidence: 0.9,
    });
    const system = manager.addSystem({
      name: 'Finance MCP',
      type: 'mcp',
      description: '',
      status: 'unknown',
      ingestionConfig: { type: 'mcp' },
    });

    mockListResources.mockResolvedValue({
      resources: [{ uri: 'mcp://invoices', name: 'invoices_resource', description: 'Invoice data' }],
    });
    mockListTools.mockResolvedValue({ tools: [] });

    const proposals: IngestionMappingProposal[] = [
      {
        incomingField: 'invoices_resource',
        mappedConceptId: concept.id,
        confidence: 0.4,
        reasoning: 'Unclear whether this is an invoice or a payment in this system',
      },
    ];

    const connector = new McpConnector(manager, mockLlmService(proposals));
    const result = await connector.ingestFromMcpServer(system.id, {
      command: 'node',
      args: ['server.js'],
    });

    expect(result.success).toBe(true);
    expect(result.gapsDetected).toBe(1);
    // Not "handled" at high confidence, so it still runs through the
    // deterministic ingestResource fallback (unlike discoverFromSchema, which
    // excludes gapped entities from its fallback).
    expect(result.conceptsCreated).toBe(1);

    const gaps = manager.listGaps('open').filter((g) => g.description.includes('invoices_resource'));
    expect(gaps).toHaveLength(1);
    expect(gaps[0].description).toContain('invoice or a payment');

    // The originally-proposed concept itself was left unmodified
    const unchanged = manager.getConcept(concept.id)!;
    expect(unchanged.systemMappings).toHaveLength(0);
  });
});
