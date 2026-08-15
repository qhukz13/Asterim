# [TEST-P6-02] — MCP Full Lifecycle, Capability Discovery & Regression Gate

**Gate ID:** TEST-P6-02  
**Phase:** Phase 6 — AI Ecosystem & Multi-Agent Orchestration  
**Assigned Agent:** Claude Code (QA / Test Runner Agent)  
**Orchestrator:** Antigravity (CTO / Lead Architect)  
**Status:** ASSIGNED  
**Date:** 2026-08-15  

---

## 1. Objective

Execute independent quality assurance verification on the unified MCP Server Management and Capability Discovery subsystem (Tasks `P6-01` and `P6-02`), verify graceful shutdown consolidation, and run full regression testing across all 26 test suites in the monorepo (2,006+ assertions).

---

## 2. Testing Mandates & Protocols

* **QA Role Only**: Do **not** modify product code, add features, or alter test expectations.
* **Full Monorepo Regression**: Verify that all 26 test suites across Server, Web, Relay, MCP Server, and Adapters execute cleanly without regressions.
* **Capability Discovery Verification**: Verify that child stdio processes successfully negotiate JSON-RPC 2.0 `initialize` handshakes, discover tools/resources/prompts, and transition to `RUNNING` only upon readiness.
* **Unified Graceful Shutdown**: Confirm that SIGINT/SIGTERM terminates all child MCP processes, removes `server.json`, checkpoints SQLite WAL, and closes ports.

---

## 3. Verification Steps

### Step 1: Execute Full Monorepo Typecheck & Lint
```bash
pnpm run typecheck
pnpm run lint
```
* **Expectation**: 0 TypeScript compiler errors (11 Turbo tasks) and 0 ESLint errors (7 workspace packages).

### Step 2: Run MCP Capability Discovery & Process Supervisor Test Suites
```bash
pnpm --filter asterim exec tsx src/services/mcp/__tests__/McpProcessSupervisor.test.ts
pnpm --filter asterim exec tsx src/services/mcp/__tests__/McpCapabilityDiscovery.test.ts
```
* **Expectation**:
  - `McpProcessSupervisor.test.ts`: 115 / 115 assertions passing.
  - `McpCapabilityDiscovery.test.ts`: 89 / 89 assertions passing.

### Step 3: Run Full Monorepo Test Battery
```bash
pnpm run test
```
* **Expectation**: All 26 test suites pass with 0 failures across 2,006+ assertions:
  - `asterim` (Server): 13 suites (1,129 assertions)
  - `@asterim/mcp-memory-server`: 7 suites (348 assertions)
  - `@asterim/web`: 4 suites (435 assertions)
  - `@asterim/relay`: 1 suite (71 assertions)
  - `@asterim/adapters`: 1 suite (23 assertions)

### Step 4: Full Production Build Validation
```bash
pnpm run build
```
* **Expectation**: 7 / 7 Turbo packages build successfully in under 10 seconds.

---

## 4. Required Report

Write the QA execution report to `tests/report.md` following standard reporting guidelines.
