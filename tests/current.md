# [TEST-P6-04] — Agent Tool Bridge, Schema Validation & Per-Server Queueing Gate

**Gate ID:** TEST-P6-04  
**Phase:** Phase 6 — AI Ecosystem & Multi-Agent Orchestration  
**Assigned Agent:** Claude Code (QA / Test Runner Agent)  
**Orchestrator:** Antigravity (CTO / Lead Architect)  
**Status:** ASSIGNED  
**Date:** 2026-08-16  

---

## 1. Objective

Execute independent quality assurance verification on the newly implemented Agent Tool Bridge (`McpAgentBridge.ts`), input schema validation engine (`SchemaValidator.ts`), per-server invocation queueing (`SerialQueue`), and unified auth headers (`apps/web/src/utils/auth.ts`), and run full regression testing across all 29 test suites in the monorepo (2,220+ assertions).

---

## 2. Testing Mandates & Protocols

* **QA Role Only**: Do **not** modify product code, add features, or alter test expectations.
* **Full Monorepo Regression**: Verify that all 29 test suites across Server, Web, Relay, MCP Server, and Adapters execute cleanly without regressions.
* **Schema Validation & Queue Safety**: Verify that `SchemaValidator` properly rejects malformed arguments with detailed field paths, and `SerialQueue` strictly serializes concurrent tool calls to a single stdio child process without stream collisions or slot leaks.
* **Unified Auth Verification**: Confirm that `getAuthHeaders` correctly resolves both local `asterim_token` and remote `asterim_token_<url>`.

---

## 3. Verification Steps

### Step 1: Execute Full Monorepo Typecheck & Lint
```bash
pnpm run typecheck
pnpm run lint
```
* **Expectation**: 0 TypeScript compiler errors (11 Turbo tasks) and 0 ESLint errors (7 workspace packages).

### Step 2: Run MCP Agent Bridge & Schema Validation Test Suite
```bash
pnpm --filter asterim exec tsx src/services/mcp/__tests__/McpAgentBridge.test.ts
```
* **Expectation**: 67 / 67 assertions passing across schema validation, queue serialization, namespacing, and error formatting.

### Step 3: Run Full Monorepo Test Battery
```bash
pnpm run test
```
* **Expectation**: All 29 test suites pass with 0 failures across 2,220+ assertions:
  - `asterim` (Server): 15 suites (1,239 assertions)
  - `@asterim/mcp-memory-server`: 7 suites (348 assertions)
  - `@asterim/web`: 5 suites (539 assertions)
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
