# Current Task: P5.4-01 — Cross-Process Memory Event Relay & Live Sync

**Task ID:** P5.4-01  
**Phase:** Phase 5.4 — Intelligent Memory & Continuous Governance  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-14  

---

## 1. Objective

Implement a lightweight, local-first cross-process event relay that enables external MCP memory server processes (`@asterim/mcp-memory-server`) to notify the running Core Fastify Server upon memory mutations, publishing events onto `EventBus` and pushing real-time (0ms) Socket.IO updates to connected web clients.

---

## 2. Context & Architectural Decisions

* **Problem Identified in Integration Gate**: When Claude Code, Cursor, or CLI agents record decisions via `@asterim/mcp-memory-server`, the writes commit to SQLite immediately via WAL, but the Core server's in-memory `EventBus` does not fire. Connected web clients only see updates upon manual page reload.
* **DEC-026 (Approved Strategy)**:
  1. Core server creates `~/.asterim/server.json` on startup with loopback port & ephemeral token.
  2. Core exposes `POST /api/v1/internal/memory-events` guarded by the loopback token.
  3. MCP client sends a non-blocking fire-and-forget loopback POST after committing to SQLite.
  4. Core validates the token and calls `eventBus.publish(event)` $\rightarrow$ `SocketManager` pushes to browser.
  5. If Core is offline, MCP continues with 0 delay and zero errors.

---

## 3. Repository Evidence & Relevant Files

Inspect:
* [`docs/phase5-4-task-plan.md`](file:///c:/Projects/Asterim/docs/phase5-4-task-plan.md) (Task P5.4-01 design)
* [`decisions.md`](file:///c:/Projects/Asterim/decisions.md) (DEC-026)
* [`apps/server/src/index.ts`](file:///c:/Projects/Asterim/apps/server/src/index.ts)
* [`apps/server/src/sockets/socketManager.ts`](file:///c:/Projects/Asterim/apps/server/src/sockets/socketManager.ts)
* [`packages/mcp-memory-server/src/index.ts`](file:///c:/Projects/Asterim/packages/mcp-memory-server/src/index.ts)
* [`packages/mcp-memory-server/src/stdio-guard.ts`](file:///c:/Projects/Asterim/packages/mcp-memory-server/src/stdio-guard.ts)

---

## 4. Implementation Scope

1. **Server Registry (`apps/server/src/services/ServerRegistry.ts`)**:
   - Generates an ephemeral cryptographic loopback token (`crypto.randomBytes(24).toString('hex')`).
   - Writes `server.json` to the Asterim data directory (`process.env.ASTERIM_DATA_DIR` or `~/.asterim`):
     ```json
     {
       "url": "http://127.0.0.1:<port>",
       "token": "<loopback-token>",
       "pid": 12345,
       "startedAt": 1723600000000
     }
     ```
   - Automatically removes `server.json` on server shutdown (`close()` / process exit).
2. **Internal Loopback Endpoint (`apps/server/src/routes/internal.ts`)**:
   - `POST /api/v1/internal/memory-events`:
     - Validates `headers['x-asterim-loopback-token'] === serverRegistry.getToken()`.
     - Validates body is a valid `AsterimEvent` with `type` starting with `memory.`.
     - Ingests and publishes to `eventBus.publish(event)`.
     - Returns `{ ok: true }`.
   - Register the route plugin in `apps/server/src/index.ts`.
3. **MCP Relay Client (`packages/mcp-memory-server/src/relay-client.ts`)**:
   - Exports `async function notifyCoreServer(event: AsterimEvent<any>): Promise<void>`.
   - Reads `server.json` from Asterim data directory.
   - If present, sends `POST <url>/api/v1/internal/memory-events` with `x-asterim-loopback-token` header and 500ms timeout.
   - Catches all connection errors (`ECONNREFUSED`, timeout) silently so MCP execution never hangs or throws.
4. **Hook MCP `record_decision`**:
   - In `packages/mcp-memory-server/src/index.ts`:
     - After successfully inserting a decision, construct the `memory.decision_created` event and call `notifyCoreServer(event)`.
5. **Automated Verification**:
   - Unit tests:
     - `apps/server/src/routes/__tests__/internal.test.ts` (test token validation, rejection of invalid tokens, and `eventBus` publishing).
     - `packages/mcp-memory-server/__tests__/relay-client.test.ts` (test relay client with mock server, missing server file, and unresponsive server).

---

## 5. Explicitly Forbidden Changes

* Do **NOT** introduce external daemon dependencies (no Redis, no ZeroMQ, no Unix socket binaries).
* Do **NOT** block MCP stdio protocol output or write diagnostic logs to `process.stdout` (preserve `stdio-guard.ts` purity per DEC-025).
* Do **NOT** duplicate `ProjectMemoryService` business logic.

---

## 6. Acceptance Criteria

1. Core Server writes `server.json` on boot and cleans it up on shutdown.
2. `POST /api/v1/internal/memory-events` rejects unauthorized requests and publishes authorized memory events to `EventBus`.
3. `record_decision` via MCP stdio successfully triggers the loopback relay and emits `memory.decision_created` to connected Socket.IO clients in 0ms.
4. If Core Server is not running, MCP `record_decision` completes normally without delay or errors.
5. All test suites pass and `pnpm run build` succeeds with 0 errors.

---

## 7. Verification Commands

```bash
pnpm --filter asterim exec tsx src/routes/__tests__/internal.test.ts
pnpm --filter @asterim/mcp-memory-server exec tsx __tests__/relay-client.test.ts
pnpm --filter @asterim/mcp-memory-server exec tsc --noEmit
pnpm --filter asterim exec tsc --noEmit
pnpm run build
```

---

## 8. Required Report Format

Upon completion, write the execution result directly to `reports/current.md` using the standard format:
* **Task ID**: P5.4-01
* **Status**: `IMPLEMENTED` / `VERIFIED` / `BLOCKED`
* **Summary**: Summary of loopback registry, internal route, and MCP relay client
* **Files Changed**: List of files created/modified
* **Tests / Verification**: Output of test suites and build commands
* **Problems Discovered & Concerns**: Any issues encountered
* **Recommended Next Step**: Recommendation for P5.4-02 (Git Staleness & Drift Engine)
