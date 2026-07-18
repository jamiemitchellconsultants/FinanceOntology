# FinanceOntology

A system to build and maintain a semantic ontology for the enterprise finance team, usable by AI agents (Claude, GitHub Copilot, Codex, etc.) via the **Model Context Protocol (MCP)**.

## Overview

The Finance Ontology MCP server provides a shared, evolving semantic data layer over the finance team's systems (ERP, AP automation, banking, budgeting, expense management, procurement). It enables AI agents to:

- **Understand** finance domain concepts and their relationships
- **Discover** which systems hold which data and how to retrieve it
- **Orchestrate** calls across multiple systems for a given task
- **Identify** gaps and uncertainties in the semantic model

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   MCP Clients                           │
│  Claude Desktop │ GitHub Copilot │ Codex │ Custom Agent │
└───────────────────────┬─────────────────────────────────┘
                        │  MCP Protocol (stdio)
┌───────────────────────▼─────────────────────────────────┐
│             Finance Ontology MCP Server                 │
│  Tools · Resources · Prompts                            │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │  Ontology    │  │  Ingestion   │  │  Gap Analyzer │ │
│  │  Manager     │  │  Connectors  │  │               │ │
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘ │
│         └─────────────────┴──────────────────┘         │
│                    Ontology Store                       │
│                   (data/ontology.json)                  │
└─────────────────────────────────────────────────────────┘
                        │
     ┌──────────────────┼──────────────────┐
     ▼                  ▼                  ▼
┌─────────┐      ┌─────────────┐    ┌──────────┐
│  ERP    │      │ AP System   │    │ Banking  │ …
└─────────┘      └─────────────┘    └──────────┘
```

## Quick Start

### Prerequisites
- Node.js ≥ 18

### Install & Build

```bash
npm install
npm run build
```

### Run the MCP Server

```bash
node dist/index.js
```

The server communicates via stdio and is compatible with any MCP-capable agent.

### Seed the Ontology

The server auto-seeds on first run. To seed explicitly:

```bash
node dist/seed/run-seed.js
```

This loads 14 core finance concepts, 15 relationships, 6 systems, and 5 known gaps.

## MCP Tools

### Ontology Management

| Tool | Description |
|------|-------------|
| `list_concepts` | List concepts with filters (type, tags, system, confidence, search) |
| `get_concept` | Get full concept detail including attributes and system mappings |
| `add_concept` | Add a new finance concept |
| `update_concept` | Update an existing concept |
| `add_relationship` | Define a semantic relationship between two concepts |
| `list_relationships` | List relationships with optional filters |
| `find_related_concepts` | Graph traversal to find related concepts |
| `find_data_path` | Find the shortest relationship path between two concepts |

### System Management

| Tool | Description |
|------|-------------|
| `list_systems` | List all registered external systems |
| `add_system` | Register a new external system |
| `register_mcp_system` | Register another MCP server as a system |

### Data Ingestion

| Tool | Description |
|------|-------------|
| `ingest_from_api` | Ingest data from a registered REST API system |
| `ingest_from_api_schema` | Auto-discover concepts from an OpenAPI schema |
| `ingest_from_mcp` | Connect to an external MCP server and ingest its resources/tools |

### Gap Analysis

| Tool | Description |
|------|-------------|
| `list_gaps` | List gaps and uncertainties (filter by status or severity) |
| `report_gap` | Report a new gap or uncertainty |
| `resolve_gap` | Mark a gap as resolved |
| `analyze_gaps` | Run automated gap analysis |
| `describe_uncertainty` | Get uncertainty report for a concept or the whole ontology |

### Orchestration

| Tool | Description |
|------|-------------|
| `get_orchestration_context` | Get systems, concepts, data flow, and gaps relevant to a task |

## MCP Resources

| URI | Description |
|-----|-------------|
| `ontology://overview` | Ontology statistics and system summary |
| `ontology://concepts/{id}` | Full concept detail |
| `ontology://gaps` | All gaps as JSON |
| `ontology://systems` | All registered systems as JSON |

## MCP Prompts

| Prompt | Description |
|--------|-------------|
| `finance_task_context` | Generate agent context for a finance task |
| `gap_analysis_report` | Structured gap analysis report |

## Pre-loaded Finance Concepts

| Concept | Type | Description |
|---------|------|-------------|
| Chart of Accounts | Entity | Structured account list |
| General Ledger | Entity | All financial transactions |
| Cost Center | Dimension | Departmental cost tracking |
| Profit Center | Dimension | P&L reporting unit |
| Vendor | Entity | Supplier / service provider |
| Invoice | Entity | Vendor invoice for payment |
| Purchase Order | Entity | Formal purchase request |
| Budget | Entity | Financial plan by period |
| Bank Account | Entity | Organization bank accounts |
| Payment | Process | Payment execution |
| Expense Report | Entity | Employee expense claims |
| Trial Balance | Report | Account balances by period |
| Budget vs Actuals | Report | Variance analysis report |
| Cash Flow | Metric | Cash movement KPI |

## Known Gaps (Pre-seeded)

- Vendor ID mismatch between ERP and AP system (high)
- Budget vs Actuals data is nightly-only, not real-time (medium)
- Intercompany transactions not modelled (high)
- Tax compliance system not yet integrated (medium)
- Fixed assets / CAPEX not modelled (medium)

## Integrating with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "finance-ontology": {
      "command": "node",
      "args": ["/path/to/FinanceOntology/dist/index.js"]
    }
  }
}
```

## Integrating with VS Code Copilot

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "finance-ontology": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/index.js"]
    }
  }
}
```

## Development

```bash
npm run dev      # Run server directly with ts-node (no build step)
npm test         # Run tests
npm run lint     # TypeScript type check
npm run build    # Compile to dist/
```

## Extending the Ontology

### Adding a new finance concept

```
Use the add_concept MCP tool, or edit src/seed/finance-seed.ts
```

### Ingesting a new system via REST API

1. Register the system: `add_system`
2. Configure its `ingestionConfig` with REST endpoint and field mappings
3. Trigger ingestion: `ingest_from_api`

### Connecting another MCP server

```
Use register_mcp_system then ingest_from_mcp
```

### Running gap analysis

```
Call the analyze_gaps tool to detect:
- Concepts without system mappings
- Low-confidence concepts
- Isolated concepts (no relationships)
- Systems never ingested
- Ambiguous multi-system mappings
- Missing required finance concepts
```
