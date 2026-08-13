# Current Task: P5.1-02 — MCP Memory Server Package & Stdio Scaffold

**Task ID:** P5.1-02  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-13  

---

## 1. Objective

Create the `@asterim/mcp-memory-server` package (`packages/mcp-memory-server`), configure the build pipeline and dependencies (`@modelcontextprotocol/sdk`, `zod`), implement the `stdio-guard.ts` stream isolation module, and scaffold the stdio MCP server entrypoint with a working JSON-RPC handshake.

---

## 2. Context & Findings from P5.1-01

* `@modelcontextprotocol/sdk` must be installed at `^1.30.0` along with `zod@^4.4.3`.
* `node:sqlite` in `DatabaseService` outputs `[Database] Using database at...` to `console.log`. Over stdio transport, this corrupts JSON-RPC message frames on `process.stdout`.
* `src/stdio-guard.ts` must execute as the **first import** in the entrypoint to redirect `globalThis.console` to `process.stderr` before any service or SDK module loads.
* The package must produce a standalone executable binary (`dist/index.js`) with shebang banner `#!/usr/bin/env node` for invocation by Claude Code (`claude mcp add`) and other MCP clients.

---

## 3. Repository Evidence & Relevant Files

Inspect:
* [`packages/adapters/package.json`](file:///c:/Projects/Asterim/packages/adapters/package.json)
* [`packages/shared/package.json`](file:///c:/Projects/Asterim/packages/shared/package.json)
* [`apps/server/package.json`](file:///c:/Projects/Asterim/apps/server/package.json)
* [`apps/server/tsup.config.ts`](file:///c:/Projects/Asterim/apps/server/tsup.config.ts)
* [`tsconfig.base.json`](file:///c:/Projects/Asterim/tsconfig.base.json)
* [`docs/p5.1-01-audit-report.md`](file:///c:/Projects/Asterim/docs/p5.1-01-audit-report.md)
* [`reports/current.md`](file:///c:/Projects/Asterim/reports/current.md)

---

## 4. Implementation Scope

1. **Package Setup (`packages/mcp-memory-server/package.json`)**:
   - Package name: `"@asterim/mcp-memory-server"`, version `"0.1.0"`, `"private": true`.
   - Binary entrypoint: `"bin": { "asterim-mcp-memory": "./dist/index.js" }`.
   - Node engine: `"engines": { "node": ">=22" }`.
   - Dependencies:
     - `"@modelcontextprotocol/sdk": "^1.30.0"`
     - `"zod": "^4.4.3"`
     - `"@asterim/shared": "workspace:*"`
     - `"asterim": "workspace:*"` (for in-process access to `ProjectMemoryService` and `DatabaseService`)
   - Dev dependencies: `"tsup": "^8.0.0"`, `"typescript": "^5.4.0"`, `"@types/node": "^20.0.0"`.
   - Scripts: `"build": "tsup"`, `"dev": "tsup --watch"`.
2. **Build Configuration**:
   - `packages/mcp-memory-server/tsconfig.json` extending `../../tsconfig.base.json`.
   - `packages/mcp-memory-server/tsup.config.ts` configuring CommonJS build, bundling entrypoint `src/index.ts`, externalizing `node:sqlite`, and injecting shebang `#!/usr/bin/env node`.
3. **Stdio Protocol Guard (`packages/mcp-memory-server/src/stdio-guard.ts`)**:
   - Redirect all console methods to `stderr`:
     ```typescript
     globalThis.console = new console.Console(process.stderr, process.stderr);
     ```
4. **Server Entrypoint (`packages/mcp-memory-server/src/index.ts`)**:
   - Must start with: `import './stdio-guard';`
   - Initialize MCP Server using `@modelcontextprotocol/sdk` (`Server` with `StdioServerTransport` or `McpServer`).
   - Declare server metadata: `name: 'asterim-mcp-memory'`, `version: '0.1.0'`.
   - Connect transport to stdio and handle graceful shutdown on `SIGINT` and `SIGTERM`.
5. **Stdio Protocol Verification Test (`packages/mcp-memory-server/src/__tests__/stdio_scaffold.test.ts`)**:
   - Spawns the server binary with `ASTERIM_DATA_DIR` directed to a temp directory.
   - Sends an MCP `initialize` request via stdin:
     `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0.0"}}}`
   - Asserts that stdout receives **strictly valid JSON-RPC frames** and 0 raw console log lines.
   - Cleans up child process and temp directory.

---

## 5. Explicitly Forbidden Changes

* Do **NOT** implement the individual memory tools (`get_project_briefing`, `query_decisions`, `record_decision`) yet — reserved for P5.1-04 and P5.1-05.
* Do **NOT** implement project identity resolution yet — reserved for P5.1-03.
* Do **NOT** modify existing services in `apps/server` or `packages/shared`.
* Do **NOT** alter existing database DDL schemas.

---

## 6. Acceptance Criteria

1. `packages/mcp-memory-server` is configured, installed, and builds cleanly with `pnpm --filter @asterim/mcp-memory-server build`.
2. `dist/index.js` is generated with executable shebang `#!/usr/bin/env node`.
3. `stdio_scaffold.test.ts` passes: stdout produces clean JSON-RPC initialize response with zero stray logging text.
4. `pnpm run build` completes with 0 errors across all monorepo packages.

---

## 7. Verification Commands

```bash
pnpm install
pnpm --filter @asterim/mcp-memory-server build
pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/stdio_scaffold.test.ts
pnpm run build
```

---

## 8. Required Report Format

Upon completion, write the execution result directly to `reports/current.md` using the standard format:
* **Task ID**: P5.1-02
* **Status**: `IMPLEMENTED` / `VERIFIED` / `BLOCKED`
* **Summary**: Summary of package creation and stdio transport setup
* **Files Changed**: List of files created/modified
* **Implementation Details**: Details on SDK wiring and stdio guard
* **Tests / Verification**: Output of test execution and build commands
* **Problems Discovered & Concerns**: Any issues encountered
* **Recommended Next Step**: Recommendation for P5.1-03
