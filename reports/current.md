Task-ID: P8-01
Status: COMPLETE

# Execution Report: P8-01 — Shared Team Agent Primitive, Schema & Turn Concurrency Engine

**Task ID:** P8-01
**Phase:** Phase 8 — Collaborative Team Agents & Multi-User Governance
**Status:** IMPLEMENTED & VERIFIED
**Date:** 2026-08-18
**Author:** Claude Code

---

## 1. Summary

The Shared Team Agent primitive and the Turn Concurrency Engine are implemented end to end: migration `002_team_agents` (four tables, four indexes) applying through the DEC-030 `MigrationEngine`; the shared type contract in `@asterim/shared`; `AgentTurnLock` as a per-thread FIFO lock with Socket.IO turn broadcasting; `TeamAgentService` for agent/thread CRUD, durable queue persistence, transcript logging and turn dispatch through `AgentService`; seven authenticated REST routes registered in `server.ts`; and a 162-assertion automated suite wired into `apps/server`'s `test` script.

All four CI gates are green with 0 errors: `pnpm typecheck` (11/11 tasks), `pnpm lint` (7/7, 0 errors), `pnpm test` (10/10 tasks, every suite at 100%), `pnpm build` (7/7).

Two things worth Antigravity's attention before reading further, both detailed in §7 and §8:

1. The task named `packages/server/src/migrations/002_team_agents.sql`. That path does not exist (the server is `apps/server`) and the `.sql` form contradicts the DEC-030 implementation shipped in P7-02, which compiles migrations in as TypeScript modules for a documented reason. The migration was authored as `apps/server/src/migrations/002_team_agents.ts` following the existing engine's contract. **No specification change was made** — see §8 for the discrepancy note.
2. Adding migration 2 exposed a pre-existing build-ordering gap that made `pnpm run test` fail. It is fixed (one line in `turbo.json`) and explained in §7.

---

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `packages/shared/src/types/teamAgent.ts` | Created | The team agent / turn contract across the WebSocket boundary: `TeamAgent`, `TeamThread`, `TeamTurnRequest`, `TeamTurnQueueItem`, `TeamAgentMessage`, `TeamTurnStatus`, `TeamThreadTurnState`, `TeamTurnQueueState`, `TeamTurnResult`, `TeamTurnEventPayload` and the four `team_turn:*` event constants. |
| `packages/shared/src/index.ts` | Modified | Exports the new type module. |
| `apps/server/src/migrations/002_team_agents.ts` | Created | Migration v2: `team_agents`, `team_threads`, `team_turn_queue`, `team_agent_messages` + the four declared indexes. |
| `apps/server/src/migrations/index.ts` | Modified | Registers migration 2; `LATEST_SCHEMA_VERSION` becomes 2. |
| `apps/server/src/services/ai/AgentTurnLock.ts` | Created | The Turn Concurrency Engine: per-thread FIFO queue, atomic turn lock, approval parking, and turn-transition broadcasting. |
| `apps/server/src/services/ai/TeamAgentService.ts` | Created | Agent/thread CRUD, durable queue mirroring, transcript logging, turn dispatch, restart recovery, and the production `EventBusTeamTurnExecutor`. |
| `apps/server/src/routes/teamAgents.ts` | Created | The seven authenticated REST routes under `/api/v1/team-agents` and `/api/v1/team-threads`. |
| `apps/server/src/server.ts` | Modified | Registers `teamAgentRoutes`; calls `teamAgentService.recoverTurns()` during startup recovery. |
| `apps/server/src/services/ai/__tests__/TeamAgentService.test.ts` | Created | 162-assertion suite across 13 sections. |
| `apps/server/package.json` | Modified | Adds the new suite to the `test` script. |
| `turbo.json` | Modified | `@asterim/mcp-memory-server#test` now depends on its own `build` (see §7). |

No files were deleted. `tests/report.md` was already modified in the working tree before this task began; it is **not** mine and was deliberately left out of the commit.

---

## 3. Implementation Details

### 3.1 Schema (migration v2)

Four tables in one migration, applied transactionally by the existing engine:

- `team_agents` — `id`, `team_id`, `name`, `role`, `description`, `system_prompt`, `model`, `temperature`, `enabled_mcp_servers`, `enabled_skills`, `created_by`, `created_at`, `updated_at`.
- `team_threads` — `id`, `team_agent_id`, `project_id`, `title`, `status`, `active_turn_user_id`, `created_at`, `updated_at`, FK → `team_agents` `ON DELETE CASCADE`.
- `team_turn_queue` — every column DEC-031 names (`id`, `team_thread_id`, `user_id`, `user_name`, `instruction`, `context_json`, `status`, `queued_at`, `started_at`, `completed_at`, `error_message`), FK → `team_threads` `ON DELETE CASCADE`.
- `team_agent_messages` — `id`, `team_thread_id`, `user_id`, `user_name`, `role`, `content`, `tool_calls_json`, `created_at`, FK → `team_threads` `ON DELETE CASCADE`.
- Indexes: `idx_team_agents_team`, `idx_team_threads_agent`, `idx_team_queue_thread_status`, `idx_team_messages_thread`.

**One column beyond the task's list:** `team_threads.project_id`. A shared agent executes on the host workstation against a real checkout (DEC-032 § 1), and `AgentService` needs a `projectId` to resolve a working directory. It is nullable — a thread with no binding can be read and queued into but not served, and a turn on one fails with a clear `NO_PROJECT_BOUND` reason rather than running somewhere arbitrary. That behaviour is asserted.

### 3.2 `AgentTurnLock`

Per-thread "lane" holding an active turn, a FIFO queue, a `TeamThreadTurnState`, and pending `acquireTurn` resolvers.

- `enqueue(item, context)` is **synchronous and total**: when it returns, the turn's place in the order is fixed. This is what makes the FIFO guarantee real — two members submitting in the same tick both reach it before either awaits. It returns the number of turns ahead, so a caller can say "you are third" without a second query.
- `acquireTurn(threadId, turnId, context?)` resolves `true` when the turn holds the lock and `false` when it was cancelled while waiting. A turn id the lock has never seen is enqueued on the spot, so the two-step and one-step forms both work and observe the same order. A turn id already settled answers `false` rather than getting a new place in line (a bounded `settled` set of 2000 ids, so a long-running Core does not leak).
- `pump` grants the head of the queue **whether or not its waiter has registered yet**. Making activation wait for a promise to be constructed would let a turn whose caller is one microtask slower be overtaken by the one behind it; a caller that acquires afterwards finds itself already active and is answered immediately.
- `releaseTurn(threadId, turnId, outcome?)` frees the lock and pumps. A release naming a turn that is not the active one is ignored — a timed-out turn that later finishes must not release its successor's lock. `outcome` carries the real status so a failed turn is not announced to the room as `COMPLETED`.
- `cancelTurn` withdraws **queued turns only** and returns `false` for the active one, which is what lets the REST layer answer 409 rather than silently corrupting a turn mid-generation.
- `markAwaitingApproval` / `resumeFromApproval` park and resume the active turn **without releasing the lock** (DEC-031 § 3): an approval prompt is part of a turn, not a gap between turns.
- Broadcasting is injected (`TurnBroadcaster`). Production publishes `team_turn:queued|started|completed|cancelled` on the EventBus with `workspaceId` set to the team id, which the existing `socketManager` bridge routes to the `workspace:<id>` room. Nothing in this file imports Socket.IO, which is what lets the ordering guarantees be tested with no network, no database and no PTY.

### 3.3 `TeamAgentService`

- **CRUD** for agents (`create`/`get`/`require`/`list(teamId)`/`update`/`delete`) and threads (`create`/`get`/`require`/`list(agentId)`), with `ProfileService`-style validation. The unset-vs-empty distinction on capability lists is preserved: `undefined` means "whatever the workstation allows", `[]` means "deliberately nothing".
- **`enqueueTurn(request)`** persists the queue row, writes the member's instruction into the shared transcript *at submission time* (so a busy thread shows the queue as it actually is), then enqueues on the lock. Everything up to and including `lock.enqueue` is synchronous. It returns `{ turn, queuePosition, completion }`; `completion` never rejects.
- **`runTurn`** is the only place the lock and the database meet. It runs nothing before `acquireTurn` answers `true`, and every path out — success, executor throw, timeout, failed bookkeeping write — reaches `releaseTurn` through a `finally` whose database writes are individually guarded. A failed UPDATE is a lost record; a skipped release is a shared thread that never moves again.
- **`cancelTurn`** returns the settled turn for one that is already over (so clicking Cancel on a request that just finished is not an error), raises `TURN_NOT_CANCELLABLE` for one being served, and `TURN_NOT_FOUND` for an unknown id.
- **`recoverTurns()`** settles rows a restart stopped on top of: `PROCESSING`/`AWAITING_APPROVAL` → `FAILED`, leftover `QUEUED` → `CANCELLED` (nothing is waiting on the lock for them), and every thread back to `IDLE`. Called from `server.ts` alongside `agentDelegationService.recoverDelegations()`.
- **`EventBusTeamTurnExecutor`** is the production executor. It uses the team thread's id as the session's thread id, so a shared thread is one long-lived session rather than a process per turn — which is what makes the agent's memory of the team's earlier questions real. It publishes the same `client.command` / `client.chat_message` events the dashboard does, inheriting the workspace check, the sanitized subprocess environment and the approval interception. Completion is *observed* (output, then idle) exactly as `AgentDelegationService` documents, with the same `error starting agent` guard so an unstartable session fails fast instead of holding the lock for ten minutes with the team queued behind it. It owns the "has this session been briefed" state itself, so the persona is published once and never repeated into a session already running under it.

### 3.4 REST

Seven routes, all rejecting anonymous requests. Two decisions live in the route layer:

- **The author of a turn comes from the session, never the body.** In a shared thread the author is what the whole team reads and what an approval policy is evaluated against, so a client that could name someone else could put words in a colleague's mouth. Only the display name is taken from the request. Same for `createdBy` on agent creation.
- **`POST /turns` answers 202 immediately** with the turn and its queue position rather than holding the request open. Holding it would make the third person in a queue wait out the two turns ahead of them on a connection, which is the failure a queue exists to replace. The outcome arrives on the socket, and the pending promise is consumed so a late failure cannot surface as an unhandled rejection.

`GET /api/v1/team-agents` requires `?teamId=`: there is no ambient "current team" on a request, and answering with every team's agents would be a cross-team disclosure dressed up as a convenience.

---

## 4. Verification

Every command below was run to completion in this session; the figures are actual output.

**New suite** — `pnpm --filter asterim exec tsx src/services/ai/__tests__/TeamAgentService.test.ts`

```
162/162 assertions passed
```

13 sections: migration application · agent/thread persistence · FIFO under concurrent submission · turn atomicity · cancellation · failure-releases-lock · broadcast · the lock in isolation · prompt composition · the production executor · restart recovery · cascade delete · the REST surface.

**Sibling AI suites** (task §8)

```
pnpm --filter asterim exec tsx src/services/ai/__tests__/AgentDelegationService.test.ts  → 461/461 assertions passed
pnpm --filter asterim exec tsx src/services/ai/__tests__/ProfileService.test.ts          → 138/138 assertions passed
```

**Monorepo CI gates**

| Command | Result |
| :--- | :--- |
| `pnpm typecheck` | `Tasks: 11 successful, 11 total` — 0 errors |
| `pnpm lint` | `Tasks: 7 successful, 7 total` — **0 errors** (warning counts unchanged from baseline: shared 3, adapters 28, marketing 18, asterim 294, mcp-memory-server 12, web 311) |
| `pnpm test` | `Tasks: 10 successful, 10 total` — zero `FAIL` lines across all 28 `asterim` suites plus relay, adapters, web and mcp-memory-server |
| `pnpm build` | `Tasks: 7 successful, 7 total` |

`apps/server`'s 28 suites individually: 63, 60, 140, 52, 51, 64, 89, 111, 90, 55, 157, 21, 231, 52, 102, 116, 89, 43, 67, 160, 169, 138, 461, **162**, 196, 133, 181, 208 — all at 100%.

No browser/screenshot verification: this task adds no UI (the Phase 8 web deliverable is a separate item in `blueprint/ROADMAP.md`).

---

## 5. Acceptance Criteria Review

- [x] **1. Migration `002_team_agents` applies cleanly via `MigrationEngine`.** Verified against a real SQLite file through the production engine: all four tables, all four declared indexes, all eleven `team_turn_queue` columns present; `applied` contains `002_team_agents`; a second `runMigrations()` returns `[]`. The running Core's own database is also confirmed to carry the tables. *(Authored as `.ts` per the shipped DEC-030 contract — see §8.)*
- [x] **2. `TeamAgentService` supports full CRUD for team agents and collaborative threads.** `createTeamAgent`/`getTeamAgent`/`listTeamAgents(teamId)`/`updateTeamAgent`/`deleteTeamAgent` and `createTeamThread`/`getTeamThread`/`listTeamThreads(agentId)` — all round-tripped through SQLite. Asserted: prompt/temperature/creator survive; an explicit list survives and an empty one stays empty; listing is team-scoped and does not leak `team-beta` into `team-alpha`; an update changes what it names and leaves what it does not; delete cascades threads, queue rows and transcript; invalid input and missing ids raise the right codes.
- [x] **3. `AgentTurnLock` maintains deterministic FIFO ordering when multiple users queue tasks concurrently.** Five members submitted via five independent microtasks: `queuePosition` came back `[0,1,2,3,4]` and `executor.served` equalled the submission order exactly. Separately, the lock alone was given four turns and had them acquired **in reverse order**; it still granted them in enqueue order (`in enqueue order, not acquire order`).
- [x] **4. Concurrent turns do not collide or interleave; each turn completes before the next begins.** The executor records `start:<id>`/`end:<id>`; the trace was asserted to strictly alternate with no nesting, and `peakInFlight` was `1`. Also asserted: a failing turn still releases the lock and the turn behind it runs; a cancelled turn's successor starts; a stray `releaseTurn` for a non-active id does not free the lock.
- [x] **5. Authenticated REST endpoints under `/api/v1/team-agents` and `/api/v1/team-threads` return accurate responses.** All seven routes driven with `fastify.inject`: 201 create agent, 200 list (400 without `teamId`), 200 get (404 unknown, code `AGENT_NOT_FOUND`), 201 create thread, 200 read thread (transcript + live queue + agent), 202 submit turn (400 empty instruction), 200/404 cancel. Guards asserted: anonymous reads and writes are 401; `createdBy` and the turn author come from the session, not the body (`user-impostor` in the payload was ignored). A turn queued behind a held lane was withdrawn over HTTP and came back `CANCELLED`.
- [x] **6. `TeamAgentService.test.ts` passes with comprehensive concurrency assertions.** 162/162. Concurrency-specific coverage: FIFO under simultaneous submission, non-interleaving trace, out-of-order acquisition, cancel-while-queued, cancel-while-running refusal, failure releasing the lock, approval parking without release, stray release, and broadcast ordering with queue positions.
- [x] **7. Monorepo CI gates pass with 0 errors.** `pnpm typecheck` 11/11 · `pnpm lint` 7/7 with 0 errors · `pnpm test` 10/10 · `pnpm build` 7/7. Full figures in §4.

**Definition of Done**

- [x] `002_team_agents` created and verified
- [x] Shared team agent types in `@asterim/shared`
- [x] `AgentTurnLock.ts` implemented
- [x] `TeamAgentService.ts` implemented
- [x] REST endpoints registered in `server.ts`
- [x] `TeamAgentService.test.ts` created and passing
- [x] Monorepo CI gates pass cleanly

---

## 6. Git Diff Review

`git diff` was reviewed line by line against every criterion. Modifications to existing files total **17 added / 2 removed lines** across five files, all additive and all necessary:

- `apps/server/src/migrations/index.ts` — one import, one array entry.
- `apps/server/src/server.ts` — one route import, one `register` call, one recovery call.
- `packages/shared/src/index.ts` — one export line.
- `apps/server/package.json` — one suite appended to `test`.
- `turbo.json` — one task-ordering entry (§7).

Six new files. No existing behaviour was altered, no file deleted, no dependency added, no `.env`/CI/blueprint file touched. Nothing was written to `docs/`.

**Forbidden-change check:**
- *No race conditions or interleaved generation on one `team_thread_id`* — enforced structurally (nothing runs before `acquireTurn` returns `true`, everything reaches `releaseTurn`) and asserted on the executor trace.
- *No transcripts or source to unapproved external endpoints (DEC-028/DEC-032)* — the diff contains no HTTP client, no fetch, no socket connect. Turns execute through the local EventBus → `AgentService` → PTY path; transcripts and queue state are local SQLite only. The turn broadcast is a Socket.IO room emit on the host.
- *100% test pass rate across existing suites* — met; see §4 and §7.

Two review findings were caught and fixed before reporting:
1. `releaseTurn` announced every turn as `COMPLETED`, so a **failed** turn would have shown the team an answer that never arrived. It now takes the real outcome; two assertions were added.
2. The "session has been briefed" flag was owned by `TeamAgentService` and only set on success, so a turn that failed *after* the persona was published would have re-published it into a live session. It moved into `EventBusTeamTurnExecutor`, which is the only thing that knows what was actually sent; a new test section drives the production executor over a real EventBus and asserts the persona is published exactly once across two turns, and not at all for a refused unbound thread.

---

## 7. Problems Discovered

**1. The task's migration path and file format do not match the shipped engine.**
`packages/server/src/migrations/002_team_agents.sql` was specified. There is no `packages/server` (the server package is `apps/server`), and `apps/server/src/migrations/index.ts` documents explicitly why migrations are TypeScript modules rather than loose `.sql` files: the Core ships as one bundled `dist/index.js`, and a runtime `readdir` of a migrations directory would have to survive bundling or be resolved relative to a path that differs between `tsx watch` and the packaged binary — "a migration that cannot be found is a database that cannot be opened". Authoring a `.sql` file would have produced a migration the engine never loads. Written as `002_team_agents.ts` conforming to the `MigrationDefinition` contract, which satisfies AC1 as written ("applies cleanly via `MigrationEngine`"). Flagged for spec reconciliation in §8.

**2. Adding migration 2 broke `pnpm run test` — a real, pre-existing build-ordering gap.**
`packages/mcp-memory-server` is a *separate process* that opens the same `asterim.db`. Its tests spawn its built `dist/index.js` as a child. `turbo.json` declared `test` as `dependsOn: ["^build"]` — upstream dependencies only, not the package's own build — so the test ran against a **stale bundle with only migration 1 compiled in**. That bundle then correctly refused a database the harness had already migrated to v2:

```
Error: [MigrationEngine] This database has migration 2 (002_team_agents) applied,
which this build of Asterim does not know about. It was written by a newer version —
upgrade Asterim rather than downgrading the database.
```

This is DEC-030's newer-database guard working exactly as designed; the fault was the stale artifact. Fixed with one entry in `turbo.json` making `@asterim/mcp-memory-server#test` depend on its own `build`. Verified: turbo now schedules the build first, and `pnpm test` goes from 9 tasks (1 failing) to 10 tasks, all successful. Note this never affected `.github/workflows/ci.yml`, which runs only `lint` and `build`.

**3. Two self-review findings** — the `COMPLETED`-on-failure broadcast and the persona re-brief. Both described in §6, both fixed with added coverage.

**4. Backtick characters inside a SQL template literal.** Writing SQL comments in the prose style used elsewhere (`` `status` is the thread's turn state ``) terminates the surrounding template literal. Caught by `tsc` immediately; comments rewritten without backticks.

**5. The developer's own `~/.asterim/asterim.db` was migrated to v2** as a side effect of a diagnostic run. This is exactly what the shipped Core does on its next boot, and the engine took its usual pre-migration snapshot beside the file, so nothing is at risk — noted only for completeness.

---

## 8. Architectural Concerns

**a. Specification discrepancy — DEC-030's stated migration format (needs a decision).**
`decisions.md` DEC-030 § 1 says "Sequential `.sql` migration files stored in `packages/server/src/migrations/`". The P7-02 implementation (approved and merged) deliberately does neither: TypeScript modules in `apps/server/src/migrations/`, for the bundling reason quoted in §7. The specification and the implementation have therefore been out of step since P7-02, and P8-01's task text inherited the stale wording. Per `AGENTS.md` § 1.3 I did not alter the implementation to match the spec — the spec is describing something that provably cannot work with the shipped packaging. **Recommendation:** Antigravity amends DEC-030 § 1 to read "sequential versioned migration modules in `apps/server/src/migrations/`, compiled into the bundle", with the rationale already written in `migrations/index.ts`. I have not authored the Change Proposal, as amending an approved ADR is the Orchestrator's call.

**b. Cross-team authorization is not yet enforced on these routes.**
Any authenticated user can read or write any team agent or thread; the routes check *that* there is a session, not *which team* it belongs to. This matches the existing `profiles.ts` and `delegation.ts` surfaces exactly, and DEC-031 § 3 ("role-based approval governance") is a separate Phase 8 deliverable — but a *shared* agent is the first primitive where the gap is a real disclosure rather than a theoretical one. Suggest a dedicated task layering `rbacGuard`/`team_memberships` over these seven routes before the Phase 8 UI ships. `AgentTurnLock.markAwaitingApproval` / `resumeFromApproval` are already in place as the hook that governance work will need.

**c. `team_id` has no `teams` table behind it.**
`team_memberships.team_id` (baseline) has no referent either. I treated a team as a workspace, which is what DEC-028's Phase 3 redefinition implies, and routed turn events to the existing `workspace:<id>` Socket.IO room accordingly. If Phase 8 intends a distinct `teams` entity, a follow-up migration should add it and put a foreign key on `team_agents.team_id`.

**d. The live queue and the durable queue diverge across a restart.**
`getQueueState` reads the in-memory lock (empty after a restart) while `listTurnHistory` reads SQLite. `recoverTurns()` reconciles the rows so nothing shows as busy forever, but a member's queued turn does not survive a Core restart — it is cancelled with a reason. Re-queueing survivors would mean re-running instructions whose side effects may already have happened, which seemed the wrong default to choose unilaterally. Worth an explicit product decision.

**e. Two versioned processes share one database file.**
`packages/mcp-memory-server` ships as its own binary against the same `asterim.db`. Every future migration makes an older installed copy of it refuse to start (§7). They version together from this repo today, so it is fine — but it is a compatibility edge that will bite if the MCP server is ever distributed independently.

---

## 9. Recommended Next Step

**P8-02 — Collaborative Multi-User Web UI** (`blueprint/ROADMAP.md` Phase 8, deliverable 3): the Team Agent Explorer, the Active Turn Queue inspector, and multi-user observer indicators in thread chat. The server contract it needs is complete and stable — `GET /api/v1/team-threads/:id` returns transcript, live queue and durable history in one response, and the four `team_turn:*` events carry the whole queue with positions on every transition, so a dashboard that joins mid-conversation needs no extra fetch.

Two items to schedule alongside or before it:
- The DEC-030 § 1 amendment in §8(a), which is a five-line documentation fix and should not wait.
- The team-scoped authorization task in §8(b), which should land **before** the UI makes these routes easy to reach.
