Task-ID: P7-05
Phase: 7

# [P7-05] — Operator-Initiated Multi-Agent Parallel Batch Delegation & Modal Workflow Dispatch

**Task ID:** P7-05  
**Phase:** Phase 7 — Multi-Agent Orchestration & Collaborative Workflows  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-16  

---

## 1. Objective

Extend the Asterim Dashboard delegation interface (`DelegateModal`) to support operator-initiated parallel multi-agent delegation batches (fan-out of 2 to 4 concurrent subagent tasks). Provide an interactive multi-item batch builder allowing operators to configure distinct target roles, task descriptions, and supporting contexts per subagent; enforce `MAX_CONCURRENT_DELEGATIONS = 4` with dynamic item addition and removal; integrate with `useProjectStore.delegateParallel` and `POST /api/v1/threads/:id/delegate/parallel`; surface real-time validation and error states; and add unit test coverage in `DelegationUI.test.ts`.

---

## 2. Why This Task Exists

In task P7-04, the Core server engine, REST API (`POST .../delegate/parallel`), socket events (`delegation.batch_completed`), and store actions (`delegateParallel`) for bounded parallel fan-out were implemented and verified. However, `DelegateModal` currently only composes single-agent delegations (`TASK` vs `REVIEW`). 

To make multi-agent parallel orchestration accessible directly to human operators without requiring agent meta-tools or manual curl commands, `DelegateModal` must provide a first-class parallel batch composition mode. This completes the end-to-end operator experience for Phase 7 parallel workflows.

---

## 3. Context & Architecture

- **Shared Delegation Types (`packages/shared/src/types/delegation.ts`)**:
  - `MAX_CONCURRENT_DELEGATIONS = 4` (upper bound on simultaneous active children per parent thread).
  - `ParallelDelegationItem`: `{ targetRole?: string; profileId?: string; taskDescription: string; inputContext?: string; timeoutMs?: number; kind?: DelegationKind; reviewCriteria?: string[] }`.
  - `ParallelDelegationRequest`: `{ parentThreadId: string; delegations: ParallelDelegationItem[] }`.
- **Web Store Actions (`apps/web/src/stores/useProjectStore.ts`)**:
  - `delegateParallel: (projectId: string, parentThreadId: string, delegations: ParallelDelegationItem[]) => Promise<boolean>` calling `POST /api/v1/threads/:id/delegate/parallel`.
- **Web Modal Component (`apps/web/src/components/delegation/DelegateModal.tsx`)**:
  - Extend `DelegateModalMode`: `'TASK' | 'REVIEW' | 'PARALLEL'`.
  - In `PARALLEL` mode, render a dynamic list of subagent configuration rows (minimum 2, maximum `MAX_CONCURRENT_DELEGATIONS = 4`).
  - Each item row allows configuring:
    - Target Role / Profile (`profileId` dropdown with available roles).
    - Task description (textarea).
    - Context / input instructions (optional textarea).
  - Provide "+ Add Subagent" button (disabled when item count equals 4) and a removal control ("Remove" / "×") for each row (disabled when item count equals 2).
  - Form validation: Every subagent row must have a non-empty task description.
  - Submitting invokes `delegateParallel` (or direct API call) and automatically closes the modal when socket updates confirm child session dispatches.
  - Design aesthetic: Strictly follow design tokens (`tokens.css`), dark monochrome theme with emerald accents, and zero hardcoded colors.

---

## 4. Repository Evidence

Key files to inspect before implementing:
- `apps/web/src/components/delegation/DelegateModal.tsx` — Current single-delegation modal implementation, `roleOptionsFrom`, `canSubmitDelegation`, `buildDelegationBody`, `DelegateModalView`, `DelegateModal`.
- `apps/web/src/stores/useProjectStore.ts` — `delegateParallel` action, `pendingChildren`, `batchOutcomes`.
- `packages/shared/src/types/delegation.ts` — `MAX_CONCURRENT_DELEGATIONS`, `ParallelDelegationItem`, `ParallelDelegationRequest`.
- `apps/server/src/routes/delegation.ts` — `POST /api/v1/threads/:id/delegate/parallel` endpoint schema.
- `apps/web/src/components/delegation/__tests__/DelegationUI.test.ts` — Existing 316 web unit assertions for banner, card, tree, and modal.

---

## 5. Implementation Scope

1. **Modal Mode & Helpers (`apps/web/src/components/delegation/DelegateModal.tsx`)**:
   - Extend `DelegateModalMode` type to include `'PARALLEL'`.
   - Add state and helper types for parallel batch items:
     - `export interface ParallelItemState { id: string; profileId: string; task: string; context: string; }`
   - Update submission validator:
     - `canSubmitParallelDelegation(items: ParallelItemState[]): boolean` — ensures `2 <= items.length <= MAX_CONCURRENT_DELEGATIONS` (4) and every item has a non-empty trimmed `task`.
   - Update / add body builder:
     - `buildParallelDelegationBody(items: ParallelItemState[]): Record<string, unknown>` — outputs `{ delegations: ParallelDelegationItem[] }` matching the `POST /delegate/parallel` schema.

2. **Parallel Subagent Row & Modal Presentation (`DelegateModalView`)**:
   - Add tab switcher for `Delegate Task`, `Request Review`, and `Parallel Batch`.
   - In `Parallel Batch` mode:
     - Render header with current batch size counter (e.g. "Subagents (2/4)").
     - Render card / row per subagent with:
       - Item index and title (e.g. "Subagent 1", "Subagent 2").
       - Role selector (`roleOptionsFrom(profiles)`).
       - Task description textarea.
       - Optional context textarea.
       - "Remove" button per row (visible/enabled when items.length > 2).
     - Render "+ Add Subagent" button (enabled when items.length < 4).
     - Explanatory copy: "Dispatch up to 4 concurrent subagents under specialized roles. This thread will wait until all subagents finish and aggregate their outcomes."

3. **Modal Container & Store Integration (`DelegateModal`)**:
   - Manage parallel items list state with default of 2 items.
   - Wire submission in parallel mode to `POST /api/v1/threads/:id/delegate/parallel` (or `useProjectStore.delegateParallel`).
   - Listen for socket pending child state transition to close modal cleanly.
   - Surface error banner on 400 (validation), 409 (`CONCURRENCY_LIMIT_EXCEEDED`), or network failures.

4. **Automated Unit & Integration Tests (`apps/web/src/components/delegation/__tests__/DelegationUI.test.ts`)**:
   - Test tab switching to `Parallel Batch` mode.
   - Test initial parallel state starts with 2 subagent rows.
   - Test adding a 3rd and 4th subagent row and disabling add button at 4.
   - Test removing subagent rows down to minimum 2 and disabling remove button at 2.
   - Test validation: disabled submit if any subagent task is empty.
   - Test payload builder producing valid `ParallelDelegationItem[]` structures.
   - Test successful dispatch invoking API/store action and closing modal upon socket transition.
   - Test error display when server returns 409 `CONCURRENCY_LIMIT_EXCEEDED`.

---

## 6. Explicitly Forbidden Changes

- Do NOT break or regress single-child delegation (`TASK` and `REVIEW`) in `DelegateModal`.
- Do NOT allow dispatching more than `MAX_CONCURRENT_DELEGATIONS = 4` subagents in a single batch.
- Do NOT hardcode colors; use CSS variables from `apps/web/src/styles/tokens.css`.
- Do NOT break any existing test suites (all 36 suites must remain green).

---

## 7. Acceptance Criteria

1. `DelegateModal` includes a "Parallel Batch" mode tab alongside "Delegate Task" and "Request Review".
2. In Parallel mode, the operator can configure 2 to 4 concurrent subagents with individual roles, tasks, and contexts.
3. Adding subagents is enabled up to 4 (`MAX_CONCURRENT_DELEGATIONS`) and disabled thereafter; removing subagents is enabled down to 2 and disabled thereafter.
4. Validation prevents submission if any configured subagent has an empty task description or if total count is outside [2, 4].
5. Submitting parallel batch dispatches to `POST /api/v1/threads/:id/delegate/parallel` and closes modal when child sessions start.
6. Error responses (e.g. 409 concurrency limit or 400 invalid batch) are rendered in the modal error banner.
7. Unit test suite in `DelegationUI.test.ts` verifies parallel modal rendering, row addition/removal, validation, payload generation, and dispatch.
8. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`.

---

## 8. Definition of Done

- [ ] `DelegateModalMode` updated and parallel batch UI implemented in `DelegateModal.tsx`
- [ ] Dynamic addition and removal of subagent rows bounded between 2 and 4
- [ ] Parallel delegation validation and request payload builders authored
- [ ] Parallel modal submission and error handling wired to backend
- [ ] Unit tests for parallel modal authored and green in `DelegationUI.test.ts`
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
- Verify no styling regressions across light/dark themes and responsive breakpoints.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
