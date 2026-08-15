# [P6-05] — Agent Adapter Integration, Tool Execution Gateway & Security Gate

**Task ID:** P6-05  
**Phase:** Phase 6 — AI Ecosystem & Multi-Agent Orchestration  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-16  

---

## 1. Objective

Wire `McpAgentBridge` into the Agent Execution Engine (`AgentService`, `AdapterManager`, and agent adapters): dynamically advertise available MCP tools when an agent session begins, intercept and execute agent tool calls through the bridge, integrate tool calls into the Command Security Guard for human approval of sensitive actions, and author comprehensive end-to-end integration tests.

---

## 2. Why This Task Exists

In P6-01 through P6-04, Asterim built the complete MCP substrate: process supervision, capability discovery, autostart, web management UI, stdio tool execution, JSON Schema pre-validation, and per-server concurrency serialization.

However, running AI agents cannot yet call these tools. This task connects the bridge to the agent runtime, enabling agents (`claude`, `aider`, `antigravity`) to seamlessly invoke tools from any running MCP server while preserving security guardrails and human approvals.

---

## 3. Context

* **Blueprint Reference**: `blueprint/ROADMAP.md` Phase 6 Deliverable 1 (MCP System) & `blueprint/ARCHITECTURE.md` § 4 (Adapters).
* **Execution Flow**:
  1. Agent Session Spawn: `AgentService` queries `McpAgentBridge.getAvailableTools(workspaceId)` and passes tool configurations / system prompt instructions to the agent adapter.
  2. Tool Invocation Interception: When the agent emits a tool call event (e.g. `mcp__filesystem__read_file` or structured JSON tool call), the adapter intercepts it.
  3. Security Gate: If the tool requires approval (or touches protected resources), the server emits `agent:approval_required` and pauses execution until approved in the UI.
  4. Tool Execution: The call routes through `McpAgentBridge.executeTool()`, and the formatted output returns into the agent's active stream.

---

## 4. Repository Evidence

Inspect:
* [`apps/server/src/services/AgentService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/AgentService.ts)
* [`packages/adapters/src/BaseAdapter.ts`](file:///c:/Projects/Asterim/packages/adapters/src/BaseAdapter.ts)
* [`packages/adapters/src/ClaudeAdapter.ts`](file:///c:/Projects/Asterim/packages/adapters/src/ClaudeAdapter.ts)
* [`packages/adapters/src/AiderAdapter.ts`](file:///c:/Projects/Asterim/packages/adapters/src/AiderAdapter.ts)
* [`apps/server/src/services/mcp/McpAgentBridge.ts`](file:///c:/Projects/Asterim/apps/server/src/services/mcp/McpAgentBridge.ts)
* [`apps/server/src/services/CommandApprovalService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/CommandApprovalService.ts)

---

## 5. Implementation Scope

1. **Adapter Tool Interception & Bridge Interface (`packages/adapters` & `apps/server`)**:
   - In `BaseAdapter.ts`:
     - Add `registerToolExecutor(executor: (toolName: string, args: Record<string, unknown>) => Promise<McpToolCallResult>)`.
     - Add support for tool call parsing from agent output streams.
   - In `AgentService.ts`:
     - When starting a thread/session, bind `McpAgentBridge.executeTool` to the adapter's tool executor.
     - Provide available tool list in session startup payload.

2. **Security Gate & Approval Integration (`CommandApprovalService.ts`)**:
   - Extend approval policies to cover sensitive MCP tool invocations (e.g. destructive writes or external network requests).
   - If approval is required, pause tool execution, emit `agent:approval_required` over EventBus/Socket.IO, and resume execution upon human approval.

3. **Multi-Agent Tool Formatting & Prompt Integration**:
   - Format MCP tool schemas cleanly for agent system prompts / adapter CLI tool definitions.
   - Return structured results (`text`, `isError`, `content`) formatted appropriately for the calling agent.

4. **Automated Integration Test Suite (`apps/server/src/services/mcp/__tests__/AgentMcpIntegration.test.ts`)**:
   - Test end-to-end agent session launch with dynamically attached MCP tools.
   - Test agent tool call interception and execution via `McpAgentBridge`.
   - Test approval gate pausing and resuming tool execution.
   - Test error handling when an agent calls an invalid tool or passes invalid parameters.
   - Wire into `apps/server/package.json` `"test"` script.

---

## 6. Explicitly Forbidden Changes

* Do **NOT** bypass human approval gates for destructive tool calls when strict security mode is active.
* Do **NOT** crash the agent process if an individual tool call fails or times out.
* Do **NOT** break any existing tests or monorepo CI gates.

---

## 7. Acceptance Criteria

1. `AgentService` dynamically discovers available MCP tools and exposes them to initialized agent sessions.
2. Agent tool invocations are intercepted and routed through `McpAgentBridge.executeTool()`.
3. Sensitive tool calls correctly trigger human approval requests via `CommandApprovalService` when configured.
4. Tool outputs and errors are returned cleanly into the agent's conversation stream without crashing the adapter.
5. `AgentMcpIntegration.test.ts` passes with comprehensive end-to-end assertions.
6. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test` (30 test suites), `pnpm run build`.

---

## 8. Definition of Done

- [ ] Tool executor registered in `BaseAdapter` / `AgentService`
- [ ] Agent tool call interception and bridge execution active
- [ ] Security approval gate integrated for sensitive tools
- [ ] `AgentMcpIntegration.test.ts` created and passing
- [ ] All 30 test suites passing across the monorepo
- [ ] Monorepo CI gates pass cleanly

---

## 9. Verification Commands

```bash
# Run new Agent MCP Integration test suite
pnpm --filter asterim exec tsx src/services/mcp/__tests__/AgentMcpIntegration.test.ts

# Run all agent adapter test suites
pnpm --filter @asterim/adapters exec tsx src/__tests__/ProcessManager.test.ts

# Run full monorepo CI pipeline
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 10. Self-Review Requirements

- Verify that pending tool approval requests properly time out or cancel if the agent thread is terminated by the user.
- Ensure tool execution results are accurately captured in the session transcript.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
