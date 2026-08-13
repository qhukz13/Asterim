# Current Task: P5.4-02 — Git Staleness & Drift Engine

**Task ID:** P5.4-02  
**Phase:** Phase 5.4 — Intelligent Memory & Continuous Governance  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-14  

---

## 1. Objective

Implement a non-destructive Git staleness and drift detection engine (`GitDriftDetector`) that evaluates `decision_code_refs` against the project's Git working tree and AST symbols, exposes drift status via REST and project briefings, and renders visual caution indicators in the Decision Explorer and Memory Timeline.

---

## 2. Context & Architectural Decisions

* **DEC-027 (Approved Strategy)**:
  1. Drift is **non-destructive**: Human-confirmed decisions are **never** automatically mutated, demoted, or deleted when code changes.
  2. Drift status is computed dynamically across code references (`FILE_MODIFIED`, `FILE_DELETED`, `SYMBOL_NOT_FOUND`, or `CLEAN`).
  3. Decisions with drift display visual caution badges in the UI and drift warnings in agent briefings.

---

## 3. Repository Evidence & Relevant Files

Inspect:
* [`docs/phase5-4-task-plan.md`](file:///c:/Projects/Asterim/docs/phase5-4-task-plan.md) (Task P5.4-02 design)
* [`decisions.md`](file:///c:/Projects/Asterim/decisions.md) (DEC-027)
* [`apps/server/src/services/git/GitService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/git/GitService.ts)
* [`apps/server/src/services/ProjectMemoryService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/ProjectMemoryService.ts)
* [`apps/server/src/routes/memory.ts`](file:///c:/Projects/Asterim/apps/server/src/routes/memory.ts)
* [`apps/web/src/components/memory/DecisionExplorer.tsx`](file:///c:/Projects/Asterim/apps/web/src/components/memory/DecisionExplorer.tsx)
* [`apps/web/src/components/memory/MemoryTimelineView.tsx`](file:///c:/Projects/Asterim/apps/web/src/components/memory/MemoryTimelineView.tsx)

---

## 4. Implementation Scope

1. **`GitDriftDetector` Service (`apps/server/src/services/git/GitDriftDetector.ts`)**:
   - Exports `class GitDriftDetector`:
     - `detectRefDrift(projectPath: string, ref: DecisionCodeRef): DriftType | null`
       - `FILE_DELETED`: The file specified in `ref.filePath` does not exist on disk.
       - `FILE_MODIFIED`: The file has uncommitted changes in Git (`git status --porcelain`) or the current commit head differs from `ref.commitHash`.
       - `SYMBOL_NOT_FOUND`: If `ref.symbolName` is specified, checks if the symbol exists in the file content (regex/AST match).
       - `null`: Reference is intact and clean.
     - `detectDecisionDrift(projectPath: string, decision: ProjectDecision): DecisionDriftInfo`
       - Aggregates drift across all code references of a decision.
2. **Project Memory Integration**:
   - In `ProjectMemoryService.ts`:
     - Method `getProjectDrift(projectId: string): Record<string, DecisionDriftInfo>`
     - In `getProjectBriefing()`: attach optional `drift` metadata to active decisions that have drifted.
     - In `listDecisions()`: attach `drift` summary when requested.
   - In `apps/server/src/routes/memory.ts`:
     - Add endpoint `GET /api/v1/projects/:id/memory/drift` returning drift analysis for all active decisions.
3. **UI Drift Indicators**:
   - In `DecisionExplorer.tsx` and `MemoryTimelineView.tsx`:
     - If a decision has code drift, render an amber warning tag/badge (e.g. `⚠️ Code anchor modified` or `⚠️ File missing`).
     - Display tooltip/details showing which referenced file drifted.
4. **Automated Verification**:
   - Service unit tests in `apps/server/src/services/git/__tests__/GitDriftDetector.test.ts` (test clean refs, modified files, deleted files, and missing symbols).
   - Route tests in `apps/server/src/routes/__tests__/memory.test.ts`.
   - Component rendering tests in `apps/web/src/components/memory/__tests__/DecisionExplorer.test.ts`.

---

## 5. Explicitly Forbidden Changes

* Do **NOT** automatically delete or alter the `status` column of decisions in SQLite — drift is a computed analytical property, not a destructive data mutation.
* Do **NOT** introduce external AST binary dependencies; use existing regex/lexer utilities or lightweight symbol matchers.

---

## 6. Acceptance Criteria

1. Deleting or modifying a file linked in `decision_code_refs` correctly flags the decision with `FILE_DELETED` or `FILE_MODIFIED`.
2. A symbol anchor missing from a file flags the decision with `SYMBOL_NOT_FOUND`.
3. Clean decisions return `null` drift.
4. UI renders amber caution badges for drifted decisions while preserving active status.
5. All test suites pass and `pnpm run build` succeeds with 0 errors.

---

## 7. Verification Commands

```bash
pnpm --filter asterim exec tsx src/services/git/__tests__/GitDriftDetector.test.ts
pnpm --filter asterim exec tsx src/routes/__tests__/memory.test.ts
pnpm --filter @asterim/web exec tsx src/components/memory/__tests__/DecisionExplorer.test.ts
pnpm --filter asterim exec tsc --noEmit
pnpm run build
```

---

## 8. Required Report Format

Upon completion, write the execution result directly to `reports/current.md` using the standard format:
* **Task ID**: P5.4-02
* **Status**: `IMPLEMENTED` / `VERIFIED` / `BLOCKED`
* **Summary**: Summary of GitDriftDetector, drift routes, and UI indicators
* **Files Changed**: List of files created/modified
* **Tests / Verification**: Output of test suites and build commands
* **Problems Discovered & Concerns**: Any issues encountered
* **Recommended Next Step**: Recommendation for P5.4-03 (Decision Extraction Queue & Candidate Review UI)
