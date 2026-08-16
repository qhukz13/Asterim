Task-ID: P6-06-FIX
Phase: 6

# P6-06-FIX — Hardened BaseAdapter Tool Call Echo De-Duplication & Flaky Test Resolution

**Task ID:** P6-06-FIX
**Phase:** 6
**Assigned Agent:** Claude Code
**Orchestrator:** Antigravity
**Status:** ASSIGNED
**Date:** 2026-08-16

---

## 1. Objective
Fix the racy tool call de-duplication in `packages/adapters/src/sdk/BaseAdapter.ts` by introducing a TTL-based time-window de-duplication mechanism for recently executed tool calls, replacing the in-flight-only tracking state. Ensure `apps/server/src/services/mcp/__tests__/AgentMcpIntegration.test.ts` passes deterministically and clears the monorepo test battery gate.

## 2. Why This Task Exists
During verification of Task P6-06, step 4 of the test gate (`pnpm run test`) failed non-deterministically (2 of 5 runs failed). The failure was traced to a flaky assertion in `AgentMcpIntegration.test.ts` (`but only once, not twice - expected 3, got 4`).
In `BaseAdapter.ts`, tool calls are currently de-duplicated based on `inFlightToolCalls: Set<string>`. When stdout chunks from node-pty arrive split across chunk boundaries, the first tool call completes and clears its in-flight key before the duplicate chunk is processed, causing the duplicate tool call to be dispatched a second time.
Adding a short TTL window (e.g. 1500ms) for recently seen tool call signatures suppresses duplicate tool invocations across chunk boundaries without affecting distinct tool calls.

## 3. Context & Repository Evidence
- `packages/adapters/src/sdk/BaseAdapter.ts` (lines 229-256): `runToolCall` de-duplication logic.
- `apps/server/src/services/mcp/__tests__/AgentMcpIntegration.test.ts` (lines 1035-1039): Flaky assertion test case.
- `tests/report.md`: QA Test Report detailing Finding 1 and root cause analysis.

## 4. Implementation Scope
1. **`BaseAdapter.ts` (`packages/adapters/src/sdk/BaseAdapter.ts`)**:
   - Update `BaseAdapter` tool call de-duplication to track executed tool call keys with timestamps in a TTL cache (e.g. 1500ms window).
   - Suppress incoming tool calls matching a recently executed signature within the TTL window.
   - Clean up expired cache entries to prevent memory growth.
2. **Deterministic Verification**:
   - Run `AgentMcpIntegration.test.ts` standalone 10 times consecutively.
   - Run `pnpm run test` 5 times consecutively to verify 100% pass rate across all 32 test suites.

## 5. Explicitly Forbidden Changes
- Do NOT delete, weaken, or modify the assertion `but only once, not twice` in `AgentMcpIntegration.test.ts`.
- Do NOT modify implementation files outside `packages/adapters/src/sdk/BaseAdapter.ts`.
- Do NOT alter any P6-06 skills subsystem code in `apps/server/src/services/skills/`.

## 6. Acceptance Criteria
1. `BaseAdapter.ts` de-duplicates tool calls using a short TTL time window (e.g. 1500ms) alongside in-flight tracking.
2. `AgentMcpIntegration.test.ts` passes 10 consecutive standalone runs with 0 failures.
3. Monorepo CI gates pass with 0 errors across 5 consecutive runs: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test` (all 32 test suites pass), `pnpm run build`.

## 7. Definition of Done
- TypeScript typecheck passes with 0 errors (`pnpm run typecheck`).
- ESLint passes with 0 errors (`pnpm run lint`).
- All 32 monorepo test suites pass deterministically with 0 failures across multiple runs (`pnpm run test`).
- Monorepo production build succeeds (`pnpm run build`).
- Execution report written to `reports/current.md`.

## 8. Verification Commands
```bash
pnpm run typecheck
pnpm run lint
pnpm --filter asterim exec tsx src/services/mcp/__tests__/AgentMcpIntegration.test.ts
pnpm run test
pnpm run build
```

## 9. Self-Review Requirements
- Inspect `git diff packages/adapters/src/sdk/BaseAdapter.ts` to confirm clean implementation.
- Verify that TTL map pruning operates cleanly without memory leaks.

## 10. Required Report
Write execution report to `reports/current.md` adhering to schema in `AGENTS.md`.
