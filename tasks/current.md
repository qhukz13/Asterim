# [P6-04] — Agent Tool Bridge, Schema Validation & Per-Server Queueing

**Task ID:** P6-04  
**Phase:** Phase 6 — AI Ecosystem & Multi-Agent Orchestration  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-15  

---

## 1. Objective

Implement the Agent MCP Tool Bridge (`McpAgentBridge.ts`) connecting running AI agents to supervised MCP servers: perform input schema validation against cached tool definitions, enforce per-server invocation queueing to prevent stdio stream corruption under concurrent load, aggregate available tools across enabled servers, unify remote auth token handling in the Web UI, and author comprehensive unit tests.

---

## 2. Why This Task Exists

Asterim can now discover MCP servers and execute tools over stdio. However:
1. **Agent Access**: AI agents running in Asterim (`claude`, `aider`, `antigravity`) need a unified bridge to discover and invoke tools provided by any running MCP server.
2. **Pipe Safety**: A stdio MCP server communicates over a single standard input/output pipe. Concurrent tool invocations without queueing risk interleaved bytes and protocol crashes.
3. **Schema Validation**: Passing malformed tool arguments down to a third-party MCP server produces obscure error messages. Pre-validating arguments against the cached `inputSchema` provides immediate, actionable feedback to the calling agent.
4. **Token Consistency**: `useMcpStore` and `useMemoryStore` currently use `asterim_token` while remote workstations require `asterim_token_<url>`.

---

## 3. Context

* **Blueprint Reference**: `blueprint/ROADMAP.md` Phase 6 Deliverable 1 (MCP System) & `blueprint/ARCHITECTURE.md` § 4 (Adapters).
* **Architecture Pattern**:
  - `McpAgentBridge` sits between `AgentService` / `AdapterManager` and `McpProcessSupervisor`.
  - When an agent is initialized for a project, `McpAgentBridge.getToolsForAgent(workspaceId)` returns tools from all global and workspace-scoped `RUNNING` MCP servers.
  - When an agent executes a tool (`mcp__<serverName>__<toolName>`), `McpAgentBridge.executeTool()` validates input schemas, enqueues the call, routes to `McpProcessSupervisor.callTool()`, and returns formatted results into the agent's context.

---

## 4. Repository Evidence

Inspect:
* [`apps/server/src/services/mcp/McpProcessSupervisor.ts`](file:///c:/Projects/Asterim/apps/server/src/services/mcp/McpProcessSupervisor.ts)
* [`apps/server/src/services/mcp/McpStdioClient.ts`](file:///c:/Projects/Asterim/apps/server/src/services/mcp/McpStdioClient.ts)
* [`packages/adapters/src/BaseAdapter.ts`](file:///c:/Projects/Asterim/packages/adapters/src/BaseAdapter.ts) (Command queueing patterns)
* [`apps/web/src/stores/useMcpStore.ts`](file:///c:/Projects/Asterim/apps/web/src/stores/useMcpStore.ts)
* [`apps/web/src/stores/useMemoryStore.ts`](file:///c:/Projects/Asterim/apps/web/src/stores/useMemoryStore.ts)

---

## 5. Implementation Scope

1. **Schema Validation Helper (`apps/server/src/services/mcp/SchemaValidator.ts`)**:
   - Validate incoming tool argument objects against cached `inputSchema` (properties, required fields, type checks: string, number, boolean, object, array).
   - Return `{ valid: boolean; errors?: string[] }`.
   - Pre-validate before routing to stdio.

2. **Per-Server Concurrency Queue (`apps/server/src/services/mcp/McpProcessSupervisor.ts` / `McpStdioClient.ts`)**:
   - Implement invocation queue per running server instance.
   - Enforce maximum concurrent active tool calls (default: 1 concurrent per stdio pipe to guarantee zero stream multiplexing collisions).
   - Additional concurrent calls wait in FIFO order with bounded queue depth (e.g. 20) and timeout.

3. **`McpAgentBridge.ts` (`apps/server/src/services/mcp/McpAgentBridge.ts`)**:
   - `getAvailableTools(workspaceId?: string)`:
     - Returns namespaced tools: `mcp__${server.name}__${tool.name}` with description and parameters formatted for agent consumption.
   - `executeTool(namespacedToolName: string, args: Record<string, unknown>, workspaceId?: string)`:
     - Parses server name and tool name.
     - Resolves server instance and validates schema.
     - Executes via `McpProcessSupervisor.callTool()`.
     - Returns agent-standard tool result string / error string.

4. **Unified Auth Helper (`apps/web/src/utils/auth.ts`)**:
   - Create shared `getAuthHeaders(backendUrl?: string)` supporting both local `asterim_token` and per-backend `asterim_token_<url>`.
   - Update `useMcpStore.ts` and `useMemoryStore.ts` to use the unified helper.

5. **Automated Unit Test Suite (`apps/server/src/services/mcp/__tests__/McpAgentBridge.test.ts`)**:
   - Test `SchemaValidator` (required parameters, type mismatches, missing fields).
   - Test per-server serialized queueing (burst of 5 concurrent tool calls resolve cleanly in sequence without pipe corruption).
   - Test `McpAgentBridge` tool aggregation and namespaced invocation.
   - Test error formatting for agent consumption.
   - Wire into `apps/server/package.json` `"test"` script.

---

## 6. Explicitly Forbidden Changes

* Do **NOT** allow unbounded queue growth (reject calls beyond queue depth with 429 `QUEUE_FULL`).
* Do **NOT** allow unhandled schema validation errors to crash the process.
* Do **NOT** break any of the 28 existing test suites.

---

## 7. Acceptance Criteria

1. `SchemaValidator` validates tool arguments against `inputSchema` and returns detailed field errors.
2. Concurrent tool calls to a single stdio MCP server are serialized through the per-server queue without stream corruption.
3. `McpAgentBridge` aggregates tools across all `RUNNING` servers and executes namespaced tool calls.
4. `useMcpStore` and `useMemoryStore` use unified `getAuthHeaders` across local and remote connections.
5. `McpAgentBridge.test.ts` passes with comprehensive assertions.
6. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test` (29 test suites), `pnpm run build`.

---

## 8. Definition of Done

- [ ] `SchemaValidator.ts` created and verified
- [ ] Per-server queueing implemented in supervisor/client
- [ ] `McpAgentBridge.ts` implemented and tested
- [ ] `getAuthHeaders` unified in `apps/web/src/utils/auth.ts`
- [ ] `McpAgentBridge.test.ts` passing
- [ ] Monorepo CI gates pass cleanly

---

## 9. Verification Commands

```bash
# Run new Agent Bridge & Schema Validation test suite
pnpm --filter asterim exec tsx src/services/mcp/__tests__/McpAgentBridge.test.ts

# Run all MCP test suites
pnpm --filter asterim exec tsx src/services/mcp/__tests__/McpToolInvocation.test.ts

# Run full monorepo CI pipeline
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 10. Self-Review Requirements

- Verify concurrent tool calls properly release the queue mutex even when a tool execution fails or times out.
- Ensure schema validator does not throw unhandled exceptions on circular or malformed schemas.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
