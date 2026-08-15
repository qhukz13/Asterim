# [P6-01] — MCP Server Manager Core & Multi-Process Supervisor

**Task ID:** P6-01  
**Phase:** Phase 6 — AI Ecosystem & Multi-Agent Orchestration  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-15  

---

## 1. Objective

Implement the core MCP Server Management subsystem in `apps/server`: create SQLite schema for registered MCP servers, author `McpProcessSupervisor.ts` for spawning, health-monitoring, restarting, and capturing stderr logs from child MCP processes (stdio transport), and expose authenticated `/api/v1/mcp/servers` REST endpoints.

---

## 2. Why This Task Exists

Asterim is evolving into the universal control plane for AI engineering. While Asterim now provides its own Project Memory MCP Server (`@asterim/mcp-memory-server`), developers frequently rely on multiple external MCP servers (filesystem, Postgres, GitHub, Brave Search, custom tools).

Currently, external MCP servers must be configured by hand in individual agent configuration files. The MCP Server Manager provides Asterim with a centralized supervisor that manages the lifecycle, configuration, health monitoring, and log capture of all MCP servers running on the developer's workstation.

---

## 3. Context

* **Blueprint Reference**: `blueprint/ROADMAP.md` Phase 6 Deliverable 1 (MCP Management System) & `blueprint/ARCHITECTURE.md`.
* **Subsystem Architecture**:
  - MCP servers run as isolated child processes communicating over `stdio` (JSON-RPC) or local HTTP/SSE.
  - The supervisor tracks process state (`STOPPED`, `STARTING`, `RUNNING`, `CRASHED`), ping health, memory/uptime, and a rolling ring-buffer of recent stderr logs.
  - Configuration persists locally in SQLite `~/.asterim/asterim.db`.

---

## 4. Repository Evidence

Inspect:
* [`apps/server/src/services/DatabaseService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/DatabaseService.ts) (Table schema creation and `PRAGMA busy_timeout = 5000`)
* [`packages/adapters/src/sdk/ProcessManager.ts`](file:///c:/Projects/Asterim/packages/adapters/src/sdk/ProcessManager.ts) (Child process management patterns)
* [`apps/server/src/services/ProcessTreeManager.ts`](file:///c:/Projects/Asterim/apps/server/src/services/ProcessTreeManager.ts)
* [`packages/mcp-memory-server/src/index.ts`](file:///c:/Projects/Asterim/packages/mcp-memory-server/src/index.ts)
* [`apps/server/src/index.ts`](file:///c:/Projects/Asterim/apps/server/src/index.ts)

---

## 5. Implementation Scope

1. **SQLite Database Schema (`DatabaseService.ts`)**:
   - Add `mcp_servers` table:
     ```sql
     CREATE TABLE IF NOT EXISTS mcp_servers (
       id TEXT PRIMARY KEY,
       workspace_id TEXT,
       name TEXT NOT NULL,
       transport TEXT NOT NULL DEFAULT 'stdio',
       command TEXT NOT NULL,
       args_json TEXT NOT NULL DEFAULT '[]',
       env_json TEXT NOT NULL DEFAULT '{}',
       is_enabled INTEGER NOT NULL DEFAULT 1,
       is_global INTEGER NOT NULL DEFAULT 0,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS idx_mcp_servers_workspace ON mcp_servers(workspace_id);
     ```

2. **Shared Types (`packages/shared/src/types/mcp.ts`)**:
   - Define:
     ```ts
     export type McpTransport = 'stdio' | 'sse';
     export type McpServerStatus = 'STOPPED' | 'STARTING' | 'RUNNING' | 'CRASHED' | 'ERROR';

     export interface McpServerConfig {
       id: string;
       workspaceId?: string | null;
       name: string;
       transport: McpTransport;
       command: string;
       args: string[];
       env?: Record<string, string>;
       isEnabled: boolean;
       isGlobal: boolean;
       createdAt: number;
       updatedAt: number;
     }

     export interface McpServerRuntimeInfo extends McpServerConfig {
       status: McpServerStatus;
       pid?: number | null;
       uptimeSeconds?: number;
       recentStderrLogs: string[];
       lastError?: string | null;
     }
     ```
   - Export from `packages/shared/src/index.ts`.

3. **`McpProcessSupervisor.ts` (`apps/server/src/services/mcp/McpProcessSupervisor.ts`)**:
   - Manages lifecycle for registered MCP servers:
     - `startServer(id: string)`: Spawns the child process via `child_process.spawn` (with `env` isolation and path resolution), captures stdout/stderr, tracks PID.
     - `stopServer(id: string)`: Sends `SIGTERM` with 3s timeout before `SIGKILL`.
     - `restartServer(id: string)`: Performs clean stop and start.
     - `getServerStatus(id: string)`: Returns `McpServerRuntimeInfo` with status, PID, and rolling buffer of last 50 stderr lines.
     - `listServers(workspaceId?: string)`: Loads server configs from SQLite and augments with live runtime info.
     - `saveServer(config)` / `deleteServer(id)`: Database CRUD operations.
     - `shutdownAll()`: Gracefully terminates all active MCP processes on Asterim Core shutdown.

4. **REST API Routes (`apps/server/src/routes/mcp.ts`)**:
   - `GET /api/v1/mcp/servers` — List MCP servers (filtered by optional `?workspaceId=`) with runtime status.
   - `POST /api/v1/mcp/servers` — Create a new MCP server configuration.
   - `GET /api/v1/mcp/servers/:id` — Get server config & runtime metrics.
   - `PATCH /api/v1/mcp/servers/:id` — Update server config (name, command, args, env, isEnabled).
   - `DELETE /api/v1/mcp/servers/:id` — Stop process and delete server configuration.
   - `POST /api/v1/mcp/servers/:id/start` — Start stopped server.
   - `POST /api/v1/mcp/servers/:id/stop` — Stop running server.
   - `POST /api/v1/mcp/servers/:id/restart` — Restart server process.
   - `GET /api/v1/mcp/servers/:id/logs` — Retrieve rolling stderr logs.
   - Register route in `apps/server/src/index.ts`.

5. **Automated Unit Test Suite (`apps/server/src/services/mcp/__tests__/McpProcessSupervisor.test.ts`)**:
   - Test CRUD operations on `mcp_servers` SQLite table.
   - Test starting a sample child process (e.g. `node -e "..."` or mock echo stdio server), verifying status changes to `RUNNING` and PID tracking.
   - Test stderr capture in rolling ring-buffer.
   - Test stopping and restarting child process.
   - Test crash detection (process exiting with non-zero exit code marks status `CRASHED`).
   - Test REST route handlers using `fastify.inject()`.
   - Wire into `apps/server/package.json` `"test"` script.

---

## 6. Explicitly Forbidden Changes

* Do **NOT** run external child processes with elevated/root privileges.
* Do **NOT** allow MCP processes to inherit Asterim Core's internal server tokens (`server.json` or `STRIPE_*` keys).
* Do **NOT** break any of the existing 24 test suites or monorepo build gates.

---

## 7. Acceptance Criteria

1. SQLite table `mcp_servers` is created idempotently during database initialization.
2. `McpProcessSupervisor` reliably spawns, tracks, stops, and restarts child processes with PID and stderr logging.
3. Crashing child processes are detected and transition status cleanly to `CRASHED`.
4. All `/api/v1/mcp/servers` REST endpoints return accurate status and handle invalid inputs with structured error responses.
5. `McpProcessSupervisor.test.ts` passes with comprehensive assertions.
6. All monorepo CI gates pass cleanly: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test` (25 test suites), `pnpm run build`.

---

## 8. Definition of Done

- [ ] `mcp_servers` table added to SQLite schema
- [ ] Shared MCP types added to `@asterim/shared`
- [ ] `McpProcessSupervisor.ts` implemented
- [ ] `/api/v1/mcp/servers` routes registered and functional
- [ ] `McpProcessSupervisor.test.ts` created and passing
- [ ] `pnpm run test` passes across all packages
- [ ] Clean Git diff

---

## 9. Verification Commands

```bash
# Run new MCP Process Supervisor unit test suite
pnpm --filter asterim exec tsx src/services/mcp/__tests__/McpProcessSupervisor.test.ts

# Run all server test suites
pnpm --filter asterim exec tsx src/routes/__tests__/internal.test.ts

# Run full monorepo CI pipeline
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 10. Self-Review Requirements

- Inspect `git diff` to ensure environment variables passed to child MCP processes are sanitized (never leaking Asterim server private keys).
- Verify `shutdownAll()` is registered on Fastify server shutdown hook.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
