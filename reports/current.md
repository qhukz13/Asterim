# Execution Report: P6-02 — MCP Capability Discovery, Stdio Handshake & Boot Autostart

**Task ID:** P6-02  
**Phase:** Phase 6 — AI Ecosystem & Multi-Agent Orchestration  
**Status:** IMPLEMENTED & VERIFIED  
**Date:** 2026-08-15  
**Author:** Claude Code  

---

## 1. Summary

`RUNNING` now means something. `McpStdioClient` speaks JSON-RPC 2.0 over the child's stdio,
negotiates `initialize`, sends `notifications/initialized`, and reads back `tools/list`,
`resources/list` and `prompts/list` — asking only for what the server advertised. The supervisor
walks `STARTING → INITIALIZING → RUNNING` and reaches `RUNNING` only once capabilities are cached;
a handshake that fails or times out marks the server `ERROR` **and stops the unusable process**.

Four `mcp.*` events reach the EventBus on every transition, `autostartEnabledServers()` brings up
enabled servers on boot without ever blocking it, and `GET /capabilities` / `POST /refresh` expose
and re-read the catalogue.

Shutdown now has one owner. `ServerRegistry` had its own `SIGINT`/`SIGTERM` handlers that called
`process.exit(0)`, which silently skipped every asynchronous cleanup anything else registered —
the exact problem §8.2 of the P6-01 report flagged. Those handlers are gone; `setupGracefulShutdown`
closes Fastify, stops the MCP children, removes `server.json` and closes SQLite, in that order,
bounded by a timeout.

Two new suites' worth of evidence: **89 new assertions** here plus the P6-01 suite updated to the new
contract, and both verified against a **real booted Core** — a real SIGTERM killing a real MCP child,
and a real reboot autostarting one (§4.3, §4.4). `pnpm run test` is now **26 suites / 2,006
assertions**; all four gates pass.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `apps/server/src/services/mcp/McpStdioClient.ts` | Created | JSON-RPC 2.0 over stdio: framing, id multiplexing, timeouts, `discover()` |
| `apps/server/src/services/GracefulShutdown.ts` | Created | The single shutdown owner |
| `apps/server/src/services/mcp/__tests__/McpCapabilityDiscovery.test.ts` | Created | 89 assertions across framing, discovery, failure modes, events, autostart, routes |
| `apps/server/src/services/mcp/McpProcessSupervisor.ts` | Modified | Handshake integration, `INITIALIZING`, capability cache, `refreshCapabilities`, `autostartEnabledServers`, EventBus emissions |
| `packages/shared/src/types/mcp.ts` | Modified | Capability types, `INITIALIZING`, `McpServerEventPayload`, `MCP_EVENTS` |
| `apps/server/src/routes/mcp.ts` | Modified | `GET /capabilities`, `POST /refresh`, `NOT_RUNNING` → 409 |
| `apps/server/src/services/DatabaseService.ts` | Modified | Idempotent `close()` |
| `apps/server/src/services/ServerRegistry.ts` | Modified | `registerCleanup()` removed — it was the competing shutdown owner |
| `apps/server/src/index.ts` | Modified | `setupGracefulShutdown(fastify)`, autostart kick-off |
| `apps/server/src/services/mcp/__tests__/McpProcessSupervisor.test.ts` | Modified | Fixtures now speak MCP (§7.1) |
| `apps/server/package.json` | Modified | New suite wired into `test` |

## 3. Implementation Details

### 3.1 `McpStdioClient`

Newline-delimited JSON-RPC over the child's stdin/stdout. Three properties of that transport drive
the implementation:

- **Framing.** A `data` chunk may carry half a message or several. Text accumulates in a buffer and
  is split on newlines; the trailing fragment is kept for the next chunk. Asserted with a response
  deliberately split across three writes, one of them mid-token (§10 of the task).
- **Multiplexing.** Every request carries an id and a pending entry; answers are matched by id, not
  by arrival order. Asserted by answering two concurrent requests backwards in a single write.
- **Tolerance.** A non-JSON banner line, a server notification, and an answer to an id nobody is
  waiting on are all survived rather than fatal — real servers print banners.

`discover()` sends `initialize` (protocol `2024-11-05`, `clientInfo: asterim-core/0.1.0`), then the
required `notifications/initialized`, then **only the lists the server advertised**. Asking an
implementation for prompts it never claimed is how a healthy server gets reported as broken. A server
that advertises a list and then answers `-32601` degrades to an empty list rather than failing the
handshake; any other error propagates.

### 3.2 Supervisor

| Concern | Behaviour |
| :--- | :--- |
| States | `STARTING` (spawn) → `INITIALIZING` (handshake) → `RUNNING` (capabilities cached). Failure at any point → `ERROR`. |
| Failed handshake | The process is alive but unusable, so it is stopped. Leaving a supervised process nothing can talk to would be worse than reporting the failure. |
| Child dies mid-handshake | The handshake races the child's `exit` and fails immediately instead of waiting out the timeout — and the `CRASHED` status the exit handler already set is preserved, because "exited with code 3" explains more than "handshake failed". |
| Timeouts | Two bounds: per-request (5s default) and whole-handshake (10s default). Both asserted, including the case where the outer one is the tighter of the two. |
| Session | One `McpStdioClient` per running child, kept open — a refresh, and eventually tool invocation, speak over the same session. Disposed on stop and on exit. |
| `refreshCapabilities` | Re-runs discovery against a live server; `NOT_RUNNING` (409) otherwise. |
| `autostartEnabledServers` | Starts every enabled stdio server in parallel, **never rejects**, logs failures and leaves each status visible. Called un-awaited from `index.ts`, so a slow MCP server cannot delay a workstation. |

### 3.3 Events

`mcp.server_started`, `mcp.server_stopped`, `mcp.server_crashed`, `mcp.capabilities_updated`, all
published in the repository's established envelope (`id`, `timestamp`, `source: 'system:mcp'`,
`type`, `payload`) with `payload: { server: McpServerRuntimeInfo }`.

The payload deliberately carries no `projectId`. That is not an omission — `socketManager` persists
an event into the project log **only** when one is present, so MCP events are broadcast to connected
clients and never written to a table. That is what keeps §6's "no tool payload in persistent log
tables" true by construction rather than by discipline. Asserted.

`ERROR` states are announced as `mcp.server_crashed`: the four event types the task specifies have no
separate "failed to become usable" event, and the payload's `status` field distinguishes `ERROR` from
`CRASHED` for any client that cares.

### 3.4 One shutdown owner

`ServerRegistry.registerCleanup()` trapped `SIGINT`/`SIGTERM` and called `process.exit(0)`. Since
Node runs signal listeners in registration order and `process.exit()` does not wait for anything,
that handler ended the process before any asynchronous cleanup elsewhere could run — including the
MCP `onClose` hook added in P6-01. It has been removed, and `setupGracefulShutdown(fastify)` now owns
the sequence:

```
SIGINT/SIGTERM → fastify.close()          (fires onClose hooks)
               → mcpProcessSupervisor.shutdownAll()
               → serverRegistry.clear()   (remove server.json)
               → dbService.close()        (checkpoint the WAL)
               → exit(0)
```

Each step is individually guarded, so one failure cannot strand the rest; the whole sequence is
bounded at 10s, after which the process exits anyway; a second signal exits immediately. A
synchronous `process.on('exit')` still clears the descriptor for the paths no handler can await.

`setupGracefulShutdown` lives in its own module rather than inside `McpProcessSupervisor` (where §5.3
lists it): it closes the HTTP server and the database, and having the MCP subsystem own the Core's
lifecycle would invert the dependency. §8 of the task asks for the sequence to be wired in
`index.ts`, which it is.

## 4. Verification

### 4.1 Gates

```
pnpm run typecheck  → 11 successful, 11 total (0 errors)
pnpm run lint       → 7 successful, 7 total   (0 errors)
pnpm run test       → 9 successful, 9 total   (26 suites, 2,006 assertions), exit 0
pnpm run build      → 7 successful, 7 total
```

`apps/server` reports 0 lint errors and 241 warnings — the same count as before this task, so the new
code adds none.

### 4.2 The new suite — 89/89

| Group | Covers |
| :--- | :--- |
| Framing (13) | request written as one line; a response split across three chunks reassembled; two messages in one chunk; answers matched by id, not order; banner line, notification and stray id survived; request timeout names its method; dispose fails what is in flight |
| `discover()` (13) | protocol version and `serverInfo` returned; tools read with schemas intact; unadvertised lists empty and **never requested**; `initialize` first, then `notifications/initialized`; the client's own identity sent |
| Full server, supervised (10) | `RUNNING` with a pid; protocol version, server identity, 2 tools, 1 resource, 1 prompt; schema survives the round trip; no error recorded |
| Refresh (3) | stays `RUNNING`; a tool added since the last handshake appears; the snapshot is newer |
| Tools-only server (5) | `RUNNING`; resources and prompts empty; the server never complained about an unadvertised request |
| Advertise-but-not-implement (3) | still usable; the missing method degrades to an empty list |
| Silent server (6) | `ERROR` by timeout, reason recorded naming the request, no capabilities claimed, **process not left running**, stderr still available for diagnosis |
| Whole-handshake bound (3) | with a generous per-request timeout, the outer bound is what stops it |
| Refusing server (3) | `ERROR` carrying the server's own message |
| EventBus (9) | `server_started` + `capabilities_updated` on start; payload carries the server, status and capabilities; **no `projectId`**; `server_stopped` on stop; `server_crashed` on crash |
| Autostart (7) | only enabled servers considered; good ones `RUNNING`; disabled untouched; broken one `ERROR`; autostart itself never throws; capabilities available immediately |
| Routes (14) | capabilities 200 with `null` before any handshake; served after; refresh updates the list; refresh on a stopped server 409 `NOT_RUNNING`; last-known capabilities still readable; 404s; 401 unauthenticated |

### 4.3 Graceful shutdown, against a real Core

A Core booted on a scratch data dir, an MCP server registered and started **through the HTTP API**,
then a real `SIGTERM`:

```
started: RUNNING pid 361057 tools 1
child alive before shutdown: true      server.json present: true
--- after SIGTERM ---
child alive: false                     server.json present: false     port released: true
```

This is the change that could not be proven by unit tests alone, since the behaviour it fixes was a
conflict between two signal handlers in a booted process.

### 4.4 Boot autostart, against a real Core

A server registered on one boot and never started, then the Core restarted:

```
registered: autostart-stub  enabled: true  status: STOPPED
after reboot -> status: RUNNING  pid: 361722
capabilities: 2 tools from autostub
GET /capabilities -> ["alpha","beta"]
```

Nothing asked it to start, and its tools were known before any client connected.

## 5. Acceptance Criteria Review

- [x] **1. `McpStdioClient` conducts the handshake and retrieves all three lists** — 26 assertions
      across framing and discovery, plus real child processes serving all three lists.
- [x] **2. Capabilities cached; `RUNNING` only after a successful handshake** — asserted on the
      supervisor and observed end-to-end (§4.4). The P6-01 suite had to be updated precisely because
      this contract changed (§7.1).
- [x] **3. Failures and timeouts mark `ERROR` with the reason recorded** — timeout, whole-handshake
      bound, JSON-RPC error and mid-handshake death all covered; the unusable process is stopped.
- [x] **4. `autostartEnabledServers()` starts enabled servers without blocking boot** — 7
      assertions including a broken server that ends `ERROR` while the others run; called un-awaited
      from `index.ts`; verified across a real restart (§4.4).
- [x] **5. `mcp.*` events emitted on all state transitions** — 9 assertions; started, stopped,
      crashed and capabilities_updated all observed on the bus.
- [x] **6. Unified graceful shutdown terminates MCP children on `SIGINT`/`SIGTERM`** — verified on a
      booted Core: child gone, descriptor removed, port released (§4.3).
- [x] **7. `McpCapabilityDiscovery.test.ts` passes** — 89/89.
- [x] **8. CI gates pass with 0 errors** — typecheck 11/11, lint 7/7, test 26 suites / 2,006
      assertions, build 7/7.

Definition of Done: all nine items complete.

## 6. Git Diff Review

Three new files, eight modified, all within `apps/server` and `packages/shared`. Reviewed against §6:

- **Boot is never blocked by a failing MCP server.** `autostartEnabledServers()` catches per-server,
  returns rather than throws, and is called without `await`. A server whose binary does not exist
  ends `ERROR` while its neighbours run — asserted, and the Core in §4.4 booted normally.
- **No tool payload reaches a log table.** The child's stdout is consumed by the JSON-RPC client and
  written nowhere; only stderr enters the 50-line in-memory ring buffer, which is not persisted; and
  `mcp.*` events carry no `projectId`, which is the condition `socketManager` uses to decide whether
  to write an event to the database.
- **Nothing existing broke.** 26 suites, 2,006 assertions, exit 0. One suite needed updating, and the
  reason is a contract change this task exists to make (§7.1).

Two changes to existing behaviour, both deliberate:

1. **`ServerRegistry.registerCleanup()` was removed.** It was the competing shutdown owner. Its
   descriptor-removal duty is preserved in `GracefulShutdown` (both in the ordered sequence and in
   the synchronous `exit` backstop), and it had exactly one caller.
2. **`RUNNING` requires a handshake.** A supervised process that does not speak MCP now ends `ERROR`
   rather than sitting in `RUNNING` forever. That is the point of the task, and it is why the P6-01
   fixtures changed.

New files are Prettier-clean; `index.ts` and `DatabaseService.ts` were already non-compliant before
this task and were not reflowed.

## 7. Problems Discovered

1. **The P6-01 suite asserted the old contract.** Its fixtures were plain `node -e` processes that
   stay alive without speaking MCP, so under the new rule they were stopped and marked `ERROR` —
   23 of 115 assertions failed. Fixed by giving every long-lived fixture a minimal `initialize` +
   `tools/list` responder; what each case actually tests (a pid, a stderr buffer, a refused signal,
   an env dump) is unchanged, and the suite is back to 115/115. This is the expected cost of a
   deliberate contract change, not collateral damage.
2. **An `unref()`'d timeout can be skipped entirely.** The request timer was `unref`'d, so when the
   event loop had nothing else to hold it open the process exited *before* the timer fired — a test
   run ended silently mid-suite with exit code 0 and no tally. In production a child-process handle
   keeps the loop alive and it never showed. Both the request timeout and the handshake bound are now
   ordinary timers, cleared on every settling path.
3. **A child that dies during the handshake used to cost a full timeout** and then overwrote the more
   informative `CRASHED` status with `ERROR`. The handshake now races the child's exit.
4. **A bodiless `POST` with `content-type: application/json` is a 400.** Fastify rejects an empty
   body under that header, so `POST /start` fails for a client that always sets it. Not changed —
   this is framework behaviour shared by every bodiless POST in the codebase — but worth knowing
   before the web UI is written against these routes.
5. **A stale Core from an earlier verification run held the port**, so a later run silently measured
   the *old* process and reported a shutdown failure that was not real. Worth recording because the
   symptom looked exactly like the bug under test. All strays were cleaned up; the user's dev servers
   on 3000/5173/5174 were left untouched.

## 8. Architectural Concerns

1. **`tests/report.md` currently says `BLOCKED`, and it is not a code defect.** A QA agent ran
   TEST-P6-01 against the working tree *while this task was mid-flight* and recorded transient
   failures — the `fullId` lint error, the `TS18048`/`TS18046` errors, and the 92/115 supervisor
   suite — every one of which is a state I passed through and fixed. At the tree this report
   describes: typecheck 11/11, lint 0 errors, `McpProcessSupervisor.test.ts` 115/115, full battery
   26 suites / 2,006 assertions. The gate is re-runnable as soon as this work is committed. The
   deeper lesson is procedural: a QA gate and an implementation task must not run against the same
   working tree at the same time.
2. **Capabilities are a snapshot, and nothing invalidates them.** MCP defines
   `notifications/tools/list_changed`; the client ignores notifications entirely. A server that
   gains or loses a tool is only noticed on the next explicit refresh, so a cached catalogue can be
   quietly wrong. Handling that notification is the natural next increment.
3. **The open session is not used for anything yet.** One `McpStdioClient` per running child is kept
   alive deliberately, but nothing calls a tool through it. Until `tools/call` exists, the MCP
   subsystem can describe capabilities it cannot yet exercise.
4. **`sse` remains stored but unsupported**, unchanged from P6-01 and now more visible: a server
   configured as `sse` can never reach `RUNNING`.
5. **Autostart has no backoff and no supervision after the fact.** A server that crashes a second
   after autostart stays `CRASHED` until someone asks. A restart policy (`always` / `on-failure` /
   `never`) with exponential backoff is the obvious companion to autostart, and belongs in the config
   row rather than in code.

## 9. Recommended Next Step

**`P6-03` — tool invocation and live capability tracking.** The catalogue exists; nothing can call
into it. In order:

1. **`tools/call` through the open session**, exposed as `POST /api/v1/mcp/servers/:id/tools/:name`
   with argument validation against the cached `inputSchema`, and a per-call timeout. This is the
   point of everything built in P6-01 and P6-02.
2. **Handle `notifications/tools/list_changed`** (§8.2) so a cached catalogue cannot go quietly
   stale, re-emitting `mcp.capabilities_updated` when it does.
3. **A restart policy on the server row** (§8.5), which is what makes autostart trustworthy on a
   workstation that stays up for days.

Before any of that: **commit this work and re-run TEST-P6-01** (§8.1). The gate is blocked on tree
state, not on defects, and it should be cleared before more code lands on top of it.
