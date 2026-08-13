# Current Task: P5.3-02 — Interactive Decision Supersede & Archive UI Dialogs

**Task ID:** P5.3-02  
**Phase:** Phase 5.3 — Decision Lifecycle & Memory Curation UI  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-14  

---

## 1. Objective

Implement interactive decision lifecycle management in the UI by creating `SupersedeDecisionModal.tsx`, an Archive confirmation dialog, and adding lifecycle action triggers ("Supersede", "Archive", "Mark Stale", "Reactivate") to Decision cards in both the Explorer and Timeline views.

---

## 2. Context & Design Guidelines

* In P5.3-01, `useMemoryStore` was equipped with `supersedeDecision`, `updateDecisionStatus`, `archiveDecision`, and live `memory.decision_updated` handling.
* Per `DESIGN_SYSTEM.md`:
  - Monochrome dark theme surfaces with subtle borders (`var(--color-surface-2)`, `var(--color-border-subtle)`).
  - Emerald accent (`var(--color-accent-primary)`) for primary interactive confirmation actions.
  - Warning/Amber accent for archive / stale actions.
  - No unapproved frameworks or cliché visual effects.
* Archiving is a significant action because it removes the decision from agent briefings — it must require explicit modal confirmation.

---

## 3. Repository Evidence & Relevant Files

Inspect:
* [`apps/web/src/stores/useMemoryStore.ts`](file:///c:/Projects/Asterim/apps/web/src/stores/useMemoryStore.ts)
* [`apps/web/src/components/memory/DecisionExplorer.tsx`](file:///c:/Projects/Asterim/apps/web/src/components/memory/DecisionExplorer.tsx)
* [`apps/web/src/components/memory/MemoryTimelineView.tsx`](file:///c:/Projects/Asterim/apps/web/src/components/memory/MemoryTimelineView.tsx)
* [`apps/web/src/components/memory/RecordDecisionModal.tsx`](file:///c:/Projects/Asterim/apps/web/src/components/memory/RecordDecisionModal.tsx)
* [`reports/current.md`](file:///c:/Projects/Asterim/reports/current.md)

---

## 4. Implementation Scope

1. **Supersede Decision Modal (`apps/web/src/components/memory/SupersedeDecisionModal.tsx`)**:
   - Header: *"Supersede Decision"*, showing the headline of the decision being replaced.
   - Form fields:
     - New Title (required)
     - New Summary (required)
     - New Rationale (required) — why the previous decision is being superseded
     - Constraints (pre-populated with existing constraints, editable)
     - Related Files (pre-populated with existing related files, editable)
   - Submission: calls `useMemoryStore.getState().supersedeDecision(projectId, targetDecision.id, { ...data, provenance: 'HUMAN_CONFIRMED', confidence: 1.0 })`.
2. **Archive Confirmation Dialog (`apps/web/src/components/memory/ArchiveDecisionModal.tsx` or inline dialog)**:
   - Explains that the decision will be moved to `ARCHIVED` and retired from active agent briefings while remaining preserved in the timeline.
   - Confirms via `useMemoryStore.getState().archiveDecision(projectId, targetDecision.id)`.
3. **Card Actions Integration**:
   - In `DecisionExplorer.tsx` and `MemoryTimelineView.tsx`:
     - On `ACTIVE` decisions: provide "Supersede", "Mark Stale", and "Archive" buttons/dropdown.
     - On `STALE` decisions: provide "Reactivate", "Supersede", and "Archive".
     - On `SUPERSEDED` and `ARCHIVED` decisions: render read-only status and lineage without mutation triggers.
4. **Automated Verification**:
   - Add/update tests in `apps/web/src/components/memory/__tests__/DecisionExplorer.test.ts` and `MemoryTimeline.test.ts` asserting modal rendering, pre-population, action callback triggers, and lifecycle state changes.

---

## 5. Explicitly Forbidden Changes

* Do **NOT** delete decisions from SQLite — all retirements must transition to `ARCHIVED` or `SUPERSEDED`.
* Do **NOT** modify backend routes or MCP server implementations.

---

## 6. Acceptance Criteria

1. Users can launch the Supersede dialog from any active decision in Explorer and Timeline.
2. Supersede dialog pre-populates previous constraints/anchors and successfully creates the replacement.
3. Archive dialog confirms and marks the decision `ARCHIVED`, immediately updating local state and briefings.
4. "Mark Stale" and "Reactivate" toggle lifecycle states without full dialogs.
5. `pnpm run build` and `tsc --noEmit` pass with 0 errors.

---

## 7. Verification Commands

```bash
pnpm --filter @asterim/web exec tsx src/components/memory/__tests__/DecisionExplorer.test.ts
pnpm --filter @asterim/web exec tsx src/components/memory/__tests__/MemoryTimeline.test.ts
pnpm --filter @asterim/web exec tsx src/stores/__tests__/useMemoryStore.test.ts
pnpm --filter @asterim/web exec tsc --noEmit
pnpm run build
```

---

## 8. Required Report Format

Upon completion, write the execution result directly to `reports/current.md` using the standard format:
* **Task ID**: P5.3-02
* **Status**: `IMPLEMENTED` / `VERIFIED` / `BLOCKED`
* **Summary**: Summary of supersede/archive dialogs and action integration
* **Files Changed**: List of files created/modified
* **Tests / Verification**: Output of test suites and build commands
* **Problems Discovered & Concerns**: Any issues encountered
* **Recommended Next Step**: Recommendation for P5.3-03 (Rules & Intent Curation UI)
