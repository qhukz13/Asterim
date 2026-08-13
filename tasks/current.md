# Current Task: P5.3-03 — Architectural Rules & Intent Management UI

**Task ID:** P5.3-03  
**Phase:** Phase 5.3 — Decision Lifecycle & Memory Curation UI  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-14  

---

## 1. Objective

Implement human curation controls for standing architectural rules and active project intent: create `CreateRuleModal.tsx` and `UpdateIntentModal.tsx`, integrate action triggers into the Rules and Intent panels in the Memory view, and resolve `supersededBy` decision titles across both Explorer and Timeline views.

---

## 2. Context & Design Guidelines

* In Phase 5.0 and 5.2, `createRule` and `createIntent` were implemented in the backend and `useMemoryStore`.
* Memory curation allows humans to establish project guardrails and update the active mission directly from the web interface.
* Per `DESIGN_SYSTEM.md`:
  - Monochrome panels (`var(--color-surface-2)`, `var(--color-border-subtle)`).
  - Emerald accent (`var(--color-accent-primary)`) for primary confirmation and active rules.
  - Severity indicators: `error` (red/crimson), `warning` (amber), `info` (blue/neutral).

---

## 3. Repository Evidence & Relevant Files

Inspect:
* [`apps/web/src/stores/useMemoryStore.ts`](file:///c:/Projects/Asterim/apps/web/src/stores/useMemoryStore.ts)
* [`apps/web/src/components/memory/DecisionExplorer.tsx`](file:///c:/Projects/Asterim/apps/web/src/components/memory/DecisionExplorer.tsx)
* [`apps/web/src/components/memory/MemoryTimelineView.tsx`](file:///c:/Projects/Asterim/apps/web/src/components/memory/MemoryTimelineView.tsx)
* [`apps/web/src/components/memory/ReentryBriefingCard.tsx`](file:///c:/Projects/Asterim/apps/web/src/components/memory/ReentryBriefingCard.tsx)
* [`reports/current.md`](file:///c:/Projects/Asterim/reports/current.md)

---

## 4. Implementation Scope

1. **Create Rule Modal (`apps/web/src/components/memory/CreateRuleModal.tsx`)**:
   - Header: *"Add Architectural Rule"*.
   - Form fields:
     - Title (required): Short headline (e.g. `Enforce Service Isolation`).
     - Statement (required): Directive statement (e.g. `All MCP operations must delegate to ProjectMemoryService`).
     - Severity dropdown: `warning` (default), `error`, `info`.
     - Scope Pattern (optional): glob pattern, defaults to `*`.
   - Submission: calls `useMemoryStore.getState().createRule(projectId, { title, statement, severity, scopePattern })`.
2. **Update Intent Modal (`apps/web/src/components/memory/UpdateIntentModal.tsx`)**:
   - Header: *"Update Project Intent"*.
   - Explains that saving will archive the previous intent and make this the new active goal.
   - Form fields:
     - Goal (required): Main outcome.
     - Constraints (optional, comma/newline separated).
     - Non-Goals (optional, comma/newline separated).
   - Pre-populates the current active intent's values if present.
   - Submission: calls `useMemoryStore.getState().createIntent(projectId, { goal, constraints, nonGoals })`.
3. **Intent & Rules Panel Integration**:
   - In `DecisionExplorer.tsx` and `ReentryBriefingCard.tsx`:
     - Add *"Update Intent"* action button to the Intent card (or *"Set Intent"* when none is active).
     - Add *"Add Rule"* button to the Architectural Rules section.
     - Resolve `supersededBy` in `DecisionExplorer.tsx` to render the matching decision's title instead of a raw ID.
4. **Automated Verification**:
   - Add/update tests in `apps/web/src/components/memory/__tests__/` asserting modal rendering, pre-population, validation, and title resolution.

---

## 5. Explicitly Forbidden Changes

* Do **NOT** modify backend database schemas or REST routes.
* Do **NOT** remove any existing memory components.

---

## 6. Acceptance Criteria

1. Users can add standing architectural rules with title, statement, severity, and scope pattern from the UI.
2. Users can set or update the active project intent with pre-populated values and non-goals.
3. Both Explorer and Timeline resolve superseded links to human-readable titles.
4. `pnpm run build` and `tsc --noEmit` pass with 0 errors.

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
* **Task ID**: P5.3-03
* **Status**: `IMPLEMENTED` / `VERIFIED` / `BLOCKED`
* **Summary**: Summary of Rules and Intent UI modals and title resolution
* **Files Changed**: List of files created/modified
* **Tests / Verification**: Output of test suites and build commands
* **Problems Discovered & Concerns**: Any issues encountered
* **Recommended Next Step**: Recommendation for Phase 5.3 completion / Phase 5.4 or Phase 6
