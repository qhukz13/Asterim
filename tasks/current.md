Task-ID: P9-01
Phase: 9

# [P9-01] — Declarative Pipeline Engine, Schema & Multi-Step Execution Controller

**Task ID:** P9-01  
**Phase:** Phase 9 — Multi-Agent Automated Pipelines & Worktree Fleet Execution  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-18  

---

## 1. Objective

Implement the Declarative Pipeline Engine and Multi-Step Execution Controller in `apps/server`: add SQL migration `003_pipelines.sql`, author `PipelineParser.ts` for validating declarative YAML pipeline DAGs (`.asterim/pipelines/*.yaml`), author `PipelineEngine.ts` to coordinate sequential and parallel multi-agent step execution with context handoff, expose authenticated REST endpoints under `/api/v1/pipelines` and `/api/v1/pipeline-runs`, and author a comprehensive automated test suite.

---

## 2. Why This Task Exists

As specified in `blueprint/ROADMAP.md` (Phase 9), software engineering involves complex multi-stage tasks (e.g. Feature Implementation → Unit Test Generation → Security Audit → Documentation Synthesis). While Phase 7 and Phase 8 enabled ad-hoc delegation and shared team agent chat, engineering teams require automated, repeatable, event-driven pipelines where multiple specialized agent personas collaborate across a structured Directed Acyclic Graph (DAG).

---

## 3. Context & Architecture

- **Declarative Pipeline Specifications**:
  - Declarative YAML definitions declaring trigger, parameters, and DAG steps with explicit dependencies (`dependsOn`).
- **DAG Execution Controller (`PipelineEngine`)**:
  - Computes topological sort of pipeline steps.
  - Executes independent steps concurrently and dependent steps sequentially.
  - Passes accumulated context and file diffs from ancestor steps to descendant steps.
  - Fail-closed: Step failure halts pipeline execution and cleans up ephemeral resources.
- **Local-First Sovereignty (`DEC-028`)**:
  - All pipeline definitions, runs, step logs, and diffs reside in local SQLite.

---

## 4. Implementation Scope

1. **SQL Migration (`packages/server/src/migrations/003_pipelines.sql`)**:
   - `pipelines`: `id TEXT PRIMARY KEY`, `workspace_id TEXT`, `name TEXT NOT NULL`, `description TEXT`, `yaml_content TEXT NOT NULL`, `created_at INTEGER NOT NULL`, `updated_at INTEGER NOT NULL`.
   - `pipeline_runs`: `id TEXT PRIMARY KEY`, `pipeline_id TEXT NOT NULL`, `status TEXT NOT NULL DEFAULT 'PENDING'`, `current_step_id TEXT`, `run_context_json TEXT NOT NULL DEFAULT '{}'`, `started_at INTEGER NOT NULL`, `completed_at INTEGER`, `error_message TEXT`, `FOREIGN KEY(pipeline_id) REFERENCES pipelines(id) ON DELETE CASCADE`.
   - `pipeline_step_runs`: `id TEXT PRIMARY KEY`, `pipeline_run_id TEXT NOT NULL`, `step_id TEXT NOT NULL`, `step_name TEXT NOT NULL`, `role_profile_id TEXT NOT NULL`, `status TEXT NOT NULL DEFAULT 'PENDING'`, `thread_id TEXT`, `worktree_path TEXT`, `diff TEXT`, `output TEXT`, `started_at INTEGER`, `completed_at INTEGER`, `error_message TEXT`, `FOREIGN KEY(pipeline_run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE`.
   - Indexes: `idx_pipeline_runs_pipeline`, `idx_pipeline_step_runs_run`.

2. **Shared Types (`packages/shared/src/types/pipeline.ts`)**:
   - `PipelineDefinition`, `PipelineStep`, `PipelineTriggerType` (`MANUAL` | `GIT_COMMIT` | `FILE_CHANGE` | `SCHEDULE`), `PipelineRun`, `PipelineStepRun`, `PipelineRunStatus` (`PENDING` | `RUNNING` | `PASSED` | `FAILED` | `CANCELLED`), `PipelineStepStatus` (`PENDING` | `RUNNING` | `PASSED` | `FAILED` | `SKIPPED` | `CANCELLED`).
   - Export from `packages/shared/src/index.ts`.

3. **`PipelineParser.ts` (`apps/server/src/services/pipeline/PipelineParser.ts`)**:
   - Safe YAML parsing of pipeline definitions.
   - DAG validation: checks for unique step IDs, valid `roleProfileId` references, and absence of cyclic dependencies.

4. **`PipelineEngine.ts` (`apps/server/src/services/pipeline/PipelineEngine.ts`)**:
   - `runPipeline(pipelineId: string, runContext?: Record<string, any>): Promise<PipelineRun>`:
     - Persists `pipeline_runs` row and `pipeline_step_runs` rows.
     - Resolves executable steps (steps whose `dependsOn` dependencies have PASSED).
     - Spawns agent sessions for ready steps, passes accumulated context, and captures outputs.
     - Advances DAG until all steps complete (PASSED) or any step fails (FAILED).
   - `cancelPipeline(runId: string): Promise<boolean>`: Halts all running step threads.
   - Emits Socket.IO events: `pipeline:started`, `pipeline:step_started`, `pipeline:step_completed`, `pipeline:completed`, `pipeline:failed`.

5. **REST API Endpoints (`apps/server/src/routes/pipelines.ts`)**:
   - `POST /api/v1/pipelines` — Save / validate pipeline definition.
   - `GET /api/v1/pipelines` — List pipelines for workspace.
   - `GET /api/v1/pipelines/:id` — Get pipeline definition.
   - `POST /api/v1/pipelines/:id/run` — Trigger pipeline execution (`{ runContext? }`).
   - `GET /api/v1/pipeline-runs/:id` — Get execution run status and step progress.
   - `POST /api/v1/pipeline-runs/:id/cancel` — Cancel active run.
   - Register in `apps/server/src/server.ts`.

6. **Automated Unit & Integration Test Suite (`apps/server/src/services/pipeline/__tests__/PipelineEngine.test.ts`)**:
   - Test YAML pipeline parsing and DAG cycle detection.
   - Test sequential multi-step execution (Step 1 → Step 2 with context handoff).
   - Test parallel step execution for independent DAG nodes.
   - Test step failure halting downstream steps.
   - Test cancellation cascading to running step threads.
   - Wire into `apps/server/package.json` `"test"` script.

---

## 5. Constraints & Forbidden Changes

- Cyclic DAG dependencies must be rejected before execution begins.
- Step failures must halt the pipeline cleanly without leaving orphaned processes.
- Maintain 100% test pass rate across all existing monorepo test suites.

---

## 6. Acceptance Criteria

1. Migration `003_pipelines.sql` applies cleanly via `MigrationEngine`.
2. `PipelineParser` correctly validates YAML pipeline definitions and rejects cyclic DAG dependencies.
3. `PipelineEngine` executes sequential and parallel steps according to DAG topology.
4. Outputs and context from completed steps are passed to downstream dependent steps.
5. Authenticated REST endpoints under `/api/v1/pipelines` and `/api/v1/pipeline-runs` function correctly.
6. `PipelineEngine.test.ts` passes with comprehensive DAG and execution assertions.
7. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`.

---

## 7. Definition of Done

- [ ] `003_pipelines.sql` created and verified
- [ ] Shared pipeline types in `@asterim/shared`
- [ ] `PipelineParser.ts` implemented
- [ ] `PipelineEngine.ts` implemented
- [ ] REST routes registered in `server.ts`
- [ ] `PipelineEngine.test.ts` created and passing
- [ ] Monorepo CI gates pass cleanly

---

## 8. Verification Commands

```bash
# Run new Pipeline Engine test suite
pnpm --filter asterim exec tsx src/services/pipeline/__tests__/PipelineEngine.test.ts

# Run all AI, delegation & team agent test suites
pnpm --filter asterim exec tsx src/services/ai/__tests__/TeamAgentService.test.ts
pnpm --filter asterim exec tsx src/services/ai/__tests__/AgentDelegationService.test.ts

# Run full monorepo CI validation
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 9. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
