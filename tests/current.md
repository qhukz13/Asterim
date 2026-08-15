# [TEST-P6-01] — MCP Server Supervisor & Monorepo Regression Gate

**Gate ID:** TEST-P6-01  
**Phase:** Phase 6 — AI Ecosystem & Multi-Agent Orchestration  
**Assigned Agent:** Claude Code (QA / Test Runner Agent)  
**Orchestrator:** Antigravity (CTO / Lead Architect)  
**Status:** ASSIGNED  
**Date:** 2026-08-15  

---

## 1. Objective

Execute independent quality assurance verification on the newly implemented MCP Server Manager & Multi-Process Supervisor (`P6-01`), and run full regression testing across the entire 25-suite monorepo test battery (1,917+ assertions).

---

## 2. Testing Mandates & Protocols

* **QA Role Only**: Do **not** modify product code, add features, or alter test expectations.
* **Full Monorepo Regression**: Verify that all 25 test suites across Server, Web, Relay, MCP Server, and Adapters execute cleanly without regressions.
* **Process Lifecycle Verification**: Verify that child processes spawned by `McpProcessSupervisor` are reliably tracked, log stderr, cleanly terminate on SIGTERM/SIGKILL, and report accurate HTTP status codes.
* **Environment Sanitization Verification**: Confirm that child processes never inherit Asterim Core private tokens (`STRIPE_*`, `RELAY_SECRET`, `server.json`).

---

## 3. Verification Steps

### Step 1: Execute Full Monorepo Typecheck & Lint
```bash
pnpm run typecheck
pnpm run lint
```
* **Expectation**: 0 TypeScript compiler errors (11 Turbo tasks) and 0 ESLint errors (7 workspace packages).

### Step 2: Run MCP Process Supervisor Unit & Route Tests
```bash
pnpm --filter asterim exec tsx src/services/mcp/__tests__/McpProcessSupervisor.test.ts
```
* **Expectation**: 115 / 115 assertions passing across CRUD, child process spawning, PID tracking, stderr ring buffer, crash detection, graceful termination, and REST routes.

### Step 3: Run Full Monorepo Test Battery
```bash
pnpm run test
```
* **Expectation**: All 25 test suites pass with 0 failures across 1,917+ assertions:
  - `asterim` (Server): 12 suites (1,040 assertions)
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

Write the QA execution report to `reports/current.md` (or QA report channel) following standard reporting guidelines.
