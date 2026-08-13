# Current Task: P5.3-01 — Decision Status Lifecycle REST Endpoint & Store Actions

**Task ID:** P5.3-01  
**Phase:** Phase 5.3 — Decision Lifecycle & Memory Curation UI  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-14  

---

## 1. Objective

Expose the decision status lifecycle over REST by adding `PATCH /api/v1/projects/:id/memory/decisions/:decisionId/status`, emit `memory.decision_updated` on `ProjectMemoryService.updateDecisionStatus`, and implement `updateDecisionStatus` / `archiveDecision` actions in `useMemoryStore`.

---

## 2. Context & Requirements

* `ProjectMemoryService.updateDecisionStatus(id, status)` and `ProjectMemoryService.archiveDecision(id)` exist in the backend service, but are not yet exposed over the REST surface.
* `updateDecisionStatus` currently does not publish an EventBus event, meaning client stores cannot live-update when a decision is archived or changed to STALE.
* In Phase 5.3, we build the interactive Supersede and Archive UI. The required foundation is an atomic REST endpoint for lifecycle state transitions and real-time synchronization.

---

## 3. Repository Evidence & Relevant Files

Inspect:
* [`apps/server/src/services/ProjectMemoryService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/ProjectMemoryService.ts) (lines 280–305)
* [`apps/server/src/routes/memory.ts`](file:///c:/Projects/Asterim/apps/server/src/routes/memory.ts)
* [`packages/shared/src/types/memory.ts`](file:///c:/Projects/Asterim/packages/shared/src/types/memory.ts)
* [`packages/shared/src/events.ts`](file:///c:/Projects/Asterim/packages/shared/src/events.ts)
* [`apps/web/src/stores/useMemoryStore.ts`](file:///c:/Projects/Asterim/apps/web/src/stores/useMemoryStore.ts)
* [`apps/server/src/routes/__tests__/memory.test.ts`](file:///c:/Projects/Asterim/apps/server/src/routes/__tests__/memory.test.ts)
* [`apps/web/src/stores/__tests__/useMemoryStore.test.ts`](file:///c:/Projects/Asterim/apps/web/src/stores/__tests__/useMemoryStore.test.ts)

---

## 4. Implementation Scope

1. **Backend Event & Service (`apps/server/src/services/ProjectMemoryService.ts` & `packages/shared`)**:
   - Add `MemoryDecisionUpdatedPayload` to `packages/shared/src/types/memory.ts` and event type `'memory.decision_updated'` to `packages/shared/src/events.ts` (if required).
   - In `ProjectMemoryService.updateDecisionStatus`:
     - Publish `this.publishMemoryEvent<MemoryDecisionUpdatedPayload>('memory.decision_updated', { projectId: updated.projectId, decision: updated, previousStatus: existing.status })`.
2. **REST Endpoint (`apps/server/src/routes/memory.ts`)**:
   - Add `PATCH /api/v1/projects/:id/memory/decisions/:decisionId/status`.
   - Body: `{ status: DecisionStatus }`. Validate that `status` is one of `DECISION_STATUSES`.
   - Verify `decision.projectId === id`; return 400 if project mismatch, 404 if not found.
   - Return `{ decision: updated }` with status 200.
3. **Frontend Store Integration (`apps/web/src/stores/useMemoryStore.ts`)**:
   - Add `updateDecisionStatus(projectId: string, decisionId: string, status: DecisionStatus): Promise<ProjectDecision>`.
   - Add `archiveDecision(projectId: string, decisionId: string): Promise<ProjectDecision>` (convenience calling `updateDecisionStatus(projectId, decisionId, 'ARCHIVED')`).
   - Add `'memory.decision_updated'` to `MEMORY_EVENT_TYPES` and update `handleMemoryEvent` to update the decision in `decisions` and maintain `briefing.activeDecisions` (removing if non-ACTIVE, upserting if ACTIVE).
4. **Automated Verification**:
   - Add tests for `PATCH /api/v1/projects/:id/memory/decisions/:decisionId/status` in `apps/server/src/routes/__tests__/memory.test.ts`.
   - Add unit tests for `updateDecisionStatus`, `archiveDecision`, and `'memory.decision_updated'` event in `apps/web/src/stores/__tests__/useMemoryStore.test.ts`.

---

## 5. Explicitly Forbidden Changes

* Do **NOT** remove or alter existing REST endpoints.
* Do **NOT** allow cross-project status modification.

---

## 6. Acceptance Criteria

1. `PATCH /api/v1/projects/:id/memory/decisions/:decisionId/status` validates `status`, enforces project boundaries, updates SQLite, and publishes `memory.decision_updated`.
2. `useMemoryStore` exposes `updateDecisionStatus` and `archiveDecision`, updating local state and `briefing.activeDecisions`.
3. Socket event `memory.decision_updated` updates state in real-time across connected clients.
4. `pnpm run build` and all regression test suites pass with 0 errors.

---

## 7. Verification Commands

```bash
pnpm --filter asterim exec tsx src/routes/__tests__/memory.test.ts
pnpm --filter asterim exec tsx src/services/__tests__/ProjectMemoryService.test.ts
pnpm --filter @asterim/web exec tsx src/stores/__tests__/useMemoryStore.test.ts
pnpm --filter @asterim/shared build
pnpm run build
```

---

## 8. Required Report Format

Upon completion, write the execution result directly to `reports/current.md` using the standard format:
* **Task ID**: P5.3-01
* **Status**: `IMPLEMENTED` / `VERIFIED` / `BLOCKED`
* **Summary**: Summary of status endpoint, EventBus event, and store actions
* **Files Changed**: List of files created/modified
* **Tests / Verification**: Output of test suites and build commands
* **Problems Discovered & Concerns**: Any issues encountered
* **Recommended Next Step**: Recommendation for P5.3-02 (Interactive Supersede & Archive UI Dialogs)
