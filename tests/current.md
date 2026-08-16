Task-ID: P6-06-FIX

## Verification Commands
1. Run Typecheck:
   `pnpm run typecheck`
   PASS: 0 TypeScript errors across 11 Turbo tasks.

2. Run Lint:
   `pnpm run lint`
   PASS: 0 ESLint errors across 7 workspace packages.

3. Run Standalone Integration Test:
   `pnpm --filter asterim exec tsx src/services/mcp/__tests__/AgentMcpIntegration.test.ts`
   PASS: 160/160 assertions pass deterministically across 10 consecutive executions.

4. Run Full Monorepo Test Battery:
   `pnpm run test`
   PASS: All 32 test suites pass with 0 failures across 5 consecutive runs.

5. Run Production Build:
   `pnpm run build`
   PASS: All 7 Turbo packages build successfully.
