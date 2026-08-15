# [P6-02] — MCP Capability Discovery, Stdio Handshake & Boot Autostart

**Task ID:** P6-02  
**Phase:** Phase 6 — AI Ecosystem & Multi-Agent Orchestration  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-15  

---

## 1. Objective

Implement JSON-RPC 2.0 stdio handshake and capability discovery in `McpProcessSupervisor`: perform `initialize` negotiation upon process spawn, query `tools/list`, `resources/list`, and `prompts/list`, cache discovered capabilities on the server runtime model, expose `GET /api/v1/mcp/servers/:id/capabilities`, emit `mcp.*` status events onto the Asterim `EventBus`, implement boot-time autostart for enabled servers, and consolidate process graceful shutdown into a unified sequence.

---

## 2. Why This Task Exists

In P6-01, `McpProcessSupervisor` was built to supervise child processes and capture stderr logs. However, process existence (`RUNNING`) is not yet semantic readiness: Asterim does not know what tools, resources, or prompts an MCP server provides until a JSON-RPC 2.0 `initialize` handshake is performed.

Discovering and caching capabilities allows Asterim to:
1. Guarantee that a server is truly ready to handle agent tool invocations.
2. Provide Asterim UI and Agent profiles with a searchable catalog of available tools (e.g. `filesystem:read_file`, `postgres:query`, `github:create_issue`).
3. Auto-start enabled MCP servers on Asterim Core boot so agent tools are instantly available without manual intervention.

---

## 3. Context

* **Blueprint Reference**: `blueprint/ROADMAP.md` Phase 6 Deliverable 1 (MCP Registry & Capability Control) & `blueprint/ARCHITECTURE.md`.
* **JSON-RPC 2.0 Protocol (Model Context Protocol Specification)**:
  - Client sends `initialize` request with client info & capabilities.
  - Server responds with server info, protocol version, and server capabilities.
  - Client sends `notifications/initialized`.
  - Client queries `tools/list`, `resources/list`, `prompts/list`.
* **EventBus Bridge**: Status transitions (`mcp.server_started`, `mcp.server_stopped`, `mcp.server_crashed`, `mcp.capabilities_updated`) should emit to `eventBus` so connected Web UI clients receive instant state updates over Socket.IO.

---

## 4. Repository Evidence

Inspect:
* [`apps/server/src/services/mcp/McpProcessSupervisor.ts`](file:///c:/Projects/Asterim/apps/server/src/services/mcp/McpProcessSupervisor.ts)
* [`packages/shared/src/types/mcp.ts`](file:///c:/Projects/Asterim/packages/shared/src/types/mcp.ts)
* [`apps/server/src/services/EventBus.ts`](file:///c:/Projects/Asterim/apps/server/src/services/EventBus.ts)
* [`packages/mcp-memory-server/src/index.ts`](file:///c:/Projects/Asterim/packages/mcp-memory-server/src/index.ts)
* [`apps/server/src/routes/mcp.ts`](file:///c:/Projects/Asterim/apps/server/src/routes/mcp.ts)
* [`apps/server/src/index.ts`](file:///c:/Projects/Asterim/apps/server/src/index.ts)

---

## 5. Implementation Scope

1. **Shared Types (`packages/shared/src/types/mcp.ts`)**:
   - Define capability interfaces:
     ```ts
     export interface McpToolDefinition {
       name: string;
       description?: string;
       inputSchema?: Record<string, unknown>;
     }

     export interface McpResourceDefinition {
       uri: string;
       name: string;
       description?: string;
       mimeType?: string;
     }

     export interface McpPromptDefinition {
       name: string;
       description?: string;
       arguments?: Array<{ name: string; description?: string; required?: boolean }>;
     }

     export interface McpServerCapabilities {
       tools: McpToolDefinition[];
       resources: McpResourceDefinition[];
       prompts: McpPromptDefinition[];
       protocolVersion?: string;
       serverInfo?: { name: string; version: string };
       discoveredAt: number;
     }
     ```
   - Augment `McpServerRuntimeInfo` with `capabilities?: McpServerCapabilities | null` and status `INITIALIZING`.

2. **Stdio JSON-RPC 2.0 Handshake Client (`apps/server/src/services/mcp/McpStdioClient.ts`)**:
   - Connects to child process stdin/stdout with newline-delimited JSON-RPC framing.
   - Implements request/response multiplexing with timeout (default: 5000ms):
     - Sends `initialize` request (`protocolVersion: '2024-11-05'`, `clientInfo: { name: 'asterim-core', version: '0.1.0' }`).
     - Awaits response, then sends `notifications/initialized`.
     - Calls `tools/list`, `resources/list`, and `prompts/list` (handling optional capability flags).
   - Returns structured `McpServerCapabilities`.
   - Keeps tool session open for dynamic queries or closes gracefully when only probing.

3. **`McpProcessSupervisor.ts` Upgrades**:
   - State transition during start: `STARTING` → `INITIALIZING` (handshake in progress) → `RUNNING` (ready with cached capabilities) or `ERROR` (handshake failed/timeout).
   - EventBus emissions: publish `mcp.server_started`, `mcp.server_stopped`, `mcp.server_crashed`, and `mcp.capabilities_updated` with `McpServerRuntimeInfo`.
   - Boot Autostart: `autostartEnabledServers()` reads all servers with `is_enabled = 1` from SQLite and starts them in parallel on Asterim Core boot.
   - Graceful Shutdown Consolidation: Implement single-owner `setupGracefulShutdown(fastifyServer)` that traps `SIGINT`/`SIGTERM`, closes Fastify, shuts down all MCP servers, closes SQLite connections, and removes `server.json`.

4. **REST API Extensions (`apps/server/src/routes/mcp.ts`)**:
   - `GET /api/v1/mcp/servers/:id/capabilities` — Returns cached tools, resources, and prompts for the server.
   - `POST /api/v1/mcp/servers/:id/refresh` — Re-runs discovery handshake and updates cached capabilities.

5. **Automated Unit & Integration Test Suite (`apps/server/src/services/mcp/__tests__/McpCapabilityDiscovery.test.ts`)**:
   - Test JSON-RPC handshake against a real mock stdio MCP server (e.g. small Node script responding to `initialize`, `tools/list`, `resources/list`).
   - Test capability caching and schema parsing.
   - Test handshake timeout (slow child transitions to `ERROR`).
   - Test `autostartEnabledServers()` booting only `isEnabled: true` servers.
   - Test EventBus emissions on status changes.
   - Test REST route `GET /capabilities` and `POST /refresh`.
   - Wire into `apps/server/package.json` `"test"` script.

---

## 6. Explicitly Forbidden Changes

* Do **NOT** block Asterim startup if an external MCP server fails to start (log warning, mark `ERROR`, continue boot).
* Do **NOT** leak stdin/stdout tool payload data into persistent log tables.
* Do **NOT** break any existing tests or typechecks.

---

## 7. Acceptance Criteria

1. `McpStdioClient` conducts JSON-RPC 2.0 `initialize` handshake and retrieves `tools/list`, `resources/list`, `prompts/list`.
2. `McpProcessSupervisor` caches discovered capabilities and transitions status to `RUNNING` only after successful handshake.
3. Handshake failures or timeouts cleanly mark the server as `ERROR` with the error reason recorded.
4. `autostartEnabledServers()` starts enabled servers on Core boot without blocking server startup on failed children.
5. `mcp.*` events are emitted onto `EventBus` on all state transitions.
6. Unified graceful shutdown terminates all MCP child processes cleanly on `SIGINT`/`SIGTERM`.
7. `McpCapabilityDiscovery.test.ts` passes with comprehensive assertions.
8. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`.

---

## 8. Definition of Done

- [ ] Shared capability types defined in `@asterim/shared`
- [ ] `McpStdioClient.ts` implemented and tested
- [ ] Handshake discovery integrated into `McpProcessSupervisor`
- [ ] `autostartEnabledServers()` implemented
- [ ] EventBus notifications active
- [ ] `GET /capabilities` REST route functional
- [ ] Unified graceful shutdown sequence in `index.ts`
- [ ] New test suite passing
- [ ] Monorepo CI gates pass cleanly

---

## 9. Verification Commands

```bash
# Run new MCP Capability Discovery unit test suite
pnpm --filter asterim exec tsx src/services/mcp/__tests__/McpCapabilityDiscovery.test.ts

# Run all MCP test suites
pnpm --filter asterim exec tsx src/services/mcp/__tests__/McpProcessSupervisor.test.ts

# Run full monorepo CI pipeline
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 10. Self-Review Requirements

- Verify JSON-RPC message framing handles fragmented buffers over stdio streams.
- Ensure `EventBus` events adhere to the established `@asterim/shared` event format.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
