# Current Task: P5.2-02 — Project Decision Explorer UI Component

**Task ID:** P5.2-02  
**Phase:** Phase 5.2 — Project Decision Explorer & Memory UI  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-14  

---

## 1. Objective

Implement the Project Decision Explorer UI (`apps/web/src/components/memory/DecisionExplorer.tsx`), integrating it into the project workspace tabs, with decision filtering, provenance/confidence visualization, constraints, code anchor navigation, and a manual decision creation modal.

---

## 2. Context & Design Rules

* Adhere strictly to `blueprint/DESIGN_SYSTEM.md` and `CLAUDE.md`:
  - Clean monochrome surfaces (`bg-neutral-900`, `bg-neutral-950`, `border-neutral-800`).
  - Single emerald accent for primary interactive states.
  - **No forbidden cliché tropes**: no gradients on text, no glowing border accents, no icon-stuffed bento boxes.
  - Clear visual distinction between `AGENT_STATEMENT` (e.g. 75% confidence badge) and `HUMAN_CONFIRMED` (100% confidence badge) per DEC-024.
* Integrate with `useMemoryStore` (`fetchBriefing`, `fetchDecisions`, `createDecision`, `reset`).
* On project change, call `reset()` and fetch the active project's memory.

---

## 3. Repository Evidence & Relevant Files

Inspect:
* [`apps/web/src/stores/useMemoryStore.ts`](file:///c:/Projects/Asterim/apps/web/src/stores/useMemoryStore.ts)
* [`packages/shared/src/types/memory.ts`](file:///c:/Projects/Asterim/packages/shared/src/types/memory.ts)
* [`apps/web/src/components/workspace/ContextView.tsx`](file:///c:/Projects/Asterim/apps/web/src/components/workspace/ContextView.tsx)
* [`apps/web/src/components/workspace/WorkspaceTabView.tsx`](file:///c:/Projects/Asterim/apps/web/src/components/workspace/WorkspaceTabView.tsx)
* [`blueprint/DESIGN_SYSTEM.md`](file:///c:/Projects/Asterim/blueprint/DESIGN_SYSTEM.md)
* [`reports/current.md`](file:///c:/Projects/Asterim/reports/current.md)

---

## 4. Implementation Scope

1. **Decision Explorer Component (`apps/web/src/components/memory/DecisionExplorer.tsx`)**:
   - Header with Project Memory overview, Active Intent summary card, and "Record Decision" button.
   - Filter bar: text search input, status pill filter (`All`, `ACTIVE`, `SUPERSEDED`, `ARCHIVED`, `STALE`), file path filter.
   - Decision Card list:
     - Title, status badge, created timestamp.
     - Provenance & Confidence meter: badge displaying `Agent (75%)` vs `Human (100%)` with distinct subtle indicator.
     - Summary and collapsible Rationale.
     - Constraints list.
     - Code anchors (`filePath` and `symbolName`).
     - Superseded relationship (showing link / identifier of superseding decision if superseded).
   - Empty state when no decisions match filters or project has no recorded decisions.
2. **Record Decision Modal (`apps/web/src/components/memory/RecordDecisionModal.tsx`)**:
   - Form fields: Title (required), Summary (required), Rationale (required), Constraints (comma/newline separated), Related Files (comma/newline separated).
   - Submits via `useMemoryStore.getState().createDecision(projectId, { ...data, provenance: 'HUMAN_CONFIRMED', confidence: 1.0 })`.
3. **Workspace View Integration**:
   - Add "Decisions" / "Memory" tab to project view or integrate inside `WorkspaceTabView.tsx` / `ContextView.tsx`.
   - Wire `useEffect` watching active `projectId` to call `reset()` and `fetchBriefing(activeProjectId)`.
4. **Verification Tests**:
   - Add unit/component tests in `apps/web/src/components/memory/__tests__/DecisionExplorer.test.ts` or standalone verification testing filter logic and render states.

---

## 5. Explicitly Forbidden Changes

* Do **NOT** use unapproved CSS frameworks or gradient text cliché tropes.
* Do **NOT** modify backend REST routes or MCP memory server.

---

## 6. Acceptance Criteria

1. `DecisionExplorer` cleanly renders all decisions, intent, and constraints from `useMemoryStore`.
2. Provenance and confidence metadata are visibly distinguished on every card.
3. Filtering by status, text search, and file path works accurately.
4. `RecordDecisionModal` successfully submits human-confirmed decisions to the backend.
5. Project switching calls `reset()` and loads the newly selected project's memory.
6. `pnpm run build` completes with 0 errors across all monorepo packages.

---

## 7. Verification Commands

```bash
pnpm --filter @asterim/web exec tsc --noEmit
pnpm --filter @asterim/web build
pnpm run build
```

---

## 8. Required Report Format

Upon completion, write the execution result directly to `reports/current.md` using the standard format:
* **Task ID**: P5.2-02
* **Status**: `IMPLEMENTED` / `VERIFIED` / `BLOCKED`
* **Summary**: Summary of Decision Explorer component, filtering, and modal integration
* **Files Changed**: List of files created/modified
* **Tests / Verification**: Output of build and typecheck commands
* **Problems Discovered & Concerns**: Any issues encountered
* **Recommended Next Step**: Recommendation for P5.2-03 (Memory Timeline & Re-entry Briefing View)
