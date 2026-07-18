/**
 * Entry point for the Finance Ontology MCP server.
 * Starts the server using stdio transport for compatibility with
 * Claude Desktop, VS Code Copilot, Codex, and other MCP-compatible agents.
 *
 * Usage:
 *   node dist/index.js
 *   node --experimental-strip-types src/index.ts
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const server = createServer();
const transport = new StdioServerTransport();

await server.connect(transport);

// Log to stderr so it doesn't interfere with MCP stdio protocol
process.stderr.write('Finance Ontology MCP server started (stdio transport)\n');
