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
import {
  projectMemoryService,
  DECISION_STATUSES,
  DECISION_PROVENANCES
} from 'asterim/src/services/ProjectMemoryService';
import type { CreateCodeRefInput } from 'asterim/src/services/ProjectMemoryService';
import { parseResolveOptionsFromArgv, resolveProjectContext } from './resolver';
import type { ResolvedProject } from './resolver';

const SERVER_NAME = 'asterim-mcp-memory';
const SERVER_VERSION = '0.1.0';

/**
 * Defaults applied when an agent records a decision without stating them.
 *
 * An agent's assertion is weaker evidence than a human's confirmation, so it is
 * recorded as such rather than inheriting the service's HUMAN_CONFIRMED default —
 * provenance is the field a reviewer uses to decide how much weight to give a
 * remembered decision, and letting agent output enter as human-confirmed would
 * quietly destroy that distinction.
 */
const AGENT_DEFAULTS = {
  status: 'ACTIVE',
  provenance: 'AGENT_STATEMENT',
  confidence: 0.75
} as const;

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
  },
  {
    name: 'record_decision',
    description:
      'Record an architectural decision, rationale, constraints, and related files for the project. ' +
      'Use this when a durable choice is made that future work must respect — not for routine progress notes. ' +
      'Anchor it to the files it governs so a later query_decisions on those paths surfaces it.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short imperative headline, e.g. "Hash passwords with Argon2id".' },
        summary: { type: 'string', description: 'What was decided.' },
        rationale: { type: 'string', description: 'Why it was decided, including the alternatives rejected.' },
        constraints: {
          type: 'array',
          items: { type: 'string' },
          description: 'Boundaries this decision imposes on future work.'
        },
        relatedFiles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Repository-relative paths the decision governs. Stored as code anchors.'
        },
        codeRefs: {
          type: 'array',
          description: 'Precise anchors. Each entry must set at least one field.',
          items: {
            type: 'object',
            properties: {
              filePath: { type: 'string' },
              symbolName: { type: 'string' },
              commitHash: { type: 'string' }
            },
            additionalProperties: false
          }
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: `How sure you are, 0 to 1. Defaults to ${AGENT_DEFAULTS.confidence}.`
        },
        status: {
          type: 'string',
          enum: [...DECISION_STATUSES],
          description: `Lifecycle state. Defaults to ${AGENT_DEFAULTS.status}.`
        },
        provenance: {
          type: 'string',
          enum: [...DECISION_PROVENANCES],
          description: `How the decision was established. Defaults to ${AGENT_DEFAULTS.provenance}; only raise it to HUMAN_CONFIRMED when the user actually confirmed it.`
        },
        projectId: {
          type: 'string',
          description:
            'Optional. Must equal the project this server was started against — a write cannot cross project boundaries.'
        }
      },
      required: ['title', 'summary', 'rationale'],
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

/** Reads a required string argument. */
function requireString(args: Record<string, unknown> | undefined, key: string): string {
  const value = readString(args, key);
  if (value === undefined) {
    throw new Error(`'${key}' is required and must be a non-empty string.`);
  }
  return value;
}

/**
 * Validates an argument against one of the runtime enum lists.
 *
 * Rejecting an unrecognised value matters more here than it looks. On a read,
 * passing it through produces an empty result set, which a model reads as "this
 * project has no such decisions" rather than "you spelled the filter wrong". On a
 * write, `ProjectMemoryService` would reject it anyway, but only after the request
 * had reached the persistence layer, with a message written for a server log rather
 * than for the agent that has to correct itself.
 */
function readEnum<T extends string>(
  args: Record<string, unknown> | undefined,
  key: string,
  allowed: readonly T[]
): T | undefined {
  const raw = readString(args, key);
  if (raw === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(raw)) {
    throw new Error(`Unknown ${key} '${raw}'. Valid values are: ${allowed.join(', ')}.`);
  }
  return raw as T;
}

/** Reads an optional array of strings, dropping blanks. */
function readStringArray(args: Record<string, unknown> | undefined, key: string): string[] | undefined {
  const value = args?.[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`'${key}' must be an array of strings, received ${typeof value}.`);
  }
  const out: string[] = [];
  value.forEach((item, i) => {
    if (typeof item !== 'string') {
      throw new Error(`'${key}[${i}]' must be a string, received ${typeof item}.`);
    }
    const trimmed = item.trim();
    if (trimmed.length > 0) out.push(trimmed);
  });
  return out;
}

/**
 * Reads the optional code-ref anchors.
 *
 * An entry setting none of the three fields is rejected rather than dropped.
 * `ProjectMemoryService.mergeCodeRefInputs` silently discards such entries, so an
 * agent that mistyped a key would be told its decision was recorded with anchors
 * and then find `query_decisions({ filePath })` returns nothing.
 */
function readCodeRefs(args: Record<string, unknown> | undefined): CreateCodeRefInput[] | undefined {
  const value = args?.codeRefs;
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`'codeRefs' must be an array of objects, received ${typeof value}.`);
  }

  return value.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`'codeRefs[${i}]' must be an object.`);
    }
    const source = entry as Record<string, unknown>;
    const ref: CreateCodeRefInput = {};

    for (const key of ['filePath', 'symbolName', 'commitHash'] as const) {
      const raw = source[key];
      if (raw === undefined || raw === null) continue;
      if (typeof raw !== 'string') {
        throw new Error(`'codeRefs[${i}].${key}' must be a string, received ${typeof raw}.`);
      }
      const trimmed = raw.trim();
      if (trimmed.length > 0) ref[key] = trimmed;
    }

    if (!ref.filePath && !ref.symbolName && !ref.commitHash) {
      throw new Error(`'codeRefs[${i}]' must set at least one of filePath, symbolName or commitHash.`);
    }
    return ref;
  });
}

/**
 * Reads the optional confidence score.
 *
 * Out-of-range values are rejected rather than clamped. `clampConfidence` in the
 * service maps anything above 1 down to 1.0 — so an agent meaning "75%" and sending
 * `75` would have its guess stored as *maximum* confidence, the exact inverse of
 * what it expressed, with nothing in the record to show it happened.
 */
function readConfidence(args: Record<string, unknown> | undefined): number | undefined {
  const value = args?.confidence;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`'confidence' must be a finite number between 0 and 1, received ${typeof value}.`);
  }
  if (value < 0 || value > 1) {
    throw new Error(`'confidence' must be between 0 and 1, received ${value}.`);
  }
  return value;
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
        const status = readEnum(args, 'status', DECISION_STATUSES);

        const decisions = filePath
          ? projectMemoryService.findRelevantDecisions(targetProjectId, filePath)
          : projectMemoryService.listDecisions(targetProjectId, { status });

        return toolResult({ decisions });
      }

      case 'record_decision': {
        // The boundary check comes first, before any other validation. A write is
        // the one operation where being wrong about the project is unrecoverable
        // from inside this process: the decision lands in another project's memory
        // and reads as that project's own history from then on.
        const requestedProjectId = readString(args, 'projectId');
        if (requestedProjectId !== undefined && requestedProjectId !== resolvedProject.id) {
          return toolError(
            `Cannot record decision for project '${requestedProjectId}' from workspace of project '${resolvedProject.id}'.`
          );
        }

        // Every argument is validated before createDecision is reached, so a
        // malformed request never opens a transaction.
        const decision = projectMemoryService.createDecision({
          projectId: resolvedProject.id,
          title: requireString(args, 'title'),
          summary: requireString(args, 'summary'),
          rationale: requireString(args, 'rationale'),
          constraints: readStringArray(args, 'constraints'),
          relatedFiles: readStringArray(args, 'relatedFiles'),
          codeRefs: readCodeRefs(args),
          confidence: readConfidence(args) ?? AGENT_DEFAULTS.confidence,
          status: readEnum(args, 'status', DECISION_STATUSES) ?? AGENT_DEFAULTS.status,
          provenance: readEnum(args, 'provenance', DECISION_PROVENANCES) ?? AGENT_DEFAULTS.provenance
        });

        return toolResult({ decision });
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
