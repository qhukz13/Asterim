Task-ID: P8-02
Phase: 8

# [P8-02] — Collaborative Multi-User Web UI & Team Turn Queue Inspector

**Task ID:** P8-02  
**Phase:** Phase 8 — Collaborative Team Agents & Multi-User Governance  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-18  

---

## 1. Objective

Build the Web UI for Shared Team Agents and Collaborative Threads (`DEC-031` / `blueprint/ROADMAP.md` Phase 8 Deliverable 3): author `useTeamAgentStore.ts` in `apps/web/src/stores/` to manage team agents, collaborative threads, transcripts, and real-time Socket.IO turn events (`team_turn:queued`, `team_turn:started`, `team_turn:completed`, `team_turn:cancelled`); build the Team Agent Explorer (`TeamAgentExplorer.tsx`), Collaborative Thread Chat (`TeamThreadChatView.tsx`), and the Active Turn Queue Inspector (`ActiveTurnQueueInspector.tsx`); integrate into Asterim navigation and session views; and author a comprehensive frontend unit/integration test suite in `apps/web/src/components/teamAgents/__tests__/TeamAgentUI.test.ts`.

---

## 2. Why This Task Exists

In P8-01, the Shared Team Agent primitive, database schema (v2), the Turn Concurrency Engine (`AgentTurnLock.ts`), and `TeamAgentService.ts` REST routes were implemented and verified with 100% test coverage.

Engineering teams now require the visual interface to create, discover, and interact with these persistent shared agent roles (e.g. "Tech Lead", "Security Reviewer", "Database Architect"). The UI must provide real-time visibility into the shared transcript, show which team member authored each prompt, display the active turn state (`PROCESSING_TURN`, `AWAITING_APPROVAL`, `IDLE`), and visualize the FIFO turn queue so team members understand their place in line without prompt collisions.

---

## 3. Context & Architecture (DEC-031, DEC-032 & STORE_ARCHITECTURE.md)

- **State Management (`useTeamAgentStore.ts`)**:
  - Scoped to the active workspace/team and selected collaborative thread.
  - Manages `teamAgents: TeamAgent[]`, `teamThreads: Record<string, TeamThread[]>`, `activeThread: TeamThread | null`, `activeTranscript: TeamAgentMessage[]`, `activeQueueState: TeamTurnQueueState | null`, `turnHistory: TeamTurnQueueItem[]`.
  - REST Integration:
    - `fetchTeamAgents(teamId: string)` (`GET /api/v1/team-agents?teamId=`)
    - `createTeamAgent(input: CreateTeamAgentInput)` (`POST /api/v1/team-agents`)
    - `updateTeamAgent(id: string, input: UpdateTeamAgentInput)` (`PATCH /api/v1/team-agents/:id`)
    - `deleteTeamAgent(id: string)` (`DELETE /api/v1/team-agents/:id`)
    - `fetchTeamThread(id: string)` (`GET /api/v1/team-threads/:id`)
    - `createTeamThread(agentId: string, input: { title: string; projectId?: string })` (`POST /api/v1/team-agents/:id/threads`)
    - `submitTurn(threadId: string, instruction: string, context?: unknown)` (`POST /api/v1/team-threads/:id/turns`) — handles `202 Accepted` response
    - `cancelTurn(threadId: string, turnId: string)` (`DELETE /api/v1/team-threads/:id/turns/:turnId`)
  - Real-Time Socket.IO Synchronization:
    - Listens for `team_turn:queued`, `team_turn:started`, `team_turn:completed`, `team_turn:cancelled` events from `@asterim/shared`.
    - Updates `activeQueueState`, thread turn status, active turn item, and queue positions in real time.
- **Component Architecture (`apps/web/src/components/teamAgents/`)**:
  - `TeamAgentExplorer.tsx`: Card grid / list of team agents in the active workspace. Displays name, role badge, description, system prompt preview, capability indicators (MCP servers, skills), model, and attached collaborative threads.
  - `CreateTeamAgentModal.tsx`: Modal for creating and editing team agents with role prompt editing, MCP tool selector, and skill selector.
  - `TeamThreadChatView.tsx`: Collaborative multi-user chat view. Renders transcript messages (`TeamAgentMessage`) with distinct user badges (`userName`), agent responses, and active generation indicators. Includes input area for queueing instructions.
  - `ActiveTurnQueueInspector.tsx`: Live turn queue drawer/panel displaying:
    - Thread status badge (`IDLE`, `PROCESSING_TURN`, `AWAITING_APPROVAL`).
    - Active operator indicator (avatar, name, started timestamp).
    - Ordered FIFO pending turns list with queue position badges (`#1 in queue`, `#2 in queue`), submission timestamps, and operator cancel button (`DELETE /turns/:id`).
- **Design System & Styling (`tokens.css`)**:
  - Adhere to `blueprint/DESIGN_SYSTEM.md`: monochrome surfaces (`--color-surface-*`), surgical emerald accent (`--color-accent-*`), status tokens (`--color-state-*`), typography tokens (`--font-family-mono`, `--font-family-sans`), keyboard accessibility, and ARIA attributes (`aria-expanded`, `aria-live="polite"`).

---

## 4. Implementation Scope

1. **`useTeamAgentStore.ts` (`apps/web/src/stores/useTeamAgentStore.ts`)**:
   - Complete Zustand store with all agent CRUD, thread management, turn submission (202 handling), turn cancellation, and Socket.IO turn transition event listeners.
   - Clean hydration and error handling states.

2. **UI Components (`apps/web/src/components/teamAgents/`)**:
   - `TeamAgentExplorer.tsx` — Team agent discovery and listing.
   - `CreateTeamAgentModal.tsx` — Team agent creation and editing modal.
   - `TeamThreadChatView.tsx` — Collaborative transcript and multi-user chat view.
   - `ActiveTurnQueueInspector.tsx` — Live turn queue and concurrency inspector.

3. **Navigation & View Integration**:
   - Integrate Team Agent Explorer and Collaborative Thread views into navigation sidebar / workspace shell / router as appropriate.

4. **Automated Unit & Integration Test Suite (`apps/web/src/components/teamAgents/__tests__/TeamAgentUI.test.ts`)**:
   - Pure helper assertions (filtering, queue position calculations, status badge resolution).
   - `useTeamAgentStore` assertions against recording `fetch` (verifying exact REST URLs, HTTP verbs, payload serialization, 202 Accepted handling, and error codes).
   - Socket.IO event handler assertions (`team_turn:queued`, `team_turn:started`, `team_turn:completed`, `team_turn:cancelled` updating store state).
   - Component static markup rendering assertions (`react-dom/server`) across all views and queue states.
   - Wire into `apps/web/package.json` `"test"` script.

---

## 5. Constraints & Forbidden Changes

- Import all team agent types, queue states, and event constants from `@asterim/shared` — do NOT duplicate types.
- Follow `blueprint/DESIGN_SYSTEM.md` and `blueprint/STORE_ARCHITECTURE.md` strictly.
- Do NOT alter existing single-developer chat or delegation UI workflows.
- Maintain 100% test pass rate across all existing monorepo test suites.

---

## 6. Acceptance Criteria

1. `useTeamAgentStore` manages team agents, threads, transcripts, and queue state, with complete REST API and Socket.IO event synchronization.
2. `TeamAgentExplorer` renders agent cards, role badges, capability pills, and collaborative thread entry points.
3. `CreateTeamAgentModal` validates inputs and supports configuring persona system prompts, models, MCP tools, and skills.
4. `ActiveTurnQueueInspector` displays active turn state (`IDLE` / `PROCESSING_TURN` / `AWAITING_APPROVAL`), active operator, and FIFO queued items with position badges and cancellation buttons.
5. `TeamThreadChatView` displays collaborative multi-user transcripts with user author tags, assistant responses, and turn queue status.
6. `TeamAgentUI.test.ts` passes with comprehensive coverage across helpers, store actions, Socket.IO updates, and component rendering.
7. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`.

---

## 7. Definition of Done

- [ ] `useTeamAgentStore.ts` implemented and exported
- [ ] `TeamAgentExplorer.tsx` & `CreateTeamAgentModal.tsx` created
- [ ] `ActiveTurnQueueInspector.tsx` & `TeamThreadChatView.tsx` created
- [ ] Views integrated into dashboard navigation
- [ ] `TeamAgentUI.test.ts` created and passing
- [ ] `apps/web/package.json` test script updated
- [ ] Monorepo CI gates pass cleanly

---

## 8. Verification Commands

```bash
# Run new Team Agent UI test suite
pnpm --filter @asterim/web exec tsx src/components/teamAgents/__tests__/TeamAgentUI.test.ts

# Run all web test suites
pnpm --filter @asterim/web run test

# Run full monorepo CI validation
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 9. Self-Review Requirements

Review git diff against all acceptance criteria and design system tokens before submitting report.

---

## 10. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
