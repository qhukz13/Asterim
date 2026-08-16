Task-ID: P7-04
Status: COMPLETE

# Execution Report: P7-04 — Multi-Agent Parallel Delegation, Concurrent Fan-Out & Aggregated Workflow Orchestration

**Task ID:** P7-04
**Phase:** Phase 7 — Multi-Agent Orchestration & Collaborative Workflows
**Status:** IMPLEMENTED & VERIFIED
**Date:** 2026-08-16
**Author:** Claude Code

---

## 1. Summary

Bounded parallel delegation is implemented end to end: an orchestrator-class agent (or an operator over REST) hands up to `MAX_CONCURRENT_DELEGATIONS = 4` independent pieces of work to different roles at once, every child runs as an ordinary delegated thread, and the parent is parked until the last of them settles and then resumed once with an aggregated outcome matrix.

The delegation registry in `AgentDelegationService` was refactored from one-child-per-parent (`Map<parentThreadId, ActiveDelegation>`) to many (`Map<parentThreadId, Map<childThreadId, ActiveDelegation>>`, plus `Map<parentThreadId, Set<childThreadId>>` for the parked state). `delegateTask` was factored so that the single and the parallel paths share one child lifecycle (`runDelegation`) — same child row, same brief, same watch, same terminal `delegation.*` events — differing only in who releases the parent. Nothing that watched a single delegation before has to learn anything new; the batch adds one new event (`delegation.batch_completed`) carrying the aggregate that per-child events cannot express.

Cancellation covers both granularities: `cancelDelegation` stops one child while its siblings keep running, `cancelAllDelegations` stops a whole fan-out. Both settle through the same single writer per child, so a cancelled batch leaves no orphaned child process, no dangling bus subscription and no parent parked behind work that is over (all three asserted).

The dashboard supervises the fan-out live: the waiting banner lists every in-flight subagent with its own role, state, "Inspect" and "Stop", plus a batch "Cancel All"; the thread tree renders siblings with independent status and stop controls; and a new aggregated outcome card shows the overall status, one verdict over every review in the batch, and a per-child breakdown with summaries and artifacts.

All gates are green: 0 TypeScript errors, 0 ESLint errors, **36/36 test suites (3634 assertions)** passing, and all 7 packages building.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `packages/shared/src/types/delegation.ts` | Modified | `MAX_CONCURRENT_DELEGATIONS`, `DELEGATE_PARALLEL_TOOL`, `ParallelDelegationItem/Request`, `BatchDelegationResult`, `BatchDelegationStatus`, `aggregateDelegationStatus`, `aggregateReviewVerdict`, `delegation.batch_completed` event + payload, `delegate_parallel` tool definition |
| `apps/server/src/services/ai/AgentDelegationService.ts` | Modified | Multi-child registry, `runDelegation` extraction, `delegateParallel`, `cancelAllDelegations`, `getPendingChildren`, `getActiveDelegationCount`, `CONCURRENCY_LIMIT_EXCEEDED`, `summarizeBatch`, `formatBatchDelegationReport`, `parseParallelItems`, `delegate_parallel` meta-tool dispatch |
| `apps/server/src/routes/delegation.ts` | Modified | `POST /delegate/parallel` (+ `/delegation/parallel`), `POST /delegate/cancel-all` (+ `/delegation/cancel-all`), `pendingChildThreadIds` on `GET /children`, 409 mapping for the new code |
| `apps/web/src/stores/useProjectStore.ts` | Modified | `pendingChildren` becomes `Record<string, string[]>`, `batchOutcomes`, `applyDelegationBatchCompleted`, `delegateParallel`, `cancelAllDelegations`, `batchStatusTone`, multi-child sync/cancel handling |
| `apps/web/src/components/delegation/DelegationStatus.tsx` | Modified | Multi-child `DelegationWaitingBanner` (+ `PendingDelegationView`, `pendingProgress`), new `DelegationBatchOutcomeCard`, `DelegationStatusView`/container rewired for fan-out |
| `apps/web/src/components/delegation/DelegateModal.tsx` | Modified | Reads the pending list rather than a single pending child id |
| `apps/web/src/hooks/useSocket.ts` | Modified | Replays `delegation.batch_completed` from history alongside started/completed |
| `apps/server/src/services/ai/__tests__/AgentDelegationService.test.ts` | Modified | +133 assertions: fan-out, aggregation, limits, per-child and batch cancellation, meta-tool, REST |
| `apps/web/src/components/delegation/__tests__/DelegationUI.test.ts` | Modified | +107 assertions: multi-child store events, `delegateParallel`, `cancelAllDelegations`, sync, banner, batch card, sibling tree |

No files were created; no files outside the delegation subsystem were touched.

## 3. Implementation Details

### 3.1 Shared contract (`@asterim/shared`)

- `MAX_CONCURRENT_DELEGATIONS = 4` — a bound on **concurrency**, not on total children: a parent may delegate a hundred times in sequence, four at a time. `MAX_DELEGATION_DEPTH = 3` is unchanged and enforced for every child of a batch.
- `BatchDelegationStatus = DelegationStatus | 'PARTIAL_SUCCESS'`.
- `aggregateDelegationStatus`: all completed → `COMPLETED`; some completed → `PARTIAL_SUCCESS`; none completed → `FAILED`, **unless every child timed out**, which stays `TIMEOUT`. That preserves the P7-01 rule that a timeout is not a failure — a child that ran out of time may well have done the work, and the parent is owed the difference.
- `aggregateReviewVerdict`: `undefined` when the batch contained no reviews; `PASS` only when every review passed; one dissent carries. Reporting a majority would be the one summary an agent could act on and be wrong.
- `DELEGATE_PARALLEL_TOOL` is appended to `DELEGATION_TOOL_NAMES`/`DELEGATION_TOOL_DEFINITIONS`, so `McpAgentBridge.getDelegationTools` offers it to exactly the profiles `canProfileDelegate` already gates (tech lead / architect / orchestrator / staff & principal engineer). An unprofiled session and a reviewer profile still get nothing.

### 3.2 Core orchestration

**Registry.** `waiting: Map<parentThreadId, Set<childThreadId>>` and `active: Map<parentThreadId, Map<childThreadId, ActiveDelegation>>`. `getPendingChild` still answers with the oldest child so the P7-01 REST field keeps its meaning; `getPendingChildren` is the whole answer.

**`runDelegation`.** Everything from the child row to the parent's release, shared by both paths. `options.releaseParent === false` (parallel) means settling a child does not publish `delegation.parent_state: ACTIVE`; the child is still removed from the parent's waiting set, and the removal is repeated in a `finally` as a net so an unexpected throw cannot strand a parent behind a child that is over.

**`delegateParallel`.** Validation order: batch size → parent exists → `running + requested > 4` → depth (once, for the whole batch) → every item's task/context/timeout/profile. All of it happens **before any child row is written**, so a batch naming one bad role leaves no half-started children (asserted). Children are then dispatched together and awaited with `Promise.allSettled`; a rejection is turned into a synthetic `FAILED` row with an empty `childThreadId` rather than discarding the siblings that worked. The parent is released once — and only if nothing else is running under it — then resumed with `formatBatchDelegationReport` (verdict, one-line summary, numbered outcome matrix with artifacts) and `delegation.batch_completed` is published.

**Events.** Per child: `delegation.started`, `delegation.child_state`, `delegation.completed` — exactly as a single delegation. Per batch: N × `parent_state: WAITING_FOR_CHILD`, 1 × `parent_state: ACTIVE`, 1 × `delegation.batch_completed`. Verified by counting events across a 3-child batch.

**Cancellation.** `cancelDelegation(childId)` stops one child; siblings keep running and the parent stays parked (asserted). `cancelDelegation(parentId)` resolves to the oldest running child, which keeps the P7-03 banner path working for a single delegation. `cancelAllDelegations(parentId)` snapshots the running set before awaiting (each settle mutates the registry), aborts each once, and returns what each settled as. Neither settles anything itself — they ask the running delegation to settle, so there is still one writer of each child row, one `safeStop` per child, and one release of the parent.

**Backwards compatibility.** `delegateTask` still refuses a second sequential delegation with `ALREADY_DELEGATING`, including while a batch is running (asserted). Every P7-01/02/03 assertion still passes unchanged apart from the tool-count assertion, which now expects three meta-tools.

### 3.3 REST

`POST /api/v1/threads/:id/delegate/parallel` (alias `/delegation/parallel`) — auth-guarded, 400 for a missing/non-array list, 409 `CONCURRENCY_LIMIT_EXCEEDED` for >4, 404 for an unknown thread/role, 409 `DEPTH_EXCEEDED` past the bound. Synchronous like `POST /delegate`, but the wait is the slowest child's rather than the sum. Bodies are read through the same `parseParallelItems` the meta-tool uses, so `role`/`task`/`context` work from both.

`POST /api/v1/threads/:id/delegate/cancel-all` (alias `/delegation/cancel-all`) — returns `{ success, cancelled, results }`; a thread with nothing running is 200 with `cancelled: 0`, an unknown thread is 404.

`GET /children` gains `pendingChildThreadIds` and keeps `pendingChildThreadId`.

### 3.4 Web

`pendingChildren` is now a list per parent. `delegation.completed` removes only its own child and flips the parent to `ACTIVE` **only when the list empties** — otherwise a fan-out's banner would vanish the moment its first child answered. `WAITING_FOR_CHILD` appends without duplicating, so a socket reconnect replaying the same child does not show it twice. `applyDelegationBatchCompleted` stores the batch and clears the single-outcome entry for that parent so the last child is not rendered twice, once alone and once inside the batch it belonged to.

`DelegationWaitingBanner` renders one child as the sentence it always was ("Delegated — waiting on Security Auditor" + "Cancel Delegation") and several as a list with a header count, a "1 of 3 finished" progress line, per-child role/state/task/Inspect/Stop, and one "Cancel All". `DelegationBatchOutcomeCard` leads with the answer (overall status pill, aggregated verdict) and follows with the working: every child's status, verdict, summary, artifacts and transcript link — including children that failed, which are the rows most worth opening. All colours come from `tokens.css` custom properties; the tests assert no hex literal reaches the rendered markup.

`ThreadTree` needed no change — siblings already render under a common parent with independent indentation, status dots and stop pills — and is now covered by explicit sibling assertions.

## 4. Verification

Everything below was executed in this session. The root `pnpm run <task>` (turbo) form was not runnable non-interactively in this sandbox, so each Turbo task was run per workspace with `pnpm --filter <pkg> <task>`, which covers the same task graph.

| Gate | Command | Result |
| :--- | :--- | :--- |
| Typecheck | `pnpm --filter <pkg> typecheck` × 7 (`shared`, `adapters`, `asterim`, `web`, `marketing`, `relay`, `mcp-memory-server`) | **0 errors** |
| Lint | `pnpm --filter <pkg> lint` × 7 | **0 errors** (610 pre-existing warnings) |
| Server delegation suite | `pnpm --filter asterim exec tsx src/services/ai/__tests__/AgentDelegationService.test.ts` | **412/412** (was 279) |
| Web delegation suite | `pnpm --filter @asterim/web exec tsx src/components/delegation/__tests__/DelegationUI.test.ts` | **316/316** (was 209) |
| Server tests | `pnpm --filter asterim test` | 19 suites, **2118/2118** |
| Web tests | `pnpm --filter @asterim/web test` | 8 suites, **1074/1074** |
| Adapters / relay / mcp-memory-server tests | `pnpm --filter <pkg> test` | 1 + 1 + 7 suites, **442/442** |
| **Total** | | **36 suites, 3634/3634 assertions, 0 failures** |
| Build | `pnpm --filter <pkg> build` × 7 | all successful (`asterim` bundles `apps/web/dist`) |

Concurrency is asserted structurally rather than by wall-clock: the fake runner records how many sessions had been started at the moment the first child answered (3 of 3), which a sequential implementation could not produce. Lifecycle hygiene is asserted directly — after a cancelled 3-child fan-out, `chat.message` and `agent.status` listener counts return to their pre-batch values, all three child processes were stopped, and all three child rows are settled `FAILED` in SQLite.

## 5. Acceptance Criteria Review

- [x] **1. `delegateParallel()` concurrently spawns, monitors and aggregates multiple children (up to 4) under one parent** — `describe('delegateParallel — several children at once')`: 3 children in 3 distinct threads, all 3 sessions started before the first answer, one resume, one release, 3 rows settled in storage.
- [x] **2. Exceeding `MAX_CONCURRENT_DELEGATIONS` is rejected with an explicit error code** — `CONCURRENCY_LIMIT_EXCEEDED` for a batch of 5, and for 2 more while 3 are already running (`describe('delegateParallel — what it refuses')`, `describe('… the concurrency bound counts what is running')`); 409 over HTTP with the code in the body.
- [x] **3. `delegate_parallel` is available to orchestrator/architect profiles** — `bridge.getDelegationTools({role:'Tech Lead'})` returns `[delegate_task, request_review, delegate_parallel]`; a Security Auditor and an unprofiled session get none; `isDelegationToolName` recognises it; `executeDelegationTool` runs a batch and returns the matrix without double-resuming the parent.
- [x] **4. `BatchDelegationResult` computes overall status and unified verdict** — `aggregateDelegationStatus` / `aggregateReviewVerdict` unit-asserted for all-pass, mixed, all-fail, all-timeout and no-review cases; integration-asserted as `COMPLETED`, `PARTIAL_SUCCESS` (COMPLETED+FAILED+TIMEOUT), `FAILED`, and `PASS` vs `NEEDS_FIX` across two review children.
- [x] **5. REST `POST …/delegate/parallel` and `…/delegate/cancel-all` work with auth and validation** — 401 anonymous, 400 non-array/empty, 409 over-limit, 404 unknown thread, 200 happy path through the *default* runner (2 children), and a live fan-out cancelled over HTTP via the `/delegation/cancel-all` alias returning both results while the open batch answers `FAILED`.
- [x] **6. `DelegationWaitingBanner` shows all concurrent children with per-child status, per-child Stop and a batch Cancel All** — rendered markup asserts the count, per-child roles/states/tasks, `aria-label="Stop Frontend Reviewer"`, `aria-label="Cancel all delegations"`; click handlers verified to name the individual child and, for Cancel All, no child at all.
- [x] **7. ChatView renders aggregated multi-agent outcome cards with per-child breakdowns and artifacts** — `DelegationBatchOutcomeCard` (reached from `App.tsx` via `DelegationStatus` → `DelegationStatusView`) asserts overall status, aggregated verdict, batch summary, every child's role/status/verdict/summary/artifacts and transcript links, plus precedence over the single-outcome card and over a new fan-out.
- [x] **8. All assertions in `AgentDelegationService.test.ts` and `DelegationUI.test.ts` pass** — 412/412 and 316/316.
- [x] **9. Monorepo CI gates pass with 0 errors** — typecheck 0, lint 0 errors, 36/36 suites (3634 assertions), 7/7 builds. See § 4 for the per-workspace form used.

**Definition of Done:** all eight boxes are met — shared types & tool ✓, `delegateParallel`/`cancelAllDelegations` ✓, REST routes ✓, store multi-child state & actions ✓, banner/outcome card/tree ✓, server tests ✓, web tests ✓, full suite + build clean ✓.

## 6. Git Diff Review

`git status --short` shows 9 modified files (§ 2) plus the pre-existing, unrelated `tests/report.md` left dirty by the P7-03 gate session — not touched here and not committed. No new files, no `docs/` reports, no debug scripts, no dependency changes.

Reviewed against § 6 "Explicitly Forbidden Changes":

- **Single `delegate_task` compatibility** — the sequential path keeps its validation order, its `ALREADY_DELEGATING` guard and its own parent release; all pre-existing assertions pass untouched. The four P7-01 socket events keep their names and payload shapes; the batch event is additive.
- **`MAX_CONCURRENT_DELEGATIONS` never exceeded** — the bound is checked against `requested + already running`, not against the request alone.
- **No orphaned processes or subscriptions** — every terminal path runs `safeStop`, and `watchChild.finish` unsubscribes both channels; listener counts are asserted back to baseline after a cancelled fan-out.
- **No hardcoded colours** — new UI uses `var(--color-*)` tokens only; the rendered-markup tests reject any `#rrggbb`.
- **No suite broken** — 36/36 green. Two existing assertions were *updated* rather than broken: the meta-tool list is now three tools, and `DELEGATION_EVENT_TYPES` is now five names.

## 7. Problems Discovered

1. **The parent-release event is not per-child.** A naive fan-out would publish `delegation.parent_state: ACTIVE` each time a child finished, and the dashboard's banner would disappear while three agents were still working. Fixed on both sides: the Core releases once per batch (and only when nothing else is running under that parent), and the store flips the parent to `ACTIVE` only when its pending list empties.
2. **`cancelDelegation(parentId)` is ambiguous during a fan-out.** Resolved deliberately rather than silently: a parent with several running children resolves to the oldest, the dashboard names the child explicitly whenever there is more than one, and stopping everything is its own verb.
3. **`Promise.allSettled` is load-bearing, twice.** Once so one child's crash does not discard the siblings' results, and once because the per-delegation `settled` promise is rejected on unexpected errors — an unawaited rejection there would take the Core down.
4. **Registry mutation during cancellation.** `cancelAllDelegations` iterating `this.active` live would skip siblings as each settle deleted its own entry; the running set is snapshotted before the first await.
5. **`CLAUDE.md` still says there is no test runner.** There demonstrably is one (`pnpm test` per workspace, 36 suites); the statement is stale as of P5.x and could mislead a future session into not running the suites.

## 8. Architectural Concerns

1. **No operator entry point for a fan-out.** `delegateParallel` is reachable from an agent (meta-tool), from REST, and from the store action — but `DelegateModal` still only composes a single delegation, so an operator cannot start a batch from the dashboard. This matches the task's UI scope (§5.5 lists only the banner, the outcome card and the tree), so no modal work was invented; it is the obvious next increment if operator-initiated fan-out is wanted.
2. **`delegation.batch_completed` is a fifth event.** It was added rather than reconstructing the grouping client-side from N per-child completions, because nothing else on the wire can say which outcomes were one batch or carry the verdict over them. It is additive and ignored by any consumer that does not know it.
3. **Depth × width is now the real bound.** With depth 3 and width 4, a worst-case tree is 4 + 16 + 64 = 84 concurrent agent processes. Each level is individually bounded, but nothing bounds the *product*. A per-workspace ceiling on live delegated sessions may be worth a decision record before this is exercised in anger.
4. **The batch holds an HTTP request open for the slowest child** (up to the one-hour timeout cap), same as `POST /delegate`. Cancellation makes it survivable, but an async "accept and report over the socket" variant would be the cleaner shape if fan-outs get long.

## 9. Recommended Next Step

Proceed to **P7-05**. The two candidates the current state suggests, in order:

1. **Operator-initiated fan-out in the dashboard** — a parallel mode for `DelegateModal` (2–4 role/task rows, live validation against `MAX_CONCURRENT_DELEGATIONS`, wired to the existing `delegateParallel` store action), which closes the one gap between what the Core can do and what the UI can ask for.
2. **Shared context & artifact hand-off between siblings** — a fan-in step where one child's artifacts become the next batch's input, which is the natural continuation of Phase 7's collaborative-workflow arc and the point at which a workspace-wide concurrency ceiling (§ 8.3) should be decided.
