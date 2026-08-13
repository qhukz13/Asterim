# Current Task: P5.1-06 — End-to-End Dogfood Scenario & Multi-Session Persistence

**Task ID:** P5.1-06  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-13  

---

## 1. Objective

Implement and verify the full End-to-End Cross-Agent Dogfood Scenario across multiple disjoint MCP server processes (Session A $\rightarrow$ Session B $\rightarrow$ Session C), proving cross-session memory retrieval, project isolation, and non-destructive integration with live `~/.asterim/asterim.db`.

---

## 2. Context & Scenario Flow

The core value of Asterim Project Memory is allowing successive agent sessions (Claude Code, Antigravity, Cursor, etc.) to share architectural context without manual prompting or copy-pasting.

The scenario must exercise the complete agent lifecycle:
1. **Session A (First Agent Session)**:
   - Spawns in project workspace.
   - Queries `get_project_briefing` and `query_decisions` for a target file.
   - Records an architectural decision via `record_decision`.
   - Process terminates cleanly.
2. **Session B (Subsequent Agent Session)**:
   - Spawns a completely new, independent MCP process in the same workspace.
   - Calls `get_project_briefing` and `query_decisions` — proving that Session A's decision is immediately and accurately retrieved without session bleeding or state loss.
   - Records a follow-up decision anchoring related files.
   - Process terminates cleanly.
3. **Session C (Neighbor / Foreign Project Session)**:
   - Spawns in a neighboring registered project workspace.
   - Calls `get_project_briefing` — proving zero bleeding from Project A.
   - Attempts cross-project write targeting Project A — proving strict boundary rejection.
   - Process terminates cleanly.
4. **Live System Smoke Test**:
   - If `~/.asterim/asterim.db` exists, perform a non-destructive read-only resolution check (`resolveProjectContext`) to confirm compatibility with live registered project paths.

---

## 3. Repository Evidence & Relevant Files

Inspect:
* [`packages/mcp-memory-server/src/index.ts`](file:///c:/Projects/Asterim/packages/mcp-memory-server/src/index.ts)
* [`packages/mcp-memory-server/src/resolver.ts`](file:///c:/Projects/Asterim/packages/mcp-memory-server/src/resolver.ts)
* [`packages/mcp-memory-server/src/__tests__/record_decision.test.ts`](file:///c:/Projects/Asterim/packages/mcp-memory-server/src/__tests__/record_decision.test.ts)
* [`packages/mcp-memory-server/src/__tests__/retrieval_tools.test.ts`](file:///c:/Projects/Asterim/packages/mcp-memory-server/src/__tests__/retrieval_tools.test.ts)
* [`docs/phase5-1-task-plan.md`](file:///c:/Projects/Asterim/docs/phase5-1-task-plan.md) § 2
* [`reports/current.md`](file:///c:/Projects/Asterim/reports/current.md)

---

## 4. Implementation Scope

1. **Dogfood Test Suite (`packages/mcp-memory-server/src/__tests__/dogfood_scenario.test.ts`)**:
   - Set up an isolated temp database fixture with two registered projects: `Project Primary` and `Project Neighbor`.
   - **Phase 1 (Session A)**:
     - Spawn child process in `Project Primary` workspace.
     - Execute `get_project_briefing` (assert empty initial active decisions).
     - Execute `query_decisions({ filePath: 'src/auth/jwt.ts' })` (assert empty).
     - Execute `record_decision` recording Decision A: "Use Ed25519 for Session Token Signing" anchored to `src/auth/jwt.ts`.
     - Shut down Session A process.
   - **Phase 2 (Session B)**:
     - Spawn a brand new child process in `Project Primary` workspace.
     - Execute `get_project_briefing` (assert Decision A is present in active decisions with `provenance: 'AGENT_STATEMENT'`).
     - Execute `query_decisions({ filePath: 'src/auth/jwt.ts' })` (assert Decision A returned).
     - Execute `record_decision` recording Decision B: "Set 15-Minute Expiration for Session Tokens" with constraint "Rotate signing keys every 30 days".
     - Shut down Session B process.
   - **Phase 3 (Session C - Project Neighbor)**:
     - Spawn child process in `Project Neighbor` workspace.
     - Execute `get_project_briefing` (assert 0 active decisions, 0 bleeding from Primary).
     - Execute `query_decisions({ filePath: 'src/auth/jwt.ts' })` (assert 0 decisions).
     - Attempt `record_decision({ projectId: 'primary-project-id', ... })` (assert rejected with `isError: true`).
     - Shut down Session C process.
   - **Phase 4 (Live Database Read-Only Probe)**:
     - If the user's live `~/.asterim/asterim.db` exists, verify `resolveProjectContext` reads and resolves without mutation.
2. **Close Unchecked Arguments Hazard**:
   - Optional: If unrecognised keys are passed to tools, reject or drop safely.

---

## 5. Explicitly Forbidden Changes

* Do **NOT** modify database DDL or core server tables.
* Do **NOT** perform destructive writes against the user's real `~/.asterim/asterim.db`.
* Do **NOT** modify existing services in `apps/server` or `packages/shared`.

---

## 6. Acceptance Criteria

1. Session A $\rightarrow$ Session B $\rightarrow$ Session C multi-process lifecycle is executed and verified over stdio JSON-RPC.
2. Decisions recorded in Session A are immediately visible in Session B across distinct process lifecycles.
3. Session C proves 100% project isolation and rejection of cross-project writes.
4. `dogfood_scenario.test.ts` passes 100% of assertions.
5. All regression suites (`record_decision.test.ts`, `retrieval_tools.test.ts`, `stdio_scaffold.test.ts`, `resolver.test.ts`) pass.
6. `pnpm run build` completes with 0 errors across all monorepo packages.

---

## 7. Verification Commands

```bash
pnpm --filter asterim exec tsx ../../packages/mcp-memory-server/src/__tests__/dogfood_scenario.test.ts
pnpm --filter asterim exec tsx ../../packages/mcp-memory-server/src/__tests__/record_decision.test.ts
pnpm --filter asterim exec tsx ../../packages/mcp-memory-server/src/__tests__/retrieval_tools.test.ts
pnpm --filter asterim exec tsx ../../packages/mcp-memory-server/src/__tests__/stdio_scaffold.test.ts
pnpm --filter asterim exec tsx ../../packages/mcp-memory-server/src/__tests__/resolver.test.ts
pnpm --filter @asterim/mcp-memory-server build
pnpm run build
```

---

## 8. Required Report Format

Upon completion, write the execution result directly to `reports/current.md` using the standard format:
* **Task ID**: P5.1-06
* **Status**: `IMPLEMENTED` / `VERIFIED` / `BLOCKED`
* **Summary**: Summary of the dogfood multi-session verification results
* **Files Changed**: List of files created/modified
* **Implementation Details**: Details on session isolation and live DB probing
* **Tests / Verification**: Output of test execution and build commands
* **Problems Discovered & Concerns**: Any issues encountered
* **Recommended Next Step**: Recommendation for P5.1-07 / P5.1-08 (Documentation, MCP Config, Blueprint sync)
