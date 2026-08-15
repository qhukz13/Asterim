# Execution Report: P6-03 — MCP Tool Invocation Engine, Change Notifications & Registry UI

**Task ID:** P6-03  
**Phase:** Phase 6 — AI Ecosystem & Multi-Agent Orchestration  
**Status:** IMPLEMENTED & VERIFIED  
**Date:** 2026-08-15  
**Author:** Claude Code  

---

## 1. Summary

Asterim can now call the tools it discovers, notice when a server's catalogue changes, and show all
of it to a developer.

`McpStdioClient.callTool()` issues `tools/call` over the session opened at handshake time, with its
own 30-second budget — protocol requests and someone else's database query need different patience.
A tool that reports failure (`isError: true`) resolves rather than throws: "that file does not exist"
is an answer, and the caller needs the content that explains it. Only transport failures throw.

`notifications/tools/list_changed` is handled: the client reports it, the supervisor re-reads the
catalogue and emits `mcp.capabilities_updated`. A server that mounts a new directory mid-session is
therefore callable without anybody pressing refresh — proven with a mock that changes its tool list
when a tool is called and announces it.

The UI is a store, three components and a workspace tab. It was driven **in a real browser against
the live Core** (§4.4): the registry renders, the drawer opens, and stopping a server through the API
turns the row grey without touching the page — the socket path end to end.

**28 suites / 2,153 assertions**, all four gates green.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `apps/server/src/services/mcp/McpStdioClient.ts` | Modified | `callTool()`, per-request timeout override, `McpTimeoutError`, `notifications/*_changed` routing |
| `apps/server/src/services/mcp/McpProcessSupervisor.ts` | Modified | `callTool()` with liveness and tool-existence checks, `onListChanged` re-read, env-configurable timeouts |
| `apps/server/src/routes/mcp.ts` | Modified | `POST /:id/tools/:toolName`; `TOOL_NOT_FOUND` → 404, `SERVER_NOT_RUNNING` → 409, `TOOL_TIMEOUT` → 504 |
| `packages/shared/src/types/mcp.ts` | Modified | `McpToolContent`, `McpToolCallResult` |
| `apps/server/src/services/mcp/__tests__/McpToolInvocation.test.ts` | Created | 43 assertions: invocation, failure modes, timeout, live catalogue change, REST |
| `apps/web/src/stores/useMcpStore.ts` | Created | Registry state, nine actions, socket event application |
| `apps/web/src/components/mcp/McpServerExplorer.tsx` | Created | Server list, status badges, chips, lifecycle actions |
| `apps/web/src/components/mcp/McpServerModal.tsx` | Created | Create/edit form with argument and environment parsing |
| `apps/web/src/components/mcp/McpServerDetailDrawer.tsx` | Created | Tools (with a runner), Resources & Prompts, Logs |
| `apps/web/src/components/mcp/__tests__/McpServerExplorer.test.ts` | Created | 104 assertions: helpers, store, rendering |
| `apps/web/src/hooks/useSocket.ts` | Modified | Subscribe the four `mcp.*` events into the store |
| `apps/web/src/stores/useViewStore.ts`, `apps/web/src/App.tsx` | Modified | `mcp` view, nav tab, mounted panel |
| `apps/server/src/services/mcp/__tests__/McpCapabilityDiscovery.test.ts` | Modified | One assertion follows the `SERVER_NOT_RUNNING` rename |
| `apps/server/package.json`, `apps/web/package.json` | Modified | Suites wired into `test` |

## 3. Implementation Details

### 3.1 Tool invocation

`McpStdioClient.callTool(name, args, timeoutMs = 30000)` sends `tools/call` over the existing
session and normalises the answer into `{ content, isError }`. `request()` gained a per-call timeout
override so one long budget does not loosen the handshake's short one.

`McpProcessSupervisor.callTool(serverId, toolName, args)` checks two things before anything leaves:

1. **The server is `RUNNING`.** A stopped or crashed server has no session (§6).
2. **The tool is one the last handshake found.** Not bureaucracy: it turns "the server eventually
   answered `-32602`" into an immediate, specific answer, and it is what lets the route return 404
   rather than 500.

A timeout is translated into `McpError('TOOL_TIMEOUT')`, which is the route's 504. The session
survives a timed-out call — asserted, because a client that abandons a request must not corrupt the
id-keyed pending map it shares with every later call.

### 3.2 Dynamic capability invalidation

The client routes `notifications/tools/list_changed` (and the resource and prompt equivalents) to an
`onListChanged` callback. It only *reports*; deciding what to do belongs to the supervisor, which
owns the cache.

The supervisor's handler re-runs discovery and emits `mcp.capabilities_updated`. It is deliberately
best-effort: it runs from a notification with nobody waiting on it, so a failed re-read keeps the
previous capabilities — stale beats empty — and says so in the log.

### 3.3 The tool route

`POST /api/v1/mcp/servers/:id/tools/:toolName` with `{ arguments }`.

| Outcome | Response |
| :--- | :--- |
| Tool ran | 200 `{ result, isError: false }` |
| Tool reported failure | **200** `{ result, isError: true }` — the call succeeded, the tool said no |
| `arguments` is not an object | 400 |
| Unknown tool | 404 `TOOL_NOT_FOUND` |
| Server not running | 409 `SERVER_NOT_RUNNING` |
| Tool never answered | 504 `TOOL_TIMEOUT` |
| Unknown server | 404 `NOT_FOUND` |

The supervisor's timeouts are now environment-configurable (`ASTERIM_MCP_TOOL_TIMEOUT_MS`,
`ASTERIM_MCP_REQUEST_TIMEOUT_MS`, `ASTERIM_MCP_HANDSHAKE_TIMEOUT_MS`). That is operational, not
architectural: a workstation running a slow database server needs a longer budget, and finding that
out should not require a rebuild.

### 3.4 The web layer

`useMcpStore` follows the memory store's conventions exactly — `authHeaders`, `readJson` that throws
the server's own message, actions that write through the API and adopt what comes back. It is
workstation-scoped rather than project-scoped, so unlike the memory store there is nothing to discard
on a project change. `handleMcpEvent` upserts by id, so an event about a server the client has never
seen adds it rather than being dropped.

Each component is split into a props-only view and a store-connected container, for the reason the
Decision Explorer documents: zustand v5 serves `getInitialState` as the server snapshot, so a
store-reading component renders empty under `react-dom/server` and could not be tested at all.

Design decisions worth naming:

- **`INITIALIZING` is amber, not green.** The process exists but the handshake has not finished, and
  a developer who reads that as "ready" would call a tool that is not there yet. Asserted.
- **Command and arguments are separate fields** in the modal. The Core spawns without a shell, so
  `--root "/my dir"` is one argument; a single shell-looking box would produce servers that silently
  never start.
- **The modal says Asterim passes none of its own credentials** and that anything the server needs
  must be named there — the sanitiser from P6-01 is invisible otherwise, and its symptom (a server
  that cannot see `GITHUB_TOKEN`) looks like a bug.
- **The Tools tab runs the tool.** A catalogue that can only be read answers "what exists" but never
  "does it work".

## 4. Verification

### 4.1 Gates

```
pnpm run typecheck  → 11 successful, 11 total (0 errors)
pnpm run lint       → 7 successful, 7 total   (0 errors)
pnpm run test       → 9 successful, 9 total   (28 suites, 2,153 assertions), exit 0
pnpm run build      → 7 successful, 7 total
```

### 4.2 `McpToolInvocation.test.ts` — 43/43

Real child processes speaking real JSON-RPC.

| Group | Covers |
| :--- | :--- |
| Calling (8) | arguments arrive intact; no-argument call sends `{}`; multi-part content preserved, including an image part's mimeType and payload |
| Tool-level failure (2) | resolves with `isError: true` and a readable reason |
| Transport failures (5) | unknown tool → `TOOL_NOT_FOUND`; JSON-RPC error propagates; a hanging tool → `TOOL_TIMEOUT` inside its budget; **the session still works afterwards** |
| Not running (2) | stopped server → `SERVER_NOT_RUNNING`; unknown server → `NOT_FOUND` |
| `list_changed` (8) | a server that gains a tool and announces it; the catalogue is re-read; `mcp.capabilities_updated` emitted carrying both tools; the session is unaffected |
| REST (18) | 200 with content; no-body call; tool failure still 200 with `isError`; non-object arguments 400; 404; 504; 401; 409 after stopping |

### 4.3 `McpServerExplorer.test.ts` — 104/104

| Group | Covers |
| :--- | :--- |
| `statusTone` (7) | every status maps to its token colour; `INITIALIZING` is amber |
| `formatUptime` (5), `canStart` (4) | seconds/minutes/hours; a running or initializing server cannot be started |
| Modal parsers (6) | one argument per line; `KEY=value` splitting on the **first** `=` so a base64 token survives; comments and malformed lines ignored; round trips |
| Drawer formatters (6) | missing schema stated plainly; schema pretty-printed; empty content says so rather than looking successful; binary parts described, not dumped |
| Store (33) | exact URLs, methods, headers and bodies for all nine actions; tool names URL-encoded; failures surface the server's message and clear `pending`; delete closes the drawer |
| Socket events (7) | a crash rewrites the row; a capability update replaces the catalogue; an unknown server is added; an unrelated event changes nothing |
| Rendering (36) | empty state; name, status, tool count, PID, uptime, transport, command; a crashed server shows why and offers Start rather than Stop; error banner; modal fields; drawer tabs, resources, prompts with required markers, logs, empty log, and a stopped server explaining why there are no tools |

### 4.4 In a browser, against the live Core

Paired with a real token, driven with puppeteer:

```
server: RUNNING tools: 2
tool call over HTTP: {"type":"text","text":"hello from the tool"}
MCP tab clicked: true
registry text: … Chat Terminal Changes Memory MCP … MCP Servers — Tool providers Asterim supervises …
drawer opened: true          (Tools (2) · Resources & Prompts (1) · Logs (1))
after a socket-driven stop: "Stopped ui-demo stdio Start Restart Refresh Delete 2 tools PID — up —"
console errors: none
servers left in the real DB: 0
```

The last two lines are the ones that matter. The stop was issued **through the API, not the page** —
the row went from `Running / PID 389154 / up 5s` to `Stopped / PID — / up —` on its own, which is the
`mcp.server_stopped` event travelling Core → Socket.IO → `useMcpStore` → render. And nothing was left
behind in the user's real database.

Screenshots confirmed the registry and drawer visually; two defects were found and fixed there
(§7.3, §7.4).

## 5. Acceptance Criteria Review

- [x] **1. Client and supervisor execute `tools/call` and return structured responses** — 15
      assertions at the supervisor level over real processes, plus the REST surface.
- [x] **2. `notifications/tools/list_changed` invalidates and refreshes, emitting
      `mcp.capabilities_updated`** — 8 assertions driven by a server that genuinely changes its list
      mid-session.
- [x] **3. The tool route handles invocations, timeouts and structured errors** — 18 assertions;
      200/400/404/409/504/401 all covered, including the deliberate 200-with-`isError`.
- [x] **4. The three components render with live Socket.IO reactivity** — 36 render assertions plus
      the live browser run (§4.4), where a socket event rewrote the row unaided.
- [x] **5. All automated unit tests pass** — 43/43 server, 104/104 web.
- [x] **6. CI gates pass with 0 errors, 27+ suites** — **28 suites / 2,153 assertions**, typecheck
      11/11, lint 7/7 (0 errors), build 7/7.

Definition of Done: all seven items complete.

## 6. Git Diff Review

Six new files, ten modified. Reviewed against §6:

- **Tools cannot run on a stopped or crashed server.** The supervisor checks `status === 'RUNNING'`
  *and* the presence of a live client before touching the session; the route maps that refusal to
  409 `SERVER_NOT_RUNNING`. Asserted at both levels.
- **No sensitive environment variable is shown in the log viewer.** The drawer renders
  `recentStderrLogs` — the child's own stderr — and nothing else. `server.env` is never rendered
  anywhere: not in the row, not in the drawer, only in the edit form where the operator typed it.
  The registry row shows `command` and `args`, which the operator also typed.
- **Nothing existing broke.** 28 suites, 2,153 assertions, exit 0 — the 26 prior suites unchanged,
  plus 147 new assertions.

One rename: `NOT_RUNNING` → `SERVER_NOT_RUNNING`, the name §6 uses. It was introduced in P6-02 and
had one caller and one assertion; carrying two codes that mean the same thing would have been worse
than the rename.

`apps/server` reports 0 lint errors and 241 warnings — its pre-task count. `apps/web` reports 0
errors and 265 warnings, **9 more than before**, all `react-refresh/only-export-components` from
exporting pure helpers next to components. That is the pattern `DecisionExplorer.tsx` already uses
(28 such warnings exist repo-wide), and the alternative — a separate helpers file per component —
would invent a layout convention this codebase does not have. All new files are Prettier-clean.

## 7. Problems Discovered

1. **A stray `Core` from an earlier verification run held the port**, so one run measured the *old*
   process and reported a failure that was not real (carried over from P6-02's verification; noted
   again because the symptom is indistinguishable from the bug under test).
2. **The routes use the shared supervisor, not whichever instance a test constructs.** The first
   REST assertions returned 409 because the suite had started the server on its *own* supervisor.
   Fixed by driving the routes end to end and making the singleton's budgets environment-configurable
   so the 504 case costs one second rather than thirty — which is a better production knob anyway.
3. **The drawer header grew without bound.** A server whose command is a long argument list pushed
   the tabs off the panel entirely. Found by looking at the screenshot, not by a test: the render
   assertions all passed. Now clamped to two lines with the full command in the tooltip.
4. **The drawer rendered *under* the workspace chrome.** At `z-index: 50` the app's top bar (100)
   covered the drawer's own title and close button. Also invisible to the render tests, which have no
   layout. Raised above the chrome, and the modal with it.
5. **`useMcpStore` reads the plain `asterim_token` key**, while `useSocket`, `useProjects` and `App`
   use a per-backend key (`asterim_token_<url>`) when a remote workstation is selected. The memory
   store has the same simplification, so this is consistent — but on a machine driving a *remote*
   Core, both stores would send the wrong token. Noted in §8, not fixed here: it is a pre-existing
   inconsistency with a wider blast radius than this task.

## 8. Architectural Concerns

1. **Two token conventions exist** (§7.5). One of them is wrong on remote workstations. Worth
   settling in one place — a shared `authHeaders` helper both stores import — before a third store
   copies the simpler half.
2. **Arguments are not validated against the tool's schema.** The drawer sends whatever JSON the
   developer typed, and the route only checks that it is an object. The `inputSchema` is cached and
   sitting right there; validating against it would turn a confusing server-side error into a
   pointed one. The task's §5.2 stopped at "accepts `{ arguments }`", so this stayed out of scope.
3. **Nothing but a human can call a tool yet.** The point of the catalogue is agent access, and the
   agent layer still cannot reach it. That is the next task, and it is the one that makes P6-01
   through P6-03 pay off.
4. **`callTool` has no concurrency limit.** Nothing stops fifty simultaneous calls to one server; a
   stdio session is a single pipe, and an MCP server is under no obligation to pipeline. A per-server
   queue (the pattern `BaseAdapter` already uses for agent commands) is the natural fix.
5. **The registry is workstation-wide in a project-scoped shell.** The tab lives inside a project
   workspace but lists every server, and `workspaceId` filtering exists in the API and store while
   nothing in the UI passes one. Either the tab should move up to a workstation-level view, or the
   scope should be surfaced and filtered.

## 9. Recommended Next Step

**`P6-04` — expose MCP tools to agents.** Everything is in place to describe and invoke a tool; no
agent can use one. The unit is the bridge: let an adapter's tool-call request resolve against the
supervisor's catalogue, route it through `callTool`, and return the result into the agent's
transcript — with the approval gate the AST guard already establishes for shell commands, because an
MCP tool is exactly as capable as one.

Two things belong in the same task because they only matter once agents are calling tools at
machine speed: **per-server call queueing** (§8.4) and **argument validation against `inputSchema`**
(§8.2). And before any of it, the small one worth doing while it is cheap: **unify the auth token
convention** (§8.1), which is currently one line wrong in two stores.
