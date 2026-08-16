Task-ID: P8-03
Status: COMPLETE

# Execution Report: P8-03 — Worktree Sandboxing & Verification Pipeline Dashboard UI

**Task ID:** P8-03
**Phase:** Phase 8 — Automated Verification Pipelines & Worktree Sandboxing
**Status:** IMPLEMENTED / VERIFIED
**Date:** 2026-08-17
**Author:** Claude Code

---

## 1. Summary

The operator-facing half of Phase 8 is in. `DelegationOutcomeCard` and
`DelegationBatchOutcomeCard` now render the evidence a delegation produced
rather than only its prose summary: a verification badge, a collapsible
step-by-step breakdown with commands, durations and exit codes, bounded
monospace output for failing steps, the sandbox branch, the changed-file list,
a tokenised diff preview, and the two buttons that decide what happens to the
work. `useProjectStore` gained the sandbox state and the five actions that talk
to the P8-01/P8-02 REST surface. `ThreadTree` badges sandboxed rows and
verification outcomes, the chat header says whether this thread's work is going
into a sandbox at all, and `DelegateModal` exposes the two switches that decide
it up front.

The three-valued reading of a pipeline is preserved end to end: **passed**,
**failed**, and **nothing ran** — a report with `totalSteps: 0` renders as
"No verification pipeline configured" in the idle tone and never as a pass.

`DelegationUI.test.ts` grew from 401 to **686 assertions**, all passing. All 38
monorepo test suites, both lint gates (0 errors) and every typecheck and build
are green.

---

## 2. Files Changed

| File | Change |
| :--- | :--- |
| `apps/web/src/stores/useProjectStore.ts` | `threadWorktrees` / `threadDiffs` / `threadVerificationReports` / `worktreeActions` state; `fetchThreadWorktree`, `fetchThreadVerification`, `mergeThreadWorktree`, `discardThreadWorktree`, `verifyThreadWorktree`; `verificationStatusTone` / `verificationStepTone`; evidence recorded off `delegation.completed` and `delegation.batch_completed` |
| `apps/web/src/components/delegation/DelegationStatus.tsx` | `VerificationEvidence`, `SandboxEvidence`, `DelegationEvidence`, `ThreadSandboxIndicator` / `ThreadSandboxStatus`; helpers `diffLineTone`, `diffLineColor`, `diffPreview`, `sandboxBranchLabel`, `verificationStepDetail`, `stepOutput`; container wiring (panel state, two-click confirmation, notices, hydration) |
| `apps/web/src/components/delegation/ThreadTree.tsx` | `threadSandbox()`; `[sandbox]` badge and verification tick/cross per row; `verificationReports` prop threaded through nesting |
| `apps/web/src/components/delegation/DelegateModal.tsx` | "Isolate in Git Worktree" and "Run Verification Pipeline" switches; `defaultSandboxOptions`, `applySandboxOption`; both flags carried in `buildDelegationBody` and `buildParallelDelegationBody` |
| `apps/web/src/components/SessionSidebar.tsx` | Passes `threadVerificationReports` into `ThreadTreeView` |
| `apps/web/src/App.tsx` | `ThreadSandboxStatus` in the chat thread header |
| `apps/web/src/components/delegation/__tests__/DelegationUI.test.ts` | +285 assertions across 15 new blocks (401 → 686) |
| `apps/server/src/routes/delegation.ts` | Forwards `verifyPipeline` / `verificationSteps` on `POST /delegate` (see §7) |
| `apps/server/src/services/ai/AgentDelegationService.ts` | `parseParallelItems` reads `isolateWorktree` / `verifyPipeline` / `verificationSteps`; `requestReview` accepts the two verification fields; `asOptionalBoolean` helper |

---

## 3. Implementation Details

**Store.** Sandbox state is keyed by the *child* thread id, because a sandbox
belongs to the thread that ran in it. `null` and "absent" are different answers:
`null` means "asked, and there is none" (a thread that never had a sandbox, or
one that was just discarded) and an absent key means "never asked". That
distinction is what stops a discarded sandbox from falling back to the stale
diff still sitting on the delegation payload.

`evidenceFromResult` folds the diff, the changed files and the report off the
`delegation.completed` payload into those maps, and does the same for every
child of a `delegation.batch_completed`. It is deliberately additive: a
delegation with no sandbox writes nothing rather than writing `null`, so an
unsandboxed sibling cannot erase what an on-demand read established.

`worktreeActions` is named (`MERGING` / `DISCARDING` / `VERIFYING`) rather than
boolean so the button that spins is the one that was pressed. Every action
clears it in a `finally`, including on a refusal or a network failure.

**Merge failures come back two ways** and both are read: a `409` from the route,
and a `200` carrying `result.merged: false` with `reason` and `conflicts` (which
is how `GitWorktreeService` reports a non-conflict refusal). Both become the
same operator-facing string.

**Evidence rendering.** `DelegationEvidence` is one component used by both cards,
so a fan-out's four children each get their own panel, their own diff and their
own two buttons — merging one says nothing about the other three. All interaction
state is keyed by child thread id and handed down as props, keeping every view in
the file props-only and testable under `react-dom/server`.

**Merging and discarding both ask twice.** The first click arms the button
("Confirm Merge" / "Confirm Discard"), the second one acts. Merging is the only
thing in the dashboard that writes to the operator's real checkout and
discarding destroys work; neither belongs to a stray click. This matches
`blueprint/GIT.md`'s rule that agents never commit without explicit approval —
merging remains an operator-initiated `POST` with no agent route to it.

**Diff preview** is tinted by `diffLineTone`, which checks `---`/`+++` before
`-`/`+` so file headers are not drawn as deletions, and bounded at
`MAX_DIFF_PREVIEW_LINES = 400` with a line saying how much was left out. Colours
come from `--color-state-completed` / `--color-state-error` / `--color-text-muted`;
no hex value appears anywhere in the new markup (asserted).

**Hydration.** The diff and the report travel on `delegation.completed`, which a
dashboard that reloaded never saw — `latestOutcomeFor` rebuilds the outcome from
the children list, which carries neither. A one-shot effect (guarded by a ref)
calls `fetchThreadWorktree` and `fetchThreadVerification` per child, so the
evidence and the merge/discard controls survive a reload. The server already
persists the delegation's report via `saveThreadVerificationReport`, so
`GET /worktree/verify` returns it.

**Design system.** Sandbox indicators use the violet `--color-state-waiting`
tokens (distinct from working-emerald, paused-amber and error-rose), monospace
comes from `--font-family-mono`, all transitions are 150ms, and the step
accordion and diff toggle carry `aria-expanded`. No new dependency was added —
the diff is tinted `<div>`s, not a syntax highlighter.

---

## 4. Verification

Every command was run from the repository root. Turbo's root-level aggregate
scripts were unavailable in this sandbox, so each workspace was invoked directly;
the union is the same set of tasks `pnpm run <script>` fans out to.

| Gate | Command | Result |
| :--- | :--- | :--- |
| Delegation UI suite | `pnpm --filter @asterim/web exec tsx src/components/delegation/__tests__/DelegationUI.test.ts` | **686/686 assertions passed**, exit 0 |
| Web suites (8) | `pnpm --filter @asterim/web test` | 8/8 suites, all green |
| Server suites (21) | `pnpm --filter asterim test` | 21/21 suites, all green (incl. `GitWorktreeService` 111/111, `VerificationPipelineService` 196/196, `AgentDelegationService` 461/461) |
| Relay / adapters / mcp-memory (9) | `pnpm --filter @asterim/relay|@asterim/adapters|@asterim/mcp-memory-server test` | 9/9 suites green |
| **Total** | | **38/38 test suites passing** |
| Typecheck | `pnpm --filter <each> typecheck` (web, server, shared, adapters, relay, marketing, mcp-memory) | 0 errors |
| Lint | `pnpm --filter @asterim/web lint` / `pnpm --filter asterim lint` | **0 errors** (302 / 273 pre-existing warnings, unchanged in kind and count) |
| Build | `pnpm --filter @asterim/shared|@asterim/adapters|@asterim/web|asterim|@asterim/marketing|@asterim/relay|@asterim/mcp-memory-server build` | all succeeded; server build copied `apps/web/dist` into `dist/web` |

No screenshot capture was run: this session is non-interactive and the task's
verification commands do not include a visual gate. Rendering is asserted
instead through `react-dom/server` static markup in the test suite.

---

## 5. Acceptance Criteria Review

- [x] **1 — Verification summary badges and collapsible step breakdowns in both cards.**
  `VerificationEvidence` renders the badge from `verificationStatusTone` and a
  `Show Steps (n)` / `Hide Steps` accordion with per-step pill, command, duration
  and exit code. Evidence: `DelegationOutcomeCard — verification evidence`
  ("the card has a verification block", "with the summary badge", "every step is
  broken out", "with the command behind it", "its duration", "and its exit code",
  "the breakdown starts closed"), and `DelegationBatchOutcomeCard — evidence per
  child` ("the one that passed says so", "and the one that failed says which
  step"). The unverified state is covered: `an empty pipeline says so plainly`,
  `and never claims a pass`.

- [x] **2 — Failing steps render bounded monospace `stdoutSummary`/`stderrSummary`.**
  Failing rows render a `maxHeight: 180px` scrollable `<pre>` in
  `--font-family-mono`, labelled `<step> output`, with a Copy button. Evidence:
  "the failing step’s output is shown", "both streams of it", "in a labelled
  box", "that can be copied", "and the passing step carries no diagnostic box";
  plus `stepOutput` unit assertions.

- [x] **3 — Changed file counts, diff preview toggle, working Merge/Discard buttons.**
  Evidence: `DelegationOutcomeCard — sandbox diff and lifecycle` ("naming the
  branch it sits on", "counting the files it changed", "and listing them", "the
  diff can be opened", "the work can be kept", "or thrown away", singular/plural
  file count, expanded-diff tinting, bounded preview, confirmation labels, busy
  labels, success/error notices) and `sandbox and verification controls — the
  clicks themselves` (clicking Merge/Discard/View Diff names the right child).
  The store side is proven end to end in `useProjectStore — mergeThreadWorktree`
  (URL, method, token, target branch, conflict, 409 refusal, spinner cleared)
  and `— discardThreadWorktree` (DELETE, state cleared, refusal).

- [x] **4 — "Re-run Verification" triggers `POST /worktree/verify` and updates the UI.**
  `useProjectStore — verifyThreadWorktree` asserts the exact URL, `POST`, the
  Authorization header, that step *names* (never commands) are sent, that the
  report replaces the previous one, and that a 500 leaves the last report alone.
  The button and its loading state are asserted in the card
  ("verification can be re-run", "a verification in flight is visible", "and the
  button is spent") and the click is driven in `— the clicks themselves`.

- [x] **5 — `ThreadTree` shows sandbox indicators and verification badges.**
  `ThreadTreeView — sandbox and verification badges (P8-03)`: `threadSandbox`
  reads the brief with the thread row as fallback, the sandboxed row is badged
  and titled `Isolated in <branch>`, verified/failed rows carry a tick/cross with
  the summary as its tooltip, exactly one row is badged, grandchildren inherit
  the props, and a tree with no reports claims nothing about verification.

- [x] **6 — `DelegateModal` offers worktree and verification toggles.**
  `defaultSandboxOptions` (task/batch on, review off), `applySandboxOption`
  (turning isolation off takes verification with it; verification cannot be
  armed without a sandbox), the rendered switches with their explanatory copy,
  the disabled state and its reason, and the two `onChange` handlers driven
  directly. The flags reach the wire: `buildDelegationBody` /
  `buildParallelDelegationBody` assertions, and a silent form still sends
  `undefined` so the Core keeps its own defaults.

- [x] **7 — `DelegationUI.test.ts` expanded and passing with exit code 0.**
  401 → **686 assertions**, exit 0. New blocks: `verificationStatusTone`,
  `diff and step presentation helpers`, `resolveEvidence`, `evidence from a
  finished delegation`, `fetchThreadWorktree`, `fetchThreadVerification`,
  `mergeThreadWorktree`, `discardThreadWorktree`, `verifyThreadWorktree`,
  `ThreadSandboxIndicator`, two outcome-card blocks, the batch block, the click
  block, the tree block, and three modal blocks.

- [x] **8 — CI gates pass with 0 errors.** See §4: 38/38 suites, 0 typecheck
  errors, 0 lint errors, every build green.

**Definition of Done** — all six boxes met: store extended; `DelegationStatus`
carries evidence, steps, diff and controls; `ThreadTree` badged; `DelegateModal`
switched; tests expanded; CI green.

---

## 6. Git Diff Review

`git diff` was read in full before writing this report. Nine files changed
(+2,822 / −151, of which +1,153 is the test suite).

- No new dependency: `apps/web/package.json` is untouched. The diff preview is
  tinted `<div>`s inside a `<pre>`, not a highlighter.
- No hardcoded colours anywhere in the new markup — asserted negatively
  (`!/#[0-9a-fA-F]{6}/`) on every new render block.
- No existing delegation event handler, store subscription or route was changed
  in behaviour. `applyDelegationCompleted` and `applyDelegationBatchCompleted`
  gained additive fields only; every pre-existing assertion in the suite still
  passes unmodified.
- One pre-existing test-harness default was adjusted rather than an assertion:
  `renderModal` now passes `isolateWorktree: true, verifyPipeline: true`, which
  is what the container hands the view for a `TASK`. Without it the harness
  would render a mode the real modal never shows. No assertion text was
  weakened; one was strengthened (`!html.includes('disabled=""')`).
- `tests/report.md` was already modified in the working tree when this session
  started (an uncommitted P8-02 *test gate* report from a previous run). It was
  not touched and is **not** part of this commit.

---

## 7. Problems Discovered

**The `verifyPipeline` toggle had no wire to travel on.** `DelegationRequest`
declares `verifyPipeline` and `verificationSteps` (P8-02) and
`AgentDelegationService.delegateTask` reads them, but `POST /delegate` never
forwarded them and `parseParallelItems` never parsed them — nor did it parse
`isolateWorktree`, which the single-delegation route does forward. Shipping the
checkbox without this would have made acceptance criterion 6 cosmetic: the
operator unticks "Run Verification Pipeline" and the pipeline runs anyway.

Three minimal pass-throughs were added, all inside the existing contract, none
architectural:

1. `POST /delegate` forwards `verifyPipeline` and `verificationSteps` using the
   same "only when the caller stated it" rule the route already applies to
   `isolateWorktree`, so an unset field still means the service's own default.
2. `parseParallelItems` reads the same three fields (the batch service at
   `delegateParallel` already looked for `item.verifyPipeline`).
3. `requestReview` accepts the two verification fields and passes them down;
   it already accepted `isolateWorktree`.

Step names are filtered by the existing `normalizeStepNames` / `isSafeScriptName`
guard, so this adds no way to introduce a command — only to choose among the
ones the project already declares. Flagged here for Antigravity because it is
the one change outside `apps/web`.

**Reload loses the socket-borne evidence.** `latestOutcomeFor` rebuilds an
outcome from `GET /children`, which carries no diff and no report, so a card
shown after a reload would have had a summary and nothing else. Handled with a
one-shot hydration effect over `GET /worktree` and `GET /worktree/verify`; the
latter needed a fifth store action (`fetchThreadVerification`) beyond the four
the task names. It reads the P8-02 endpoint under the same `/worktree*` prefix
the task specifies and runs nothing.

**Discard versus stale evidence.** Because the merge/discard actions write
`null` into the maps, `resolveEvidence` had to distinguish an explicit `null`
from an absent key (`in` rather than `??`) — otherwise discarding a sandbox
would leave the card still showing the diff and still offering to merge it.
Covered by `resolveEvidence` assertions.

---

## 8. Architectural Concerns

1. **The thread header indicator is not in the task's Implementation Scope** but
   is in its Objective ("sandbox status indicators to `ThreadTree.tsx` and thread
   headers"). It is implemented as `ThreadSandboxStatus` in `App.tsx`'s chat
   header. Flagging the ambiguity in case a different surface was meant.
2. **`SessionSidebar` badges only what the store has seen.** Verification badges
   in the tree appear for threads whose evidence arrived on the socket or was
   hydrated by an opened card. A list-wide badge would need `GET /children` to
   carry a verification summary per child — a P8-02 contract change, so it was
   not made here. Worth a Change Proposal if the tree is expected to be
   authoritative on load.
3. **`DelegationStatus.tsx` is now ~1,600 lines** and exports eleven non-component
   helpers alongside its components (hence the `react-refresh/only-export-components`
   warnings it already had). Splitting the evidence panel into its own module is
   a clean follow-up; it was not done here to keep the diff reviewable against
   the named file list.

---

## 9. Recommended Next Step

Phase 8's vertical is complete: sandboxes (P8-01), pipelines (P8-02) and the
operator loop over both (P8-03). Recommended next is a **Phase 8 verification
gate** in `tests/current.md` exercising the full loop against a real repository —
delegate with isolation on, let the pipeline fail, re-run it from the card, then
merge and confirm the sandbox branch and directory are cleaned up — plus a
visual QA pass over the outcome card and the two new badges, which is the one
thing the static-markup suite cannot judge.
