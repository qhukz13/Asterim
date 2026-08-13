# Current Task: P5.2-03 — Workspace Navigation Overflow Fix & Memory Timeline / Re-entry Briefing

**Task ID:** P5.2-03  
**Phase:** Phase 5.2 — Project Decision Explorer & Memory UI  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-14  

---

## 1. Objective

1. **Fix Workspace Top View-Navigation Overflow**: Ensure the workspace tab bar (`view-navigation` containing Chat, Terminal, Changes, Memory, Settings, Environment) handles viewport resizing and Inspector Panel ("AI Context & State") expansion without clipping or hiding tabs behind the inspector. Enable smooth horizontal scrolling (`overflow-x: auto`) and clean layout constraints.
2. **Implement Memory Timeline & Re-entry Briefing View**: Build the chronological decision timeline with supersession lineage chains and re-entry briefing cards rendering `recentAgentWork` and `recentApprovals`.

---

## 2. Context & User Issue

* **User Reported Issue**:
  > *"One concern in the topbar of workspace "Environment tab" is behind AI Context & State. And when resizing AI Context & State it overlaps with the tabs in top bar(Environment, settings etc) and i cant scroll topbar to the right to see the tabs."*
* **Root Cause**:
  In `apps/web/src/App.tsx`, `view-navigation` is inside `workspace-main-content`. With 6 tabs (`Chat`, `Terminal`, `Changes`, `Memory`, `Settings`, `Environment`), the tab list exceeds available width when `InspectorPanel` is resized wider (up to 500px). Because `view-navigation` lacks `min-width: 0`, `overflow-x: auto`, and container scroll handling, the rightmost tabs get clipped or trapped beneath the inspector boundary.

---

## 3. Repository Evidence & Relevant Files

Inspect:
* [`apps/web/src/App.tsx`](file:///c:/Projects/Asterim/apps/web/src/App.tsx) (lines 506–660)
* [`apps/web/src/styles/layout.css`](file:///c:/Projects/Asterim/apps/web/src/styles/layout.css)
* [`apps/web/src/components/InspectorPanel.tsx`](file:///c:/Projects/Asterim/apps/web/src/components/InspectorPanel.tsx)
* [`apps/web/src/components/memory/DecisionExplorer.tsx`](file:///c:/Projects/Asterim/apps/web/src/components/memory/DecisionExplorer.tsx)
* [`apps/web/src/stores/useMemoryStore.ts`](file:///c:/Projects/Asterim/apps/web/src/stores/useMemoryStore.ts)
* [`reports/current.md`](file:///c:/Projects/Asterim/reports/current.md)

---

## 4. Implementation Scope

### Part A: Workspace Navigation Overflow & Scroll Fix
1. In `apps/web/src/App.tsx` (and `layout.css`):
   - Make `.view-navigation` container resilient with `min-width: 0`, `max-width: 100%`, `overflow: hidden`.
   - Wrap the tab buttons container in a dedicated horizontally scrollable wrapper with:
     - `overflow-x: auto`
     - `overflow-y: hidden`
     - `scrollbar-width: thin`
     - `white-space: nowrap`
     - `flex: 1`
     - `min-width: 0`
     - Smooth scrolling and subtle scrollbar styling.
   - Keep right-side actions (`clear-chat-btn`, etc.) with `flex-shrink: 0` so they never collapse or obscure the tabs.
   - Ensure all tab buttons carry `flex-shrink: 0` so text is never truncated awkwardly.

### Part B: Memory Timeline & Re-entry Briefing
1. **Decision Timeline View (`apps/web/src/components/memory/MemoryTimelineView.tsx` or timeline mode in `DecisionExplorer.tsx`)**:
   - Provide a toggle or sub-view between "Explorer" and "Timeline" in the Memory view.
   - Group decisions chronologically by date/time.
   - Render supersession lineage chains: visibly connect superseded decisions to their replacements with a visual lineage indicator (e.g. `Replaced by [Decision Title]`).
2. **Re-entry Briefing Component (`apps/web/src/components/memory/ReentryBriefingCard.tsx`)**:
   - Display a compact session handover card:
     - Active project intent & goal.
     - Standing architectural rules summary.
     - Recent agent work history (`briefing.recentAgentWork` showing session IDs, agent types, and timestamps).
     - Recent approval history (`briefing.recentApprovals` showing action descriptions and status).
3. **Component Tests**:
   - Add unit/render tests for `MemoryTimelineView` and `ReentryBriefingCard` in `apps/web/src/components/memory/__tests__/`.

---

## 5. Explicitly Forbidden Changes

* Do **NOT** remove any existing tabs or alter project routes.
* Do **NOT** use unapproved CSS frameworks; follow `tokens.css` and existing styling conventions.

---

## 6. Acceptance Criteria

1. Workspace navigation tab bar can be scrolled horizontally when the window is narrow or `InspectorPanel` is resized to maximum width; no tabs are clipped or inaccessible.
2. The Memory view provides chronological timeline ordering with clear supersession relationships.
3. The Re-entry Briefing accurately displays `recentAgentWork` and `recentApprovals` from `useMemoryStore`.
4. `pnpm run build` and `tsc --noEmit` complete with 0 errors across all monorepo packages.

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
* **Task ID**: P5.2-03
* **Status**: `IMPLEMENTED` / `VERIFIED` / `BLOCKED`
* **Summary**: Summary of navigation overflow fix and Memory Timeline/Briefing implementation
* **Files Changed**: List of files created/modified
* **Tests / Verification**: Output of build, typecheck, and test commands
* **Problems Discovered & Concerns**: Any issues encountered
* **Recommended Next Step**: Recommendation for Phase 5.2 milestone wrap-up / Phase 5.3
