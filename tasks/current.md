# [P5.6-01] — CI Test Suite Automation & ESLint Debt Resolution

**Task ID:** P5.6-01  
**Phase:** Phase 5.6 — SaaS Foundation & Commercial Beta Release  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-14  

---

## 1. Objective

Clear all 64 pre-existing ESLint errors across `apps/server` and `@asterim/adapters`, wire all 21 Phase 5 test suites (1,540 assertions) into package-level `test` scripts and a consolidated `turbo run test` task, and update `.github/workflows/ci.yml` so that CI enforces Typecheck, Lint, Test, and Build with 100% green status.

---

## 2. Why This Task Exists

During the Phase 5 Production Gate (`GATE-P5`), 21 self-contained test suites were verified. However, they currently execute only when run by hand because `turbo.json` lacks a `test` task. Furthermore, `pnpm run lint` fails on `main` due to 64 mechanical lint errors (~40 in `apps/server`, ~24 in `@asterim/adapters`).

Resolving lint debt and wiring automated test execution into CI creates a permanent, standing regression guard before developing SaaS relay authentication, Stripe billing, or container deployment.

---

## 3. Context

* **GATE-P5 Audit**: [`docs/phase5-production-gate.md`](file:///c:/Projects/Asterim/docs/phase5-production-gate.md) (§8.1 CI/Lint Gap and §15 Recommendation H1).
* **Phase 5 Reconciliation**: [`docs/phase5-reconciliation.md`](file:///c:/Projects/Asterim/docs/phase5-reconciliation.md) (§4 Task P5.6-01).
* Common ESLint error patterns to fix cleanly:
  - `no-empty`: Empty catch blocks must carry an explicit comment or logged warning.
  - `no-useless-assignment`: Variables initialized or assigned but overwritten before being read.
  - `preserve-caught-error`: Rethrown errors must attach `{ cause: err }`.
  - `no-this-alias`: Avoid `const self = this`.
  - `no-unused-vars` / `no-explicit-any`.

---

## 4. Repository Evidence

Inspect:
* [`.github/workflows/ci.yml`](file:///c:/Projects/Asterim/.github/workflows/ci.yml)
* [`turbo.json`](file:///c:/Projects/Asterim/turbo.json)
* [`package.json`](file:///c:/Projects/Asterim/package.json)
* [`apps/server/package.json`](file:///c:/Projects/Asterim/apps/server/package.json)
* [`packages/mcp-memory-server/package.json`](file:///c:/Projects/Asterim/packages/mcp-memory-server/package.json)
* [`apps/web/package.json`](file:///c:/Projects/Asterim/apps/web/package.json)
* [`packages/adapters/package.json`](file:///c:/Projects/Asterim/packages/adapters/package.json)
* [`apps/server/src/`](file:///c:/Projects/Asterim/apps/server/src)
* [`packages/adapters/src/`](file:///c:/Projects/Asterim/packages/adapters/src)

---

## 5. Implementation Scope

1. **Resolve ESLint Errors**:
   - Fix all ~40 lint errors in `apps/server/src/**`.
   - Fix all ~24 lint errors in `packages/adapters/src/**`.
   - Do NOT use blanket `/* eslint-disable */` file disables; fix the underlying code cleanly.

2. **Package Test Scripts & Turbo Task**:
   - Add `"test"` scripts to each package that holds tests:
     - `apps/server/package.json`: Run its 9 test suites (`MemoryRelevanceEngine`, `memory` routes, `memory-candidates` routes, `internal` routes, `DecisionExtractor`, `GitDriftDetector`, `SovereignMode`, `PairingService`, `ProjectMemoryService`).
     - `packages/mcp-memory-server/package.json`: Run its 7 test suites (`retrieval_tools`, `record_decision`, `dogfood_scenario`, `relay-client`, `relay_e2e`, `resolver`, `stdio_scaffold`).
     - `apps/web/package.json`: Run its 4 test suites (`DecisionExplorer`, `CandidateReview`, `MemoryTimeline`, `useMemoryStore`).
     - `packages/adapters/package.json`: Run its test suite (`ProcessManager`).
   - In `turbo.json`:
     ```json
     "test": {
       "dependsOn": ["^build"]
     }
     ```
   - In root `package.json`:
     ```json
     "test": "turbo run test"
     ```

3. **CI Pipeline Integration (`.github/workflows/ci.yml`)**:
   - Ensure the workflow executes in order:
     1. `pnpm run typecheck`
     2. `pnpm run lint`
     3. `pnpm run test`
     4. `pnpm run build`

---

## 6. Explicitly Forbidden Changes

* Do **NOT** disable ESLint rules in `.eslintrc` or `eslint.config.js`.
* Do **NOT** delete or skip any of the 21 Phase 5 test suites.
* Do **NOT** alter application business logic or SQLite database schemas.

---

## 7. Acceptance Criteria

1. `pnpm run lint` passes across the entire monorepo with **0 errors and 0 warnings**.
2. `pnpm run test` executes all 21 test suites via Turbo and passes with **0 failures (1,540+ assertions)**.
3. `pnpm run typecheck` continues to pass cleanly with **0 errors**.
4. `pnpm run build` succeeds across all 7 workspace packages.
5. `.github/workflows/ci.yml` is updated with the `pnpm run test` step.

---

## 8. Definition of Done

- [ ] `pnpm run lint` reports 0 errors repo-wide
- [ ] `pnpm run test` passes across all workspace packages
- [ ] `pnpm run typecheck` passes (11/11 turbo tasks)
- [ ] `pnpm run build` passes (7/7 packages)
- [ ] Clean Git diff with no unwanted changes

---

## 9. Verification Commands

```bash
# Run lint check across all packages
pnpm run lint

# Run all test suites via Turbo
pnpm run test

# Run typecheck
pnpm run typecheck

# Run full monorepo build
pnpm run build
```

---

## 10. Self-Review Requirements

- Inspect `git diff` to confirm lint fixes are clean and preserve original behavior.
- Ensure all 21 test suites are wired into `pnpm run test` without any suite left out.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
