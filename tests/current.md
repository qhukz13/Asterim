# [TEST-P6-03] — MCP Tool Invocation Engine & Web Registry UI Gate

**Gate ID:** TEST-P6-03  
**Phase:** Phase 6 — AI Ecosystem & Multi-Agent Orchestration  
**Assigned Agent:** Claude Code (QA / Test Runner Agent)  
**Orchestrator:** Antigravity (CTO / Lead Architect)  
**Status:** ASSIGNED  
**Date:** 2026-08-15  

---

## 1. Objective

Execute independent quality assurance verification on the newly implemented MCP Tool Invocation Engine, dynamic capability invalidation (`list_changed`), and the React Web Registry UI (`apps/web`), and run full regression testing across all 28 test suites in the monorepo (2,153+ assertions).

---

## 2. Testing Mandates & Protocols

* **QA Role Only**: Do **not** modify product code, add features, or alter test expectations.
* **Full Monorepo Regression**: Verify that all 28 test suites across Server, Web, Relay, MCP Server, and Adapters execute cleanly without regressions.
* **Tool Invocation Verification**: Verify that `tools/call` over active stdio sessions correctly executes tools, returns structured content/error status, and survives timeouts without pipe corruption.
* **Dynamic Invalidation Verification**: Confirm that `notifications/tools/list_changed` automatically triggers capability re-discovery and emits `mcp.capabilities_updated` on the EventBus.
* **Web Component & Store Verification**: Confirm `useMcpStore.ts` and `McpServerExplorer.tsx` render accurately and react to Socket.IO events.

---

## 3. Verification Steps

### Step 1: Execute Full Monorepo Typecheck & Lint
```bash
pnpm run typecheck
pnpm run lint
```
* **Expectation**: 0 TypeScript compiler errors (11 Turbo tasks) and 0 ESLint errors (7 workspace packages).

### Step 2: Run MCP Tool Invocation & Web Explorer Test Suites
```bash
pnpm --filter asterim exec tsx src/services/mcp/__tests__/McpToolInvocation.test.ts
pnpm --filter @asterim/web exec tsx src/components/mcp/__tests__/McpServerExplorer.test.ts
```
* **Expectation**:
  - `McpToolInvocation.test.ts`: 43 / 43 assertions passing.
  - `McpServerExplorer.test.ts`: 104 / 104 assertions passing.

### Step 3: Run Full Monorepo Test Battery
```bash
pnpm run test
```
* **Expectation**: All 28 test suites pass with 0 failures across 2,153+ assertions:
  - `asterim` (Server): 14 suites (1,172 assertions)
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
