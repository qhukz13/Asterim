# Mandatory Task Lifecycle
 
No feature or bugfix skips this workflow.
 
1. **Assignment**: Read the single authoritative task from `tasks/current.md`.
2. **Context & Specification**: Read `blueprint/AI_CONTEXT.md` and the designated domain documents (e.g., `ARCHITECTURE.md`).
3. **Inspect Repository**: Inspect existing services, stores, routes, and schemas to avoid duplicating code.
4. **Implement**: Write clean, maintainable code adhering to `rules/engineering.md` within the assigned scope.
5. **Typecheck & Test**: Run TypeScript validation (`tsc --noEmit`), unit/integration test suites, and full monorepo build (`pnpm run build`).
6. **Git Diff Self-Review**: Run `git diff` and compare every change against each acceptance criterion. Fix any discovered bugs or regressions.
7. **Verify Definition of Done**: Validate against `.agents/DEFINITION_OF_DONE.md`.
8. **Report**: Overwrite `reports/current.md` using the standard report format, explicitly verifying all acceptance criteria checkboxes.
