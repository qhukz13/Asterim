// The stdio guard MUST stay the first import. Imports hoist, but they execute in
// source order, and `asterim/src/services/DatabaseService` writes to console.log
// from its singleton constructor — i.e. during import, before any line below runs.
// See ./stdio-guard.ts and docs/p5.1-01-audit-report.md § 4.
import './stdio-guard';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { dbService } from 'asterim/src/services/DatabaseService';

const SERVER_NAME = 'asterim-mcp-memory';
const SERVER_VERSION = '0.1.0';

const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION
  },
  {
    capabilities: {
      // Declared now so clients negotiate tool support during initialize.
      // The tools themselves arrive in P5.1-04 and P5.1-05.
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`[${SERVER_NAME}] received ${signal}, closing transport`);
  try {
    await server.close();
  } catch (err) {
    console.error(`[${SERVER_NAME}] error while closing:`, err);
  }
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stderr only — stdout belongs to the protocol. Reading dbService here also
  // pins the database this process opened, which is the first thing to check
  // when an agent reports memory it does not recognise.
  console.error(`[${SERVER_NAME}] v${SERVER_VERSION} ready on stdio`);
  console.error(`[${SERVER_NAME}] database: ${dbService.dbPath}`);
}

main().catch(err => {
  console.error(`[${SERVER_NAME}] fatal:`, err);
  process.exit(1);
});
