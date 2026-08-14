# Definition of Done

A task is complete **ONLY IF**:

- [x] Specification and Blueprint rules respected.
- [x] Architecture and domain model preserved (no speculative changes).
- [x] All Acceptance Criteria in `tasks/current.md` independently verified.
- [x] Git diff inspected and verified clean (no stray files, no unwanted mutations).
- [x] TypeScript typechecking passes without errors (`tsc --noEmit`).
- [x] Automated test suites pass for all touched packages.
- [x] Monorepo build passes cleanly (`pnpm run build`).
- [x] Documentation & tests synchronized where required.
- [x] Standard execution report written to `reports/current.md`.
