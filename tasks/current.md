# Current Task: P5.1-05 — `record_decision` MCP Tool & Input Validation

**Task ID:** P5.1-05  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-13  

---

## 1. Objective

Implement and register the `record_decision` MCP tool in `@asterim/mcp-memory-server`, enforce project boundary scoping, validate input against domain enums, set agent-appropriate defaults (`provenance: 'AGENT_STATEMENT'`, `confidence: 0.75`), and verify persistence through stdio JSON-RPC tool calls against `ProjectMemoryService`.

---

## 2. Context & Design Decisions

* **Project Scoping Guarantee**: An MCP agent process is scoped to its resolved project. If `args.projectId` is provided, it **must** equal `resolvedProject.id`. Attempting to record a decision for another project ID must be rejected with an `isError` response (`"Cannot record decision for project '...' from workspace of project '...'"`).
* **Agent Defaults**: Default `provenance` to `'AGENT_STATEMENT'` and default `confidence` to `0.75` if omitted. Default `status` to `'ACTIVE'`.
* **Input Validation**: Use exported `DECISION_STATUSES` and `DECISION_PROVENANCES` from `ProjectMemoryService` to reject misspelled enums in-band before invoking the service. Required fields are `title`, `summary`, `rationale`.
* **Scaffold Test Synchronization**: Update `stdio_scaffold.test.ts` tool-list assertion to expect all 3 registered tools: `['get_project_briefing', 'query_decisions', 'record_decision']`.

---

## 3. Repository Evidence & Relevant Files

Inspect:
* [`packages/mcp-memory-server/src/index.ts`](file:///c:/Projects/Asterim/packages/mcp-memory-server/src/index.ts)
* [`packages/mcp-memory-server/src/__tests__/stdio_scaffold.test.ts`](file:///c:/Projects/Asterim/packages/mcp-memory-server/src/__tests__/stdio_scaffold.test.ts)
* [`apps/server/src/services/ProjectMemoryService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/ProjectMemoryService.ts)
* [`packages/shared/src/types/memory.ts`](file:///c:/Projects/Asterim/packages/shared/src/types/memory.ts)
* [`docs/phase5-1-task-plan.md`](file:///c:/Projects/Asterim/docs/phase5-1-task-plan.md) § 2
* [`reports/current.md`](file:///c:/Projects/Asterim/reports/current.md)

---

## 4. Implementation Scope

1. **Server Entrypoint (`packages/mcp-memory-server/src/index.ts`)**:
   - In `ListToolsRequestSchema`, add `record_decision`:
     - Description: "Record an architectural decision, rationale, constraints, and related files for the project."
     - Properties:
       - `title`: string (required)
       - `summary`: string (required)
       - `rationale`: string (required)
       - `constraints`: string[] (optional)
       - `relatedFiles`: string[] (optional)
       - `codeRefs`: Array<{ filePath?: string, symbolName?: string, commitHash?: string }> (optional)
       - `confidence`: number (optional, 0.0 to 1.0)
       - `status`: enum `DECISION_STATUSES` (optional, default: 'ACTIVE')
       - `provenance`: enum `DECISION_PROVENANCES` (optional, default: 'AGENT_STATEMENT')
       - `projectId`: string (optional, must match resolved project)
     - `required`: `['title', 'summary', 'rationale']`
   - In `CallToolRequestSchema`, route `record_decision`:
     - Validate required fields (`title`, `summary`, `rationale`). Return `isError` if missing or blank.
     - Validate `projectId`: if passed and non-blank, assert `args.projectId === resolvedProject.id`. Return `isError` on mismatch.
     - Validate `status` against `DECISION_STATUSES` (if provided).
     - Validate `provenance` against `DECISION_PROVENANCES` (if provided).
     - Validate `confidence` is a number in `[0.0, 1.0]` (if provided).
     - Call `projectMemoryService.createDecision({ projectId: resolvedProject.id, title, summary, rationale, constraints, relatedFiles, codeRefs, confidence: confidence ?? 0.75, status: status ?? 'ACTIVE', provenance: provenance ?? 'AGENT_STATEMENT' })`.
     - Return `{ content: [{ type: 'text', text: JSON.stringify({ decision }, null, 2) }] }`.
2. **Update Scaffold Test (`packages/mcp-memory-server/src/__tests__/stdio_scaffold.test.ts`)**:
   - Update `tools/list` assertion to verify all 3 tools: `['get_project_briefing', 'query_decisions', 'record_decision']`.
3. **Record Decision Test Suite (`packages/mcp-memory-server/src/__tests__/record_decision.test.ts`)**:
   - Spawn server binary with `--project <testProjectId>` against a temporary SQLite database.
   - Test `tools/list` advertises `record_decision` with required `['title', 'summary', 'rationale']`.
   - Test recording with minimal required fields: verifies created decision has `status: 'ACTIVE'`, `provenance: 'AGENT_STATEMENT'`, `confidence: 0.75`.
   - Test recording with full fields: `constraints`, `relatedFiles`, `codeRefs`, custom `confidence`, `provenance`.
   - Test retrieval integration: recorded decision is immediately visible in `query_decisions({ filePath })` and `get_project_briefing()`.
   - Test cross-project mismatch rejection: passing a different `projectId` returns `isError: true` with explanation.
   - Test validation rejections: missing title/summary/rationale, invalid status enum, invalid provenance enum, out-of-range confidence.
   - Test database persistence: verify decision row directly in SQLite database table `project_decisions`.

---

## 5. Explicitly Forbidden Changes

* Do **NOT** modify existing services in `apps/server` or `packages/shared`.
* Do **NOT** alter existing database DDL schemas.
* Do **NOT** add speculative MCP tools outside the 3 specified in the task plan.

---

## 6. Acceptance Criteria

1. `tools/list` advertises all 3 core memory tools (`get_project_briefing`, `query_decisions`, `record_decision`).
2. `record_decision` creates and persists architectural decisions with `provenance: 'AGENT_STATEMENT'` and default confidence `0.75`.
3. Cross-project write attempts are strictly rejected with an in-band `isError` response.
4. Newly recorded decisions are immediately retrievable via `query_decisions` and `get_project_briefing`.
5. Unit test suites (`record_decision.test.ts`, `retrieval_tools.test.ts`, `stdio_scaffold.test.ts`, `resolver.test.ts`) pass 100% of assertions.
6. `pnpm run build` completes with 0 errors across all monorepo packages.

---

## 7. Verification Commands

```bash
pnpm --filter asterim exec tsx ../../packages/mcp-memory-server/src/__tests__/record_decision.test.ts
pnpm --filter asterim exec tsx ../../packages/mcp-memory-server/src/__tests__/retrieval_tools.test.ts
pnpm --filter asterim exec tsx ../../packages/mcp-memory-server/src/__tests__/stdio_scaffold.test.ts
pnpm --filter @asterim/mcp-memory-server build
pnpm run build
```

---

## 8. Required Report Format

Upon completion, write the execution result directly to `reports/current.md` using the standard format:
* **Task ID**: P5.1-05
* **Status**: `IMPLEMENTED` / `VERIFIED` / `BLOCKED`
* **Summary**: Summary of `record_decision` implementation and validation rules
* **Files Changed**: List of files created/modified
* **Implementation Details**: Details on defaults, enum checks, and scoping enforcement
* **Tests / Verification**: Output of test execution and build commands
* **Problems Discovered & Concerns**: Any issues encountered
* **Recommended Next Step**: Recommendation for P5.1-06 (End-to-End Dogfood Scenario)
