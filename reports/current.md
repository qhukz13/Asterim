# Execution Report: P5.1-01 — MCP Architecture & Transport Audit

**Task ID:** P5.1-01  
**Status:** VERIFIED  
**Date:** 2026-08-13  
**Author:** Claude Code  
**Reviewed By:** Antigravity Orchestrator  

---

## 1. Summary

A read-only architecture, transport, and dependency audit was performed to determine the exact packaging, `@modelcontextprotocol/sdk` integration, service re-use pattern, stdio logging isolation, and project resolution strategy for `@asterim/mcp-memory-server` (`packages/mcp-memory-server`) before any code or package configuration is written.

All audit findings were documented in `docs/p5.1-01-audit-report.md`.

---

## 2. Files Inspected & Changed

* **Files Inspected:**
  - `pnpm-workspace.yaml`, `package.json`, `packages/adapters/package.json`, `packages/shared/package.json`, `apps/server/package.json`
  - `apps/server/src/services/ProjectMemoryService.ts`, `apps/server/src/services/DatabaseService.ts`, `apps/server/src/services/ProjectManager.ts`
  - `docs/phase5-1-task-plan.md`, `docs/phase5-0-completion-report.md`, `blueprint/ARCHITECTURE.md` § 8, `blueprint/DOMAIN_MODEL.md` § Project Memory
* **Files Changed:**
  - `docs/p5.1-01-audit-report.md` (created historical audit log)
  - Zero code, dependency, or configuration files were modified.

---

## 3. Implementation Details & Key Findings

1. **MCP SDK & Zod**:
   - `@modelcontextprotocol/sdk` is referenced only as an optional peer in the lockfile; it must be installed as `@modelcontextprotocol/sdk@^1.30.0` along with `zod@^4.4.3` in `packages/mcp-memory-server/package.json`.
   - The SDK supports CommonJS via export conditions; keeping `packages/mcp-memory-server` CJS aligns with monorepo base tsconfig.
2. **Service Re-use**:
   - `ProjectMemoryService` has a clean dependency closure (`crypto`, `DatabaseService`, `EventBus`, `@asterim/shared` types) with zero Fastify, Socket.IO, or web controller dependencies.
   - It can be initialized directly in-process against SQLite (`~/.asterim/asterim.db`) in WAL mode.
3. **Stdio Protocol Safety (Critical Trap)**:
   - `DatabaseService` logs to `console.log` on instantiation (`[Database] Using database at...`). In stdio transport, this corrupts JSON-RPC messages on `process.stdout`.
   - A `stdio-guard.ts` module must be loaded **first** to redirect `globalThis.console = new console.Console(process.stderr, process.stderr)`.
4. **Project Identity Resolution**:
   - `ProjectManager` does not have a `getProjectByPath` method.
   - The MCP resolver should query `projects` table directly and perform normalized path comparison with longest-prefix matching to handle nested project roots cleanly.

---

## 4. Verification & Build Results

* `pnpm --filter @asterim/shared build`: Exit 0 (clean build)
* `pnpm run build`: 6/6 tasks successful, Exit 0
* `tsc -p apps/server/tsconfig.json --noEmit`: 4 pre-existing errors on `main`, zero new errors.

---

## 5. Architectural Concerns & Blockers

* **Blockers:** None.
* **Key Concerns for P5.1-02:**
  - `stdio-guard.ts` must execute before any `DatabaseService` import.
  - `engines.node` must be `>=22` for native `node:sqlite`.

---

## 6. Recommended Next Step

Proceed to **Task P5.1-02 — MCP Memory Server Package & Project Context Scaffold**:
* Create `packages/mcp-memory-server` package structure.
* Add dependencies (`@modelcontextprotocol/sdk`, `zod`, `@asterim/shared`).
* Implement `stdio-guard.ts` and scaffold the stdio MCP server entrypoint with basic `tools/list` handshake.
