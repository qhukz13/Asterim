Task-ID: P7-02
Phase: 7

# [P7-02] — Multi-Agent Delegation UI, Thread Hierarchy & Real-Time Supervision

**Task ID:** P7-02  
**Phase:** Phase 7 — Multi-Agent Orchestration & Collaborative Workflows  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-16  

---

## 1. Objective

Implement the Multi-Agent Delegation Web UI, Thread Hierarchy Tree, and real-time delegation supervision in `apps/web` (with server-side startup orphan recovery in `apps/server`): visualize parent-child thread trees in `SessionSidebar`, display live delegation status (`WAITING_FOR_CHILD`, child lifecycle states) and structured outcome cards in `ChatView`, provide a manual Delegation/Review modal, and wire real-time socket events for seamless multi-agent workflow observability.

---

## 2. Why This Task Exists

In Task P7-01, the core backend delegation protocol (`AgentDelegationService`, SQLite parent-child columns, delegation meta-tools `delegate_task`/`request_review`, and REST endpoints) was implemented and verified with 189 assertions.

However, the Web UI currently renders threads as a flat list with no visual indication of hierarchy, parent waiting states, child progress, or structured review verdicts. Operators and developers need immediate visual clarity into multi-agent workflows: seeing which subagents were spawned, what tasks they are executing, their live status, and their completed summaries and artifacts directly within the dashboard.

---

## 3. Context & Architecture

- **Store Hierarchy (`blueprint/STORE_ARCHITECTURE.md`)**:
  - `ProjectStore`: owns repository context and the list of threads (including `parent_thread_id` and delegation metadata).
  - `ThreadStore`: owns active thread context and timeline events.
  - `ExecutionStore`: owns active process execution lifecycle.
  - Do NOT store business hierarchy data in `InspectorStore` (which holds only selection paths).
- **Socket Events (`packages/shared/src/types/delegation.ts`)**:
  - `delegation.started` (`DelegationStartedPayload`)
  - `delegation.parent_state` (`DelegationParentStatePayload`)
  - `delegation.child_state` (`DelegationChildStatePayload`)
  - `delegation.completed` (`DelegationCompletedPayload`)
- **Design Tokens & UI (`blueprint/DESIGN_SYSTEM.md`)**:
  - Monochrome dark surfaces with emerald accent (`var(--color-accent-primary)`).
  - Subtle hierarchy nesting (indentation, branch connectors, role badges).
  - Smooth transitions (≤ 200ms), zero "AI sparkle" fluff.

---

## 4. Implementation Scope

1. **Store & Socket Real-Time Handling (`apps/web/src/stores/`, `apps/web/src/hooks/useSocket.ts`)**:
   - Extend `useProjectStore` / `useThreadStore` to hold thread hierarchy information (`parent_thread_id`, `delegation_context_json`, `parentState`, `childState`).
   - Update `useSocket.ts` to listen to `delegation.started`, `delegation.parent_state`, `delegation.child_state`, `delegation.completed` and dispatch state updates to the relevant stores.
   - When switching threads or receiving project history, fetch/sync child delegation status via `GET /api/v1/threads/:id/children`.

2. **SessionSidebar Thread Hierarchy Tree (`apps/web/src/components/SessionSidebar.tsx`)**:
   - Render root threads with collapsible/nested child threads underneath.
   - Display role badge (e.g. `Security Auditor`, `Senior Backend`) and status indicator (pulsing indicator for active child, amber for parked parent `WAITING_FOR_CHILD`, checkmark for completed, error dot for failed/timeout).
   - Display delegation depth badge/pill (e.g. `L1`, `L2`).
   - Clicking a child thread navigates to that thread's route (`/workspace/project/:projectId/thread/:threadId/view/chat`).

3. **Parent Thread "Waiting on Child" Status Banner (`apps/web/src/ChatView.tsx` / `apps/web/src/components/delegation/`)**:
   - When active thread has `parentState === 'WAITING_FOR_CHILD'`, render a status banner:
     - Indicating which role/child thread is currently executing work.
     - Displaying task summary snippet.
     - Showing an action button to "Inspect Child Thread" (navigating to child).
   - Once child finishes and parent resumes, render a structured **Delegation Outcome Card**:
     - Status badge (`COMPLETED` | `FAILED` | `TIMEOUT`).
     - Review verdict badge (`PASS` / `NEEDS_FIX`) when `kind === 'REVIEW'`.
     - Output summary and clickable artifact file links.

4. **Manual Delegation Action Modal (`apps/web/src/components/delegation/DelegateModal.tsx`)**:
   - Provide a "Delegate Work" / "Request Review" action trigger (accessible from thread header or chat actions).
   - Role selector dropdown (populating available `AgentProfile`s from `useProfileStore`), task description input, optional context/diff input, and submit action calling `POST /api/v1/threads/:id/delegate`.

5. **Server-Side Startup Orphan Recovery (`apps/server/src/services/ai/AgentDelegationService.ts`, `apps/server/src/index.ts`)**:
   - Add `recoverDelegations()` or include in startup lifecycle: scan for threads with non-null `parent_thread_id` whose `delegation_context_json` has no terminal `status` upon server startup, and record them as `FAILED` (with reason `"Server restarted while child was running"`), preventing permanent dangling `RUNNING` child states.

6. **Web Automated Unit Tests (`apps/web/src/components/delegation/__tests__/` or `apps/web/src/stores/__tests__/`)**:
   - Unit tests covering thread tree transformation, hierarchy rendering, delegation status badges, and socket event dispatch.

---

## 5. Constraints & Forbidden Changes

- Adhere strictly to `blueprint/STORE_ARCHITECTURE.md` for store boundaries.
- Do NOT alter the delegation wire contract in `@asterim/shared` without backward compatibility.
- Ensure all styling uses CSS custom properties from `apps/web/src/styles/tokens.css`.
- Do NOT break any existing server or web test suites (all 35 suites must remain green).

---

## 6. Acceptance Criteria

1. `SessionSidebar` renders hierarchical parent-child thread trees with role badges, depth indicators, and live status.
2. `useSocket.ts` receives all four `delegation.*` socket events and synchronizes thread state in real time.
3. When a parent thread is `WAITING_FOR_CHILD`, `ChatView` shows a dedicated status banner with a direct navigation link to the child thread.
4. Completed delegations render structured summary/review cards with status, verdict, summary, and artifacts.
5. Operators can manually trigger task delegation or code review via `DelegateModal`.
6. Server startup cleanly recovers dangling child threads left running before a shutdown.
7. Automated unit tests for web delegation components pass.
8. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`.

---

## 7. Definition of Done

- [ ] Hierarchy rendering added to `SessionSidebar.tsx`
- [ ] Delegation socket events wired into `useSocket.ts` and stores
- [ ] Waiting banner and delegation outcome card added to `ChatView` / web components
- [ ] `DelegateModal.tsx` implemented and functional
- [ ] Server startup orphan recovery implemented
- [ ] Web unit tests authored and passing
- [ ] Monorepo CI gates (`typecheck`, `lint`, `test`, `build`) pass cleanly

---

## 8. Verification Commands

```bash
# Run web unit tests
pnpm --filter @asterim/web test

# Run server unit tests (including delegation)
pnpm --filter asterim exec tsx src/services/ai/__tests__/AgentDelegationService.test.ts

# Run full monorepo CI battery
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 9. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
