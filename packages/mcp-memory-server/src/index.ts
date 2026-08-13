// The stdio guard MUST stay the first import. Imports hoist, but they execute in
// source order, and `asterim/src/services/DatabaseService` writes to console.log
// from its singleton constructor — i.e. during import, before any line below runs.
// See ./stdio-guard.ts and docs/p5.1-01-audit-report.md § 4.
import './stdio-guard';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { dbService } from 'asterim/src/services/DatabaseService';
import { projectMemoryService, DECISION_STATUSES } from 'asterim/src/services/ProjectMemoryService';
import type { DecisionStatus } from '@asterim/shared';
import { parseResolveOptionsFromArgv, resolveProjectContext } from './resolver';
import type { ResolvedProject } from './resolver';

const SERVER_NAME = 'asterim-mcp-memory';
const SERVER_VERSION = '0.1.0';

/**
 * The project this process is scoped to, resolved once at startup.
 *
 * Assigned in main() before the transport connects, so no request handler can
 * observe it unset — a handler only runs after a client is connected.
 */
let resolvedProject: ResolvedProject;

const server = new Server(
  {
    name: SERVER_NAME,
    version: SERVER_VERSION
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// --- Tool definitions ---

const TOOLS: Tool[] = [
  {
    name: 'get_project_briefing',
    description:
      "Returns this project's memory snapshot: active decisions, architectural rules, the current intent, " +
      'recent agent sessions, and recent approvals. Call this before starting work on a project to learn what ' +
      'has already been decided and which constraints apply.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: {
          type: 'string',
          description:
            'Project to brief on. Defaults to the project this server was started against, which is what you normally want.'
        }
      },
      additionalProperties: false
    }
  },
  {
    name: 'query_decisions',
    description:
      'Looks up durable decisions recorded for this project. Pass filePath to get the ACTIVE decisions ' +
      'governing a specific file — the check to run before editing it. Pass status to list decisions in a ' +
      'given lifecycle state. With neither, returns every decision, newest first.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description:
            'Repository-relative path, e.g. "src/auth.ts". Returns only ACTIVE decisions anchored to that exact path. Takes precedence over status.'
        },
        status: {
          type: 'string',
          enum: [...DECISION_STATUSES],
          description: 'Lifecycle state to filter by. Omit to return decisions in every state.'
        },
        projectId: {
          type: 'string',
          description: 'Project to query. Defaults to the project this server was started against.'
        }
      },
      additionalProperties: false
    }
  }
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

// --- Tool dispatch ---

/** A tool result carrying JSON for the model to read. */
function toolResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }]
  };
}

/**
 * A tool failure reported *in band*.
 *
 * Throwing out of a request handler would surface as a JSON-RPC protocol error;
 * an `isError` result keeps the transport intact and hands the model something it
 * can read and act on. Adapter and tool failures must never take down the process.
 */
function toolError(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }]
  };
}

/**
 * Reads an optional string argument.
 *
 * An absent, empty, or whitespace-only value is treated as not supplied, so
 * `{ projectId: '' }` falls back to the resolved project rather than querying a
 * project whose id is the empty string. A non-string throws, and the caller
 * converts that into an isError result.
 */
function readString(args: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = args?.[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error(`'${key}' must be a string, received ${typeof value}.`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Validates a status argument against the runtime status list.
 *
 * Rejecting an unrecognised value matters more here than it looks: passing it
 * through would produce an empty result set, which a model reads as "this project
 * has no such decisions" rather than "you spelled the filter wrong". A memory
 * system that answers a malformed question with silence is worse than one that
 * refuses it.
 */
function readStatus(args: Record<string, unknown> | undefined): DecisionStatus | undefined {
  const raw = readString(args, 'status');
  if (raw === undefined) return undefined;
  if (!(DECISION_STATUSES as readonly string[]).includes(raw)) {
    throw new Error(`Unknown status '${raw}'. Valid values are: ${DECISION_STATUSES.join(', ')}.`);
  }
  return raw as DecisionStatus;
}

server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'get_project_briefing': {
        const targetProjectId = readString(args, 'projectId') ?? resolvedProject.id;
        const briefing = projectMemoryService.getProjectBriefing(targetProjectId);
        return toolResult({ briefing });
      }

      case 'query_decisions': {
        const targetProjectId = readString(args, 'projectId') ?? resolvedProject.id;
        const filePath = readString(args, 'filePath');
        const status = readStatus(args);

        const decisions = filePath
          ? projectMemoryService.findRelevantDecisions(targetProjectId, filePath)
          : projectMemoryService.listDecisions(targetProjectId, { status });

        return toolResult({ decisions });
      }

      default:
        return toolError(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
});

// --- Lifecycle ---

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
  // Resolve BEFORE the transport connects. A resolution failure must leave stdout
  // untouched: once a transport is attached, anything written there is read as a
  // protocol frame, and a client would see a corrupt stream rather than a clean exit.
  try {
    resolvedProject = resolveProjectContext(parseResolveOptionsFromArgv(process.argv.slice(2)));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stderr only — stdout belongs to the protocol. Reading dbService here also
  // pins the database this process opened, which is the first thing to check
  // when an agent reports memory it does not recognise.
  console.error(`[${SERVER_NAME}] v${SERVER_VERSION} ready on stdio`);
  console.error(`[${SERVER_NAME}] database: ${dbService.dbPath}`);
  console.error(`[${SERVER_NAME}] project: ${resolvedProject.name} [${resolvedProject.id}] → ${resolvedProject.path}`);
}

main().catch(err => {
  console.error(`[${SERVER_NAME}] fatal:`, err);
  process.exit(1);
});
