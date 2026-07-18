# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # Compile TypeScript to dist/
npm run dev            # Run server directly via node --experimental-strip-types (no build)
npm run seed           # Run seed script directly (no build)
npm test               # Run all tests
npx jest tests/gaps.test.ts   # Run a single test file
npm run lint           # TypeScript type-check only (tsc --noEmit)
node dist/index.js     # Start the compiled MCP server
```

Tests use `ts-jest` with a separate `tsconfig.jest.json` (CommonJS transform). The project itself is ESM (`"type": "module"`), which is why two tsconfig files exist.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `AZURE_OPENAI_ENDPOINT` | For LLM | Azure OpenAI resource endpoint URL |
| `AZURE_OPENAI_KEY` | For LLM | Azure OpenAI API key |
| `AZURE_OPENAI_API_VERSION` | No | API version (default: `2024-08-01-preview`) |
| `MCP_INGESTION_ALLOWED_COMMANDS` | No | JSON array of `[command, ...args]` tuples that `ingest_from_mcp` may spawn, e.g. `[["node","dist/servers/erp-mcp.js"]]`. Invocations must match a tuple exactly (command AND args) — an allowlisted binary paired with unlisted args is rejected. Unset = no restriction. Malformed JSON throws at server startup. |

When both Azure vars are absent the server starts normally — LLM-enhanced ingestion is silently disabled and connectors fall back to deterministic behaviour.

`ingest_from_mcp` spawns `command`/`args` as a subprocess on the server host — treat it as a trusted-operator-only tool. Set `MCP_INGESTION_ALLOWED_COMMANDS` to restrict it to known invocations in deployments where tool calls may originate from untrusted agent input.

## Architecture

The project is a **stdio MCP server** exposing a finance domain ontology to AI agents. It has no HTTP server; it speaks the MCP protocol over stdin/stdout.

### Request flow

```
MCP client → stdio → index.ts → server.ts (createServer) → OntologyManager → OntologyStore (data/ontology.json)
```

**`src/server.ts`** is the single large file where all MCP tools, resources, and prompts are registered. All tool handler logic lives here; it delegates to the layers below.

**`src/ontology/manager.ts`** — `OntologyManager` owns all business logic: concept/relationship/gap CRUD, graph traversal (`findRelatedConcepts`, `findPath`), keyword-based orchestration context building (`buildOrchestrationContext`), and uncertainty descriptions. It wraps `OntologyStore`.

**`src/ontology/store.ts`** — `OntologyStore` is a thin persistence layer: reads/writes `data/ontology.json` as a single `OntologyData` JSON blob. Every mutating operation must call `manager.save()` explicitly — there is no auto-flush.

**`src/ontology/types.ts`** — all domain types. The root shape is `OntologyData` which holds `concepts` (keyed object), `relationships` (array), `gaps` (array), and `systems` (keyed object).

**`src/ingestion/`** — two connectors: `ApiConnector` (fetches from REST APIs and OpenAPI schemas) and `McpConnector` (spawns another MCP server as a subprocess and ingests its resources/tools).

**`src/gaps/analyzer.ts`** — `GapAnalyzer` runs heuristic checks (unmapped concepts, low-confidence nodes, isolated nodes, un-ingested systems, etc.) and writes new `Gap` records.

**`src/services/llm.ts`** — `LlmService` wraps `AzureOpenAI`. Two-tier routing: `architect` (gpt-4o) for structural tasks, `workhorse` (gpt-4o-mini) for high-volume transactional work. `proposeMappings()` returns `IngestionMappingProposal[]` via `json_schema` structured output. Exported constant `HIGH_CONFIDENCE_THRESHOLD = 0.85` is the shared threshold used by both connectors.

**`src/seed/finance-seed.ts`** — static seed data (14 concepts, 15 relationships, 6 systems, 5 gaps). Auto-loaded by `createServer()` when the concept list is empty on first start.

### LLM ingestion flow

Both connectors accept an optional `LlmService` in their constructor. When available:
- **`discoverFromSchema`** (architect tier): all OpenAPI entity names are batched into one LLM call. Proposals with `confidence >= 0.85` update the matched existing concept's `systemMappings`; proposals below threshold call `manager.addGap()` with the field name and LLM reasoning. Entities with no proposal fall through to deterministic concept creation (confidence 0.4).
- **`ingest`** (workhorse tier): field paths are extracted from the live API response and sent to gpt-4o-mini. Same threshold logic applies. Operator-configured `ingestionConfig.mappings` always run afterward as a supplementary pass.
- **`ingestFromMcpServer`** (architect tier): all resource and tool names are batched into one LLM call. High-confidence matches call `linkConceptToSystem()`; low-confidence items report a gap and fall through to deterministic `ingestResource`/`ingestTool`.

### Key invariants

- `confidence` is a `0–1` float on both `Concept` and `Relationship`; the gap analyzer flags anything below threshold.
- `SystemMapping` (on a concept) links a concept to a specific field in an external system; `SystemDef` describes the system itself. These are separate types.
- The store is a flat JSON file — not a graph DB. Graph traversal in `OntologyManager` iterates in-memory.
- MCP log messages go to **stderr** to avoid polluting the stdio protocol stream.
- Ingestion calls are time-bounded: `ApiConnector.ingest()` aborts the fetch via `IngestionConfig.timeoutMs` (default 30s); `McpConnector.ingestFromMcpServer()` passes `McpIngestionOptions.timeoutMs` as the MCP SDK's per-request `timeout` to `connect`/`listResources`/`listTools`.
