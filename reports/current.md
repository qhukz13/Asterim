Task-ID: P7-05
Status: COMPLETE

# Execution Report: P7-05 — Operator-Initiated Multi-Agent Parallel Batch Delegation & Modal Workflow Dispatch

**Task ID:** P7-05
**Phase:** Phase 7 — Multi-Agent Orchestration & Collaborative Workflows
**Status:** IMPLEMENTED / VERIFIED
**Date:** 2026-08-16
**Author:** Claude Code

---

## 1. Summary

`DelegateModal` now composes parallel fan-outs as well as single delegations. A third
mode — `PARALLEL` — sits alongside `TASK` and `REVIEW` behind a tab switcher and
renders a bounded batch builder: two to four subagent rows, each with its own role
selector, task description and optional context, with add/remove controls bounded by
`MIN_PARALLEL_DELEGATIONS = 2` and `MAX_CONCURRENT_DELEGATIONS = 4`.

Submitting in `PARALLEL` mode posts `{ delegations: ParallelDelegationItem[] }` to
`POST /api/v1/threads/:id/delegate/parallel` with the same auth headers and the same
long-lived-request handling the single path already used: the modal does not wait on
the response (the Core holds it open until every child settles) but closes on the
socket transition that parks the parent behind its children. Refusals — 400 invalid
batch, 409 `CONCURRENCY_LIMIT_EXCEEDED`, network failure — come back into the modal's
existing error banner in the Core's own words.

No server, store, shared-type or route code was touched: P7-04 already shipped the
engine, the endpoint, the socket event and the store actions. This task is the
operator-facing surface over them.

## 2. Files Changed

| File | Change |
| :--- | :--- |
| `apps/web/src/components/delegation/DelegateModal.tsx` | **Modified.** `DelegateModalMode` extended with `'PARALLEL'`; `ParallelItemState` and the batch helpers (`newParallelItem`, `defaultParallelItems`, `canAddParallelItem`, `canRemoveParallelItem`, `addParallelItem`, `removeParallelItem`, `updateParallelItem`, `canSubmitParallelDelegation`, `buildParallelDelegationBody`) added; `DelegateModalView` given the third tab, the batch builder UI and the batch-aware submit button; `DelegateModal` given the item list state, the parallel endpoint dispatch and per-mode error copy. |
| `apps/web/src/components/delegation/__tests__/DelegationUI.test.ts` | **Modified.** Four new `describe` blocks covering the batch helpers, the payload builder, the parallel view render and its add/remove/edit interactions, plus a dispatch-and-refusal block driving the real `fetch` stub. 316 → 401 assertions. |

No other file in the repository was modified by this task.

## 3. Implementation Details

**Mode.** `DelegateModalMode = DelegationKind | 'PARALLEL'`. `canSubmitDelegation`
returns `false` for `PARALLEL` outright rather than falling through to the task branch —
a batch is not decided from the single-delegation fields, and leaving the fallthrough in
would have made an unfilled batch look submittable if the parallel guard were ever
bypassed.

**Row identity.** Each row carries an `id` from a module-level sequence
(`subagent-<n>`), so React keys, the per-row `aria-label`s and the change/remove
callbacks all address a row rather than an index. Removing row 2 of 3 therefore leaves
rows 1 and 3 holding their own text instead of shifting it.

**Bounds.** Enforced in three places for three different reasons: the add button is
disabled at 4 and the remove buttons at 2 (so the operator sees the bound before typing
into a fifth row); `addParallelItem`/`removeParallelItem` return the list unchanged past
the bound (so a stale callback cannot exceed it); and `canSubmitParallelDelegation`
re-checks `2 <= length <= 4` independently of the buttons (so any state that reached the
form from elsewhere fails the same way an empty task does). The Core remains the
authority — this is the form declining to compose something it knows will be refused.

**Payload.** `buildParallelDelegationBody` emits canonical `ParallelDelegationItem`
fields — `profileId`, `taskDescription`, `inputContext`, `kind: 'TASK'` — trimming task
and context and omitting an unchosen profile and an empty context rather than sending
them blank. The server's `parseParallelItems` accepts both the canonical names and the
agent-facing aliases; the canonical names are used so the operator path and the
meta-tool path converge on the same reader.

**Dispatch.** The modal posts the batch endpoint directly instead of calling
`useProjectStore.delegateParallel`. That action reports any refusal as `null`, and the
refusal is precisely what criterion 6 asks to render — a 409 concurrency limit reads
differently from a 400 invalid batch, and the operator is owed the Core's message.
Everything else about the request (auth headers, backend-url resolution, the
fire-and-do-not-await posture) is shared with the single-delegation path.

**Closing.** Unchanged from P7-02: the existing effect closes the modal when
`pendingChildren[activeThreadId]` becomes non-empty, which the `delegation.parent_state`
socket event fills once per dispatched child. A fan-out therefore closes the modal as
soon as its children start, not when the whole batch finishes ten minutes later.

**Styling.** Every colour, radius, spacing and font token comes from `tokens.css`
(`--color-surface-1`, `--color-border-subtle`, `--color-accent-primary`,
`--color-state-paused`, `--spacing-*`, `--radius-*`). The rendered markup is asserted
free of hex literals by test. The modal widens from 520px to 640px in parallel mode and
the row list scrolls at `maxHeight: 46vh` so a four-row batch stays inside the viewport.

## 4. Verification

The root `pnpm run typecheck | lint | test | build` turbo entrypoints were blocked by
this session's command-permission layer, so each gate was executed **per workspace**
across all six packages — the same underlying commands turbo would have run.

| Gate | Command | Result |
| :--- | :--- | :--- |
| Typecheck | `pnpm --filter <pkg> run typecheck` for `@asterim/web`, `asterim`, `@asterim/shared`, `@asterim/adapters`, `@asterim/relay`, `@asterim/marketing` | **0 errors**, all six clean |
| Lint | `pnpm --filter <pkg> run lint` for the same six | **0 errors** (pre-existing warnings only: web 292, server 266, adapters 28, marketing 18, shared 3, relay 0) |
| Tests | `pnpm --filter @asterim/web run test` | 8 suites, all green — 151, 37, 134, 113, 104, 85, 134, **401** assertions |
| Tests | `pnpm --filter asterim run test` | 19 suites, all green — including `AgentDelegationService.test.ts` at **412/412** |
| Tests | `pnpm --filter @asterim/adapters run test` / `@asterim/relay run test` | 23/23 and 71/71 |
| Build | `pnpm --filter @asterim/shared / @asterim/adapters / @asterim/web / asterim / @asterim/marketing / @asterim/relay run build` | all successful, in dependency order (web dist → `asterim` dist/web) |

`DelegationUI.test.ts` went from **316 → 401 assertions**, all passing; no existing
assertion was modified or removed.

Themes and breakpoints: `tokens.css` defines a single `:root` palette — there is no
light theme in this design system — so a theme regression is not reachable; the new
markup is asserted to contain no hardcoded colour. Puppeteer screenshot capture was
**not** performed: it needs a live server, an authenticated session and an open thread
with profiles loaded, none of which this non-interactive session could stand up
truthfully. The visual evidence is the token-only assertion plus the rendered-markup
tests.

## 5. Acceptance Criteria Review

- [x] **1 — "Parallel Batch" mode tab alongside "Delegate Task" and "Request Review".**
      `tab('PARALLEL', 'Parallel Batch')` in `DelegateModalView`; asserted by
      *"the batch form is titled"* and *"the tab is offered alongside the other two"*.
- [x] **2 — 2 to 4 concurrent subagents with individual roles, tasks and contexts.**
      Each row renders `Subagent N role` / `Subagent N task` / `Subagent N context`;
      asserted by *"each with its own role selector"*, *"each with its own task field"*,
      *"and its own context field"*, and by the interaction tests proving a change on
      row 2 names row 2's id.
- [x] **3 — Add enabled up to 4 then disabled; remove enabled down to 2 then disabled.**
      Asserted by *"and is enabled at two"*, *"at four the add control is spent"*,
      *"which is refused at the minimum of two"*, *"above the minimum a row can be
      dropped"*, plus the helper tests *"so no more may be added"* / *"and asking anyway
      changes nothing"*.
- [x] **4 — Validation blocks submission on an empty task or a count outside [2, 4].**
      `canSubmitParallelDelegation`; asserted by *"an empty batch cannot be dispatched"*,
      *"whitespace is not a task"*, *"a single delegation is not a batch"*, *"and neither
      is a fifth subagent"*, and at the view level by *"a batch with empty tasks cannot
      be submitted"* (submit button `disabled === true`).
- [x] **5 — Submitting posts to `/delegate/parallel` and closes on child start.**
      Asserted by *"the batch goes to the parallel endpoint"*, *"with POST"*, *"carrying
      the token"*, *"and both subagents as the Core reads them"*, and *"the modal's close
      condition is met once the children start"* (the same
      `pendingChildren[thread].length > 0` predicate the modal's effect reads).
- [x] **6 — 409 / 400 refusals rendered in the modal error banner.**
      Asserted by *"a concurrency refusal is shown"*, *"as an alert"*, *"a batch over the
      limit is refused"* and *"and the refusal is what the modal shows"*.
- [x] **7 — `DelegationUI.test.ts` covers rendering, add/remove, validation, payload,
      dispatch.** Four new describe blocks; 85 new assertions; 401/401 green.
- [x] **8 — CI gates pass with 0 errors.** Typecheck, lint, test and build all clean
      across all six workspaces (see §4 for the per-workspace execution note).

## 6. Git Diff Review

`git status --short` shows exactly two files changed by this task:

```
 M apps/web/src/components/delegation/DelegateModal.tsx
 M apps/web/src/components/delegation/__tests__/DelegationUI.test.ts
```

Reviewed line by line against the forbidden-changes list:

- **Single-child delegation is untouched.** The `TASK` and `REVIEW` field groups are the
  same JSX, moved inside a `{!isParallel && (<>…</>)}` wrapper and re-indented; their
  ids, `aria-label`s, placeholders, `rows` and `buildDelegationBody` output are byte-identical
  in behaviour. Every pre-existing `DelegateModalView` and `buildDelegationBody`
  assertion still passes unmodified.
- **The batch cannot exceed 4.** Bounded in the helpers, in the disabled buttons and
  again in the submit validator; the Core's own `MAX_CONCURRENT_DELEGATIONS` is imported
  rather than re-declared.
- **No hardcoded colours.** All values are `var(--…)` tokens; the no-hex regex assertion
  covers the rendered parallel markup.
- **No suite regressions.** All 29 test files across the four packages that have tests
  are green; no existing assertion was edited.

One unrelated file, `tests/report.md`, was already modified in the working tree when
this session started — it is the P7-04 verification-gate report from a previous session.
It was **not** touched and is **not** included in this task's commit.

## 7. Problems Discovered

- **`delegateParallel` swallows the refusal.** The P7-04 store action resolves to `null`
  for every failure mode, so it cannot satisfy criterion 6 on its own. The modal posts
  the endpoint directly (as the task explicitly permitted) to keep the Core's error text.
  If a future task wants the store to be the only fetch site, `delegateParallel` will
  need to resolve to a discriminated result rather than `BatchDelegationResult | null`.
- **`CLAUDE.md` is stale on testing.** It states there is "no test runner or test script
  anywhere in the repo"; every workspace now has a `test` script running `tsx` assertion
  suites, and 29 of them ran green this session. Worth correcting the next time that
  file is edited.
- **The repository is not Prettier-clean.** `prettier --check` fails on untouched files
  (`DelegationStatus.tsx`, `ThreadTree.tsx`, `useProjectStore.ts`), and `format:check` is
  not in CI (`.github/workflows/ci.yml` runs lint + build only). The new code follows the
  file's existing style; no repo-wide reformat was performed, as that would have been an
  unrequested change well outside this task.

## 8. Architectural Concerns

- **The batch is TASK-only.** `buildParallelDelegationBody` sets `kind: 'TASK'` for every
  row, matching the task's `ParallelItemState` shape (`id`, `profileId`, `task`,
  `context`). The Core and the shared type both support a per-item `REVIEW` with
  `reviewCriteria`, and `aggregateReviewVerdict` exists to roll several reviews into one
  verdict — an operator cannot currently reach that from the dashboard. A per-row
  TASK/REVIEW toggle is a small, well-bounded follow-up if Antigravity wants it.
- **`timeoutMs` is not exposed** per row either; every child gets the Core's
  `DEFAULT_DELEGATION_TIMEOUT_MS`. That seems right for a first operator surface, but it
  means a long-running batch member cannot be given more room from the UI.
- **`react-refresh/only-export-components` warnings grew.** The file now exports nine
  more non-component helpers, which is the pattern this file (and the delegation
  components generally) already follows so the pure logic stays unit-testable without a
  DOM renderer. Splitting the helpers into a sibling module would silence the warnings;
  it would also break the convention every other delegation test relies on.

## 9. Recommended Next Step

The Phase 7 operator surface for parallel delegation is complete end to end: engine
(P7-04), REST, socket, store, banner, tree and now the composition modal. Recommended
next task is a **P7 verification gate** (`tests/current.md`) running the full CI battery
plus a browser pass over the delegate modal's three modes, or, if more feature work is
wanted first, a per-row `REVIEW` toggle so an operator can dispatch a mixed
implement-and-review fan-out and see the aggregated verdict the Core already computes.
