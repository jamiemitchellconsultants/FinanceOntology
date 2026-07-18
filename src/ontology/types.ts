/**
 * Core type definitions for the Finance Ontology system.
 * These types model finance domain concepts, their relationships,
 * system mappings, and gaps/uncertainties in the semantic data layer.
 */

// ─── Concept Types ───────────────────────────────────────────────────────────

export type ConceptType =
  | 'entity'      // Finance entity (Account, Vendor, Customer, etc.)
  | 'process'     // Business process (Invoicing, Payment Run, etc.)
  | 'attribute'   // Data attribute / field definition
  | 'system'      // External software system
  | 'report'      // Financial report or data view
  | 'dimension'   // Analytical dimension (Cost Center, Profit Center, etc.)
  | 'metric';     // Calculated KPI or measure

export interface AttributeDef {
  type: 'string' | 'number' | 'date' | 'boolean' | 'enum' | 'object';
  description: string;
  required: boolean;
  enumValues?: string[];
  format?: string;    // e.g. 'ISO8601', 'currency', 'percentage'
}

/** Maps an ontology concept to a specific field/entity in an external system */
export interface FieldMapping {
  ontologyField: string;
  systemField: string;
  transform?: string; // Optional JavaScript expression or JSONPath transform
}

/** Describes how a concept is represented in a particular external system */
export interface SystemMapping {
  systemId: string;
  entityName: string;     // Name of the entity/object in that system
  apiEndpoint?: string;   // REST endpoint to fetch this entity
  httpMethod?: 'GET' | 'POST';
  queryParams?: Record<string, string>;
  fieldMappings: FieldMapping[];
  authType?: 'oauth2' | 'api_key' | 'basic' | 'mcp' | 'none';
  notes?: string;
}

/** A finance domain concept in the ontology */
export interface Concept {
  id: string;
  name: string;
  type: ConceptType;
  description: string;
  attributes: Record<string, AttributeDef>;
  systemMappings: SystemMapping[];
  tags: string[];
  /** Confidence 0-1: how well-understood and complete this concept definition is */
  confidence: number;
  /** Optional parent concept id for hierarchical concepts */
  parentId?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Relationship Types ───────────────────────────────────────────────────────

export type RelationshipType =
  | 'is_a'              // Subtype / inheritance
  | 'has_a'             // Composition / containment
  | 'relates_to'        // Generic relationship
  | 'processed_by'      // Entity processed by a system/process
  | 'approves'          // Approval relationship
  | 'references'        // Reference key / foreign key
  | 'aggregates'        // Aggregation (e.g. GL aggregates Journal Entries)
  | 'feeds_into'        // Data flow direction
  | 'triggers'          // Process triggers another process
  | 'equivalent_to';    // Same concept in different systems

export interface Relationship {
  id: string;
  fromConceptId: string;
  toConceptId: string;
  type: RelationshipType;
  description?: string;
  cardinality?: '1:1' | '1:N' | 'N:1' | 'N:M';
  /** Confidence 0-1: how certain we are this relationship is correct */
  confidence: number;
  createdAt: string;
}

// ─── Gap / Uncertainty Types ──────────────────────────────────────────────────

export type GapType =
  | 'missing_concept'       // A concept that should exist does not
  | 'missing_relationship'  // A relationship that should exist does not
  | 'missing_mapping'       // Concept exists but has no system mapping
  | 'ambiguous_mapping'     // Multiple conflicting system mappings
  | 'incomplete_definition' // Concept is poorly defined (low confidence)
  | 'conflicting_data'      // Two systems disagree on the same fact
  | 'unknown_system'        // System exists but has not been ingested
  | 'stale_data';           // Mapping/definition may be outdated

export type GapSeverity = 'critical' | 'high' | 'medium' | 'low';
export type GapStatus = 'open' | 'in_progress' | 'resolved';

export interface Gap {
  id: string;
  type: GapType;
  description: string;
  affectedConceptIds: string[];
  severity: GapSeverity;
  status: GapStatus;
  /** Where/how this gap was discovered */
  source?: string;
  discoveredAt: string;
  resolvedAt?: string;
  resolution?: string;
}

// ─── System / Integration Types ───────────────────────────────────────────────

export type SystemType =
  | 'erp'           // Enterprise Resource Planning (SAP, Oracle, etc.)
  | 'ap'            // Accounts Payable
  | 'ar'            // Accounts Receivable
  | 'banking'       // Banking / treasury system
  | 'procurement'   // Procurement / PO system
  | 'budgeting'     // Budgeting / planning tool
  | 'reporting'     // Reporting / BI tool
  | 'payroll'       // Payroll system
  | 'expense'       // Expense management
  | 'tax'           // Tax compliance
  | 'mcp'           // Another MCP server
  | 'other';

export type AuthType = 'oauth2' | 'api_key' | 'basic' | 'mcp' | 'none';
export type SystemStatus = 'active' | 'inactive' | 'unknown' | 'ingesting';

export interface IngestionMapping {
  /** JSONPath or dot-notation path in the source response */
  sourcePath: string;
  /** Target concept id in the ontology */
  targetConceptId: string;
  /** Target field on the concept (optional — may map whole concept) */
  targetField?: string;
}

export interface IngestionConfig {
  type: 'rest_api' | 'mcp' | 'manual';
  /** Base URL override (falls back to SystemDef.baseUrl) */
  endpoint?: string;
  headers?: Record<string, string>;
  /** How often to poll for updates (ms), 0 = on-demand only */
  pollIntervalMs?: number;
  /** Request timeout (ms) for the ingestion fetch call. Defaults to 30000. */
  timeoutMs?: number;
  mappings?: IngestionMapping[];
}

/** Represents an external system that the finance team uses */
export interface SystemDef {
  id: string;
  name: string;
  type: SystemType;
  description: string;
  baseUrl?: string;
  authType?: AuthType;
  /** If this system is itself an MCP server, the endpoint to connect to */
  mcpEndpoint?: string;
  status: SystemStatus;
  ingestionConfig?: IngestionConfig;
  lastIngestedAt?: string;
}

// ─── Ingestion Types ──────────────────────────────────────────────────────────

export interface IngestedField {
  systemId: string;
  entityName: string;
  fieldName: string;
  sampleValue?: unknown;
  inferredType?: string;
}

export interface IngestionResult {
  systemId: string;
  success: boolean;
  conceptsCreated: number;
  conceptsUpdated: number;
  relationshipsCreated: number;
  gapsDetected: number;
  errors: string[];
  timestamp: string;
}

// ─── Orchestration Context Types ─────────────────────────────────────────────

/**
 * Context returned to help an AI agent orchestrate calls across systems
 * to complete a finance task.
 */
export interface OrchestrationContext {
  task: string;
  relevantConcepts: Concept[];
  relevantSystems: SystemDef[];
  dataFlow: DataFlowStep[];
  gaps: Gap[];
  confidence: number;
  warnings: string[];
}

export interface DataFlowStep {
  step: number;
  systemId: string;
  systemName: string;
  action: string;
  endpoint?: string;
  conceptIds: string[];
  dependsOnStep?: number;
  notes?: string;
}

// ─── Root Store Type ──────────────────────────────────────────────────────────

export interface OntologyData {
  version: string;
  concepts: Record<string, Concept>;
  relationships: Relationship[];
  gaps: Gap[];
  systems: Record<string, SystemDef>;
  ingestionHistory: IngestionResult[];
  lastUpdated: string;
}
