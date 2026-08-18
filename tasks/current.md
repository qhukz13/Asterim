Task-ID: P9-02
Phase: 9

# [P9-02] — Worktree Fleet Orchestrator, Step Retries & Trigger Listeners

**Task ID:** P9-02  
**Phase:** Phase 9 — Multi-Agent Automated Pipelines & Worktree Fleet Execution  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-18  

---

## 1. Objective

Implement the Worktree Fleet Orchestrator (`WorktreeFleetService.ts` / `PipelineWorktreeFleet.ts`), step-level retry mechanisms in `PipelineEngine.ts`, automated branch chaining and conflict detection across concurrent step worktrees, PR branch synthesis, and event-driven pipeline trigger listeners (`PipelineTriggerService.ts`) for `GIT_COMMIT`, `FILE_CHANGE`, and `SCHEDULE` triggers in `apps/server`.

---

## 2. Why This Task Exists

As defined in `blueprint/ROADMAP.md` (Phase 9 Deliverable 2 & Deliverable 3), multi-agent engineering pipelines must operate across isolated, concurrent Git worktrees where:
1. Sequential steps build cumulatively on predecessor changes (branch chaining from ancestor step commits).
2. Parallel fan-out steps can be analyzed for merge conflicts prior to joining or final merge.
3. Steps support resilient retry policies (`retries`, `retryDelayMs`) before triggering fail-closed aborts.
4. Passing pipeline runs can synthesize a consolidated, mergeable PR branch (`asterim/pipeline/<runId>/pr`) with structured commit attribution.
5. Pipelines can trigger automatically on repository events (`GIT_COMMIT`, `FILE_CHANGE`, `SCHEDULE`) rather than solely via manual REST triggers.

---

## 3. Context & Architecture

- **Worktree Fleet & Branch Isolation**:
  - Sandboxes use structured branch refs: `asterim/pipeline/<runId>/step-<stepId>`.
  - Dependent steps branch from their direct ancestor's settled commit/branch rather than the repository HEAD, allowing downstream steps to inspect and refine upstream code changes.
  - Conflict Detection: When parallel steps modify overlapping files, detect merge conflicts cleanly via git 3-way merge inspection (`git merge-tree` or dry-run merge) before attempting final consolidation.
- **PR Synthesis**:
  - A successful pipeline run can synthesize its passing worktree branches into a clean target branch (`asterim/pipeline/<runId>/pr`) with an auto-generated summary commit.
- **Step Retry Resilience**:
  - `PipelineStep` accepts `retries` (integer >= 0, default 0, max 3) and `retryDelayMs` (default 0).
  - If a step execution fails, it is retried up to `retries` times before marking the step `FAILED` and halting the pipeline.
- **Event-Driven Trigger Listeners (`PipelineTriggerService`)**:
  - Subscribes to `EventBus` events (`git:commit`, `workspace:file_change`) and scheduled intervals, matching active pipeline definitions by project and trigger configuration to spawn automated runs.

---

## 4. Repository Evidence

- `packages/shared/src/types/pipeline.ts` — Core pipeline data models, DAG algebra, and event types.
- `apps/server/src/services/pipeline/PipelineEngine.ts` — Multi-step execution controller and DAG dispatcher.
- `apps/server/src/services/pipeline/PipelineParser.ts` & `SafeYaml.ts` — YAML parser and DAG validator.
- `apps/server/src/services/git/GitWorktreeService.ts` — Underlying worktree provisioning, diffing, and merging.
- `apps/server/src/services/git/GitProvider.ts` — Git CLI wrapper.
- `apps/server/src/services/EventBus.ts` — Monorepo event bus singleton.

---

## 5. Implementation Scope

1. **Shared Types (`packages/shared/src/types/pipeline.ts`)**:
   - Add `retries?: number` and `retryDelayMs?: number` to `PipelineStep`.
   - Add types for conflict detection: `PipelineConflictAnalysis` (`hasConflicts: boolean`, `conflictedFiles: string[]`, `branches: string[]`).
   - Add types for PR synthesis: `PipelineSynthesisRequest`, `PipelineSynthesisResult` (`branchName: string`, `commitSha: string`, `mergedStepIds: string[]`).
   - Add event payload types for triggers: `PipelineTriggerEvent`.

2. **Parser & YAML Updates (`apps/server/src/services/pipeline/PipelineParser.ts`, `SafeYaml.ts`)**:
   - Support `retries` (0-3) and `retryDelayMs` (0-60000) parsing and validation in pipeline YAML definitions.

3. **Worktree Fleet Orchestration & Branch Chaining (`apps/server/src/services/pipeline/WorktreeFleetService.ts`)**:
   - Provision step worktrees with branch naming `asterim/pipeline/<runId>/step-<stepId>`.
   - Support branch chaining: when step B depends on step A, initialize step B's worktree from step A's branch ref.
   - Implement conflict detection: analyze concurrent/parallel step branches for overlapping modified files and 3-way merge conflicts using `GitProvider`.
   - Implement PR synthesis: combine passing step branches into a consolidated branch (e.g. `asterim/pipeline/<runId>/pr`) with a commit message summarizing step outcomes.

4. **Step Retries in `PipelineEngine.ts`**:
   - Integrate `WorktreeFleetService` into `PipelineEngine.ts` for step worktree provisioning and branch chaining.
   - Implement step retry loop: on step failure, if `retries > 0` and attempts remain, re-dispatch after `retryDelayMs` before recording a final `FAILED` status.

5. **Pipeline Trigger Service (`apps/server/src/services/pipeline/PipelineTriggerService.ts`)**:
   - Listen for `GIT_COMMIT` and `FILE_CHANGE` events on `EventBus`.
   - Support cron / interval timers for `SCHEDULE` triggers.
   - Match event project/workspace to configured pipeline definitions and trigger `PipelineEngine.runPipeline(...)`.

6. **REST API Extensions (`apps/server/src/routes/pipelines.ts`)**:
   - `GET /api/v1/pipeline-runs/:id/conflicts` — Check for merge conflicts across step worktrees.
   - `POST /api/v1/pipeline-runs/:id/synthesize` — Synthesize consolidated PR branch from passing step worktrees.
   - Register any new endpoints and trigger listeners in `apps/server/src/server.ts`.

7. **Automated Unit & Integration Test Suite (`apps/server/src/services/pipeline/__tests__/WorktreeFleet.test.ts`)**:
   - Test step worktree provisioning and branch naming.
   - Test sequential branch chaining (Step B sees Step A's changes in its worktree).
   - Test conflict detection between parallel branches modifying the same file lines.
   - Test PR branch synthesis consolidating multi-step changes into a single clean commit.
   - Test step retry resilience (transient failure retries up to configured limit).
   - Test trigger listener dispatching pipeline runs on git commit / file change events.
   - Wire test suite into `apps/server/package.json` `"test"` script.

---

## 6. Explicitly Forbidden Changes

- Do NOT remove or break any existing Phase 7 or Phase 8 migration or test suite.
- Do NOT modify the primary working tree directly during step execution; all changes must remain isolated in `.asterim/worktrees/` until explicit synthesis/merge.
- Maintain 100% test pass rate across all existing monorepo test suites.

---

## 7. Acceptance Criteria

1. `PipelineStep` supports `retries` and `retryDelayMs` in YAML definition, validated by `PipelineParser`.
2. `WorktreeFleetService` creates isolated step worktrees with deterministic branch naming (`asterim/pipeline/<runId>/step-<stepId>`).
3. Branch chaining correctly propagates predecessor branch state to dependent downstream steps.
4. Conflict detection accurately identifies merge conflicts between parallel step branches before merging.
5. PR synthesis cleanly combines passing step branches into a consolidated Git branch with a summary commit.
6. Step retries execute up to the configured retry count on failure before failing closed.
7. `PipelineTriggerService` automatically triggers pipeline runs on `GIT_COMMIT` / `FILE_CHANGE` events.
8. REST endpoints `/api/v1/pipeline-runs/:id/conflicts` and `/api/v1/pipeline-runs/:id/synthesize` function with auth and workspace RBAC.
9. `WorktreeFleet.test.ts` passes with comprehensive assertions covering fleet management, chaining, conflicts, retries, and triggers.
10. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`.

---

## 8. Definition of Done

- [ ] Shared pipeline types updated in `@asterim/shared`
- [ ] `PipelineParser.ts` validates `retries` and `retryDelayMs`
- [ ] `WorktreeFleetService.ts` implemented with branch chaining, conflict detection, and PR synthesis
- [ ] `PipelineEngine.ts` integrated with worktree fleet and step retries
- [ ] `PipelineTriggerService.ts` implemented for event-driven triggers
- [ ] REST routes and `server.ts` updated
- [ ] `WorktreeFleet.test.ts` created and passing
- [ ] Monorepo CI gates pass cleanly (0 errors)

---

## 9. Verification Commands

```bash
# Run new Worktree Fleet test suite
pnpm --filter asterim exec tsx src/services/pipeline/__tests__/WorktreeFleet.test.ts

# Run existing Pipeline Engine test suite
pnpm --filter asterim exec tsx src/services/pipeline/__tests__/PipelineEngine.test.ts

# Run full monorepo CI validation
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 10. Self-Review Requirements

1. Review `git diff` against all acceptance criteria before authoring the report.
2. Confirm zero orphaned worktrees or dangling temporary branches are left behind by tests.
3. Confirm fail-closed guarantees: unresolvable merge conflicts or exhausted retries halt the pipeline cleanly.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
