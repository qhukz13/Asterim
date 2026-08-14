# [P5.4-03] — Decision Extraction Queue & Candidate Review UI

**Task ID:** P5.4-03  
**Phase:** Phase 5.4 — Intelligent Memory & Continuous Governance  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-14  

---

## 1. Objective

Implement the staged decision extraction pipeline and Candidate Review UI (`candidate_decisions` table, local transcript extraction service, approval/rejection REST lifecycle, and Candidate Review Drawer in Decision Explorer), enforcing human confirmation before candidate decisions become authoritative project memory.

---

## 2. Why This Task Exists

During active coding sessions, agents frequently make architectural commitments, enforce patterns, and establish project rules. However, allowing autonomous, unconfirmed LLM writes directly into `project_decisions` risks memory pollution and hallucination compounding across sessions.

Under **DEC-027** and **DEC-028**, Asterim resolves this by staging detected decisions into a dedicated `candidate_decisions` queue that requires explicit human review and approval before becoming permanent memory.

---

## 3. Context

* **DEC-027**: Staged Decision Candidate Queue. Extraction must write to `candidate_decisions` (`status: 'PENDING'`), and only human approval transitions records to `project_decisions` with `provenance: 'HUMAN_CONFIRMED'`.
* **DEC-028**: Data Sovereignty. Extraction must operate locally and respect `isSovereignMode()`.
* **DEC-024**: Provenance and confidence model.

---

## 4. Repository Evidence

Inspect:
* [`apps/server/src/services/ProjectMemoryService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/ProjectMemoryService.ts)
* [`apps/server/src/services/DatabaseService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/DatabaseService.ts)
* [`apps/server/src/routes/memory.ts`](file:///c:/Projects/Asterim/apps/server/src/routes/memory.ts)
* [`apps/server/src/services/SovereignMode.ts`](file:///c:/Projects/Asterim/apps/server/src/services/SovereignMode.ts)
* [`apps/server/src/services/git/GitDriftDetector.ts`](file:///c:/Projects/Asterim/apps/server/src/services/git/GitDriftDetector.ts) (re-use path/hash validation)
* [`apps/web/src/components/memory/DecisionExplorer.tsx`](file:///c:/Projects/Asterim/apps/web/src/components/memory/DecisionExplorer.tsx)
* [`apps/web/src/stores/useMemoryStore.ts`](file:///c:/Projects/Asterim/apps/web/src/stores/useMemoryStore.ts)
* [`packages/shared/src/types/memory.ts`](file:///c:/Projects/Asterim/packages/shared/src/types/memory.ts)

---

## 5. Implementation Scope

1. **Shared Types (`packages/shared/src/types/memory.ts`)**:
   - Define `CandidateDecision`:
     - `id: string`
     - `projectId: string`
     - `sessionId?: string`
     - `threadId?: string`
     - `title: string`
     - `summary: string`
     - `rationale: string`
     - `constraints: string[]`
     - `relatedFiles: string[]`
     - `codeRefs: CreateCodeRefInput[]`
     - `confidence: number`
     - `status: 'PENDING' | 'APPROVED' | 'REJECTED'`
     - `extractedAt: number`
     - `reviewedAt?: number`
2. **Database Schema (`apps/server/src/services/DatabaseService.ts`)**:
   - Add `candidate_decisions` table with appropriate indexes (`project_id`, `status`).
3. **Extraction Service (`apps/server/src/services/memory/DecisionExtractor.ts`)**:
   - Implements local transcript analysis to detect decision statements from session logs.
   - Extracts candidate fields, runs path safety checks (`resolveInsideProject`, `isSafeCommitHash`) on proposed code references, and stages rows in `candidate_decisions`.
4. **ProjectMemoryService & REST Routes**:
   - In `ProjectMemoryService.ts`:
     - `listCandidates(projectId: string, status?: string): CandidateDecision[]`
     - `createCandidate(input: CreateCandidateInput): CandidateDecision`
     - `approveCandidate(projectId: string, candidateId: string, overrides?: Partial<CreateDecisionInput>): ProjectDecision`
     - `rejectCandidate(projectId: string, candidateId: string): void`
   - In `apps/server/src/routes/memory.ts`:
     - `GET /api/v1/projects/:id/memory/candidates`
     - `POST /api/v1/projects/:id/memory/candidates/extract` (trigger extraction for thread/session)
     - `POST /api/v1/projects/:id/memory/candidates/:candidateId/approve`
     - `POST /api/v1/projects/:id/memory/candidates/:candidateId/reject`
5. **Web UI (`apps/web/src/components/memory/`)**:
   - Add candidate review drawer/banner to `DecisionExplorer.tsx`.
   - Displays pending candidate cards with badge count, title, rationale, constraints, and anchors.
   - Provide "Approve" (with optional edit) and "Discard" actions.
   - Wire actions to `useMemoryStore.ts` (`fetchCandidates`, `approveCandidate`, `rejectCandidate`).
6. **Automated Verification**:
   - Service tests in `apps/server/src/services/memory/__tests__/DecisionExtractor.test.ts`.
   - Route tests in `apps/server/src/routes/__tests__/memory-candidates.test.ts`.
   - Web component tests in `apps/web/src/components/memory/__tests__/CandidateReview.test.ts`.

---

## 6. Explicitly Forbidden Changes

* Do **NOT** automatically write unconfirmed candidates into `project_decisions` without human approval.
* Do **NOT** send transcripts or session logs to external cloud APIs when `isSovereignMode()` is `true`.
* Do **NOT** delete active human-confirmed decisions when rejecting candidates.

---

## 7. Acceptance Criteria

1. Session transcript extraction creates records in `candidate_decisions` with `status: 'PENDING'`.
2. Candidate code references pass path safety checks (no path traversal or unsafe characters).
3. `POST /api/v1/projects/:id/memory/candidates/:candidateId/approve` creates an active `project_decisions` record with `provenance: 'HUMAN_CONFIRMED'`, `confidence: 1.0`, updates candidate `status: 'APPROVED'`, and emits `memory.decision_created`.
4. `POST /api/v1/projects/:id/memory/candidates/:candidateId/reject` updates candidate `status: 'REJECTED'` with zero modifications to `project_decisions`.
5. Decision Explorer displays pending candidate counter and review drawer with 1-click Approve / Discard controls.
6. All test suites pass cleanly, `tsc --noEmit` reports 0 errors, and `pnpm run build` succeeds across monorepo.

---

## 8. Definition of Done

- [ ] All Acceptance Criteria independently verified
- [ ] Clean Git diff with no forbidden changes
- [ ] `tsc --noEmit` passes with 0 errors
- [ ] Relevant test suites pass
- [ ] `pnpm run build` succeeds across monorepo

---

## 9. Verification Commands

```bash
pnpm --filter asterim exec tsx src/services/memory/__tests__/DecisionExtractor.test.ts
pnpm --filter asterim exec tsx src/routes/__tests__/memory-candidates.test.ts
pnpm --filter @asterim/web exec tsx src/components/memory/__tests__/CandidateReview.test.ts
pnpm --filter asterim exec tsc --noEmit
pnpm --filter @asterim/web exec tsc --noEmit
pnpm run build
```

---

## 10. Self-Review Requirements

- Inspect `git diff` against every acceptance criterion before reporting.
- Fix all discovered regressions prior to completing `reports/current.md`.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
