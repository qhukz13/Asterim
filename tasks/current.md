Task-ID: P7-04
Phase: 7

# [P7-04] — Multi-Agent Parallel Delegation, Concurrent Fan-Out & Aggregated Workflow Orchestration

**Task ID:** P7-04  
**Phase:** Phase 7 — Multi-Agent Orchestration & Collaborative Workflows  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-16  

---

## 1. Objective

Extend the Asterim Multi-Agent Delegation subsystem to support parallel, concurrent subagent delegations (fan-out / fan-in) bounded by a concurrency guard (`MAX_CONCURRENT_DELEGATIONS = 4` per parent thread). Implement the `delegate_parallel` meta-tool and parallel REST endpoints in `apps/server`, orchestrate concurrent child sessions, aggregate multiple child outcomes into structured batch results (`BatchDelegationResult`), support per-child and batch-wide cancellation (`cancelAllDelegations`), and upgrade the Web UI (`DelegationWaitingBanner`, `ThreadTree`, and multi-agent outcome cards) for live parallel supervision.

---

## 2. Why This Task Exists

Tasks P7-01, P7-02, and P7-03 established the single-child delegation lifecycle (dispatch, supervision, intervention). However, real-world engineering workflows require parallel collaboration: a Lead Architect decomposing a complex feature into simultaneous Backend and Frontend subtasks, or requesting concurrent security, performance, and QA reviews across specialized agent personas.

Currently, `AgentDelegationService` enforces `ALREADY_DELEGATING` whenever a second delegation is initiated from a parked parent. By enabling bounded concurrent fan-out and structured fan-in aggregation, Asterim unlocks scalable multi-agent teamwork while maintaining strict process safety and complete observability.

---

## 3. Context & Architecture

- **Concurrency Limits & Recursion Guards (`packages/shared/src/types/delegation.ts`)**:
  - `MAX_CONCURRENT_DELEGATIONS = 4` (maximum simultaneous active children per parent thread).
  - Existing `MAX_DELEGATION_DEPTH = 3` remains strictly enforced for every child in a parallel batch.
  - New `DELEGATE_PARALLEL_TOOL = 'delegate_parallel'` added to `DELEGATION_TOOL_NAMES` and `DELEGATION_TOOL_DEFINITIONS`.
- **Delegation Service Refactor (`apps/server/src/services/ai/AgentDelegationService.ts`)**:
  - Transition active delegation tracking to support multiple concurrent children per parent (e.g. `private active = new Map<parentThreadId, Map<childThreadId, ActiveDelegation>>()` or equivalent multi-child registry).
  - Implement `delegateParallel(request: ParallelDelegationRequest): Promise<BatchDelegationResult>`:
    - Validates batch size (`1 <= items.length <= MAX_CONCURRENT_DELEGATIONS`).
    - Spawns all child sessions concurrently via `this.runner.start()`.
    - Watches all children concurrently via `Promise.allSettled()`.
    - Settles individual records in `threads.delegation_context_json`.
    - Resumes parent session with an aggregated summary and outcome matrix once all children finish.
  - Support `cancelAllDelegations(parentThreadId: string, reason?: string)` alongside existing per-child `cancelDelegation`.
- **Web UI & Store (`apps/web/src/stores/useProjectStore.ts`, `apps/web/src/components/delegation/`)**:
  - `useProjectStore`: Track multiple pending children per parent (`pendingChildren: Record<string, string[]>`), handle multi-child socket updates, and store batch outcome summaries.
  - `DelegationWaitingBanner`: Render multi-child progress (e.g. "Waiting on 3 subagents: Senior Backend (Active), Frontend Reviewer (Starting), QA (Completed)") with individual Stop controls and a "Cancel All" action.
  - `ThreadTree`: Render multiple sibling child threads under a common parent cleanly with independent status indicators and stop controls.
  - `DelegationOutcomeCard`: Support rendering aggregated multi-agent cards with tabs/breakdown for each child's output and overall review verdict.

---

## 4. Repository Evidence

Key files to inspect before implementing:
- `packages/shared/src/types/delegation.ts` — Existing delegation types, constants, tool definitions, and verdict parsers.
- `apps/server/src/services/ai/AgentDelegationService.ts` — Active registry, `delegateTask`, `cancelDelegation`, `watchChild`, `buildResult`.
- `apps/server/src/routes/delegation.ts` — REST endpoints for delegation lifecycle.
- `apps/server/src/services/ai/__tests__/AgentDelegationService.test.ts` — Existing 279 server assertions.
- `apps/web/src/stores/useProjectStore.ts` — Store actions (`cancelDelegation`, `syncDelegations`, delegation event handlers).
- `apps/web/src/components/delegation/DelegationStatus.tsx` — Waiting banner and outcome card rendering.
- `apps/web/src/components/delegation/ThreadTree.tsx` — Hierarchy tree rows and action pills.
- `apps/web/src/components/delegation/__tests__/DelegationUI.test.ts` — Existing 209 web assertions.

---

## 5. Implementation Scope

1. **Shared Contract Extensions (`packages/shared/src/types/delegation.ts`)**:
   - Add `MAX_CONCURRENT_DELEGATIONS = 4`.
   - Add `ParallelDelegationItem`: `{ targetRole?: string; profileId?: string; taskDescription: string; inputContext?: string; timeoutMs?: number; kind?: DelegationKind; reviewCriteria?: string[] }`.
   - Add `ParallelDelegationRequest`: `{ parentThreadId: string; delegations: ParallelDelegationItem[] }`.
   - Add `BatchDelegationResult`: `{ parentThreadId: string; overallStatus: DelegationStatus | 'PARTIAL_SUCCESS'; results: DelegationResult[]; aggregatedVerdict?: ReviewVerdict; summary: string; startedAt: number; finishedAt: number }`.
   - Add `DELEGATE_PARALLEL_TOOL` (`delegate_parallel`) tool definition allowing orchestrator/architect profiles to dispatch multiple concurrent subtasks.

2. **Core Server Parallel Orchestration (`apps/server/src/services/ai/AgentDelegationService.ts`)**:
   - Refactor internal active delegation registry to support multiple concurrent children per parent.
   - Implement `delegateParallel(request: ParallelDelegationRequest): Promise<BatchDelegationResult>`:
     - Validate input, role profiles, and depth constraints for all items.
     - Reject with `CONCURRENCY_LIMIT_EXCEEDED` if batch size or total active children exceeds `MAX_CONCURRENT_DELEGATIONS`.
     - Create SQLite child thread records and dispatch child sessions in parallel.
     - Emit `delegation.parent_state` (`WAITING_FOR_CHILD`) and `delegation.started` for each child.
     - Await completion of all children using `Promise.allSettled()`, ensuring unhandled rejections are caught.
     - Aggregate individual `DelegationResult` objects into `BatchDelegationResult`:
       - `overallStatus`: `'COMPLETED'` if all succeed, `'PARTIAL_SUCCESS'` if at least one succeeds and others fail/timeout, `'FAILED'` if all fail.
       - `aggregatedVerdict`: `'PASS'` if all review delegations pass, `'NEEDS_FIX'` if any review delegation fails.
     - Format concise aggregated resume prompt for parent session.
     - Emit `delegation.completed` and transition parent state back to `'ACTIVE'`.
   - Implement `cancelAllDelegations(parentThreadId: string, reason?: string)`:
     - Iterates through all active children under `parentThreadId`, stops child processes via `safeStop`, marks child records as `FAILED`, and releases the parent.

3. **REST API Extensions (`apps/server/src/routes/delegation.ts`)**:
   - Add route `POST /api/v1/threads/:id/delegate/parallel` (and alias `/delegation/parallel`): dispatches parallel delegation batch.
   - Add route `POST /api/v1/threads/:id/delegate/cancel-all` (and alias `/delegation/cancel-all`): cancels all active child delegations for a parent.

4. **Web Store & Real-Time Synchronization (`apps/web/src/stores/useProjectStore.ts`)**:
   - Update `useProjectStore` to track multiple pending children per parent thread (`pendingChildren: Record<string, string[]>`).
   - Add store actions `delegateParallel` and `cancelAllDelegations`.
   - Handle socket events to update individual child states and aggregated parent status dynamically.

5. **Web UI Components (`apps/web/src/components/delegation/`)**:
   - **`DelegationStatus.tsx` (`DelegationWaitingBanner`)**:
     - Support rendering multiple in-flight child sessions with individual role tags, status pills, and stop buttons.
     - Add "Cancel All" batch intervention button.
   - **`DelegationStatus.tsx` (`DelegationOutcomeCard`)**:
     - Render multi-agent outcome view with a summary card, overall verdict, and expandable details/artifacts for each child.
   - **`ThreadTree.tsx`**:
     - Ensure tree rendering cleanly organizes multiple child sibling nodes with correct indentation and active indicators.

6. **Automated Unit & Integration Test Suites**:
   - **Server tests in `apps/server/src/services/ai/__tests__/AgentDelegationService.test.ts`**:
     - Test parallel delegation spawning 2–4 children simultaneously.
     - Test concurrency limit rejection when exceeding `MAX_CONCURRENT_DELEGATIONS`.
     - Test aggregated outcome building (all pass, mixed success/failure, timeout).
     - Test aggregated review verdict calculation (`ALL PASS` vs `NEEDS_FIX`).
     - Test cancelling an individual child while siblings continue running.
     - Test `cancelAllDelegations` aborting all concurrent children and unparking parent cleanly.
   - **Web tests in `apps/web/src/components/delegation/__tests__/DelegationUI.test.ts`**:
     - Test rendering waiting banner with multiple concurrent children.
     - Test "Cancel All" button and multi-child state transitions.
     - Test rendering batch outcome card with aggregated metrics.

---

## 6. Explicitly Forbidden Changes

- Do NOT break backwards compatibility for single `delegateTask` (`delegate_task`) calls or existing `delegation.*` socket events.
- Do NOT exceed `MAX_CONCURRENT_DELEGATIONS = 4` per parent thread.
- Do NOT leave orphaned child subprocesses or dangling EventBus subscriptions upon partial or total cancellation.
- Do NOT hardcode colors; use CSS tokens from `apps/web/src/styles/tokens.css`.
- Do NOT break any existing test suites (all 36 suites must remain green).

---

## 7. Acceptance Criteria

1. `AgentDelegationService.delegateParallel()` concurrently spawns, monitors, and aggregates multiple child subagents (up to 4) under a single parent thread.
2. Exceeding `MAX_CONCURRENT_DELEGATIONS` (4) is rejected with an explicit error code.
3. `delegate_parallel` meta-tool is available to orchestrator/architect agent profiles.
4. Aggregated `BatchDelegationResult` correctly computes overall status (`COMPLETED`, `PARTIAL_SUCCESS`, `FAILED`) and unified review verdict (`PASS` vs `NEEDS_FIX`).
5. REST endpoints `POST /api/v1/threads/:id/delegate/parallel` and `POST /api/v1/threads/:id/delegate/cancel-all` function cleanly with proper authentication and validation.
6. `DelegationWaitingBanner` displays all active concurrent child subagents with per-child status and provides both per-child "Stop" and batch "Cancel All" actions.
7. `ChatView` renders aggregated multi-agent outcome cards with breakdowns of each child subagent's results and artifacts.
8. All unit and integration test assertions in `AgentDelegationService.test.ts` and `DelegationUI.test.ts` pass cleanly.
9. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`.

---

## 8. Definition of Done

- [ ] Shared parallel delegation types and `delegate_parallel` tool defined in `@asterim/shared`
- [ ] `delegateParallel` and `cancelAllDelegations` implemented in `AgentDelegationService.ts`
- [ ] Parallel delegation REST routes added to `routes/delegation.ts`
- [ ] Store actions and multi-child state tracking added to `useProjectStore.ts`
- [ ] Multi-agent waiting banner, outcome card, and tree updates in `apps/web`
- [ ] Server parallel delegation unit tests authored and green
- [ ] Web parallel delegation unit tests authored and green
- [ ] All 36+ monorepo test suites and full build clean

---

## 9. Verification Commands

```bash
# Run web unit tests
pnpm --filter @asterim/web test

# Run server delegation unit tests
pnpm --filter asterim exec tsx src/services/ai/__tests__/AgentDelegationService.test.ts

# Run full monorepo CI battery
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 10. Self-Review Requirements

- Execute the complete verification loop: `tsc --noEmit` -> `pnpm lint` -> `pnpm test` -> `pnpm build`.
- Check `git diff` against all acceptance criteria before writing the final report.
- Verify no subprocesses or event listeners are orphaned during parallel cancellation.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
