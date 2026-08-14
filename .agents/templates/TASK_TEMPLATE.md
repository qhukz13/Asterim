# [Task ID] — [Task Title]

**Task ID:** [e.g. P5.4-03]  
**Phase:** [Phase Name]  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** [YYYY-MM-DD]  

---

## 1. Objective
[Clear 1-2 sentence description of what will be achieved]

## 2. Why This Task Exists
[Strategic and architectural motivation within the phase roadmap]

## 3. Context
[Architectural background, relevant ADRs, DEC decisions]

## 4. Repository Evidence
[Key files, services, schemas, routes to inspect before starting]

## 5. Implementation Scope
[Concrete breakdown of files to create/modify and components to build]

## 6. Explicitly Forbidden Changes
[Strict architectural and security boundaries]

## 7. Acceptance Criteria
1. [Criterion 1]
2. [Criterion 2]
3. [Criterion 3]

## 8. Definition of Done
- [ ] All Acceptance Criteria independently verified
- [ ] Clean Git diff with no forbidden changes
- [ ] `tsc --noEmit` passes with 0 errors
- [ ] Relevant test suites pass
- [ ] `pnpm run build` succeeds across monorepo

## 9. Verification Commands
```bash
[Exact CLI commands to run for tests, typechecks, and builds]
```

## 10. Self-Review Requirements
- Inspect `git diff` against every acceptance criterion before reporting.
- Fix all discovered regressions prior to completing `reports/current.md`.

## 11. Required Report
Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
