Task-ID: P9-02
Status: COMPLETE

# Execution Report: P9-02 — Worktree Fleet Orchestrator, Step Retries & Trigger Listeners

**Task ID:** P9-02
**Phase:** Phase 9 — Multi-Agent Automated Pipelines & Worktree Fleet Execution
**Status:** VERIFIED
**Date:** 2026-08-18
**Author:** Claude Code

---

## 1. Summary

A pipeline run is now a *fleet* of isolated checkouts rather than a set of unrelated sandboxes.

`WorktreeFleetService` provisions one checkout per step on a deterministic branch
(`asterim/pipeline/<runId>/step-<stepId>` in `.asterim/worktrees/pipeline/<runId>/<stepId>`),
branches each step from its predecessors' settled commits rather than from the repository's
HEAD, settles a passing step's work onto its own branch so successors can chain from it,
reports whether parallel branches can be combined, and consolidates a finished run into a
single mergeable branch (`asterim/pipeline/<runId>/pr`) with a summary commit.

`PipelineEngine` was integrated with it: steps now run in fleet checkouts, a failed step is
re-dispatched up to its declared `retries` after `retryDelayMs`, and two new engine methods
(`analyzeRunConflicts`, `synthesizeRun`) sit behind two new REST routes. `PipelineParser`
validates `retries` (0–3) and `retryDelayMs` (0–60000). `PipelineTriggerService` starts runs
from `GIT_COMMIT` and `FILE_CHANGE` bus events and from `SCHEDULE` intervals, and `GitService`
now publishes `git:commit` after a successful commit so the first of those has a real producer.

Everything is fail-closed: a step whose ancestors' branches conflict is never started, a step
whose work cannot be committed to its branch fails rather than letting its successor chain from
the wrong commit, and a synthesis that conflicts leaves no branch behind. Nothing in this task
writes to, merges into, or checks anything out in the operator's working tree.

`WorktreeFleet.test.ts` is new: 184 assertions against real git repositories, wired into
`apps/server` `"test"`. Every monorepo gate is green.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `packages/shared/src/types/pipeline.ts` | Modified | `retries`/`retryDelayMs` on `PipelineStep` and their bounds; fleet branch/path naming helpers and `isSafePipelineRefComponent`; `PipelineStepWorktree`, `PipelineConflictAnalysis`, `PipelineBranchConflict`, `PipelineSynthesisRequest/Result`, `PipelineTriggerEvent`; trigger event names, schedule floor and file-change debounce; `worktreeBranch`/`commitSha`/`attempts` on `PipelineStepRun`, `baseCommit`/`synthesis*` on `PipelineRun`; `attempt` on the step-started payload |
| `packages/shared/src/types/delegation.ts` | Modified | `DelegationSandbox` plus the optional `sandbox` field on `DelegationRequest` and `ParallelDelegationItem` — the one way a delegation runs in a checkout it did not provision |
| `apps/server/src/services/pipeline/WorktreeFleetService.ts` | Created | The fleet: provisioning, branch chaining, settle, conflict analysis, PR synthesis, teardown |
| `apps/server/src/services/pipeline/PipelineTriggerService.ts` | Created | `GIT_COMMIT` / `FILE_CHANGE` subscribers, debounced bursts, `SCHEDULE` timer, interval parsing |
| `apps/server/src/migrations/005_pipeline_fleet.ts` | Created | Additive columns: `pipeline_step_runs.attempts/worktree_branch/commit_sha`, `pipeline_runs.base_commit/synthesis_branch/synthesis_commit` |
| `apps/server/src/migrations/index.ts` | Modified | Registers migration 5 |
| `apps/server/src/services/pipeline/PipelineEngine.ts` | Modified | Fleet base resolved per run; per-step provisioning and chaining; settle-on-pass; retry loop with an interruptible delay; `analyzeRunConflicts`; `synthesizeRun`; three new error codes; new row columns read and written |
| `apps/server/src/services/pipeline/PipelineParser.ts` | Modified | `retries` / `retryDelayMs` keys, bounded-integer reader |
| `apps/server/src/services/ai/AgentDelegationService.ts` | Modified | Honours an externally provisioned sandbox in `provisionWorktree`, threaded through both the single and parallel paths |
| `apps/server/src/routes/pipelines.ts` | Modified | `GET /api/v1/pipeline-runs/:id/conflicts`, `POST /api/v1/pipeline-runs/:id/synthesize`, three new status mappings |
| `apps/server/src/server.ts` | Modified | Starts `pipelineTriggerService` after run recovery |
| `apps/server/src/services/git/GitService.ts` | Modified | Publishes `git:commit` after a successful commit action |
| `apps/server/src/services/pipeline/__tests__/WorktreeFleet.test.ts` | Created | 184 assertions: naming, provisioning, chaining, conflicts, synthesis, retries, triggers, REST + RBAC, no orphans |
| `apps/server/package.json` | Modified | New suite in the `"test"` chain |

## 3. Implementation Details

**Branch chaining.** `provisionStep` takes the step's *direct* dependencies. The first
dependency whose branch exists is the base of the new checkout; every other is merged into it.
Direct is enough to be transitive: each dependency was itself chained, so a step branched from
a test step's branch already carries the implementation two levels up. A merge that conflicts
throws `CHAIN_CONFLICT` after aborting the merge and removing the half-chained checkout — the
step is then failed by the engine without an agent ever being started.

**Where a step actually runs.** The delegation service provisions its own sandbox named after
the child thread, which is branched from HEAD and therefore cannot see a predecessor's work.
Rather than duplicate the delegation lifecycle, `DelegationRequest` gained an optional
`sandbox` that `provisionWorktree` adopts instead of creating one. It is deliberately absent
from `parseParallelItems` and from the `delegate_task` tool schema, so an agent cannot name the
directory its child runs in — only Asterim's own orchestration can.

**Settling.** A successor branches from a *commit*, so a passing step's leftover work is
committed onto its own ephemeral branch before anything downstream is planned. A settle that
fails turns the step into a failure rather than letting the successor silently chain from the
previous commit. This commits an agent's work, which `blueprint/GIT.md` forbids doing on the
operator's branch — it happens on the run's own `asterim/pipeline/...` branch, and nothing
reaches a real branch without an explicit synthesis or merge.

**Conflict detection.** Pairwise and in two cheap passes before any expensive one: a pair where
one branch is an ancestor of the other is skipped (that is a chain), and a pair with no
overlapping changed paths is skipped (they cannot conflict). Only what survives both is merged
for real, in a detached probe checkout that is reset between pairs and removed in a `finally`.
`git merge-tree` was rejected on purpose: its porcelain changed shape in git 2.38 and the older
form reports conflicts as markers inside a patch, so reading it would mean parsing two formats
and guessing which one the workstation speaks. A probe merge answers with `--diff-filter=U` on
every version.

**Synthesis.** The `…/pr` branch is assembled in a throwaway checkout on the run's own base
commit (recorded when the run started, so a moving HEAD cannot change it), merging the passing
step branches in dependency order and finishing with an empty summary commit naming the run and
its steps. A conflict aborts the merge, discards the branch and raises `SYNTHESIS_CONFLICT` with
the paths; half a consolidation is worse than none. Synthesis is refused while the run is still
in progress.

**Retries.** `dispatchWithRetries` re-dispatches only the failed steps of a batch, each retry a
fresh delegation in a freshly provisioned checkout — what is usually being retried *is* the
session, and inheriting the failed attempt's half-written files would be different work from the
one the definition asked for. The wait between attempts is sliced at 100 ms and checks for a
cancellation, so a 60-second `retryDelayMs` is not 60 seconds of an unresponsive cancel button.
Attempt counts are persisted, and a failure's message carries "(after N attempts)".

**Triggers.** One subscriber per event kind plus one timer, all started explicitly by
`server.ts` rather than at import time. File changes are debounced per project (a save produces
several events, an install produces thousands) and start one run carrying the accumulated paths.
`SCHEDULE` reads `intervalMs`/`schedule`/`every` from the definition's parameters — `30m`, `2h`,
`90s` — with a one-minute floor; cron syntax was not invented for it. Due-ness is measured from
the last firing *in this process*, so a restart does not replay a day of missed schedules. An
`ALREADY_RUNNING` refusal is logged as normal, not as a fault.

## 4. Verification

Commands run and their results (this repository has no single test runner; each suite is a tsx
script, and the root scripts fan out through turbo):

| Gate | Command | Result |
| :--- | :--- | :--- |
| New suite | `pnpm --filter asterim exec tsx src/services/pipeline/__tests__/WorktreeFleet.test.ts` | **184 passed, 0 failed** |
| P9-01 suite | included in the chain below | **199 passed, 0 failed** |
| Server tests | `pnpm --filter asterim run test` (30 suites chained by `&&`) | all suites ran to the last one; final suite `208/208 assertions passed`, exit 0 |
| Adapters tests | `pnpm --filter @asterim/adapters run test` | 30/30 |
| Relay tests | `pnpm --filter @asterim/relay run test` | 71/71 |
| Web tests | `pnpm --filter @asterim/web run test` | 395/395 |
| MCP memory tests | `pnpm --filter @asterim/mcp-memory-server run test` | 42/42, 82/82, 87/87, 62/62, 28/28, 23/23, 24/24 (see § 7 for a flake) |
| Typecheck | `tsc --noEmit` in `asterim`, `@asterim/shared`, `@asterim/web`, `@asterim/adapters` | 0 errors |
| Lint | `run lint` in server, shared, web, marketing, relay, adapters, mcp-memory-server | **0 errors** (pre-existing `no-explicit-any` warnings only; the 8 in the new test file match the style of every other suite) |
| Build | `run build` in shared, adapters, server, web, marketing, relay, mcp-memory-server | all succeeded (`asterim` bundles to `dist/index.js`, 1.23 MB) |

The root `pnpm run typecheck` / `lint` / `build` wrappers could not be invoked in this
non-interactive session (the harness declined the root commands), so every workspace was run
individually; the set covers every workspace those scripts fan out to.

What the new suite actually proves, in its own sections:

- naming and refusal of unsafe run/step ids before git is touched;
- provisioning: deterministic branch, checkout under `.asterim/worktrees/pipeline`, base commit,
  registration on its own branch;
- chaining: a dependent step's checkout **contains its predecessor's file with its contents**,
  a re-provisioned step does **not** inherit a failed attempt's files, a fan-out join carries
  both ancestors' work, and a join whose ancestors disagree is refused with the file named;
- conflicts: disjoint pairs clean, same-line pairs conflicting with the path and the step pair
  named, a chained pair never conflicting with its own ancestor, a missing branch reported;
- synthesis: branch name, both files present in the branch tree, summary commit naming the run
  and its steps, a conflicting synthesis refused with no branch left behind, and
  `NOTHING_TO_SYNTHESIZE` for a run with nothing to carry;
- retries end-to-end: `!FLAKY(2)` with `retries: 2` passes on the third attempt (`attempts` = 3,
  4 sessions started for 2 steps), the same step with no retries fails the run and skips its
  successor, and exhausted retries record "after 2 attempts";
- triggers: a `git:commit` event starts the watching pipeline and no other, a burst of three
  `file.changed` events starts exactly one run carrying the paths, another project's commit
  starts nothing, the schedule tick starts the clock on first sight and fires once per interval,
  and a stopped listener starts nothing;
- REST: 401 anonymous on both routes, 404 on unknown runs, 200 with the expected payloads,
  subset synthesis, and RBAC — a viewer may read conflicts but gets 403 on synthesize, a
  non-member gets 403 on both, an owner gets 200;
- and, after every section, that the operator's working tree is clean, `main` is where it was,
  no fleet branch survives and no checkout is still registered.

## 5. Acceptance Criteria Review

- [x] **1. `PipelineStep` supports `retries` and `retryDelayMs`, validated by `PipelineParser`.** Keys added to `STEP_KEYS`, read by `readBoundedInteger`. Tests: "retries are read", "and so is the delay", "an explicit zero survives", plus refusals for >3, negative, fractional, non-numeric, and a delay above 60000.
- [x] **2. `WorktreeFleetService` creates isolated step worktrees with deterministic branch naming.** `provisionStep` → `asterim/pipeline/<runId>/step-<stepId>` under `.asterim/worktrees/pipeline/<runId>/<stepId>`. Tests: "the branch is deterministic", "the checkout is inside .asterim/worktrees/pipeline", "git has it registered on its own branch"; through the engine, "the first step ran on its own fleet branch".
- [x] **3. Branch chaining propagates predecessor state to dependent steps.** Tests: "the predecessor's file is in the dependent step's checkout" + "with its contents"; "and is branched from its predecessor tip"; "the join chained from both" with both ancestors' files present; end-to-end, "the downstream step read its predecessor's file" (`read:from-implement` in the step's own output).
- [x] **4. Conflict detection identifies merge conflicts between parallel branches before merging.** `analyzeConflicts` (ancestor skip → path-overlap filter → probe merge). Tests: "two steps rewriting the same line do conflict", "the conflicted path is named", "and it names the steps", "two steps that touched different files do not conflict", "a chained pair never conflicts with its own ancestor", "the probe checkout was removed".
- [x] **5. PR synthesis combines passing step branches into a consolidated branch with a summary commit.** Tests: "the branch is named after the run", "and carries both steps", "the tip commit summarizes the run", "the branch has the first step's change" / "and the other step's file"; through the engine and over HTTP as well.
- [x] **6. Step retries execute up to the configured count before failing closed.** Tests: "the run passed on the third attempt", "after three attempts", "each attempt was a session of its own", "with no retries the run fails", "exhausted retries fail the run" + "after every allowed attempt".
- [x] **7. `PipelineTriggerService` triggers runs on `GIT_COMMIT` / `FILE_CHANGE`.** Tests: "a commit started the pipeline watching for one" (run passes, `triggeredBy: GIT_COMMIT`, `commitSha` in the run context), "a burst of file changes started one run" + "exactly one", "a MANUAL pipeline was not started by it", "a commit in another project starts nothing". `SCHEDULE` is covered too, driven through `onScheduleTick` rather than by waiting a minute. Producer wired: `GitService` publishes `git:commit` after a successful commit; `file.changed` is what `WorkspaceMonitor` already publishes and is accepted alongside `workspace:file_change`.
- [x] **8. `/conflicts` and `/synthesize` function with auth and workspace RBAC.** Both refuse anonymous callers (401) and unknown runs (404); `/conflicts` requires `workspace:read`, `/synthesize` requires `workspace:write`. Tests: viewer 200 on read / 403 on write, non-member 403, owner 200.
- [x] **9. `WorktreeFleet.test.ts` passes with comprehensive assertions.** 184 assertions, 0 failures, covering fleet management, chaining, conflicts, synthesis, retries, triggers, REST/RBAC and orphan-freedom.
- [x] **10. Monorepo CI gates pass with 0 errors.** Typecheck 0 errors, lint 0 errors, every test suite green, every workspace builds. See § 4 for the exact commands, and the note there about the root wrappers.

## 6. Git Diff Review

`git diff` reviewed file by file against the criteria above.

- Nothing outside the pipeline subsystem changed except three deliberate, additive touches:
  the `sandbox` field in `AgentDelegationService.provisionWorktree` (needed for a step to run in
  its fleet checkout), the `git:commit` publish in `GitService` (the `GIT_COMMIT` trigger needs a
  producer), and the trigger service's start in `server.ts`.
- No Phase 7 or Phase 8 migration or suite was removed or edited; migration 005 is additive
  columns only, so a P9-01 database still opens (`MigrationEngine` reported "Applied 5
  migration(s)" against a fresh database, and the Phase 8 `GitWorktreeService` and
  `AgentDelegationService` suites still pass unchanged).
- No step execution writes to the primary working tree: every git command in the fleet runs in
  `.asterim/worktrees/pipeline/...`, and the suite asserts a clean `git status --porcelain` and
  an unmoved `main` after each section.
- Nothing deleted outside the `asterim/pipeline/` namespace: `removeStep` and `teardownRun` both
  gate on `isPipelineBranch`, and a test asserts a `asterim/sandbox/...` branch is not one.
- No stray files. `tests/report.md` was already modified in the working tree before this task
  started (it belongs to the orchestrator's test gate) and was left untouched and uncommitted.
- Full suite re-run and all gates re-run after the last edit; nothing was left unverified.

## 7. Problems Discovered

1. **A delegation always sandboxes itself.** `AgentDelegationService.provisionWorktree` branches
   the child from HEAD on `asterim/sandbox/<threadId>`, which defeats chaining — step B would not
   see step A's work. Solved with the optional `DelegationSandbox` on the request, honoured ahead
   of `isolateWorktree` and deliberately excluded from the agent-facing tool argument parsers, so
   a model cannot use it to escape isolation into the operator's checkout.
2. **`git merge-tree` is not portable.** Its output changed shape in 2.38; the older form reports
   conflicts as patch markers, not paths. Replaced with a probe checkout that performs a real
   `git merge --no-commit --no-ff` and reads `--diff-filter=U`, reset between pairs and removed
   in a `finally`.
3. **`GitProvider.exec` discards stdout on a non-zero exit** (it throws with stderr), which is
   another reason a `merge-tree` exit code could not be read reliably. Everything the fleet needs
   from a failing command is fetched by a following command instead.
4. **Foreign keys are enforced** by `node:sqlite` in this database, which the RBAC section of the
   new suite discovered: a `workspace_memberships` row needs `users`, `accounts` and `workspaces`
   rows behind it. The test now creates them.
5. **A flake outside this task.** One run of `pnpm --filter @asterim/mcp-memory-server run test`
   exited non-zero while every assertion in every suite passed (including the last, 24/24); an
   immediate re-run and a direct run of the final suite both exited 0. That package is untouched
   by this task; it looks like a process/port teardown race in the relay end-to-end suite and is
   worth a separate look.

## 8. Architectural Concerns

1. **Fleet checkouts are never reclaimed automatically.** `teardownRun` exists and is tested, but
   the engine does not call it — a step's checkout is the evidence a person reviews, exactly as a
   delegation sandbox is under P8-01. That means `.asterim/worktrees/pipeline/` grows one
   directory per step per run forever. P8-02's `pruneOrphanSandboxes` does not cover this
   namespace. A retention policy (age- or count-based, run at startup next to
   `pipelineEngine.recoverRuns()`) is the natural next decision, and it is a decision for
   Antigravity rather than something to invent here.
2. **A cancelled or crashed run leaves its fleet behind too.** Same mechanism, same fix.
3. **`SCHEDULE` is an interval, not cron.** Five-field cron needs a parser and a timezone policy;
   `every: 30m` covers what a workstation-local pipeline has needed so far. If real cron is
   wanted, it should be a decision with a stated timezone rule.
4. **`git:commit` currently has one producer** — the `git.action` commit path in `GitService`.
   Commits made by an agent inside a sandbox, or by the operator in a terminal, do not publish
   it. A poll-based detector (the `GitService` status poller already runs every three seconds)
   would widen it, but that is a behaviour change worth agreeing first.
5. **`isolateWorktree: false` opts a step out of the fleet**, which means it runs in the project
   directory — the pre-P8-01 behaviour. It is documented in the engine, and no pipeline in the
   repository uses it, but it is the one way a step can touch the operator's checkout.

## 9. Recommended Next Step

Phase 9 Deliverable 4: the dashboard surface for pipelines — a run view showing the DAG, each
step's status, attempt count, branch and diff, with the conflict check and the synthesize action
wired to the two new routes (`blueprint/STORE_ARCHITECTURE.md` scoping: a run belongs under the
project store, and the inspector holds only the selection). Immediately before or alongside it,
a small task for the fleet retention policy in § 8.1 — it is a handful of lines next to
`recoverRuns()` and it stops an unbounded directory from growing while the UI work happens.
