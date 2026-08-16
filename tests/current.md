Task-ID: P6-07

## Verification Commands
1. Run Typecheck:
   `pnpm run typecheck`
   PASS: 0 TypeScript errors across all Turbo tasks.

2. Run Lint:
   `pnpm run lint`
   PASS: 0 ESLint errors across workspace packages.

3. Run Standalone Profile Unit Tests:
   `pnpm --filter asterim exec tsx src/services/ai/__tests__/ProfileService.test.ts`
   `pnpm --filter @asterim/web exec tsx src/components/profiles/__tests__/ProfileSelector.test.ts`
   PASS: All profile unit and integration test assertions pass deterministically.

4. Run Full Monorepo Test Battery:
   `pnpm run test`
   PASS: All test suites pass with 0 failures across consecutive forced runs.

5. Run Production Build:
   `pnpm run build`
   PASS: All workspace packages build successfully.
