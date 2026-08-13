# Current Task: P5.1-04 — MCP Memory Retrieval Tools

**Task ID:** P5.1-04  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-13  

---

## 1. Objective

Implement and register the first two Project Memory retrieval tools (`get_project_briefing` and `query_decisions`) in `@asterim/mcp-memory-server`, wire project context resolution at startup in `src/index.ts`, and verify execution via stdio JSON-RPC tool calls against `ProjectMemoryService`.

---

## 2. Context & Requirements

* The server must resolve the active project at startup using `resolveProjectContext` and `parseResolveOptionsFromArgv(process.argv.slice(2))`. If resolution fails, output the error to `stderr` and exit 1 (never let unhandled exceptions escape to stdout).
* Tools must translate MCP parameters, delegate directly to `ProjectMemoryService` without duplicating queries or business logic, and return standard MCP `CallToolResult` responses.
* `get_project_briefing`: Calls `projectMemoryService.getProjectBriefing(targetProjectId)`.
* `query_decisions`: Calls `projectMemoryService.findRelevantDecisions(targetProjectId, filePath)` if `filePath` is supplied, else `projectMemoryService.listDecisions(targetProjectId, { status })`.
* Errors must be caught and returned as `{ isError: true, content: [{ type: 'text', text: '...' }] }` rather than throwing and dropping the stdio transport connection.

---

## 3. Repository Evidence & Relevant Files

Inspect:
* [`packages/mcp-memory-server/src/index.ts`](file:///c:/Projects/Asterim/packages/mcp-memory-server/src/index.ts)
* [`packages/mcp-memory-server/src/resolver.ts`](file:///c:/Projects/Asterim/packages/mcp-memory-server/src/resolver.ts)
* [`apps/server/src/services/ProjectMemoryService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/ProjectMemoryService.ts)
* [`packages/shared/src/types/memory.ts`](file:///c:/Projects/Asterim/packages/shared/src/types/memory.ts)
* [`docs/phase5-1-task-plan.md`](file:///c:/Projects/Asterim/docs/phase5-1-task-plan.md) § 2
* [`reports/current.md`](file:///c:/Projects/Asterim/reports/current.md)

---

## 4. Implementation Scope

1. **Server Entrypoint (`packages/mcp-memory-server/src/index.ts`)**:
   - Parse CLI arguments on startup: `parseResolveOptionsFromArgv(process.argv.slice(2))`.
   - Call `resolveProjectContext(options)` inside `main()`.
   - Catch resolution errors: write message to `console.error` and exit 1.
   - Register `ListToolsRequestSchema` handler advertising:
     - `get_project_briefing` with description and schema (`projectId?: string`).
     - `query_decisions` with description and schema (`filePath?: string`, `status?: string`, `projectId?: string`).
   - Register `CallToolRequestSchema` handler:
     - Route `get_project_briefing`:
       - `targetProjectId = args?.projectId || resolvedProject.id`
       - Calls `projectMemoryService.getProjectBriefing(targetProjectId)`
       - Returns `{ content: [{ type: 'text', text: JSON.stringify({ briefing }, null, 2) }] }`
     - Route `query_decisions`:
       - `targetProjectId = args?.projectId || resolvedProject.id`
       - If `args?.filePath`: calls `projectMemoryService.findRelevantDecisions(targetProjectId, args.filePath)`
       - Else: calls `projectMemoryService.listDecisions(targetProjectId, { status: args?.status })`
       - Returns `{ content: [{ type: 'text', text: JSON.stringify({ decisions }, null, 2) }] }`
     - Unknown tool name: returns `{ isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] }`
     - Wrap handler execution in try/catch to return `{ isError: true, content: [{ type: 'text', text: String(err) }] }`.
2. **Tool Retrieval Test Suite (`packages/mcp-memory-server/src/__tests__/retrieval_tools.test.ts`)**:
   - Spawn server binary with `--project <testProjectId>` and `ASTERIM_DATA_DIR` pointing to temp directory.
   - Seed temp database with:
     - Project row (`id`, `name`, `path`).
     - 2 decisions (1 active with code ref pointing to `src/auth.ts`, 1 archived).
     - 1 architectural rule.
     - 1 active project intent.
   - Test JSON-RPC `tools/list`:
     - Asserts `get_project_briefing` and `query_decisions` are listed with valid parameter schemas.
   - Test JSON-RPC `tools/call` for `get_project_briefing`:
     - Asserts response is successful (not `isError`).
     - Asserts JSON parsed body contains active decisions, rule, intent, and summary arrays.
   - Test JSON-RPC `tools/call` for `query_decisions`:
     - Test `filePath: "src/auth.ts"` returns the matching decision.
     - Test `status: "ACTIVE"` returns only active decisions.
     - Test query on non-existent project returns empty array or handled error.

---

## 5. Explicitly Forbidden Changes

* Do **NOT** implement `record_decision` yet — reserved for P5.1-05.
* Do **NOT** modify existing services in `apps/server` or `packages/shared`.
* Do **NOT** alter existing database DDL schemas.

---

## 6. Acceptance Criteria

1. `tools/list` returns `get_project_briefing` and `query_decisions` with complete schemas.
2. `tools/call` for `get_project_briefing` delegates to `projectMemoryService.getProjectBriefing` and returns deterministic briefing JSON.
3. `tools/call` for `query_decisions` delegates to `findRelevantDecisions` (when `filePath` is set) or `listDecisions` (when `status` is set).
4. Errors are caught and returned safely as MCP error payloads without crashing stdio transport.
5. Unit test suite `retrieval_tools.test.ts` passes 100% of assertions.
6. `pnpm run build` completes with 0 errors across all monorepo packages.

---

## 7. Verification Commands

```bash
pnpm --filter asterim exec tsx ../../packages/mcp-memory-server/src/__tests__/retrieval_tools.test.ts
pnpm --filter @asterim/mcp-memory-server build
pnpm run build
```

---

## 8. Required Report Format

Upon completion, write the execution result directly to `reports/current.md` using the standard format:
* **Task ID**: P5.1-04
* **Status**: `IMPLEMENTED` / `VERIFIED` / `BLOCKED`
* **Summary**: Summary of tool implementations and stdio integration
* **Files Changed**: List of files created/modified
* **Implementation Details**: Details on request routing and error handling
* **Tests / Verification**: Output of test execution and build commands
* **Problems Discovered & Concerns**: Any issues encountered
* **Recommended Next Step**: Recommendation for P5.1-05
