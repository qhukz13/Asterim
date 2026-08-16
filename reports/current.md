Task-ID: P7-03
Status: COMPLETE

# Execution Report: P7-03 — Multi-Agent Delegation Cancellation, Operator Intervention & Lifecycle Control

**Task ID:** P7-03
**Phase:** Phase 7 — Multi-Agent Orchestration & Collaborative Workflows
**Status:** VERIFIED
**Date:** 2026-08-16
**Author:** Claude Code

---

## 1. Summary

Delegation cancellation now exists end to end. `AgentDelegationService.cancelDelegation()` stops a running child from either end of the delegation (the parked parent's id or the running child's id), authenticated REST routes expose it, the web store carries it, and both the `ChatView` waiting banner and the `SessionSidebar` thread tree offer an operator control for it.

The central design decision: **a cancellation does not settle the delegation, it asks the delegation to settle and then reports what it settled as.** `delegateTask` registers an `ActiveDelegation` record — the child's id, an `abort` callback into the watcher, and the promise its own result will arrive on — before it begins waiting. `cancelDelegation` looks that record up, ends the wait with a cancellation outcome, and returns the record's `settled` promise. Everything terminal therefore still happens exactly once, on the one existing path: one write to `threads.delegation_context_json`, one `safeStop` of the child session, one release of the parent, one `delegation.child_state` / `delegation.parent_state` / `delegation.completed` triple. A cancellation that had its own settle path would have been a second competing writer of all five.

Status: VERIFIED. `pnpm typecheck`, `pnpm lint`, `pnpm test` (36 suites) and `pnpm build` are all clean, and every acceptance criterion below is backed by a named assertion that was run.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `apps/server/src/services/ai/AgentDelegationService.ts` | Modified | `cancelDelegation()`, the `ActiveDelegation` registry, the abort into `watchChild`, cancellation-aware `buildResult`, `NOT_DELEGATING` error code |
| `apps/server/src/routes/delegation.ts` | Modified | `POST /api/v1/threads/:id/delegate/cancel` + `/delegation/cancel` alias; `NOT_DELEGATING → 409` |
| `apps/web/src/stores/useProjectStore.ts` | Modified | `cancelDelegation` action, `cancellingChildren` map, optimistic application of the returned outcome |
| `apps/web/src/components/delegation/DelegationStatus.tsx` | Modified | "Cancel Delegation" button, in-flight and refusal states, container wiring |
| `apps/web/src/components/delegation/ThreadTree.tsx` | Modified | Inline "Stop" control on running child rows, `isCancellableChild` helper |
| `apps/web/src/components/SessionSidebar.tsx` | Modified | Wires the tree's stop control to the store action |
| `apps/server/src/services/ai/__tests__/AgentDelegationService.test.ts` | Modified | +70 assertions across six cancellation sections (209 → 279) |
| `apps/web/src/components/delegation/__tests__/DelegationUI.test.ts` | Modified | +50 assertions across three cancellation sections (159 → 209) |

No files created, no files deleted, no shared wire-protocol changes.

## 3. Implementation Details

### Server — `AgentDelegationService`

- **`ActiveDelegation` registry** (`private active = new Map<parentThreadId, ActiveDelegation>()`). Registered synchronously before `delegateTask`'s first `await`, removed in a `finally`. Holds `childThreadId`, `settled` (the deferred result), `abort`, `cancelReason`.
- **`cancelDelegation(threadId, reason?)`**:
  - Resolves the thread as a parent (`active.get(id)`) or as a child (`findActiveByChild(id)`).
  - First caller owns the reason; later callers ride the same `settled` promise, so a double-click cannot overwrite a reason the outcome was already built from.
  - Unknown thread → `THREAD_NOT_FOUND` (404). Empty id / non-string reason → `INVALID_INPUT` (400). A thread that is neither parked nor a settled child → the new `NOT_DELEGATING` (409).
  - A child that already settled answers 200 with what it settled as, reconstructed from its row by `settledResultFor` — so an operator clicking Cancel on a delegation that finished a moment earlier is not shown an error for losing a race.
- **The abort.** `watchChild` now arms `active.abort = reason => finish('FAILED', reason, true)` after subscribing, and immediately honours a `cancelReason` that was recorded before it existed. That pre-arm window is real, not theoretical: the EventBus delivers synchronously, so a subscriber to the child's `STARTING` event can call `cancelDelegation` before the watch is built. It is covered by a test.
- **No orphaned subprocess.** `runChild` returns before `runner.start()` when the delegation was already cancelled, so a session that was never wanted is never spawned. Otherwise the existing `await this.safeStop(...)` on the settle path kills the child *before* the parent is resumed, which is what makes the cancellation mean something by the time the HTTP request answers.
- **`ChildOutcome.cancelled`.** Only affects how the summary reads: a cancelled delegation's summary is the reason alone, not the reason trailed by `Last output: <whatever the child was mid-sentence on>`. `verdict` needs no special casing — `buildResult` already gives any non-`COMPLETED` review `NEEDS_FIX`.
- **`recoverDelegations`** clears `active` alongside `waiting`.

### Server — REST

One handler bound to two paths, both requiring an authenticated user like the existing delegation routes. Returns `{ success: true, result }` on 200. A missing/garbage body is accepted (the reason is optional), matching how a bare "Stop" click behaves.

### Web

- `useProjectStore.cancelDelegation(threadId, reason?, backendUrl?)` POSTs to `/delegate/cancel`, then applies the returned outcome locally rather than only waiting for the socket. Cancelling by parent id runs `applyDelegationCompleted` (parent released, banner cleared, outcome card populated); cancelling by child id runs `applyDelegationChildState` only, because the result carries no parent id and the parent's release arrives on `delegation.parent_state`. Both are idempotent with the socket events that follow.
- `cancellingChildren` is keyed by **child** thread id so the banner and the tree row — which never talk to each other — show the same intervention.
- `DelegationWaitingBanner` gained `onCancel` / `isCancelling` / `cancelError`. All three are optional; a banner rendered without `onCancel` is byte-for-byte the P7-02 banner. Colours are `--color-state-error`; the shared button styling was hoisted into one `bannerButton` object rather than duplicated.
- `ThreadTree` shows a "Stop" pill only on rows `isCancellableChild` accepts: depth > 0, carrying a delegation brief, and either live-`STARTING`/`ACTIVE` or with no recorded status yet. It disappears the moment the row goes terminal.

## 4. Verification

Every command below was run from the repository root and completed as shown.

```
pnpm typecheck   → Tasks: 11 successful, 11 total    (0 errors)
pnpm lint        → Tasks:  7 successful,  7 total    (0 errors; warnings only, all pre-existing categories)
pnpm test        → Tasks:  9 successful,  9 total    (36 suites, 0 failed assertions)
pnpm build       → Tasks:  7 successful,  7 total
```

Targeted suites:

```
pnpm --filter asterim exec tsx src/services/ai/__tests__/AgentDelegationService.test.ts
  → 279/279 assertions passed   (was 209 before this task)

pnpm --filter @asterim/web exec tsx src/components/delegation/__tests__/DelegationUI.test.ts
  → 209/209 assertions passed   (was 159 before this task)
```

New server sections, all green:

- `cancelDelegation — stopping a child from the parent` (25 assertions)
- `cancelDelegation — stopping a child from the child` (5)
- `cancelDelegation — a cancelled review has not passed` (4)
- `cancelDelegation — two operators clicking at once` (10)
- `cancelDelegation — a cancellation that beats the watch` (6)
- `cancelDelegation — what it refuses` (3)
- Cancellation over HTTP inside `the REST surface` (17)

New web sections, all green:

- `useProjectStore — cancelDelegation` (21)
- `DelegationWaitingBanner — cancelling (P7-03)` (15)
- `ThreadTreeView — stopping a child from the list (P7-03)` (14)

Not run: there is no browser/screenshot verification for this task, because the repository's Visual QA path needs a live workstation with a real delegated agent session parked behind a child, which this environment has no agent CLI for. The rendering assertions go through `react-dom/server` against the real components instead.

## 5. Acceptance Criteria Review

- [x] **1 — `cancelDelegation()` aborts an active child delegation, stops the child process, settles the DB record as `FAILED` with the cancellation reason, and releases the parent to `ACTIVE`.**
  `cancelDelegation — stopping a child from the parent`: `a cancelled delegation is FAILED`; `the summary is the reason it was given`; `the child session is stopped` / `and it is the child that stopped` (asserts `runner.stopped[0].threadId === childThreadId`); `the child row records the failure` + `with the cancellation reason as its summary` + `and a finish time` (read back out of SQLite); `the parent is released` (`getParentState === 'ACTIVE'`) + `with nothing pending`; `it answers immediately rather than at the timeout` (against a 600 000 ms timeout).

- [x] **2 — `POST /api/v1/threads/:id/delegate/cancel` validates permissions and cancels running delegations cleanly.**
  REST section: `an anonymous cancellation is 401`; `cancelling an unknown thread is 404`; `cancelling a thread that is not delegating is 409` + `with a code a client can branch on` (`NOT_DELEGATING`); `cancelling over HTTP is 200` + `and says it worked` (`success: true`) + `the outcome is a failure` + `naming the reason given`; `the open delegation returns the same outcome` + `for the same child` (the still-open `POST /delegate` and the cancel agree); `the parent is released`. The `/delegation/cancel` alias is covered by `the /delegation/cancel alias answers too`.

- [x] **3 — Cancelling a `REVIEW` delegation records verdict `NEEDS_FIX`.**
  `cancelDelegation — a cancelled review has not passed`: `and the verdict is NEEDS_FIX`; `which is what is stored` (re-read from `delegation_context_json`); `the parent is told the verdict` (the resume text contains `VERDICT: NEEDS_FIX`).

- [x] **4 — Connected web clients receive real-time socket events updating tree status, clearing the waiting banner, and displaying the cancellation outcome card.**
  Server: `the parent waits and is then released` (`delegation.parent_state` = `['WAITING_FOR_CHILD','ACTIVE']`); `the child ends in a terminal state` (`delegation.child_state` = `['STARTING','ACTIVE','FAILED']`); `the outcome is published exactly once` + `carrying the cancellation` + `and routed to the parent's room` (`delegation.completed`).
  Web: `the parent is released without waiting for the socket`; `the banner has nothing left to show` (`pendingChildren` cleared → `DelegationStatusView` falls through to the outcome card); `the child ends FAILED` (tree status); `and the outcome card gets the cancellation`; `and it is written back onto the stored brief`.

- [x] **5 — `DelegationWaitingBanner` includes an accessible "Cancel Delegation" action button that triggers cancellation.**
  `the banner offers a way out`; `labelled for a screen reader` (`aria-label="Cancel delegation"`); `and it says what it will do` (`title`); `alongside the way in` (Inspect is still there); `a cancellation in flight is visible` (`Cancelling…`) + `and the button is spent` (`disabled`); `a refusal is shown on the banner` + `as an alert` (`role="alert"`); `clicking it names the child to stop` — the handler is invoked for real, not just rendered.

- [x] **6 — All automated unit tests in `AgentDelegationService.test.ts` and `DelegationUI.test.ts` pass cleanly.**
  279/279 and 209/209 respectively, run individually and again under `pnpm test`.

- [x] **7 — Monorepo CI gates pass with 0 errors: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`.**
  Outputs in § 4. Lint reports 0 errors across all 7 packages.

**Definition of Done:** all seven boxes met — `cancelDelegation` implemented, cancel route added (plus alias), store action added, UI button added, server tests green, web tests green, all 36 suites and the full build clean.

## 6. Git Diff Review

`git diff --stat` over the eight files I touched: 8 modified, 0 created, 0 deleted, ~870 insertions in source + tests. Reviewed line by line against the forbidden-changes list:

- **No wire-protocol break.** `packages/shared` is untouched. A cancelled delegation is an ordinary `FAILED` `DelegationResult` on the existing `delegation.*` events, so a P7-02 client that never learns about cancellation still renders it correctly.
- **No orphaned subprocesses.** The single `safeStop` on the settle path is unchanged and still runs before the parent resumes; a cancellation that lands before `runner.start()` skips the start entirely (`no agent session was ever started for it`). The watcher's timer is cleared and both bus subscriptions are removed by `finish` on every path including the cancellation one.
- **No store-boundary change.** New state lives in `useProjectStore`'s existing delegation section, which is where `parentStates` / `pendingChildren` / `childStates` already live. `InspectorStore` and the scoped stores are untouched.
- **No hardcoded colours.** Every new style value is a `var(--...)` token. Two assertions (`with no hardcoded colour`, `and no colour is hardcoded`) regex the rendered markup for hex literals.
- **No broken suites.** All 36 pass; the only pre-existing assertions whose *inputs* changed are `recoverDelegations`' `recovered >= 3` lower bound, and the extra children my tests create are all settled before it runs.
- Cleanup pass: no temporary files, no `scratch/` additions, no new `docs/` reports. The `M tests/report.md` in `git status` predates this session and was deliberately left out of the commit.

## 7. Problems Discovered

1. **Two settle paths would have been two writers.** The obvious implementation — have `cancelDelegation` stop the child, write the row and release the parent itself — races the `delegateTask` that is still awaiting `watchChild`. Both would have written `delegation_context_json`, both would have published a terminal `delegation.child_state`, and the parent would have been resumed twice with two different reports. Routing the cancellation *through* the existing settle and returning its promise removes the race by construction rather than by locking.

2. **A genuinely reachable pre-arm race.** `runChild` publishes the child's `STARTING` state before `watchChild` builds the watch, and `EventBus` delivers synchronously — so a subscriber can call `cancelDelegation` in the one window where no abort exists yet. Losing it would park the parent for the full ten-minute timeout. `cancelReason` is recorded on the record and honoured the moment the watch arms; the test drives exactly that subscriber.

3. **`buildResult` would have editorialised the cancellation.** Its non-`COMPLETED` branch appends `Last output: …`, which turned "Delegation cancelled by operator" into a sentence that read like a diagnosis of a crash. Hence the `cancelled` flag on `ChildOutcome`.

4. **Unhandled rejection risk.** The deferred `settled` promise is rejected if `delegateTask` throws unexpectedly (a throwing EventBus subscriber can do it). With no cancellation in flight nothing would be listening, and Node would take the Core down. A no-op `settled.catch()` is attached at creation.

5. **Click handlers with no DOM.** The repository has no test renderer, and the existing suite header says click handlers are out of reach. They are reachable for these views specifically because they are props-only and hold no hooks: calling the component function directly returns an element tree that a small `findElement` walker can search for the button, whose `onClick` is then invoked. This is noted in the suite header so the limitation is not silently overstated.

## 8. Architectural Concerns

1. **Store action signature deviates from § 3 of the task.** The task sketched `cancelDelegation(projectId, threadId, reason?)`. I implemented `cancelDelegation(threadId, reason?, backendUrl?)`. `projectId` is not part of the URL or the body and would have been an unused parameter; `backendUrl` is genuinely required to address a remote workstation and is what the sibling `syncDelegations(threadId, backendUrl)` already takes. Flagging it as a deliberate deviation for review.

2. **No per-project authorization on any delegation route.** `/delegate`, `/children` and now `/cancel` all check only "is there an authenticated user". Criterion 2 asked for "validates permissions"; what exists repo-wide is authentication, and adding an ownership check to cancel alone would make it inconsistent with the two routes beside it. Worth a dedicated task across the whole delegation surface (and probably wider) rather than a one-route exception here.

3. **`this.waiting` and `this.active` are now parallel maps** keyed identically and mutated in the same two places. `waiting` is derivable from `active` (`waiting.get(p) === active.get(p)?.childThreadId`). I left `waiting` alone to keep the diff honest, but collapsing them would remove a class of future drift.

4. **A cancelled delegation is `FAILED`, per the task.** It is indistinguishable from a crash except by reading the summary text. If operators end up wanting to filter or count cancellations, that wants a fourth `DelegationStatus` — which is a shared wire-protocol change and therefore a Change Proposal, not something to slip in.

5. **ADR-008 note.** Nothing new was added to the `'*'` channel; the cancellation reuses the three existing delegation event types.

## 9. Recommended Next Step

The delegation lifecycle is now complete for a single parent/child pair: dispatch (P7-01), supervision (P7-02), intervention (P7-03). The natural next vertical is **parallel/concurrent delegation** — the `ALREADY_DELEGATING` guard currently allows a parent exactly one child at a time, which caps a Tech Lead at serial hand-offs. A P7-04 covering a bounded fan-out (N concurrent children per parent, aggregated outcomes in one card, per-child cancellation reusing the registry this task added) would build directly on the `ActiveDelegation` map, which already keys by parent and would need to become a set per parent.

Failing that, the delegation audit trail (who cancelled what, when, and why, persisted rather than only living in the child's summary string) is the smaller and more defensible follow-up.
