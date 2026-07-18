# Narrative

Reverse-chronological session log.

---

## 2026-07-18 — LLM-enhanced ingestion layer

**What changed:**
Added a two-tier Azure OpenAI processing layer to all three ingestion tools, replacing the single-pass deterministic approach with an LLM-assisted mapping step followed by a threshold-gated commit decision.

**New file — `src/services/llm.ts`:**
`LlmService` wraps `AzureOpenAI` (from the `openai` npm package). Tier routing: `architect = gpt-4o` for structural/schema tasks, `workhorse = gpt-4o-mini` for high-volume transactional field work. `proposeMappings()` enforces a `json_schema` structured output returning `IngestionMappingProposal[]` (`incomingField`, `mappedConceptId`, `confidence`, `reasoning`). Reads `AZURE_OPENAI_ENDPOINT` and `AZURE_OPENAI_KEY` from environment; gracefully disables when absent.

**Updated — `src/ingestion/api-connector.ts`:**
- `discoverFromSchema`: batches all OpenAPI entity names into one architect-tier call. `confidence >= 0.85` → updates existing concept's `systemMappings` (including field mappings from schema properties). Below threshold → calls `manager.addGap()` with the field name and LLM reasoning. Entities with no proposal fall through to deterministic creation.
- `ingest`: extracts field paths from the live API response (depth-2 traversal), sends to workhorse tier, applies same threshold. Operator `ingestionConfig.mappings` always run afterward as a supplementary pass.

**Updated — `src/ingestion/mcp-connector.ts`:**
Resources and tools are batched into one architect-tier LLM call. High-confidence matches invoke `linkConceptToSystem()` (adds `SystemMapping` to the existing concept). Low-confidence items report a gap and fall through to `ingestResource`/`ingestTool`.

**Updated — `src/server.ts`:**
`createServer()` instantiates `LlmService` and passes it to both connectors.

**New tests — `tests/llm-ingestion.test.ts`:**
5 tests covering: high-confidence update, low-confidence gap, hallucinated concept ID, deterministic fallback when LLM returns no proposals, and exact threshold boundary (0.85 accepted).

All 47 tests pass; `tsc --noEmit` clean.

**Decision:** `LlmService` is optional in both connector constructors, preserving all existing test behaviour (no mock needed — absence of LlmService triggers deterministic path). The threshold constant `HIGH_CONFIDENCE_THRESHOLD = 0.85` is exported from `llm.ts` and imported by connectors to ensure single-source-of-truth.
