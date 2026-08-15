# Execution Report: P6-01 — MCP Server Manager Core & Multi-Process Supervisor

**Task ID:** P6-01  
**Phase:** Phase 6 — AI Ecosystem & Multi-Agent Orchestration  
**Status:** IMPLEMENTED & VERIFIED  
**Date:** 2026-08-15  
**Author:** Claude Code  

---

## 1. Summary

The MCP Server Manager is in: an `mcp_servers` table, MCP types in `@asterim/shared`,
`McpProcessSupervisor` supervising real child processes, and nine authenticated
`/api/v1/mcp/servers` endpoints registered on the Core.

The supervisor spawns stdio MCP servers, tracks pid and status, keeps a 50-line rolling
tail of each child's stderr, stops with SIGTERM then SIGKILL after a 3-second grace, and
distinguishes three ways of not running: `STOPPED` (asked to, or exited cleanly),
`CRASHED` (exited on its own with a non-zero code or a signal) and `ERROR` (never
started — a command that does not exist). Configuration is persisted; process state
deliberately is not, because a row claiming `RUNNING` after a Core restart would be a lie.

Child environments are sanitised. The supervisor builds on the repository's existing
`sanitizeAgentEnv` — which already strips `ASTERIM_*` except `ASTERIM_DATA_DIR` — and adds
Asterim's own credentials plus anything credential-shaped. That is asserted not by
inspecting the sanitiser's return value but by having a child print its **own** environment
and checking what is missing from it.

A new **115-assertion** suite spawns genuine `node -e` processes; `pnpm run test` is now
**25 suites / 1,917 assertions**. All four gates pass, and the whole flow was exercised
against the running Core over HTTP (§4.4).

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `apps/server/src/services/mcp/McpProcessSupervisor.ts` | Created | Lifecycle, CRUD, stderr ring buffer, env sanitisation, `shutdownAll()` |
| `apps/server/src/routes/mcp.ts` | Created | The nine REST endpoints with error→status mapping |
| `apps/server/src/services/mcp/__tests__/McpProcessSupervisor.test.ts` | Created | 115 assertions over real processes, real SQLite and the real routes |
| `packages/shared/src/types/mcp.ts` | Created | `McpTransport`, `McpServerStatus`, `McpServerConfig`, `McpServerRuntimeInfo`, `McpServerInput` |
| `packages/shared/src/index.ts` | Modified | Export the MCP types |
| `apps/server/src/services/DatabaseService.ts` | Modified | `mcp_servers` table + workspace index |
| `apps/server/src/index.ts` | Modified | Register `mcpRoutes`; `onClose` hook calling `shutdownAll()` |
| `apps/server/package.json` | Modified | Suite wired into `test` |

## 3. Implementation Details

### 3.1 Schema

`mcp_servers` and `idx_mcp_servers_workspace` were added inside the existing
`CREATE TABLE IF NOT EXISTS` block, so initialisation stays idempotent and an existing
`~/.asterim/asterim.db` keeps opening — no migration framework involved, per the
repository's established pattern. Only configuration is stored; `pid`, `status` and logs
have no columns.

### 3.2 `McpProcessSupervisor`

| Method | Behaviour |
| :--- | :--- |
| `startServer(id)` | `spawn(command, args, { env: sanitizeMcpEnv(…), shell: false })`. Resolves on the `spawn` event (`RUNNING` + pid) or the `error` event (`ERROR` + reason). Already-running is a no-op that does not double-count. |
| `stopServer(id)` | SIGTERM, then SIGKILL after `TERMINATE_GRACE_MS` (3s); resolves when the child has actually exited. Idempotent. |
| `restartServer(id)` | Stop then start; the new pid differs. |
| `getServerStatus(id)` | Config + `status`, `pid`, `uptimeSeconds`, `recentStderrLogs`, `lastError`, `lastExitCode`, `startCount`. |
| `listServers(workspaceId?)` | Configs with runtime attached. With a workspace: its own servers **plus** the global ones. |
| `saveServer(input, id?)` / `deleteServer(id)` | Validated CRUD. Deleting stops the process first; disabling a running server stops it too. |
| `getLogs(id)` | The rolling stderr tail, oldest first. |
| `shutdownAll()` | Stops every live child in parallel. |

Two details worth naming. `spawn` is called with `shell: false`, so a command or argument
containing shell metacharacters is an argument rather than syntax. And the child's
**stdout is drained but never stored**: on stdio transport it is the JSON-RPC channel
carrying tool traffic, so keeping it would be both a leak and a memory problem, while not
reading it at all would block the child on a full pipe.

`RUNNING` means "the process exists", not "the server is ready". A stdio MCP server
announces readiness only through a JSON-RPC `initialize` handshake, which belongs to the
client that will speak to it, not to a supervisor.

### 3.3 Environment isolation (§6)

```
sanitizeMcpEnv(process.env, config.env)
  = sanitizeAgentEnv(process.env)      // ASTERIM_* dropped except ASTERIM_DATA_DIR
    minus BLOCKED_ENV_PATTERNS         // STRIPE_*, RELAY_SECRET, VAPID_*,
                                       // *SECRET*, *TOKEN*, *PASSWORD*, *API_KEY*,
                                       // *PRIVATE_KEY*, *CREDENTIAL*
    plus config.env                    // explicit operator intent wins
```

Reusing `sanitizeAgentEnv` keeps one policy for "what a child process may inherit" rather
than two that drift. The generic patterns are deliberately blunt: an MCP server is
third-party code, and a developer's `GITHUB_TOKEN` should reach it because someone decided
so in the server's own `env`, not because it happened to be exported in the shell that
started Asterim.

`ASTERIM_DATA_DIR` is kept on purpose — an MCP memory server resolves the database through
it, and removing it would break the very servers this subsystem exists to run.

**What this is not.** The child runs as the same user and can read anything that user can,
`~/.asterim/server.json` included. Sanitisation stops Asterim from *handing over* its
secrets; it is not a sandbox, and §8.1 says what a real one would need.

### 3.4 REST surface

`GET/POST /servers`, `GET/PATCH/DELETE /servers/:id`, `POST /servers/:id/{start,stop,restart}`,
`GET /servers/:id/logs` — all requiring `request.user`. Supervisor failures map to status
codes: `NOT_FOUND` → 404, `INVALID_CONFIG` → 400, `SERVER_DISABLED` → 409,
`UNSUPPORTED_TRANSPORT` → 400, `SPAWN_FAILED` → 500, each with a machine-readable `code`.

### 3.5 Shutdown (§10)

`index.ts` registers `fastify.addHook('onClose', () => mcpProcessSupervisor.shutdownAll())`,
verified by closing a Fastify instance with a live child and watching the child die (§4.3).

The supervisor **also** installs a synchronous `process.on('exit')` sweep that signals every
child. That is not belt-and-braces for its own sake: `ServerRegistry.registerCleanup()`
already handles `SIGINT`/`SIGTERM` and calls `process.exit(0)`, which skips async
`onClose` work entirely. Without the synchronous hook, a `Ctrl-C` or a container `SIGTERM`
would orphan every MCP child. §8.2 proposes fixing the underlying ordering properly.

## 4. Verification

### 4.1 Gates

```
pnpm run typecheck  → 11 successful, 11 total (0 errors)
pnpm run lint       → 7 successful, 7 total   (0 errors)
pnpm run test       → 9 successful, 9 total   (25 suites, 1,917 assertions), exit 0
pnpm run build      → 7 successful, 7 total
```

### 4.2 The new suite — 115/115

| Group | Covers |
| :--- | :--- |
| Schema (2) | `mcp_servers` and its index exist after initialisation |
| `sanitizeMcpEnv` (14) | PATH/HOME/LANG pass; `ASTERIM_DATA_DIR` kept; nine credential-shaped variables dropped; an explicitly configured one honoured |
| CRUD (18) | create, persisted row shape, partial update, id and `createdAt` preserved, unfiltered vs workspace-scoped listing (global servers included, other workspaces not), four invalid configurations refused, update of a missing id |
| Start (8) | `RUNNING`, live pid, no error, start counted; starting twice is a no-op; the list agrees |
| Stop (5) | `STOPPED`, pid released, process actually gone, not reported as a crash, idempotent |
| Restart (4) | running again under a new pid, old process gone, start count reflects both runs |
| stderr (6) | capture works, the buffer caps at 50, the oldest lines are the ones dropped, runtime info carries the same tail |
| Crash (5) | `CRASHED`, exit code 3 recorded, explanation, no pid, the child's last stderr line kept |
| Missing binary (3) | `ERROR` rather than `CRASHED`, reason recorded, no pid |
| SIGTERM-ignoring child (5) | ends up `STOPPED`, process gone, and SIGKILL genuinely followed the grace period (**3009 ms**) |
| Disabled / non-stdio (2) | `SERVER_DISABLED`, `UNSUPPORTED_TRANSPORT` |
| Child env, observed (6) | the child prints its own `process.env`: no Stripe key, no relay secret, no other `ASTERIM_*`, but PATH, the configured value and `ASTERIM_DATA_DIR` present |
| Delete / disable (6) | running process stopped first, row gone, second delete harmless; disabling stops a running server |
| `shutdownAll` (3) | three children started, all stopped, all reported `STOPPED` |
| Routes (28) | 401 unauthenticated; create 201; invalid 400 + code; workspace listing; start/stop/restart over HTTP with live pids; single fetch; logs; rename; 404 for unknown id on fetch, start and logs; delete then 404 |

Processes are real, not mocked: a pid that can be probed with `kill(pid, 0)`, a ring buffer
fed by an actual pipe, a SIGKILL that had to wait out a real grace period.

### 4.3 The shutdown hook

A scratch run installing exactly the wiring from `index.ts`:

```
[MCP] Started onclose (pid 336765)
child pid 336765 alive before close: true
[MCP] Stopping 1 MCP server(s)
alive after fastify.close(): false
status: STOPPED
```

### 4.4 Against the running Core

The dev server picked the change up; the full lifecycle was driven over HTTP and left no
residue in the real database:

```
POST   /api/v1/mcp/servers            → 201, id mcp_723767f1-…
POST   /api/v1/mcp/servers/:id/start  → 200 RUNNING, real pid
GET    /api/v1/mcp/servers/:id/logs   → {"logs":["mcp up"]}     ← the child's own stderr
POST   /api/v1/mcp/servers/:id/stop   → 200 STOPPED, pid null
DELETE /api/v1/mcp/servers/:id        → {"deleted":true}
GET    /api/v1/mcp/servers            → {"servers":[]}
```

## 5. Acceptance Criteria Review

- [x] **1. `mcp_servers` created idempotently during initialisation** — inside the existing
      `CREATE TABLE IF NOT EXISTS` block; asserted against `sqlite_master`, table and index.
- [x] **2. Spawns, tracks, stops and restarts with pid and stderr logging** — 30 assertions
      across start/stop/restart/logs, all against real processes with pid liveness probes.
- [x] **3. Crashing children transition cleanly to `CRASHED`** — exit code 3 → `CRASHED`
      with the code, an explanation, no pid, and the child's final stderr line retained.
      A failed *spawn* is `ERROR` instead, which is a different problem for a UI to show.
- [x] **4. All endpoints return accurate status and handle invalid input with structured
      errors** — 28 route assertions; every error carries `code`; 401/400/404/409 covered.
- [x] **5. `McpProcessSupervisor.test.ts` passes** — 115/115.
- [x] **6. CI gates pass, 25 test suites** — typecheck 11/11, lint 7/7 (0 errors), test
      **25 suites / 1,917 assertions**, build 7/7.

Definition of Done:

- [x] `mcp_servers` table added to SQLite schema
- [x] Shared MCP types added to `@asterim/shared`
- [x] `McpProcessSupervisor.ts` implemented
- [x] `/api/v1/mcp/servers` routes registered and functional
- [x] `McpProcessSupervisor.test.ts` created and passing
- [x] `pnpm run test` passes across all packages
- [x] Clean Git diff

## 6. Git Diff Review

Four new files, four modified, all within `apps/server` and `packages/shared`.
Reviewed against §6:

- **No elevated privileges.** `spawn` is called with no `uid`/`gid`, no `shell`, and no
  privilege escalation of any kind; the child inherits the Core's user and nothing more.
- **No internal token reaches a child.** Verified from the child's side: a process printing
  its own `process.env` shows no `STRIPE_SECRET_KEY`, no `ASTERIM_RELAY_SECRET`, and no
  other `ASTERIM_*` variable, while still receiving `PATH` and its own configured values.
  The `server.json` loopback token is not an environment variable and is never passed;
  the honest caveat about filesystem access is in §3.3.
- **Nothing existing broke.** 25 suites, 1,917 assertions, exit 0 — the 24 prior suites
  unchanged at 1,802, plus 115 new. `apps/server` reports **0 lint errors and 241
  warnings**, exactly the count before this task, so the new code adds none.

Changes to existing files are additive: a schema block, a type export, a route
registration, an `onClose` hook and a test-script entry. The new files are Prettier-clean;
`index.ts` and `DatabaseService.ts` were already non-compliant before this task and were
not reflowed.

## 7. Problems Discovered

1. **A just-spawned child has not installed its signal handlers yet.** The suite's
   SIGTERM-ignoring process was being terminated by the *first* SIGTERM, because Node had
   not finished booting and running the `-e` script when the stop arrived — so the default
   signal action still applied. The test now waits for the child to announce itself on
   stderr before stopping it. Worth knowing beyond the test: a supervisor that starts and
   immediately stops a server cannot assume the child's own shutdown handling exists yet.
2. **`ServerRegistry`'s signal handler pre-empts graceful shutdown.** It handles
   `SIGINT`/`SIGTERM` and calls `process.exit(0)`, which skips every async `onClose` hook
   — including this one. Hence the synchronous `process.on('exit')` sweep (§3.5); without
   it, `Ctrl-C` on a workstation or `docker stop` on a container would leave MCP children
   orphaned.
3. **`kill(pid, 0)` succeeds for a zombie**, which briefly made a stop look successful when
   it had not happened. Assertions poll until the pid is genuinely unreachable rather than
   sampling once.
4. **Prettier reformats a comment placed inside a parenthesised ternary cast** into
   something it then disagrees with, so `--write` never converges. Restructuring the
   statement — comment above, cast on a simple expression — fixed it. Cosmetic, but it
   cost a couple of cycles.

## 8. Architectural Concerns

1. **This supervises processes; it does not sandbox them.** An MCP server is third-party
   code running with the developer's full privileges: it can read `~/.asterim/asterim.db`
   and `server.json`, reach the network, and write anywhere the user can. Environment
   sanitisation narrows what Asterim *hands over*, nothing more. If MCP servers are going
   to be installed from a marketplace (the Phase 6 roadmap), the boundary needs to be a
   real one — a container, a user, or at minimum a documented trust model.
2. **Shutdown ordering needs one owner.** Three subsystems now have opinions about process
   exit (`ServerRegistry`, this supervisor, the crash handlers). A single graceful-shutdown
   sequence — signal → `fastify.close()` → registered hooks → exit — would replace the
   synchronous backstop and make `onClose` meaningful for everything, not just for callers
   who close programmatically.
3. **Nothing starts these servers automatically.** `isEnabled` is honoured for stopping but
   nothing starts enabled servers when the Core boots, so after a restart every MCP server
   is down until something asks. That is a deliberate scope line for P6-01, but it is the
   first thing a user will notice.
4. **`sse` transport is stored but not supervised.** A server configured as `sse` is
   refused at start with a clear reason. Either the supervisor gains an HTTP/SSE health
   probe, or the type should not accept a value the system cannot honour.
5. **The routes are authenticated but not authorised.** Any authenticated user can register
   an MCP server, which is a command the Core will execute. On a single-user workstation
   that is exactly right; the moment accounts and roles matter, this endpoint deserves an
   `rbacGuard` — it is the most powerful API in the product.

## 9. Recommended Next Step

**`P6-02` — MCP capability discovery and autostart.** The supervisor can run a server;
Asterim still cannot say what any of them *offers*. The natural next unit is the JSON-RPC
`initialize` handshake over the child's stdio: negotiate, read `tools/list` and
`resources/list`, cache the capabilities against the server row, and expose them on
`GET /api/v1/mcp/servers/:id/capabilities`. That turns `RUNNING` into a claim about
readiness rather than about a pid, and gives the agent layer something to route against.
Autostart of `isEnabled` servers on Core boot (§8.3) belongs in the same task, since both
need the handshake to know a server actually came up.

Before that, one small thing worth doing while it is cheap: **give shutdown a single
owner** (§8.2). It is a contained change today and gets harder with every subsystem that
adds an exit opinion.
