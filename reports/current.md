# Execution Report: P6-04 — Agent Tool Bridge, Schema Validation & Per-Server Queueing

**Task ID:** P6-04  
**Phase:** Phase 6 — AI Ecosystem & Multi-Agent Orchestration  
**Status:** IMPLEMENTED & VERIFIED  
**Date:** 2026-08-15  
**Author:** Claude Code  

---

## 1. Summary

Three things stood between MCP tools and an agent: nothing flattened the servers into one namespace,
nothing checked arguments before they crossed the pipe, and nothing stopped two calls using that pipe
at once.

`McpAgentBridge` aggregates every `RUNNING` server's tools as `mcp__<server>__<tool>` and routes calls
back to the right session. It **never throws**: an unknown tool, a stopped server, bad arguments, a
timeout or a full queue all come back as `isError: true` with text an agent can act on, because an
exception here reaches a model as a dead session rather than as an answer it can correct.

`SchemaValidator` checks arguments against the cached `inputSchema` and reports every problem at
once, with a path to each field. It never throws either — a self-referential schema is the server
author's bug, not a reason to take the Core down.

The queue is one call at a time per server, FIFO, bounded at 20, with the slot released in a
`finally`. **Verified against a real child process that reports whether a second call ever arrived
while the first was open** — it never did, over five concurrent calls, both in the suite and through
the live REST route.

The auth inconsistency I flagged in P6-03 is fixed: one `getAuthHeaders` for both stores, resolving
the per-backend key first and falling back to the legacy one. Proven in a browser with the legacy key
**deleted** — the dashboard still authenticates, which it would not have before.

**29 suites / 2,220 assertions**, all four gates green.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `apps/server/src/services/mcp/SchemaValidator.ts` | Created | JSON Schema subset validation that never throws |
| `apps/server/src/services/mcp/McpAgentBridge.ts` | Created | Tool aggregation, namespacing, resolution, agent-shaped results |
| `apps/server/src/services/mcp/McpProcessSupervisor.ts` | Modified | `SerialQueue`, pre-call validation, `queueDepth()`, configurable depth and wait |
| `apps/server/src/routes/mcp.ts` | Modified | `INVALID_ARGUMENTS` → 400, `QUEUE_FULL` → 429 |
| `apps/web/src/utils/auth.ts` | Created | `getAuthHeaders`, `getAuthToken`, `resolveBackendUrl`, `tokenStorageKey` |
| `apps/web/src/stores/useMcpStore.ts`, `useMemoryStore.ts` | Modified | Both delegate to the shared helper |
| `apps/web/src/hooks/useSocket.ts` | Modified | Typed the MCP event handler (removing a warning P6-03 added) |
| `apps/server/src/services/mcp/__tests__/McpAgentBridge.test.ts` | Created | 67 assertions across validation, the bridge and the queue |
| `apps/server/package.json` | Modified | Suite wired into `test` |

## 3. Implementation Details

### 3.1 `SchemaValidator`

`validateToolArguments(args, schema, toolName)` → `{ valid, errors? }`. It understands `type`
(including `integer` as a stricter `number`), `required`, `properties`, nested objects, `items` and
`enum`, and reports **every** failure rather than the first, so an agent fixing its call learns about
all of them in one round trip. Errors carry a path: `read_file.filter.minSize: expected number,
received string`.

Two deliberate positions:

- **Unknown keywords are ignored, not rejected.** `$ref`, `oneOf`, `patternProperties` and anything
  else pass through. A validator that failed closed on features it has not implemented would block
  working tools — a worse failure than letting an argument reach a server that would have caught it.
- **It never throws.** A cyclic schema (a plausible shape for a file tree) is guarded by a `seen` set
  and a depth cap; a malformed one is caught and logged. Both yield `valid: true`, because a broken
  schema is the server author's problem and §6 forbids it becoming a crash.

Validation lives in `McpProcessSupervisor.callTool`, not only in the bridge. Every caller — agent,
REST route, the UI's "Try tool" runner — makes the same mistakes and deserves the same answer; the
live check below shows the route returning `400 INVALID_ARGUMENTS` with the field named.

### 3.2 The per-server queue

A stdio MCP server is one pipe. Two concurrent `tools/call` writes are two interleaved byte streams,
and the protocol has no framing that survives that — so `SerialQueue` runs **one call at a time per
server**, not per process. Waiters are FIFO, capped at `MAX_QUEUE_DEPTH` (20, configurable), each
with a 60-second wait timeout, and past the cap a call is refused immediately with `QUEUE_FULL` →
**429** rather than being enqueued to fail later.

The slot is released in a `finally` (§10). That is the whole design: a tool that throws, times out or
is abandoned must not wedge the server behind it. Asserted directly — after a timed-out call the
queue is empty and the *next* call succeeds, which is the only proof that matters.

### 3.3 `McpAgentBridge`

| Method | Behaviour |
| :--- | :--- |
| `getAvailableTools(workspaceId?)` | Tools from every `RUNNING` server visible to that workspace, namespaced `mcp__<server>__<tool>`, with a description naming the server and the schema the agent must satisfy. Stopped servers contribute nothing: offering a tool that cannot be called produces a failure the agent can do nothing about. |
| `resolveTool(name)` | Matches against the live catalogue rather than splitting on `__` — a server or tool name may contain the separator, and there is no unambiguous split. |
| `executeTool(name, args, workspaceId?)` | Validates, calls through the supervisor (queue and all), and returns `{ name, isError, text, content }` with the content flattened to the string an agent reads. |

Failure text is written for the reader: bad arguments end with "Correct the arguments and call … again";
a stopped server says which server, that it is stopped, and to start it; an unknown name lists what
*is* available; a name without the prefix explains the convention.

### 3.4 Unified auth

`apps/web/src/utils/auth.ts` resolves the backend the same way `useWorkstations` does — the preferred
workstation from `asterim_workstation_config`, else the host serving the page — and reads
`asterim_token_<url>` first, then the plain `asterim_token`. The fallback is the compatibility
bridge: a session paired before this existed keeps working rather than silently logging out.

Both stores now call it. `getAuthHeaders(true)` is accepted as shorthand for `{ json: true }` so the
existing call sites stayed readable.

## 4. Verification

### 4.1 Gates

```
pnpm run typecheck  → 11 successful, 11 total (0 errors)
pnpm run lint       → 7 successful, 7 total   (0 errors)
pnpm run test       → 9 successful, 9 total   (29 suites, 2,220 assertions), exit 0
pnpm run build      → 7 successful, 7 total
```

### 4.2 `McpAgentBridge.test.ts` — 67/67

| Group | Covers |
| :--- | :--- |
| Validator, passing (4) | valid arguments; optional fields omitted; no schema and empty schema accept anything |
| Validator, catching (13) | missing required field named; wrong type with expected vs received; enum violation listing permitted values; **two problems reported together**; float rejected where integer required while integer satisfies number; nested object with a path; array item by index; `undefined` treated as `{}` |
| Validator, never throwing (5) | a self-referential schema returns permissive rather than overflowing; a non-object schema ignored; an unknown keyword ignored |
| Namespacing (4) | `mcp__server__tool`; empty, text and binary content flattening |
| Aggregation (12) | a stopped server offers nothing; a running one contributes; two servers publishing the same tool name are kept apart; workspace scoping shows the global server to another workspace and both to its own |
| Execution (6) | success text and arguments; routing to the correct server by namespace |
| Failure as answer (11) | invalid arguments, missing field caught **before the pipe**, unknown tool listing alternatives, un-namespaced name, stopped server naming itself |
| Queueing (5) | five concurrent calls all succeed; **the server never saw two at once**; served 1–5 in order; each call got its own arguments; the queue is empty afterwards |
| Slot release (3) | a timed-out call leaves nothing queued and the next call is served |
| Queue bottom (4) | with depth 2, three calls accepted and the fourth refused `QUEUE_FULL`; queue empties; the server is still usable |

### 4.3 Against the live Core

Through the real REST route, on the running dev server:

```
bad arguments     -> 400 INVALID_ARGUMENTS | slow_echo.path: expected string, received integer
missing required  -> 400 INVALID_ARGUMENTS | slow_echo.path: required
burst statuses:      200,200,200,200,200
server saw overlap:  false
served order:        1,2,3,4,5
paths in order:      /a,/b,/c,/d,/e
```

Five HTTP requests fired concurrently at one stdio server: the server itself reports it never had two
calls open at once, and every call got its own arguments back in order.

### 4.4 The auth fix, proven by removing the old key

In a browser, with `asterim_token` **deleted** and only `asterim_token_http://<host>:3000` set:

```
MCP tab clicked: true
registry row: "Running queue-demo stdio Stop Restart Refresh Delete 1 tools PID 426575 up 10s …"
console errors: none
servers left in the real DB: 0
```

Before this change `useMcpStore` read only the plain key, so with it absent the request would have
carried no token. The row rendering is the fix working.

## 5. Acceptance Criteria Review

- [x] **1. `SchemaValidator` validates against `inputSchema` with detailed field errors** — 22
      assertions; errors carry a path and say expected vs received; live at the route (§4.3).
- [x] **2. Concurrent calls are serialised without stream corruption** — proven by a server that
      reports overlap: five concurrent calls, zero overlap, strict order — in the suite and over HTTP.
- [x] **3. The bridge aggregates across `RUNNING` servers and executes namespaced calls** — 18
      assertions including two servers publishing the same tool name and workspace scoping.
- [x] **4. Both stores use unified `getAuthHeaders`** — and verified against a browser with the
      legacy key removed (§4.4).
- [x] **5. `McpAgentBridge.test.ts` passes** — 67/67.
- [x] **6. CI gates pass, 29 suites** — **29 suites / 2,220 assertions**, typecheck 11/11, lint 7/7
      (0 errors), build 7/7.

Definition of Done: all six items complete.

## 6. Git Diff Review

Four new files, six modified. Reviewed against §6:

- **The queue cannot grow without bound.** `MAX_QUEUE_DEPTH` (20) is enforced before a waiter is
  created, and the refusal is `QUEUE_FULL` → **429**, the status §6 names. Asserted with a depth of 2,
  including that the server remains usable afterwards.
- **A schema error cannot crash the process.** `validateToolArguments` wraps its walk in a
  `try/catch`, guards cycles with a `seen` set and a depth cap, and returns permissive on anything it
  cannot survive. Three assertions cover cyclic, non-object and unknown-keyword schemas.
- **Nothing existing broke.** 29 suites, 2,220 assertions, exit 0 — the 28 prior suites unchanged,
  plus 67 new. `apps/server` holds at 0 errors / 241 warnings; `apps/web` is at 0 errors / **265**
  warnings, one *fewer* than after P6-03 because typing the MCP socket handler removed a warning I
  had introduced there.

Two deviations from the literal scope, both deliberate:

1. **Validation lives in the supervisor, not only in the bridge** (§3.1). §5.3 puts it in the
   bridge's flow; putting it one level down means the REST route and the UI's tool runner get the
   same field-level errors, which §4.3 demonstrates. The bridge still owns the *phrasing* for agents.
2. **`executeTool` returns a structured result, not a bare string.** §5.3 says "tool result string /
   error string"; the string is `result.text`, and `isError` accompanies it so a caller can tell an
   answer from a failure without parsing prose.

## 7. Problems Discovered

1. **`McpAgentBridge` has no caller.** It is exactly what §5 asked for, and §3 describes where it
   will sit — but nothing in `AgentService` or any adapter invokes it yet, and no route exposes it.
   The subsystem can now describe and safely execute tools for an agent that cannot yet ask. That is
   the next task's job (§9), but it should be said plainly: this task ships a seam, not a working
   agent capability.
2. **A queue slot released in a `catch` would have been wrong.** The timeout path throws *inside*
   `queue.run`, so only a `finally` releases it — with a `catch` around the tool call (the obvious
   first shape) an abandoned call would hold the server forever. The "next call still succeeds"
   assertion is what makes that visible; the queue-depth assertion alone would have passed either way.
3. **`integer` and `number` are not interchangeable** in JSON Schema, and treating them as such would
   have let `limit: 1.5` through to a server expecting a line count. Every integer satisfies `number`;
   the reverse does not hold, and both directions are asserted.
4. **A tool name can contain the separator.** Splitting `mcp__a__b__c` on `__` is ambiguous —
   `server a`, `tool b__c` or `server a__b`, `tool c`. Resolution matches the live catalogue instead,
   and the split is used only to phrase the error when nothing matched.
5. **One warning from P6-03 was mine.** `useSocket.ts` had `(event: any)` in the MCP handler I added
   last task; I had measured the web total before that edit and missed it. Now typed as
   `AsterimEvent<McpServerEventPayload>`.

## 8. Architectural Concerns

1. **Serialisation is per server, and that is a throughput ceiling.** A filesystem server reading
   twenty files answers them one at a time. It is the only safe default for stdio — but MCP servers
   may support concurrent requests, and nothing in the protocol says which do. A per-server
   `maxConcurrent` in the config row (default 1) would let an operator raise it where it is known to
   be safe.
2. **Nothing gates *which* tools an agent may call.** The bridge offers every tool of every running
   server. `agent_profiles.mcp_visibility` already exists in the schema and is unused; an MCP tool is
   as capable as a shell command, and the AST guard gates those. Approval and per-profile visibility
   belong in the same task that wires the bridge to agents.
3. **Validation trusts the cached schema.** If a server changed its tools without announcing it, the
   validator would enforce a stale contract and reject a call the server would have accepted. The
   `list_changed` handling from P6-03 covers the announced case; the silent one is unsolvable without
   re-reading before every call, which is not worth it.
4. **`resolveTool` rebuilds the whole catalogue per call.** It walks every server and tool for each
   `executeTool`, which is fine at today's scale (a handful of servers, tens of tools) and would not
   be at a hundred. An index keyed by namespaced name, invalidated on `mcp.capabilities_updated`, is
   the obvious fix when it matters.
5. **The auth helper resolves the backend from `localStorage` on every request.** Cheap, but it means
   a token lookup depends on a config blob written by a React hook — two owners for one fact. The
   long-term shape is a workstation store both the hook and the helper read.

## 9. Recommended Next Step

**`P6-05` — wire the bridge to agents, with a gate.** Everything an agent needs exists and nothing
calls it. The unit is the connection:

1. **Advertise tools to the adapter.** `getAvailableTools(workspaceId)` at session start, formatted
   for whichever CLI the profile selects, so `mcp__filesystem__read_file` appears in the agent's tool
   list.
2. **Route invocations back through `executeTool`**, returning `text` into the transcript — the
   result shape already matches what an agent consumes.
3. **Gate it like a shell command** (§8.2). An MCP tool writes files and reaches networks; the
   approval path that exists for commands should cover it, and `agent_profiles.mcp_visibility` should
   decide which tools a profile sees at all.

Worth doing in the same task because they only bite once agents call tools unattended: a per-server
`maxConcurrent` (§8.1) and the namespaced-name index (§8.4).
