# [P6-03] — MCP Tool Invocation Engine, Change Notifications & Registry UI

**Task ID:** P6-03  
**Phase:** Phase 6 — AI Ecosystem & Multi-Agent Orchestration  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-15  

---

## 1. Objective

Implement direct MCP tool invocation in `McpProcessSupervisor` / `McpStdioClient` (`tools/call` over active stdio sessions), support dynamic capability invalidation (`notifications/tools/list_changed`), expose `POST /api/v1/mcp/servers/:id/tools/:toolName` REST endpoints, and construct the complete MCP Server Registry & Management UI in `apps/web` (`McpServerExplorer.tsx`, `McpServerModal.tsx`, `McpServerDetailDrawer.tsx`).

---

## 2. Why This Task Exists

In P6-01 and P6-02, Asterim built the process supervisor, handshake discovery, and autostart engine. However:
1. Asterim cannot yet execute tools through those open MCP sessions on behalf of agents or users.
2. If an MCP server updates its tools dynamically (e.g. connecting a database or mounting a directory), Asterim does not catch `notifications/tools/list_changed`.
3. Developers need a visual control plane in the Asterim Web UI to view registered MCP servers, inspect discovered tools & schemas, review real-time stderr logs, toggle enabled status, and add new servers with one click.

---

## 3. Context

* **Blueprint Reference**: `blueprint/ROADMAP.md` Phase 6 Deliverable 1 (MCP Management System) & `blueprint/DESIGN_SYSTEM.md`.
* **JSON-RPC Protocol**:
  - Request: `{"jsonrpc": "2.0", "id": N, "method": "tools/call", "params": {"name": "tool_name", "arguments": {...}}}`
  - Response: `{"jsonrpc": "2.0", "id": N, "result": {"content": [{"type": "text", "text": "..."}], "isError": false}}`
* **UI Architecture**:
  - Integrate into `apps/web` navigation and routing.
  - Follow the Asterim dark monochrome aesthetic with surgical emerald accents (`#10b981`).
  - Real-time Socket.IO updates on `mcp.*` events with zero page reloads.

---

## 4. Repository Evidence

Inspect:
* [`apps/server/src/services/mcp/McpProcessSupervisor.ts`](file:///c:/Projects/Asterim/apps/server/src/services/mcp/McpProcessSupervisor.ts)
* [`apps/server/src/services/mcp/McpStdioClient.ts`](file:///c:/Projects/Asterim/apps/server/src/services/mcp/McpStdioClient.ts)
* [`apps/server/src/routes/mcp.ts`](file:///c:/Projects/Asterim/apps/server/src/routes/mcp.ts)
* [`apps/web/src/components/memory/DecisionExplorer.tsx`](file:///c:/Projects/Asterim/apps/web/src/components/memory/DecisionExplorer.tsx) (UI patterns, drawers, modals, tables)
* [`apps/web/src/stores/useWorkspaceStore.ts`](file:///c:/Projects/Asterim/apps/web/src/stores/useWorkspaceStore.ts)

---

## 5. Implementation Scope

1. **Tool Invocation Engine (`McpStdioClient.ts` & `McpProcessSupervisor.ts`)**:
   - In `McpStdioClient.ts`:
     - Implement `callTool(name: string, args?: Record<string, unknown>, timeoutMs = 30000)`:
       - Sends JSON-RPC `tools/call`.
       - Handles timeout and tool execution errors (`result.isError`).
       - Returns `McpToolCallResult` (`content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>`, `isError: boolean`).
     - Handle `notifications/tools/list_changed`:
       - When received, re-trigger `discover()` and notify supervisor callback.
   - In `McpProcessSupervisor.ts`:
     - Implement `callTool(serverId: string, toolName: string, args?: Record<string, unknown>)`:
       - Verify server is `RUNNING` and tool exists in cached capabilities.
       - Execute tool via active `McpStdioClient`.
       - On `list_changed` notification from client, update cached capabilities and emit `mcp.capabilities_updated` over `EventBus`.

2. **REST API Extensions (`apps/server/src/routes/mcp.ts`)**:
   - `POST /api/v1/mcp/servers/:id/tools/:toolName` — Authenticated; accepts `{ arguments: {...} }`, calls tool and returns `{ result, isError }`.
   - Returns 404 if tool does not exist, 409 if server is not `RUNNING`, 504 on tool execution timeout.

3. **Frontend MCP Management Store & Components (`apps/web`)**:
   - Store: `apps/web/src/stores/useMcpStore.ts`:
     - Manages `servers: McpServerRuntimeInfo[]`, `activeServerId: string | null`, `isLoading: boolean`.
     - Listens to Socket.IO events (`mcp.server_started`, `mcp.server_stopped`, `mcp.server_crashed`, `mcp.capabilities_updated`) for live state updates.
     - Actions: `loadServers(workspaceId?)`, `startServer(id)`, `stopServer(id)`, `restartServer(id)`, `refreshCapabilities(id)`, `deleteServer(id)`, `callTool(id, name, args)`.
   - Component: `apps/web/src/components/mcp/McpServerExplorer.tsx`:
     - Server list with status badge (`RUNNING` emerald, `INITIALIZING` yellow, `STOPPED` slate, `CRASHED` red, `ERROR` red).
     - Tool count chip, process PID chip, uptime, transport pill.
     - Action buttons: Start, Stop, Restart, Refresh, Add Server (`+ New MCP Server`), Delete.
   - Component: `apps/web/src/components/mcp/McpServerModal.tsx`:
     - Modal for creating/editing an MCP server configuration (Name, Transport, Command, Arguments, Environment Variables JSON/Key-Value, Global vs Workspace).
   - Component: `apps/web/src/components/mcp/McpServerDetailDrawer.tsx`:
     - Slide-over drawer with tabs:
       - **Tools Tab**: List of discovered tools with descriptions, parameter JSON schemas, and an interactive "Try Tool" execution runner.
       - **Resources & Prompts Tab**: List of URI resources and prompt templates.
       - **Logs Tab**: Real-time 50-line stderr rolling log viewer with auto-scroll and copy button.

4. **Navigation & View Integration (`apps/web`)**:
   - Add MCP Registry tab / route in Workspace navigation shell (e.g. `/workspace/mcp` or Environment Settings MCP tab).

5. **Automated Unit Tests**:
   - Server: `apps/server/src/services/mcp/__tests__/McpToolInvocation.test.ts` (tool invocation, error handling, timeout, dynamic list_changed notification).
   - Web: `apps/web/src/components/mcp/__tests__/McpServerExplorer.test.ts` (store actions, component rendering, status badge mapping).
   - Wire tests into `apps/server/package.json` and `apps/web/package.json` `"test"` scripts.

---

## 6. Explicitly Forbidden Changes

* Do **NOT** execute tools when server is `STOPPED` or `CRASHED` (enforce 409 `SERVER_NOT_RUNNING`).
* Do **NOT** leak sensitive environment variables in the UI log viewer.
* Do **NOT** break any of the 26 existing test suites.

---

## 7. Acceptance Criteria

1. `McpStdioClient` and `McpProcessSupervisor` execute `tools/call` over active stdio sessions and return structured tool responses.
2. `notifications/tools/list_changed` dynamically invalidates and refreshes cached capabilities with `mcp.capabilities_updated` emitted on the EventBus.
3. `POST /api/v1/mcp/servers/:id/tools/:toolName` handles invocations, timeouts, and structured errors.
4. `McpServerExplorer.tsx`, `McpServerModal.tsx`, and `McpServerDetailDrawer.tsx` render in `apps/web` with live Socket.IO reactivity.
5. All automated unit tests pass cleanly.
6. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test` (27+ test suites), `pnpm run build`.

---

## 8. Definition of Done

- [ ] `callTool` implemented in supervisor and stdio client
- [ ] `list_changed` notification handling active
- [ ] Tool execution REST route functional
- [ ] `useMcpStore.ts` implemented with Socket.IO event binding
- [ ] `McpServerExplorer.tsx`, `McpServerModal.tsx`, `McpServerDetailDrawer.tsx` built
- [ ] New server and web test suites created and passing
- [ ] Monorepo CI gates pass cleanly

---

## 9. Verification Commands

```bash
# Run server tool invocation test suite
pnpm --filter asterim exec tsx src/services/mcp/__tests__/McpToolInvocation.test.ts

# Run web MCP component test suite
pnpm --filter @asterim/web exec tsx src/components/mcp/__tests__/McpServerExplorer.test.ts

# Run full monorepo CI pipeline
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 10. Self-Review Requirements

- Inspect `git diff` to ensure tool execution timeouts are bounded and do not leave hanging promises.
- Verify UI components adhere to WCAG contrast and accessibility standards.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
