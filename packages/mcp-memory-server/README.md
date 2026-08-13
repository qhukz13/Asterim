# @asterim/mcp-memory-server

An [MCP](https://modelcontextprotocol.io) server that gives AI coding agents access to Asterim's **Project Memory** — the durable decisions, architectural rules, and current intent recorded for a project.

The problem it solves: every agent session starts from nothing. It re-derives what was already settled, or worse, quietly reverses it. This server lets a session ask what the project has already decided, and record what it decides, so the next session — in the same tool or a different one — starts where the last one left off.

```
Session 1 (Claude Code)          Session 2 (Cursor, next week)
  record_decision  ──────┐          get_project_briefing
                         ▼                    ▲
                   ~/.asterim/asterim.db ─────┘
```

---

## What it exposes

Three tools. All of them operate on the project the server resolved at startup (see [Project resolution](#project-resolution)).

### `get_project_briefing`

The memory snapshot for the project: active decisions, architectural rules, the current intent, recent agent sessions, and recent approvals. **Call this at the start of a session.**

| Parameter | Type | Notes |
| :-- | :-- | :-- |
| `projectId` | string | Optional. Defaults to the resolved project. |

### `query_decisions`

Decisions recorded for the project.

| Parameter | Type | Notes |
| :-- | :-- | :-- |
| `filePath` | string | Repository-relative, e.g. `src/auth.ts`. Returns only **ACTIVE** decisions anchored to that exact path. Takes precedence over `status`. |
| `status` | enum | `ACTIVE` \| `STALE` \| `SUPERSEDED` \| `ARCHIVED`. |
| `projectId` | string | Optional. Defaults to the resolved project. |

With neither `filePath` nor `status`, returns every decision, newest first.

`filePath` is the useful one: **it is the check to run before editing a file.**

### `record_decision`

Records a durable choice that future work must respect. Not for progress notes.

| Parameter | Type | Notes |
| :-- | :-- | :-- |
| `title` | string | **Required.** Short imperative headline. |
| `summary` | string | **Required.** What was decided. |
| `rationale` | string | **Required.** Why, including alternatives rejected. |
| `constraints` | string[] | Boundaries this imposes on future work. |
| `relatedFiles` | string[] | Repository-relative paths the decision governs. Stored as anchors. |
| `codeRefs` | object[] | Precise anchors: `{ filePath?, symbolName?, commitHash? }`. Each entry must set at least one. |
| `confidence` | number | 0–1. Defaults to **0.75**. |
| `status` | enum | Defaults to **ACTIVE**. |
| `provenance` | enum | Defaults to **AGENT_STATEMENT**. |
| `projectId` | string | Optional, but **must equal the resolved project** — see below. |

Anchor decisions to the files they govern. An unanchored decision is only findable by listing everything; an anchored one surfaces automatically when an agent asks about that file.

---

## Project resolution

The server scopes itself to exactly one project, resolved once at startup, in this order:

1. `--project <id>`
2. `--project-path <path>`
3. `ASTERIM_PROJECT_ID` environment variable
4. **The working directory** — matched against registered project paths

Option 4 is the normal case and needs no configuration: start the server inside a project directory (or any subdirectory of one) and it attaches to that project. Where several registered projects contain the directory, the **most specific** one wins, so a repository registered inside a registered parent folder resolves to the repository.

If nothing matches, the server prints the registered projects to stderr and exits `1`. It never guesses — a wrong guess would write an agent's decisions into someone else's memory.

### Writes cannot cross projects

`record_decision` accepts `projectId` only when it equals the resolved project. Anything else is refused:

```
Cannot record decision for project 'proj-b' from workspace of project 'proj-a'.
```

Reads are **not** restricted this way: `get_project_briefing` and `query_decisions` will return another project's memory if explicitly asked for it by id. See [DEC-023](../../decisions.md).

---

## Setup

**Prerequisite:** Asterim must have been run at least once and the project registered in the dashboard, so that `~/.asterim/asterim.db` exists and contains it.

```bash
pnpm install
pnpm --filter @asterim/mcp-memory-server build
```

This produces `dist/index.js`, an executable with a `#!/usr/bin/env node` shebang.

> **The binary is not standalone.** The MCP SDK is left external, so `dist/index.js` requires this repository's `node_modules` at runtime. Configure clients with an **absolute path inside the checkout**; copying the file elsewhere will not work. See [`docs/mcp-setup-guide.md`](../../docs/mcp-setup-guide.md) for per-client configuration.

Quick check — from inside a registered project directory:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
  | node /absolute/path/to/Asterim/packages/mcp-memory-server/dist/index.js
```

A JSON-RPC result on stdout and a `project: <name> [<id>]` line on stderr means it resolved correctly.

---

## How it works

- **Transport is stdio.** stdout carries JSON-RPC frames and nothing else — `src/stdio-guard.ts` rebinds `console` to stderr before any other module loads, because a single stray log line corrupts the protocol stream. Diagnostics (database path, resolved project) go to stderr.
- **Storage is the same SQLite file the Core server uses** (`~/.asterim/asterim.db`, or `ASTERIM_DATA_DIR`). This package holds no state of its own; it is a thin MCP surface over `ProjectMemoryService`.
- **Tool failures are returned in band** as `isError` results, never thrown. A malformed request must not drop the transport and end the agent's session.
- **Arguments are validated here**, not downstream: unknown keys, unknown enum values, out-of-range confidence, and malformed anchors are all refused with a message naming the problem. Nothing partially-valid is written.

### Environment

| Variable | Effect |
| :-- | :-- |
| `ASTERIM_DATA_DIR` | Directory holding `asterim.db`. Defaults to `~/.asterim`. |
| `ASTERIM_PROJECT_ID` | Project to attach to (resolution priority 3). |

---

## Development

```bash
pnpm --filter @asterim/mcp-memory-server build      # tsup → dist/index.js
pnpm --filter @asterim/mcp-memory-server dev        # tsup --watch
pnpm --filter @asterim/mcp-memory-server lint
```

There is no test runner in this repository. The suites are standalone scripts run with `tsx`, each with its own assertion harness:

```bash
pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/resolver.test.ts
pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/stdio_scaffold.test.ts
pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/retrieval_tools.test.ts
pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/record_decision.test.ts
pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/dogfood_scenario.test.ts
```

`dist/index.js` must be built first — four of the five drive the real binary as a child process.

`dogfood_scenario.test.ts` also probes the live `~/.asterim/asterim.db` if one exists. It is read-only: it snapshots via `VACUUM INTO` over a read-only connection and asserts the original's sha256 is unchanged.
