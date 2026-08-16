Task-ID: P7-03
Phase: 7

# [P7-03] — Multi-Agent Delegation Cancellation, Operator Intervention & Lifecycle Control

**Task ID:** P7-03  
**Phase:** Phase 7 — Multi-Agent Orchestration & Collaborative Workflows  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-16  

---

## 1. Objective

Implement end-to-end delegation cancellation and operator lifecycle control across Core and Web UI: empower operators and parent sessions to abort running subagent delegations via `AgentDelegationService.cancelDelegation()`, expose authenticated REST endpoints (`POST /api/v1/threads/:id/delegate/cancel`), safely terminate the child subprocess, immediately unpark the waiting parent with a structured cancellation outcome, broadcast live lifecycle socket events, and render interactive cancellation controls in `ChatView` (waiting banner) and `SessionSidebar` (`ThreadTree`).

---

## 2. Why This Task Exists

Tasks P7-01 and P7-02 established the delegation execution protocol and its visual supervision UI. However, if a delegated child subagent enters an infinite tool-calling loop, misinterprets instructions, hangs on an external resource, or if the operator simply changes their mind, there is currently no mechanism to cancel the active delegation short of terminating the entire server process or waiting out the 10-minute timeout.

Operators require immediate, reliable intervention authority: stopping runaway child sessions with one click, cleanly recording the cancellation in SQLite memory, releasing the parent thread back to active status, and keeping both server and frontend state in 100% synchronization.

---

## 3. Context & Architecture

- **Delegation Service (`apps/server/src/services/ai/AgentDelegationService.ts`)**:
  - Manages `waiting` Map (`parentThreadId -> childThreadId`).
  - Executes `runChild` and `watchChild` promises.
  - Interacting with `SessionManager` / `ProcessManager` via `EventBusSessionRunner.stop` (`safeStop`).
  - Settles database records in `threads.delegation_context_json`.
- **Delegation Wire Contract (`packages/shared/src/types/delegation.ts`)**:
  - `DelegationStatus`: `'COMPLETED' | 'FAILED' | 'TIMEOUT'`. (A cancelled delegation is recorded with `status: 'FAILED'`, with failure reason stating cancellation, and `verdict: 'NEEDS_FIX'` for review delegations).
  - Socket events: `delegation.child_state`, `delegation.parent_state`, `delegation.completed`.
- **Web UI & State (`apps/web/src/stores/useProjectStore.ts`, `apps/web/src/components/delegation/`)**:
  - `DelegationStatus.tsx`: Renders waiting banner when `parentState === 'WAITING_FOR_CHILD'`. Needs a "Cancel Delegation" / "Stop Child" button.
  - `ThreadTree.tsx`: Renders child threads in sidebar. Can provide a stop action or cancel trigger.
  - `useProjectStore.ts`: Coordinates `cancelDelegation(threadId, reason?)` calling `POST /api/v1/threads/:id/delegate/cancel`.

---

## 4. Repository Evidence

Key files to inspect before implementing:
- `apps/server/src/services/ai/AgentDelegationService.ts` — `waiting` map, `watchChild`, `runChild`, `safeStop`, `recoverDelegations`.
- `apps/server/src/routes/delegation.ts` — REST routes for delegation operations (`/delegate`, `/children`).
- `apps/server/src/services/ai/__tests__/AgentDelegationService.test.ts` — Existing 209 unit assertions.
- `apps/web/src/stores/useProjectStore.ts` — Hierarchy and delegation store state, `syncDelegations`, `handleDelegationEvent`.
- `apps/web/src/components/delegation/DelegationStatus.tsx` — Waiting banner and outcome card rendering.
- `apps/web/src/components/delegation/ThreadTree.tsx` — Hierarchy tree rows and status badges.
- `apps/web/src/components/delegation/__tests__/DelegationUI.test.ts` — Existing 159 web unit assertions.

---

## 5. Implementation Scope

1. **Server-Side Cancellation Core (`apps/server/src/services/ai/AgentDelegationService.ts`)**:
   - Implement `public async cancelDelegation(threadId: string, reason?: string): Promise<DelegationResult>`:
     - Resolves whether `threadId` is a parent thread waiting on a child, or a child thread itself. If neither is active in delegation, throws/refuses cleanly (e.g. `NOT_DELEGATING` / `DelegationError`).
     - Aborts the active `watchChild` listener early (e.g. via an active abort callback / resolver map).
     - Terminates the child subprocess session via `await this.safeStop(projectId, childThreadId)`.
     - Settles the child thread record in `threads.delegation_context_json` with `status: 'FAILED'`, `summary: reason || 'Delegation cancelled by operator'`, `finishedAt: Date.now()`, and `verdict: 'NEEDS_FIX'` (if `kind === 'REVIEW'`).
     - Removes parent from `this.waiting` map and transitions parent state to `'ACTIVE'`.
     - Publishes terminal `delegation.child_state`, `delegation.parent_state`, and `delegation.completed` events so connected web clients and adapters update immediately.
     - Is idempotent: calling cancel on an already completed/failed delegation returns the settled state without throwing unhandled exceptions.

2. **Server REST Endpoints (`apps/server/src/routes/delegation.ts`)**:
   - Add route `POST /api/v1/threads/:id/delegate/cancel` (and alias `POST /api/v1/threads/:id/delegation/cancel`):
     - Validates thread existence and project access.
     - Invokes `agentDelegationService.cancelDelegation(threadId, req.body?.reason)`.
     - Returns `{ success: true, result: DelegationResult }` with HTTP 200, or HTTP 404/409 on invalid/inactive thread.

3. **Web Store Actions (`apps/web/src/stores/useProjectStore.ts`)**:
   - Add `cancelDelegation: (projectId: string, threadId: string, reason?: string) => Promise<boolean>` to `useProjectStore`:
     - Calls `POST /api/v1/threads/:id/delegate/cancel`.
     - Optimistically updates or handles socket event response for `parentStates`, `pendingChildren`, `childStates`, and `delegationOutcomes`.

4. **Web UI Cancellation Controls (`apps/web/src/components/delegation/`)**:
   - **`DelegationStatus.tsx` (`DelegationWaitingBanner`)**:
     - Add a prominent, styled "Cancel Delegation" / "Stop Child" secondary button alongside "Inspect Child Thread".
     - Handles click, shows loading/disabled state while cancelling, and surfaces error toast/alert if cancellation fails.
   - **`ThreadTree.tsx`**:
     - Optional inline cancel/stop icon button on active pulsing child rows (with confirmation tooltip / title).

5. **Automated Unit & Integration Tests**:
   - **Server tests in `apps/server/src/services/ai/__tests__/AgentDelegationService.test.ts`**:
     - Test cancelling by parent thread id.
     - Test cancelling by child thread id.
     - Test child session process termination (`safeStop` called).
     - Test parent unparking and event publishing (`delegation.completed`, `delegation.parent_state`).
     - Test review delegation cancellation records `NEEDS_FIX`.
     - Test cancel refusal when thread is not in an active delegation.
     - Test idempotency under rapid double-cancel requests.
   - **Web tests in `apps/web/src/components/delegation/__tests__/DelegationUI.test.ts`**:
     - Test "Cancel Delegation" button renders in waiting banner.
     - Test clicking cancel invokes store action with thread id.
     - Test cancelling state transitions in tree and banner.

---

## 6. Explicitly Forbidden Changes

- Do NOT break or modify the existing wire protocol in `@asterim/shared` in a backwards-incompatible manner.
- Do NOT leave orphaned subprocesses or open file handles when cancelling.
- Do NOT alter store boundaries (`blueprint/STORE_ARCHITECTURE.md`).
- Do NOT use hardcoded colors; use design tokens from `tokens.css`.
- Do NOT break any of the 36 existing test suites.

---

## 7. Acceptance Criteria

1. `AgentDelegationService.cancelDelegation()` aborts an active child delegation, stops the child process, settles the database record as `FAILED` (with cancellation reason), and releases the parent thread to `ACTIVE`.
2. REST endpoint `POST /api/v1/threads/:id/delegate/cancel` validates permissions and cancels running delegations cleanly.
3. Cancelling a `REVIEW` delegation records verdict `NEEDS_FIX`.
4. Connected web clients receive real-time socket events updating tree status, clearing the waiting banner, and displaying the cancellation outcome card.
5. `DelegationWaitingBanner` in `ChatView` includes an accessible "Cancel Delegation" action button that triggers cancellation.
6. All automated unit tests in `AgentDelegationService.test.ts` and `DelegationUI.test.ts` pass cleanly.
7. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`.

---

## 8. Definition of Done

- [ ] `cancelDelegation` implemented in `AgentDelegationService.ts`
- [ ] Cancellation REST route added to `routes/delegation.ts`
- [ ] `cancelDelegation` action added to `useProjectStore.ts`
- [ ] Cancellation UI button added to `DelegationStatus.tsx`
- [ ] Server cancellation unit tests authored and green
- [ ] Web cancellation unit tests authored and green
- [ ] All 36+ monorepo test suites and full build clean

---

## 9. Verification Commands

```bash
# Run web unit tests
pnpm --filter @asterim/web test

# Run server delegation unit tests
pnpm --filter asterim exec tsx src/services/ai/__tests__/AgentDelegationService.test.ts

# Run full monorepo CI battery
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 10. Self-Review Requirements

- Execute the complete verification loop: `tsc --noEmit` -> `pnpm lint` -> `pnpm test` -> `pnpm build`.
- Check `git diff` against all acceptance criteria before writing the final report.
- Ensure no stray temporary files are left behind.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
