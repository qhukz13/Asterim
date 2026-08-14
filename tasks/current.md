# [P5.4-04] — Relevance Ranking, Scoped Briefings & Noise Reduction

**Task ID:** P5.4-04  
**Phase:** Phase 5.4 — Intelligent Memory & Continuous Governance  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-14  

---

## 1. Objective

Implement local, deterministic relevance ranking and bounded context windowing for project briefings (`MemoryRelevanceEngine`), update `ProjectMemoryService` and MCP tool endpoints to support scoped retrieval by active files/tasks, and add search/drift filters to the Decision Explorer UI.

---

## 2. Why This Task Exists

As a project develops, tens or hundreds of decisions, rules, and code references are recorded in Project Memory. Dumping the entire unranked memory store into every agent prompt wastes context window tokens and injects irrelevant details.

Under **DEC-028** (Local-First Data Sovereignty), Asterim solves this without external vector databases or remote embedding APIs by using a deterministic, fast scoring engine that ranks decisions based on touched file paths, symbol anchors, task keywords, provenance, and drift penalties.

---

## 3. Context

* **DEC-028**: Local-First Data Sovereignty. Relevance ranking must execute 100% locally in-process with zero remote embedding API calls or external vector dependencies.
* **DEC-024**: Decision Provenance. Human-confirmed decisions (`HUMAN_CONFIRMED`) carry higher baseline weight than agent statements.
* **DEC-027**: Non-Destructive Git Drift. Drifted decisions receive appropriate annotations and mild ranking penalties if anchors are missing.

---

## 4. Repository Evidence

Inspect:
* [`apps/server/src/services/ProjectMemoryService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/ProjectMemoryService.ts) (`getProjectBriefing`, `queryDecisions`)
* [`packages/mcp-memory-server/src/index.ts`](file:///c:/Projects/Asterim/packages/mcp-memory-server/src/index.ts) (`get_project_briefing`, `query_decisions`)
* [`packages/shared/src/types/memory.ts`](file:///c:/Projects/Asterim/packages/shared/src/types/memory.ts) (`ProjectBriefing`, `QueryDecisionsInput`)
* [`apps/server/src/routes/memory.ts`](file:///c:/Projects/Asterim/apps/server/src/routes/memory.ts)
* [`apps/web/src/components/memory/DecisionExplorer.tsx`](file:///c:/Projects/Asterim/apps/web/src/components/memory/DecisionExplorer.tsx)
* [`apps/web/src/stores/useMemoryStore.ts`](file:///c:/Projects/Asterim/apps/web/src/stores/useMemoryStore.ts)

---

## 5. Implementation Scope

1. **Shared Types (`packages/shared/src/types/memory.ts`)**:
   - Update `ProjectBriefingOptions` / `QueryDecisionsInput`:
     - `taskDescription?: string`
     - `touchPaths?: string[]`
     - `limit?: number`
     - `drift?: boolean`
   - Add `relevanceScore?: number` to `ProjectDecision` output when queried.
2. **`MemoryRelevanceEngine` (`apps/server/src/services/memory/MemoryRelevanceEngine.ts`)**:
   - Implements deterministic relevance scoring:
     - **Provenance Base**: `HUMAN_CONFIRMED` (1.0), `REPOSITORY_EVIDENCE` (0.85), `AGENT_STATEMENT` (0.7), `INFERRED` (0.5).
     - **File Anchor Intersection**: If decision's `relatedFiles` or `codeRefs.filePath` match any path in `touchPaths` (exact match or parent folder match), apply a significant boost (+0.5).
     - **Task / Query Lexical Overlap**: Matches keywords across `title`, `summary`, `rationale`, and `constraints` (+0.1 to +0.4).
     - **Drift Penalty**: If decision has active drift `FILE_DELETED` or `SYMBOL_NOT_FOUND`, deduct -0.15.
   - `rankDecisions(decisions: ProjectDecision[], options: ScoredBriefingOptions): ProjectDecision[]`
   - `buildScopedBriefing(projectId: string, options?: BriefingOptions): ProjectBriefing`:
     - **Mandatory**: All active `architecturalRules` and `currentIntent` are ALWAYS included (never dropped).
     - **Ranked**: Active decisions sorted by score and capped at `options.limit` (default 15).
3. **ProjectMemoryService & REST Endpoints**:
   - In `ProjectMemoryService.ts`:
     - Update `getProjectBriefing` and `queryDecisions` to delegate to `MemoryRelevanceEngine`.
   - In `apps/server/src/routes/memory.ts`:
     - Support query parameters on `GET /api/v1/projects/:id/memory/briefing`:
       - `?task=...&files=src/auth.ts,src/db.ts&limit=10&drift=true`
4. **MCP Memory Server (`packages/mcp-memory-server/src/index.ts`)**:
   - Update `get_project_briefing` tool schema to accept:
     - `taskDescription` (optional string): Current objective or task description.
     - `touchPaths` (optional array of strings): File paths the agent is reading or modifying.
     - `limit` (optional number): Maximum decisions to return (default 15).
   - Update `query_decisions` tool to accept `touchPaths` and `limit`.
5. **Decision Explorer UI (`apps/web/src/components/memory/DecisionExplorer.tsx`)**:
   - Add search and filter controls:
     - Search input field filtering by title, summary, constraint, and anchor file name.
     - Status filter buttons (`ALL`, `ACTIVE`, `STALE`, `SUPERSEDED`, `ARCHIVED`).
     - Drift filter toggle (`All` / `Drifted Only`).
6. **Automated Verification**:
   - Unit tests in `apps/server/src/services/memory/__tests__/MemoryRelevanceEngine.test.ts`.
   - Route tests in `apps/server/src/routes/__tests__/memory.test.ts`.
   - MCP tests in `packages/mcp-memory-server/src/__tests__/`.
   - Component filter tests in `apps/web/src/components/memory/__tests__/DecisionExplorer.test.ts`.

---

## 6. Explicitly Forbidden Changes

* Do **NOT** add external vector databases (Pinecone, Chroma, etc.) or remote embedding API calls.
* Do **NOT** exclude active `architecturalRules` or `currentIntent` from briefings — rules are mandatory governance invariants.
* Do **NOT** alter the underlying SQLite table schemas for decisions or rules.

---

## 7. Acceptance Criteria

1. `MemoryRelevanceEngine` scores decisions deterministically using file path overlap, lexical matching, provenance weight, and drift status.
2. Decisions referencing files in `touchPaths` rank higher than unrelated decisions.
3. `getProjectBriefing` caps returned decisions at the specified `limit` while preserving all active architectural rules and intent.
4. MCP tool `get_project_briefing` accepts `taskDescription` and `touchPaths` and returns the relevance-scoped briefing.
5. Decision Explorer UI provides interactive text search, status filtering, and drift filtering.
6. All test suites pass cleanly, `tsc --noEmit` reports 0 errors, and `pnpm run build` succeeds across monorepo.

---

## 8. Definition of Done

- [ ] All Acceptance Criteria independently verified
- [ ] Clean Git diff with no forbidden changes
- [ ] `tsc --noEmit` passes with 0 errors
- [ ] Relevant test suites pass
- [ ] `pnpm run build` succeeds across monorepo

---

## 9. Verification Commands

```bash
pnpm --filter asterim exec tsx src/services/memory/__tests__/MemoryRelevanceEngine.test.ts
pnpm --filter asterim exec tsx src/routes/__tests__/memory.test.ts
pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/record_decision.test.ts
pnpm --filter @asterim/web exec tsx src/components/memory/__tests__/DecisionExplorer.test.ts
pnpm --filter asterim exec tsc --noEmit
pnpm --filter @asterim/web exec tsc --noEmit
pnpm run build
```

---

## 10. Self-Review Requirements

- Inspect `git diff` against every acceptance criterion before reporting.
- Fix all discovered regressions prior to completing `reports/current.md`.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
