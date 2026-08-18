Task-ID: P8-01
Phase: 8

# [P8-01] — Shared Team Agent Primitive, Schema & Turn Concurrency Engine

**Task ID:** P8-01  
**Phase:** Phase 8 — Collaborative Team Agents & Multi-User Governance  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-18  

---

## 1. Objective

Implement the Shared Team Agent primitive and Turn Concurrency Engine governed by `DEC-031`: add migration `002_team_agents.sql` defining team agent schemas in SQLite, author `AgentTurnLock.ts` to manage FIFO turn queueing and prevent simultaneous prompt collisions, author `TeamAgentService.ts` for multi-user collaborative session orchestration, expose authenticated REST endpoints, and author a comprehensive automated test suite.

---

## 2. Why This Task Exists

As established in `DEC-031` and the authoritative roadmap (`blueprint/ROADMAP.md`), AI agents have historically been confined to single-developer sessions. When multiple engineers collaborate on a codebase, they need persistent shared agent roles (e.g. "Tech Lead", "Security Reviewer", "Database Architect") that maintain continuous team context.

However, when multiple team members interact with one shared agent simultaneously, uncoordinated dispatches cause prompt collisions, interleaved transcripts, and race conditions. The Turn Concurrency Engine (`AgentTurnLock`) provides deterministic FIFO message queueing, turn atomicity, and real-time state synchronization across all connected team members.

---

## 3. Context & Architecture (DEC-031 & DEC-032)

- **Team Agent Primitive**:
  - Persistent entity (`team_agents`) belonging to a Team/Workspace, configured with role prompts, allowed MCP servers, and access permissions.
  - Maintains collaborative threads (`team_threads`) with shared transcript history (`team_agent_messages`).
- **Turn Concurrency Engine (`AgentTurnLock`)**:
  - Each collaborative thread has an active turn state: `IDLE`, `PROCESSING_TURN`, or `AWAITING_APPROVAL`.
  - Incoming user instructions enter a FIFO queue (`team_turn_queue`).
  - When the agent finishes generating output and executing tool calls, `AgentTurnLock` automatically advances to the next queued request and updates connected clients over Socket.IO.
- **Local-First Data Sovereignty (`DEC-028` & `DEC-032`)**:
  - The shared agent executes locally on the host machine.
  - All transcripts and queue states remain in local SQLite.

---

## 4. Implementation Scope

1. **SQL Migration (`packages/server/src/migrations/002_team_agents.sql`)**:
   - `team_agents`: `id`, `team_id`, `name`, `role`, `description`, `system_prompt`, `model`, `temperature`, `enabled_mcp_servers`, `enabled_skills`, `created_by`, `created_at`, `updated_at`.
   - `team_threads`: `id`, `team_agent_id`, `title`, `status`, `active_turn_user_id`, `created_at`, `updated_at`.
   - `team_turn_queue`: `id`, `team_thread_id`, `user_id`, `user_name`, `instruction`, `context_json`, `status` (`QUEUED` | `PROCESSING` | `AWAITING_APPROVAL` | `COMPLETED` | `FAILED` | `CANCELLED`), `queued_at`, `started_at`, `completed_at`, `error_message`.
   - `team_agent_messages`: `id`, `team_thread_id`, `user_id`, `user_name`, `role`, `content`, `tool_calls_json`, `created_at`.
   - Indexes: `idx_team_agents_team`, `idx_team_threads_agent`, `idx_team_queue_thread_status`, `idx_team_messages_thread`.

2. **Shared Types (`packages/shared/src/types/teamAgent.ts`)**:
   - `TeamAgent`, `TeamThread`, `TeamTurnRequest`, `TeamTurnQueueItem`, `TeamAgentMessage`, `TeamTurnStatus`.
   - Export from `packages/shared/src/index.ts`.

3. **`AgentTurnLock.ts` (`apps/server/src/services/ai/AgentTurnLock.ts`)**:
   - Per-thread in-memory FIFO queue and atomic turn lock manager.
   - `acquireTurn(threadId: string, turnId: string): Promise<boolean>`
   - `releaseTurn(threadId: string, turnId: string): void`
   - `cancelTurn(threadId: string, turnId: string): boolean`
   - `getQueueState(threadId: string): { activeTurn: TeamTurnQueueItem | null; queuedTurns: TeamTurnQueueItem[] }`
   - Socket.IO broadcast hooks on turn transitions (`team_turn:queued`, `team_turn:started`, `team_turn:completed`, `team_turn:cancelled`).

4. **`TeamAgentService.ts` (`apps/server/src/services/ai/TeamAgentService.ts`)**:
   - Agent CRUD: `createTeamAgent`, `getTeamAgent`, `listTeamAgents(teamId)`, `updateTeamAgent`, `deleteTeamAgent`.
   - Thread Management: `createTeamThread`, `getTeamThread`, `listTeamThreads(agentId)`.
   - Turn Dispatcher: `enqueueTurn(request: TeamTurnRequest)`: Persists queue item to SQLite, enqueues in `AgentTurnLock`, and executes turn through `AgentService` with the team agent persona.
   - Transcript Logger: Appends user and agent assistant turns to `team_agent_messages`.

5. **REST API Endpoints (`apps/server/src/routes/teamAgents.ts`)**:
   - `POST /api/v1/team-agents` — Create team agent.
   - `GET /api/v1/team-agents` — List team agents for active workspace/team.
   - `GET /api/v1/team-agents/:id` — Get team agent details.
   - `POST /api/v1/team-agents/:id/threads` — Create collaborative thread.
   - `GET /api/v1/team-threads/:id` — Get thread transcript and queue state.
   - `POST /api/v1/team-threads/:id/turns` — Enqueue instruction (`{ instruction, context? }`).
   - `DELETE /api/v1/team-threads/:id/turns/:turnId` — Cancel queued turn.
   - Register in `apps/server/src/server.ts`.

6. **Automated Unit & Integration Test Suite (`apps/server/src/services/ai/__tests__/TeamAgentService.test.ts`)**:
   - Test TeamAgent CRUD operations and SQLite persistence.
   - Test `AgentTurnLock` FIFO queue ordering under concurrent multi-user submissions.
   - Test atomic turn acquisition, generation, message persistence, and queue advancement.
   - Test turn cancellation while queued.
   - Wire into `apps/server/package.json` `"test"` script.

---

## 5. Constraints & Forbidden Changes

- Do NOT allow race conditions or interleaved agent generation on the same `team_thread_id`.
- Do NOT transmit source code or transcripts to unapproved external cloud endpoints (`DEC-028` compliance).
- Maintain 100% test pass rate across all existing monorepo test suites.

---

## 6. Acceptance Criteria

1. Migration `002_team_agents.sql` applies cleanly via `MigrationEngine`.
2. `TeamAgentService` supports full CRUD for team agents and collaborative threads.
3. `AgentTurnLock` maintains deterministic FIFO queue ordering when multiple users queue tasks concurrently.
4. Concurrent turns do not collide or interleave; each turn completes before the next begins.
5. Authenticated REST endpoints under `/api/v1/team-agents` and `/api/v1/team-threads` return accurate responses.
6. `TeamAgentService.test.ts` passes with comprehensive concurrency assertions.
7. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`.

---

## 7. Definition of Done

- [ ] `002_team_agents.sql` created and verified
- [ ] Shared team agent types in `@asterim/shared`
- [ ] `AgentTurnLock.ts` implemented
- [ ] `TeamAgentService.ts` implemented
- [ ] REST endpoints registered in `server.ts`
- [ ] `TeamAgentService.test.ts` created and passing
- [ ] Monorepo CI gates pass cleanly

---

## 8. Verification Commands

```bash
# Run new Team Agent & Concurrency test suite
pnpm --filter asterim exec tsx src/services/ai/__tests__/TeamAgentService.test.ts

# Run all AI & delegation test suites
pnpm --filter asterim exec tsx src/services/ai/__tests__/AgentDelegationService.test.ts
pnpm --filter asterim exec tsx src/services/ai/__tests__/ProfileService.test.ts

# Run full monorepo CI validation
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 9. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
