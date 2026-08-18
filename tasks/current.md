Task-ID: P9-03
Phase: 9

# [P9-03] — Pipeline Execution Dashboard, Visual DAG Graph, Step Inspector & PR Synthesis UI

**Task ID:** P9-03  
**Phase:** Phase 9 — Multi-Agent Automated Pipelines & Worktree Fleet Execution  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-18  

---

## 1. Objective

Implement the complete Web UI surface for declarative multi-agent pipelines (Phase 9 Deliverable 4):
1. A dedicated `Pipelines` view tab in the Web dashboard with store state management (`usePipelineStore.ts`).
2. A Visual DAG execution graph (`PipelineDagGraph.tsx`) displaying multi-agent step dependencies, real-time node execution status, retry badges, agent role pills, and duration.
3. A Step Inspector panel (`PipelineStepInspector.tsx`) showing step task briefs, live agent logs, worktree branch/diff artifacts, verification results, and retry attempt histories.
4. A Conflict Analysis & PR Synthesis card (`PipelineSynthesisCard.tsx` / `PipelineSynthesisModal.tsx`) providing one-click Git branch consolidation into `asterim/pipeline/<runId>/pr` with commit summaries.
5. Real-time WebSocket synchronization (`pipeline:*` events) and manual pipeline execution/editor modal.
6. A worktree fleet retention/pruning routine (`pruneOldFleetWorktrees`) on server startup to prevent unbounded disk growth.

---

## 2. Why This Task Exists

As specified in `blueprint/ROADMAP.md` (Phase 9 Deliverable 4), multi-agent engineering pipelines must not remain headless backend processes. Operators need a rich, visual control plane in the dashboard to:
1. Inspect pipeline definitions and trigger manual or parameterized runs.
2. Observe live DAG step transitions, fan-out parallelism, and agent execution across isolated worktrees in real time.
3. Drill into individual step worktree branches (`asterim/pipeline/<runId>/step-<stepId>`), transcripts, and diffs.
4. Verify merge conflict analyses between parallel branches before merging.
5. Trigger one-click "Synthesize Pull Request" consolidating passing step branches into a clean PR branch (`asterim/pipeline/<runId>/pr`).
6. Prevent `.asterim/worktrees/pipeline/` disk sprawl through automated retention pruning on boot.

---

## 3. Context & Architectural Guidance

- **Store Hierarchy (`blueprint/STORE_ARCHITECTURE.md`)**:
  - `usePipelineStore` manages project-scoped pipeline definitions, runs, active run state, conflict analysis, and synthesis outcomes.
  - The inspector panel follows `InspectorStore` conventions: selection state only, with data sourced from `usePipelineStore`.
  - The URL is the single source of truth: support `/workspace/project/:projectId/view/pipelines` in `Router.tsx`.
- **Live Event Handling**:
  - Socket events (`pipeline:started`, `pipeline:step_started`, `pipeline:step_completed`, `pipeline:completed`, `pipeline:failed`) update the store immutably, ensuring live UI animation and progress bar updates without polling.
- **Visual Design System (`blueprint/DESIGN_SYSTEM.md`)**:
  - Monochrome surfaces (`var(--color-surface-1)`, `var(--color-surface-2)`) with emerald accent (`var(--color-accent-primary)`).
  - Status colors: `PASSED` (emerald), `RUNNING` (blue/working pulse), `PENDING` (muted slate), `FAILED` (rose/red), `SKIPPED` (amber/gray), `CANCELLED` (zinc).
  - Clean DAG node layout: layered columns or topological rank with SVG connector lines/arrows.
- **Fail-Closed PR Synthesis & Conflict Inspection**:
  - Conflict analysis displays clean status or detailed list of conflicted file paths.
  - Synthesis allows selecting step subsets (default: all passing steps) and customized commit messages.

---

## 4. Repository Evidence

- `packages/shared/src/types/pipeline.ts` — Core pipeline data models, events (`pipeline:*`), DAG algebra, and helper utilities.
- `apps/server/src/routes/pipelines.ts` — REST API routes (`/api/v1/pipelines`, `/run`, `/pipeline-runs/:id`, `/conflicts`, `/synthesize`, `/cancel`).
- `apps/server/src/services/pipeline/WorktreeFleetService.ts` — Fleet provisioning, conflict detection, PR synthesis, and teardown.
- `apps/server/src/services/pipeline/PipelineEngine.ts` — Multi-step execution engine, run recovery, and lifecycle management.
- `apps/web/src/stores/useViewStore.ts` & `apps/web/src/App.tsx` — Navigation tabs, view switching, and layout.
- `apps/web/src/hooks/useSocket.ts` — Socket.IO event listener infrastructure.
- `apps/web/src/components/teamAgents/__tests__/TeamAgentUI.test.ts` — Reference standard for comprehensive Web UI unit & SSR tests.

---

## 5. Implementation Scope

1. **Web Store (`apps/web/src/stores/usePipelineStore.ts`)**:
   - State: `pipelines`, `activePipelineId`, `runs`, `activeRunId`, `selectedStepId`, `conflictAnalysisByRunId`, `synthesisByRunId`, `loading`, `error`.
   - Actions:
     - `fetchPipelines(projectId, workspaceId?, backendUrl?)`
     - `fetchPipeline(pipelineId, backendUrl?)`
     - `savePipeline({ id?, workspaceId?, yaml }, backendUrl?)`
     - `runPipeline(pipelineId, runContext?, backendUrl?)`
     - `fetchRun(runId, backendUrl?)`
     - `cancelRun(runId, reason?, backendUrl?)`
     - `checkConflicts(runId, backendUrl?)`
     - `synthesizeRun(runId, { stepIds?, message? }, backendUrl?)`
     - `selectStep(stepId)`
     - `handlePipelineEvent(type, payload)` for real-time socket event updates.

2. **View & Navigation Integration**:
   - `apps/web/src/stores/useViewStore.ts`: Add `'pipelines'` to `ViewType` and `availableViews`.
   - `apps/web/src/Router.tsx`: Support `pipelines` view in route synchronization.
   - `apps/web/src/App.tsx`:
     - Add `Pipelines` tab to navigation bar (with icon and keyboard access).
     - Render `<PipelineDashboard />` when `activeTab === 'pipelines'`.
     - Forward socket events in `useSocket.ts` to `handlePipelineEvent`.

3. **Dashboard Components (`apps/web/src/components/pipelines/`)**:
   - `PipelineDashboard.tsx`: Master-detail layout with pipeline list, run history, active run view, and "New Pipeline" / "Run" actions.
   - `PipelineDagGraph.tsx`: Visual DAG graph rendering steps as interactive nodes with role badges, status pills, retry counters (`Attempt X/Y`), and directed dependency edges.
   - `PipelineRunView.tsx`: Active run overview with status header, execution duration, base commit, DAG graph, and action toolbar (Cancel, Check Conflicts, Synthesize PR).
   - `PipelineStepInspector.tsx`: Side drawer / panel inspecting the selected step (task brief, worktree branch name, commit SHA, stdout/agent transcript, diff, verification results, retry history).
   - `PipelineSynthesisModal.tsx` / `PipelineConflictCard.tsx`: Conflict detection review and PR branch synthesis dialog with commit message input.
   - `PipelineEditorModal.tsx`: YAML pipeline editor with syntax validation and preset template selector.

4. **Fleet Worktree Retention Pruner (`apps/server`)**:
   - Add `pruneOldFleetWorktrees(maxAgeMs?: number)` in `WorktreeFleetService.ts` / `PipelineEngine.ts`.
   - Call during boot sequence in `apps/server/src/server.ts` alongside `pruneOrphanSandboxes()`.

5. **Automated Unit & Integration Test Suite (`apps/web/src/components/pipelines/__tests__/PipelineUI.test.ts`)**:
   - Pure DAG helper and layout computation assertions.
   - Store actions against mocked HTTP fetch (list, get, run, cancel, conflicts, synthesize).
   - Real-time socket event reducer tests (`pipeline:started`, `pipeline:step_started`, `pipeline:step_completed`, `pipeline:completed`, `pipeline:failed`).
   - Static component rendering tests via `react-dom/server` across pending, running, passed, failed, and conflict states.
   - Wire test suite into `apps/web/package.json` `"test"` script.

---

## 6. Explicitly Forbidden Changes

- Do NOT alter or break existing Phase 7 or Phase 8 functionality (Release channels, Team agents, Worktree delegations).
- Do NOT introduce bulky 3rd-party graph libraries (e.g. `reactflow`); keep DAG layout lightweight, accessible, and native SVG/CSS based.
- Do NOT perform unapproved git operations against the operator's primary branch during PR synthesis.

---

## 7. Acceptance Criteria

1. `usePipelineStore.ts` provides complete project-scoped pipeline and run state management with REST actions and immutable socket event handling.
2. `ViewType` in `useViewStore.ts` and `Router.tsx` includes `'pipelines'`, and the navigation tab in `App.tsx` switches seamlessly to the Pipelines dashboard.
3. `PipelineDagGraph.tsx` renders DAG steps with accurate dependency edges, role pills, status styling, and retry attempt counters.
4. `PipelineStepInspector.tsx` enables full inspection of step briefs, output transcripts, diff artifacts, branch names, and verification outcomes.
5. Conflict analysis and PR synthesis UI correctly displays merge conflict statuses and triggers `/api/v1/pipeline-runs/:id/synthesize` to create consolidated PR branches.
6. `PipelineEditorModal.tsx` allows creating and editing valid YAML pipeline definitions with inline error reporting.
7. Fleet worktree retention pruning runs cleanly on server startup to reclaim stale pipeline checkouts.
8. `PipelineUI.test.ts` passes with comprehensive assertions covering stores, socket reducers, DAG layouts, and component rendering.
9. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`.

---

## 8. Definition of Done

- [ ] `usePipelineStore.ts` created and integrated with `useSocket.ts`
- [ ] `ViewType` and navigation tabs updated for `'pipelines'`
- [ ] `PipelineDashboard`, `PipelineDagGraph`, `PipelineStepInspector`, `PipelineSynthesisModal`, `PipelineEditorModal` created in `apps/web/src/components/pipelines/`
- [ ] Fleet worktree retention cleanup hooked into `server.ts`
- [ ] `PipelineUI.test.ts` created and added to `apps/web/package.json` `"test"` script
- [ ] All monorepo verification commands pass cleanly (0 errors)

---

## 9. Verification Commands

```bash
# Run new Pipeline UI test suite
pnpm --filter @asterim/web exec tsx src/components/pipelines/__tests__/PipelineUI.test.ts

# Run web workspace test battery
pnpm --filter @asterim/web run test

# Run server pipeline tests
pnpm --filter asterim exec tsx src/services/pipeline/__tests__/WorktreeFleet.test.ts
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
2. Verify that DAG rendering handles single-step, sequential chain, parallel fan-out, and diamond dependency graphs cleanly.
3. Verify that real-time socket events seamlessly transition node states from PENDING -> RUNNING -> PASSED/FAILED.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.

