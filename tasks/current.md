Task-ID: P8-03
Phase: 8

# [P8-03] — Worktree Sandboxing & Verification Pipeline Dashboard UI

**Task ID:** P8-03  
**Phase:** Phase 8 — Automated Verification Pipelines & Worktree Sandboxing  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-17  

---

## 1. Objective

Implement the complete frontend UI for Worktree Sandboxing and Automated Verification Pipelines in `apps/web`: update `DelegationStatus.tsx` (`DelegationOutcomeCard` and `DelegationBatchOutcomeCard`) to render structured `VerificationPipelineReport` evidence (per-step pass/fail badges, durations, and bounded error output) and sandboxed Git diffs; add sandbox merge, discard, and re-verify actions; add sandbox status indicators to `ThreadTree.tsx` and thread headers; update `useProjectStore.ts` to manage worktree state and communicate with the P8-01/P8-02 REST endpoints; expose sandbox and verification options in `DelegateModal.tsx`; and author comprehensive unit tests verifying all rendering states and user interactions.

---

## 2. Why This Task Exists

P8-01 built isolated Git worktree sandboxes (`.asterim/worktrees/<threadId>`) and REST endpoints (`GET /api/v1/threads/:id/worktree`, `POST .../merge`, `DELETE .../worktree`).
P8-02 built the Automated Verification Pipeline engine (`VerificationPipelineService`) and REST endpoints (`POST /api/v1/threads/:id/worktree/verify`, `GET .../verify`).

However, the operator dashboard in `apps/web` does not yet surface this evidence or provide controls:
1. **Verification Evidence**: Operators cannot see whether a delegated subagent's work passed `typecheck`, `lint`, `test`, or `build`, or inspect the stdout/stderr of failing steps.
2. **Diff Inspection & Merge Control**: Operators cannot preview the subagent's isolated worktree diff or trigger a 1-click merge / discard directly from the outcome card or thread view.
3. **On-Demand Verification**: Operators cannot manually re-trigger a verification run on an active or completed sandbox from the UI.
4. **Sandbox Visibility**: Thread tree and session list do not visually distinguish sandboxed subagents from standard threads.

P8-03 completes the user-facing loop of Phase 8, making sandboxing and verification observable and actionable in the dashboard.

---

## 3. Context & Architecture

- **Design System Tokens (`blueprint/DESIGN_SYSTEM.md` & `tokens.css`)**:
  - Surface palette: `var(--color-surface-1)`, `var(--color-surface-2)`, `var(--color-border-subtle)`.
  - State tones:
    - Pass / Verified: `var(--color-state-completed)` (#10b981 / emerald), `var(--color-state-completed-bg)`.
    - Failed / Error: `var(--color-state-error)` (#ef4444 / rose), `var(--color-state-error-bg)`.
    - Unverified / No Pipeline: `var(--color-text-muted)` / subtle slate pill.
    - Sandboxed indicator: subtle cyan / violet / amber badge adhering to design tokens.
  - Fonts & Spacing: `var(--font-family-mono)` for code snippets, steps, and diffs; standard tokenized padding and transitions (<= 200ms).
- **Store Architecture (`apps/web/src/stores/useProjectStore.ts`)**:
  - `useProjectStore` is the state container for project-level data, socket events, and delegation tracking.
  - Extend store state with worktree metadata, diff cache, and verification report cache per thread:
    - `threadWorktrees: Record<string, WorktreeInfo | null>`
    - `threadDiffs: Record<string, { diff: string; changedFiles: string[] } | null>`
    - `threadVerificationReports: Record<string, VerificationPipelineReport | null>`
  - Action methods:
    - `fetchThreadWorktree(threadId: string): Promise<WorktreeInfo | null>`
    - `mergeThreadWorktree(threadId: string, targetBranch?: string): Promise<{ success: boolean; error?: string }>`
    - `discardThreadWorktree(threadId: string): Promise<{ success: boolean; error?: string }>`
    - `verifyThreadWorktree(threadId: string, steps?: string[]): Promise<VerificationPipelineReport | null>`
- **Rendering & Props-Only Component Architecture**:
  - Follow the existing convention: `DelegationStatus.tsx`, `ThreadTree.tsx`, and `DelegateModal.tsx` must maintain clean props-only rendering components to support `react-dom/server` static markup unit tests without headless browser dependencies.
  - Store bindings are cleanly separated at container or hook boundaries.

---

## 4. Repository Evidence

- `packages/shared/src/types/verification.ts` & `delegation.ts` & `worktree.ts`: Shared domain contracts.
- `apps/server/src/routes/worktrees.ts`: REST endpoints for worktree inspection, merge, deletion, and verification.
- `apps/web/src/components/delegation/DelegationStatus.tsx`: `DelegationOutcomeCard`, `DelegationBatchOutcomeCard`, `DelegationWaitingBanner`.
- `apps/web/src/components/delegation/ThreadTree.tsx`: Thread hierarchy and tree status rendering.
- `apps/web/src/components/delegation/DelegateModal.tsx`: Delegation dispatch modal.
- `apps/web/src/stores/useProjectStore.ts`: Project store managing delegation events and thread state.
- `apps/web/src/components/delegation/__tests__/DelegationUI.test.ts`: Existing 401-assertion UI test battery.

---

## 5. Implementation Scope

1. **Store Enhancements (`apps/web/src/stores/useProjectStore.ts`)**:
   - Add state mappings for thread worktree info, diffs, and verification reports.
   - Implement `fetchThreadWorktree`, `mergeThreadWorktree`, `discardThreadWorktree`, and `verifyThreadWorktree` calling `/api/v1/threads/:id/worktree*` with auth headers.
   - Handle incoming `delegation.completed` payload which carries `diff`, `changedFiles`, and `verificationReport`.

2. **Verification Evidence in `DelegationStatus.tsx`**:
   - **Verification Summary Row**: In `DelegationOutcomeCard` and `DelegationBatchOutcomeCard`, render verification status:
     - All Passed: Emerald badge with checkmark and step count (e.g. `✓ 4/4 verification steps passed (1.2s)`).
     - Failed: Rose badge with failed step name and exit code (e.g. `✗ typecheck failed (exit 1)`).
     - No Pipeline Discovered: Neutral badge (`No verification pipeline configured`).
   - **Step Breakdown Accordion / Detail**: Clickable toggle to view individual steps (`typecheck`, `lint`, `test`, `build`), their pass/fail icon, command, duration, and exit code.
   - **Failure Diagnostic Box**: For failing steps, display captured bounded `stdoutSummary` / `stderrSummary` in a scrollable monospace snippet box with copy button.
   - **Re-Verify Action Button**: "Re-run Verification" button triggering on-demand verification with loading state.

3. **Sandbox Diff & Lifecycle Controls in `DelegationStatus.tsx`**:
   - Render sandbox badge (`Sandbox: asterim/sandbox/<id>`) when `worktreePath` or `worktree_branch` is present.
   - Render Changed Files pill list with file count.
   - Expandable "View Diff" preview showing git patch syntax with tokenized additions/deletions highlighting.
   - "Merge Changes" button triggering `mergeThreadWorktree` with confirmation state.
   - "Discard Sandbox" button triggering `discardThreadWorktree` with confirmation state.

4. **ThreadTree & Hierarchy Badging (`apps/web/src/components/delegation/ThreadTree.tsx`)**:
   - Display a compact `[sandbox]` badge on threads running in isolated worktrees.
   - Display verification status dot / badge (emerald check / rose exclamation) on completed child rows.

5. **Delegate Modal Options (`apps/web/src/components/delegation/DelegateModal.tsx`)**:
   - Add "Isolate in Git Worktree" toggle checkbox (enabled by default for `TASK` delegations).
   - Add "Run Verification Pipeline" toggle checkbox (enabled by default when worktree isolation is selected).

6. **Unit Tests (`apps/web/src/components/delegation/__tests__/DelegationUI.test.ts`)**:
   - Test rendering `VerificationPipelineReport` in `DelegationOutcomeCard` (all pass, failed step, unverified).
   - Test rendering `stdoutSummary` snippet for failing steps.
   - Test rendering sandbox diffs and action buttons (merge, discard, re-verify).
   - Test `useProjectStore` methods for worktree fetching, merging, discarding, and verification.
   - Test `ThreadTree` sandbox badges and `DelegateModal` toggles.
   - Assert all tests pass cleanly under `react-dom/server` harness.

---

## 6. Explicitly Forbidden Changes

- Do NOT install heavy external syntax highlighters or charting libraries. Use lightweight tokenized CSS and DOM elements.
- Do NOT break existing delegation event handlers, store subscriptions, or P7/P8 backend routes.
- Do NOT introduce unstyled or raw HTML buttons; adhere strictly to `blueprint/DESIGN_SYSTEM.md` and CSS custom properties in `tokens.css`.
- Do NOT break any existing test suites (38 monorepo test suites must continue passing).

---

## 7. Acceptance Criteria

1. `DelegationOutcomeCard` and `DelegationBatchOutcomeCard` render clear verification summary badges and collapsible step-by-step breakdowns for `VerificationPipelineReport`.
2. Failing verification steps render bounded monospace error logs (`stdoutSummary`/`stderrSummary`) in the outcome card.
3. Sandboxed subagent results display changed file counts, diff preview toggle, and working 1-click "Merge Changes" and "Discard Sandbox" action buttons.
4. "Re-run Verification" button triggers on-demand verification via `POST /api/v1/threads/:id/worktree/verify` and updates the UI state.
5. `ThreadTree` displays sandboxed worktree indicators and verification outcome badges on thread rows.
6. `DelegateModal` provides intuitive toggles for worktree isolation and verification pipeline execution.
7. `DelegationUI.test.ts` is expanded with comprehensive assertions covering verification and sandbox UI states and passes with exit code 0.
8. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test` (38 test suites), `pnpm run build`.

---

## 8. Definition of Done

- [ ] `useProjectStore.ts` extended with worktree and verification state/actions
- [ ] `DelegationStatus.tsx` updated with verification evidence, step details, diff preview, and sandbox controls
- [ ] `ThreadTree.tsx` updated with sandbox and verification badges
- [ ] `DelegateModal.tsx` updated with worktree and verification configuration toggles
- [ ] `DelegationUI.test.ts` expanded with comprehensive tests for new components and store actions
- [ ] Monorepo CI gates pass cleanly (38/38 test suites, 0 lint errors, 0 typecheck errors, build succeeds)

---

## 9. Verification Commands

```bash
# Run expanded Delegation UI test suite
pnpm --filter @asterim/web exec tsx src/components/delegation/__tests__/DelegationUI.test.ts

# Run server verification & worktree test suites
pnpm --filter asterim exec tsx src/services/verification/__tests__/VerificationPipelineService.test.ts
pnpm --filter asterim exec tsx src/services/git/__tests__/GitWorktreeService.test.ts

# Run full monorepo CI validation pipeline
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 10. Self-Review Requirements

Execute the mandatory Claude Code self-review cycle:
1. Inspect git diff (`git diff`) before declaring complete.
2. Check every acceptance criterion against real test assertions.
3. Confirm zero regressions across all existing test suites.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
