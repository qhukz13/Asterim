Task-ID: P8-04
Status: COMPLETE

# Execution Report: P8-04 — End-to-End Destructive Tool Approval Interception & EventBus Resolution for Shared Team Agents

**Task ID:** P8-04
**Phase:** Phase 8 — Collaborative Team Agents & Multi-User Governance
**Status:** IMPLEMENTED (verified: 363/363 server + 395/395 web assertions, all workspaces typecheck, lint, test and build clean)
**Date:** 2026-08-18
**Author:** Claude Code

---

## 1. Summary

The three seams P8-03 left open are now joined, so a destructive tool call in a shared team
thread travels the whole way and back:

1. **Interception.** `EventBusTeamTurnExecutor` now watches `agent.approval_request` /
   `agent.approval_cancelled` for the thread it is serving, for exactly as long as it serves
   it. When `ApprovalManager` raises a prompt, the running turn parks itself in
   `AWAITING_APPROVAL` carrying the action — `actionId`, `command`, `description`, `riskLevel`,
   `warnings` — and the whole team is told through the existing `team_turn:started` transition.
   Nobody has to call `markTurnAwaitingApproval` by hand any more.
2. **Resolution.** `TeamAgentService.resolveTurnApproval` now publishes `client.approval_response`
   with the action id, the decision and the thread. That is the event `ApprovalManager` resolves
   its pending promise on and `AgentService` turns into a `y`/`n` keystroke in the PTY, so a
   governance decision recorded in SQLite now actually reaches the blocked agent. A rejection also
   cancels every other prompt the thread had outstanding.
3. **The card.** `TurnApprovalCard` renders what the agent proposed to do, not only what the
   member asked for: the command in monospace, the Core's description, a graded risk badge, and
   the analyser's security warnings.

No new dependency, no new route, no schema change, and no weakening of `AgentTurnLock`: the
approval still holds the lock, and the resolution still goes through `resumeFromApproval` /
`releaseTurn`.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `packages/shared/src/types/teamAgent.ts` | Modified | `TeamApprovalRiskLevel` and `TeamPendingApprovalInfo`; `pendingApproval` on `TeamTurnQueueItem` and on `TeamTurnEventPayload` |
| `apps/server/src/services/ai/AgentTurnLock.ts` | Modified | `markAwaitingApproval` accepts the pending action and keeps it on the active turn; `resumeFromApproval` clears it; every transition broadcasts it |
| `apps/server/src/services/ai/TeamAgentService.ts` | Modified | `toPendingApprovalInfo` parser; `TeamTurnRunParams` approval hooks; executor subscription to `agent.approval_request`/`agent.approval_cancelled`; `parkOnApproval`, `releaseApprovalHold`, `signalApproval`, `cancelPendingApprovals`; `resolveTurnApproval` publishes `client.approval_response` |
| `apps/web/src/stores/useTeamAgentStore.ts` | Modified | `pendingApprovalOf`, `approvalRiskTone`, and `withPendingApproval` retention in the queue reducer |
| `apps/web/src/components/teamAgents/ActiveTurnQueueInspector.tsx` | Modified | `TurnApprovalCard` renders the pending action: description, command, risk badge, warnings |
| `apps/server/src/services/ai/__tests__/TeamAgentService.test.ts` | Modified | Sections 18–20: payload parsing, end-to-end interception/approval/rejection/cancellation against the real `ApprovalManager`, and refusal without an intercepted action (+64 assertions) |
| `apps/web/src/components/teamAgents/__tests__/TeamAgentUI.test.ts` | Modified | Pending-action helpers, reducer retention, and card rendering of command/risk/warnings (+31 assertions) |

`apps/web/src/components/teamAgents/TeamThreadChatView.tsx` needed no edit: it already renders the
same `TurnApprovalCard`, so the transcript view gained the tool detail with it (asserted).

## 3. Implementation Details

**Where the interception lives.** In the executor, not in a service-level singleton subscription.
`EventBusTeamTurnExecutor.watch` already owns a per-turn subscription to `chat.message` and
`agent.status`; the two approval events join it and are torn down by the same `finish`. This
means the prompt is matched to the turn by construction — the subscription only exists while that
turn is being served — so no listener accumulates on the bus, no second `TeamAgentService`
instance reacts to another instance's threads, and there is no "is this still the active turn"
check to get wrong. Matching works because a shared thread's agent session runs under the team
thread's own id, which is the `threadId` `McpToolGateway` passes to `ApprovalManager`.

**The turn timeout is restarted when a prompt arrives.** The 10-minute turn timeout exists to
catch an agent that has gone quiet. A turn parked on an approval is not quiet — it is waiting on
the team — so letting a human's deliberation consume the agent's answer window would fail turns
for the crime of being asked about.

**`toPendingApprovalInfo`** reads the payload defensively (exported, unit-tested): no action id
means no prompt; a risk level that is not one of the four is dropped rather than coerced; warnings
that are not strings are discarded; command and description are truncated. An unanalysed prompt
reports *no* risk level rather than `low`, because claiming "low risk" is a claim the Core did not
make.

**Where the pending action is stored.** On the live turn inside `AgentTurnLock`, and deliberately
not in `team_turn_queue`. An outstanding prompt only exists while the process holding
`ApprovalManager`'s promise is up — `recoverTurns` settles anything mid-flight as FAILED after a
restart — so a persisted row would describe an action nothing is waiting on. The live queue is
what every transition broadcasts and what `GET /team-threads/:id` returns, so every client sees it
without a schema change.

**The resolution bridge.** `resolveTurnApproval` reads the pending action from the lock *before*
touching it (resuming clears it), then publishes `client.approval_response` — after
`resumeFromApproval` on APPROVED, and before `releaseTurn` on REJECTED so the agent is told `n`
while it is still the turn holding the lock. A rejection then calls
`ApprovalManager.cancelApprovalsForThread`, so a second prompt from the same session cannot sit on
screen for a turn that no longer exists. A turn parked by hand (no `actionId`) publishes nothing:
a `client.approval_response` naming no action would put a stray keystroke into whatever session
was running.

**Cancellation.** `agent.approval_cancelled` for the exact action the turn is parked on resumes it
(lock + row + thread state). A cancellation naming some other action is ignored, so it cannot
release a turn parked on a live prompt.

**Web.** `applyTurnEventToQueue` keeps the pending action when a transition omits it: it reads it
from the payload's top-level copy, and a re-announced park keeps what is already known — otherwise
a repeated `started` would blank a card naming `rm -rf /` while somebody is reading it. It is
dropped when the turn is no longer parked. `approvalRiskTone` gives each of the four levels its own
label and design-token colour (no hex values), because one alarm colour on both `ls` and
`rm -rf /` teaches members to ignore the badge.

## 4. Verification

Run from the repository root. The root `pnpm run <task>` scripts delegate to `turbo`, which this
non-interactive session's sandbox refuses to launch; each workspace's own gate command was
therefore run directly (same commands turbo invokes), for **all seven workspaces**.

| Gate | Command | Result |
| :--- | :--- | :--- |
| Team agent backend suite | `pnpm --filter asterim exec tsx src/services/ai/__tests__/TeamAgentService.test.ts` | **363/363 assertions passed**, exit 0 (was 299 before this task) |
| Team agent UI suite | `pnpm --filter @asterim/web exec tsx src/components/teamAgents/__tests__/TeamAgentUI.test.ts` | **395/395 assertions passed**, exit 0 (was 364) |
| Typecheck | `pnpm --filter <ws> exec tsc --noEmit` × 7 (`asterim`, `@asterim/web`, `@asterim/marketing`, `@asterim/relay`, `@asterim/shared`, `@asterim/adapters`, `@asterim/mcp-memory-server`) | **0 errors** in every workspace |
| Lint | each workspace's `lint` command (`eslint .` / `eslint src/`) × 7 | **0 errors** (296 web + 321 server + 28 adapters + 18 marketing + 12 mcp-memory-server + 3 shared warnings, all pre-existing `no-explicit-any` style warnings) |
| Server test script | `pnpm --filter asterim run test` (28 suites) | all suites passed, exit 0 |
| Web test script | `pnpm --filter @asterim/web run test` (12 suites) | all suites passed, exit 0 |
| Other test scripts | `@asterim/adapters` 30/30, `@asterim/relay` 71/71, `@asterim/mcp-memory-server` 24/24 | all passed |
| Build | `pnpm --filter <ws> run build` × 7, in dependency order (shared → adapters → web → asterim → marketing/relay/mcp-memory-server) | all succeeded; `asterim` copied `apps/web/dist` into `dist/web` as designed |

The new backend section runs against the **real** `ApprovalManager` and the **real** `EventBus`
with the production `EventBusTeamTurnExecutor`; only the agent process is stood in for (it raises
a genuine `requestApproval` and waits on the promise, exactly as `McpToolGateway` does). The test
also mirrors `AgentService`'s handler to assert the `y`/`n` keystroke that would be written into
the PTY.

No visual/puppeteer QA was run: the change is inside an existing card that has render coverage
through `react-dom/server`, and no dev server was started for this session.

## 5. Acceptance Criteria Review

- [x] **1. Automatic Approval Parking** — `agent.approval_request` for an active team thread parks
  the turn with the full action. Server suite §19: "the agent's tool call parks the turn by itself",
  "nobody had to call anything for it", "the durable row says so too", "and the thread record",
  "the turn carries the action it is parked on" (actionId), "the command the agent proposed, not
  the instruction", "what the Core would say about it" (description), "how dangerous it judged it"
  (`critical`), "and why" (both warnings), plus "the turn behind it has not started".
- [x] **2. EventBus Resolution Dispatch** — `resolveTurnApproval` publishes `client.approval_response`
  with the right action and boolean. Server suite §19: "the decision reached the agent", "as the
  action it answers", "on the thread the agent is running under", "and as the keystroke the Core
  writes into the session" (`y`), and "the blocked tool call was released" — the real
  `ApprovalManager` promise resolved `true`, which is the downstream resolver unblocking.
- [x] **3. Rejection Queue Advancement** — Server suite §19: "the agent was told as well" +
  keystroke `n`, "the blocked tool call was denied" (promise resolved `false`), "the turn is
  cancelled rather than failed", "its caller is told so" (the running turn received the rejection
  error), "nothing of that turn is left waiting on a human"
  (`approvalManager.getPendingActionIds(threadId)` empty — the `ApprovalManager` notification),
  and "the queue advanced to the member behind it" (the FIFO successor completed).
- [x] **4. UI Tool Command & Risk Rendering** — Web suite: "the pending action is its own region",
  "the command the agent proposed is rendered verbatim", "in monospace, as a command", "with what
  the Core would say about it", "the risk is graded" + "labelled for a screen reader", "the
  warnings are listed"/"each of them", alongside "the instruction is still there beside it" and
  "both answers are still offered". Attribution and policy assertions from P8-02/P8-03 still pass.
  The same detail is asserted in `TeamThreadChatView` ("the transcript view carries the same
  detail", "including the command", "and its warnings"), and a member who cannot answer still sees
  it ("a member who cannot answer is still shown what is being asked for").
- [x] **5. Automated Tests Pass** — `TeamAgentService.test.ts` 363/363 and `TeamAgentUI.test.ts`
  395/395, both exit 0, with new end-to-end coverage of interception, approval, rejection,
  prompt cancellation, defensive payload parsing, and a manual park that must not signal a phantom
  action.
- [x] **6. Monorepo CI Gates Pass** — typecheck, lint, test and build are clean across all seven
  workspaces (§4). Root `pnpm run …` wrappers could not be invoked in this sandbox; the underlying
  per-workspace commands were run instead and are recorded above.

Definition of Done: `TeamPendingApprovalInfo` exported from `@asterim/shared` ✅; interception
transitions the turn to `AWAITING_APPROVAL` ✅; `resolveTurnApproval` emits
`client.approval_response` ✅; `TurnApprovalCard` shows command, risk badge and warnings ✅; both
suites updated and passing ✅; all gates green ✅.

## 6. Git Diff Review

`git status` shows seven modified files and no new ones — every change is inside a file the task
named or its direct dependency (`AgentTurnLock.ts`, which owns the live turn the pending action
rides on). Reviewed file by file:

- No type is duplicated between server and web: `TeamApprovalRiskLevel` and
  `TeamPendingApprovalInfo` are declared once in `@asterim/shared` and imported on both sides.
  `ApprovalManager.CommandSecurityAnalysis` was left alone; its `riskLevel` is structurally
  compatible and is validated at the boundary by `toPendingApprovalInfo`.
- `AgentTurnLock` atomicity is untouched: no new path grants, releases or bypasses the lock. The
  only additions are a field on the active turn and its clearing on resume.
- No SQLite schema change, no migration, no new route, no new dependency, no `.env` change.
- Nothing new leaves the workstation: the pending action is published on the existing EventBus and
  the existing project/workspace socket rooms only (DEC-028/DEC-032 unaffected).
- Single-developer/unauthenticated paths are unchanged: the `unmanaged` branch of
  `evaluateTeamApproval` was not touched, a turn parked without details still works end to end
  (§20), and the non-team agent approval path (`socketManager` → `client.approval_response`) is
  unmodified — the service publishes the same event that surface already publishes.
- `tests/report.md` is also modified in the working tree; that is the P8-03 verification gate
  report written by the previous test-runner session, not part of this task, and it was left
  uncommitted and untouched.

## 7. Problems Discovered

- **Where to subscribe.** A `TeamAgentService`-level subscription to `agent.approval_request` would
  have leaked one listener per constructed service (the test suite builds six) and would have
  needed an "is this my thread, is this its active turn" check. Scoping the subscription to the
  executor's per-turn `watch` removes both problems and disposes itself on every exit path.
- **Ordering on rejection.** `ApprovalManager` resolves its promise synchronously inside
  `publish`, and `AgentTurnLock.releaseTurn` starts the next turn synchronously too. Publishing
  `client.approval_response` *before* releasing the lock is what lets the refused session stop
  talking before the next member's turn arms its own watcher; the reverse order would let a
  refused turn's trailing output be read as the next turn's answer.
- **`resumeFromApproval` clears the pending action**, so `resolveTurnApproval` has to read it from
  the lock before it tells the lock anything. This is easy to get wrong on a later edit; the
  comment at the read site says so.

## 8. Architectural Concerns

1. **Two prompts at once.** If a session raised a second `agent.approval_request` while the turn is
   already parked, the newer action replaces the older on the turn, and answering resolves only the
   newer one — the older would sit in `ApprovalManager` until its own timeout. With a PTY-driven
   agent that stops on each prompt this cannot currently happen, and a rejection cancels everything
   the thread had outstanding regardless. If a provider ever batches tool calls, the turn will need
   a list rather than a single `pendingApproval`.
2. **Restart loses the prompt, deliberately.** Because the pending action is not persisted, a Core
   restart while a turn is parked settles the turn as FAILED (existing `recoverTurns` behaviour)
   rather than restoring an unanswerable card. `ApprovalManager.recoverPendingApprovals` does
   re-publish `agent.approval_request` from the `approvals` table, but with no `threadId`, so it
   cannot re-park anything. If Phase 8 wants parked turns to survive a restart, that is a change
   proposal (persisting `action_id` on both sides), not an implementation detail.
3. **`ApprovalRequestPayload` in `@asterim/shared` is stale** — it declares only
   `actionId`/`description`/`command`, while `ApprovalManager` has published `securityAnalysis`
   since P6-05. I read the payload defensively rather than widen the shared type, which would have
   touched contracts outside this task's scope; widening it is a small, worthwhile follow-up.

## 9. Recommended Next Step

Phase 8's functional gap (DEC-031 § 3) is closed. The natural next step is the Phase 8 verification
gate — a `tests/current.md` assignment that re-runs the full monorepo gates plus a manual/puppeteer
pass on a live thread parked on a real destructive command, confirming the card, the badge and the
`y`/`n` round trip in the browser rather than only in `react-dom/server`. If instead the phase
continues with implementation, the shared `ApprovalRequestPayload` widening (§8.3) is the smallest
useful unit.
