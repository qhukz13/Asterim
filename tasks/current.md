Task-ID: P8-03
Phase: 8

# [P8-03] — Multi-User Governance, Role-Based Turn Approvals & Team Project Memory Integration

**Task ID:** P8-03  
**Phase:** Phase 8 — Collaborative Team Agents & Multi-User Governance  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-18  

---

## 1. Objective

Implement multi-user governance and team approval mechanics for Shared Team Agents (`DEC-031` / `blueprint/ROADMAP.md` Phase 8 Deliverable 4): author team-scoped RBAC authorization across all team agent REST routes (`POST/PATCH/DELETE /api/v1/team-agents`, turn withdrawals); implement role-based approval governance (`ANY_MEMBER`, `ADMIN_ONLY`, `TURN_INITIATOR`) for turns parked in `AWAITING_APPROVAL` with dedicated resolution endpoint (`POST /api/v1/team-threads/:id/approvals`) and Socket.IO state synchronization; integrate Team Project Memory (standing architectural rules, active intents, and decisions from `ProjectMemoryCore`) into team turn execution context; update `useTeamAgentStore.ts` and `ActiveTurnQueueInspector.tsx` / `TeamThreadChatView.tsx` with approval actions; and expand automated test suites in `TeamAgentService.test.ts` and `TeamAgentUI.test.ts`.

---

## 2. Why This Task Exists

In P8-01 and P8-02, the Shared Team Agent primitive, database schema, Turn Concurrency Engine (`AgentTurnLock.ts`), REST routes, and collaborative dashboard UI were implemented. However, two critical governance requirements from `blueprint/ROADMAP.md` and `decisions.md` (DEC-031 § 3) remain incomplete:

1. **Unchecked Team Agent Modification & Deletion**: As noted in previous verification reports, `PATCH /api/v1/team-agents/:id`, `DELETE /api/v1/team-agents/:id`, and turn withdrawals currently only verify authentication (`requireUser`), without asserting workspace team membership or RBAC permissions (`RbacService`). Any authenticated user could modify shared team prompts or delete colleagues' queued instructions.
2. **Unresolvable `AWAITING_APPROVAL` State**: When a destructive tool call or security checkpoint transitions a turn to `AWAITING_APPROVAL`, there is no endpoint or UI action to approve or reject the action based on configured approval policies (`ANY_MEMBER`, `ADMIN_ONLY`, `TURN_INITIATOR`).
3. **Missing Team Memory Ingestion**: Shared team agents currently execute turns with static system prompts without injecting team-wide standing architectural rules, active project intents, and confirmed architectural decisions from `ProjectMemoryCore`.

---

## 3. Context & Architecture (DEC-031, DEC-028 & ARCHITECTURE.md)

- **Role-Based Approval Governance (`DEC-031` § 3)**:
  - Add `approvalPolicy?: 'ANY_MEMBER' | 'ADMIN_ONLY' | 'TURN_INITIATOR'` (default `'ANY_MEMBER'`) to `TeamAgent` and `TeamThread`.
  - When an active turn requires tool confirmation, it enters `AWAITING_APPROVAL` via `AgentTurnLock.markAwaitingApproval`.
  - Authorize approval resolution against the configured policy:
    - `'ADMIN_ONLY'`: Caller must hold `admin` or `owner` role in the workspace team.
    - `'TURN_INITIATOR'`: Caller must be the `userId` who submitted the turn (or an `admin`/`owner`).
    - `'ANY_MEMBER'`: Caller must be an authenticated member of the workspace team with `agent:approve` permission.
  - Answering approvals (`POST /api/v1/team-threads/:id/approvals`):
    - Payload: `{ turnId: string; decision: 'APPROVED' | 'REJECTED'; comment?: string }`.
    - If `APPROVED`: resume turn execution via `AgentTurnLock.resumeFromApproval` and record approval in transcript.
    - If `REJECTED`: fail/cancel turn via `AgentTurnLock.releaseTurn(threadId, turnId, { status: 'CANCELLED', errorMessage })`, record rejection in transcript, and advance the queue.
- **Team-Scoped RBAC Enforcement (`RbacService.ts`)**:
  - `POST /api/v1/team-agents`: User must be a member of `teamId` with `workspace:write` or `workspace:admin`.
  - `PATCH /api/v1/team-agents/:id`: User must be a member of the agent's `teamId` with `workspace:write` or `workspace:admin`.
  - `DELETE /api/v1/team-agents/:id`: User must be a member of the agent's `teamId` with `workspace:admin` or `owner`.
  - `DELETE /api/v1/team-threads/:id/turns/:turnId`: User must be either the turn submitter (`userId === request.user.sub`) or hold `admin`/`owner` in the workspace team.
  - Return standard HTTP 403 Forbidden with `AuthErrorCode.FORBIDDEN` / `INSUFFICIENT_PERMISSIONS` on unauthorized operations.
- **Team Project Memory Integration (`ProjectMemoryCore` / `TeamAgentService`)**:
  - In `TeamAgentService.runTurn`, if `thread.projectId` is set, query active architectural rules, active intents, and relevant confirmed decisions.
  - Inject these constraints into the turn context / execution prompt alongside the agent's `systemPrompt` so the shared agent enforces team standards.
- **Web UI & Store Integration**:
  - Update `useTeamAgentStore.ts` with `resolveApproval(threadId, turnId, decision, comment)`.
  - In `ActiveTurnQueueInspector.tsx` and `TeamThreadChatView.tsx`, render interactive approval cards when `state === 'AWAITING_APPROVAL'` showing policy requirements, submitter attribution, and Approve / Reject action buttons.

---

## 4. Repository Evidence

- `apps/server/src/services/ai/TeamAgentService.ts` — Core service owning agent CRUD, transcripts, queue execution, and turn lifecycle.
- `apps/server/src/services/ai/AgentTurnLock.ts` — Concurrency engine managing `markAwaitingApproval`, `resumeFromApproval`, and turn releases.
- `apps/server/src/routes/teamAgents.ts` — Fastify REST endpoints for team agents, collaborative threads, turns, and approvals.
- `apps/server/src/services/RbacService.ts` — Workspace membership and role permission verifier.
- `packages/shared/src/types/teamAgent.ts` — Shared domain types, event constants, and approval policy interfaces.
- `apps/web/src/stores/useTeamAgentStore.ts` — Zustand store for team agent state and socket subscriptions.
- `apps/web/src/components/teamAgents/ActiveTurnQueueInspector.tsx` — Live queue drawer and turn status display.
- `apps/web/src/components/teamAgents/TeamThreadChatView.tsx` — Collaborative transcript and chat view.

---

## 5. Implementation Scope

1. **Shared Types (`packages/shared/src/types/teamAgent.ts`)**:
   - Add `TeamApprovalPolicy` (`'ANY_MEMBER' | 'ADMIN_ONLY' | 'TURN_INITIATOR'`), `TeamTurnApprovalRequest`, `TeamTurnApprovalResult`, and `TEAM_TURN_APPROVAL_EVENT` constants.
   - Update `TeamAgent`, `CreateTeamAgentInput`, and `UpdateTeamAgentInput` to optionally specify `approvalPolicy`.

2. **Server RBAC & Approval Enforcement (`apps/server/src/services/ai/TeamAgentService.ts` & `apps/server/src/routes/teamAgents.ts`)**:
   - Add `resolveTurnApproval(threadId: string, turnId: string, userId: string, decision: 'APPROVED' | 'REJECTED', comment?: string)` in `TeamAgentService`.
   - Register route `POST /api/v1/team-threads/:id/approvals` enforcing workspace membership and policy rules.
   - Apply workspace membership and role authorization guards (`rbacService`) to `POST /api/v1/team-agents`, `PATCH /api/v1/team-agents/:id`, `DELETE /api/v1/team-agents/:id`, and `DELETE /api/v1/team-threads/:id/turns/:turnId`.

3. **Team Project Memory Context Injection (`TeamAgentService.ts`)**:
   - Integrate team architectural rules, active intents, and decisions into the execution payload during `runTurn`.

4. **Web UI Approval Actions & Store (`apps/web/src/stores/useTeamAgentStore.ts` & `apps/web/src/components/teamAgents/`)**:
   - Add `resolveApproval` action to `useTeamAgentStore`.
   - Render Approve and Reject action buttons in `ActiveTurnQueueInspector` and `TeamThreadChatView` when a turn is awaiting approval.

5. **Automated Unit & Integration Tests**:
   - Expand `apps/server/src/services/ai/__tests__/TeamAgentService.test.ts` to assert RBAC permissions, approval policies (`ADMIN_ONLY`, `TURN_INITIATOR`, `ANY_MEMBER`), approval resolutions, and memory context injection.
   - Expand `apps/web/src/components/teamAgents/__tests__/TeamAgentUI.test.ts` with assertions for approval store actions, disabled states for unauthorized roles, and approval card rendering.

---

## 6. Explicitly Forbidden Changes

- Do NOT weaken data sovereignty (`DEC-028` / `DEC-032`); all agent transcripts, memory, and code must stay on the host workstation.
- Do NOT bypass `AgentTurnLock` atomicity guarantees when resolving or rejecting approvals.
- Do NOT duplicate shared types between server and web packages; import exclusively from `@asterim/shared`.
- Do NOT break existing single-developer sessions or unauthenticated local fallback modes.

---

## 7. Acceptance Criteria

1. **RBAC Authorization**: `POST/PATCH/DELETE /api/v1/team-agents` and `DELETE /api/v1/team-threads/:id/turns/:turnId` enforce workspace team membership and role permissions, returning 403 when forbidden.
2. **Approval Policy Configuration**: Team agents and threads support `approvalPolicy` (`'ANY_MEMBER' | 'ADMIN_ONLY' | 'TURN_INITIATOR'`).
3. **Approval Resolution**: `POST /api/v1/team-threads/:id/approvals` correctly evaluates caller permissions against the approval policy, resumes or cancels the turn, appends the resolution to the transcript, and broadcasts the transition.
4. **Project Memory Integration**: Active team architectural rules and project decisions are injected into the team turn execution prompt for bound projects.
5. **UI Approval Controls**: `ActiveTurnQueueInspector` and `TeamThreadChatView` render approval prompts with author attribution and Approve / Reject controls.
6. **Automated Tests Pass**: `TeamAgentService.test.ts` and `TeamAgentUI.test.ts` pass 100% with new coverage for RBAC, approvals, and memory integration.
7. **Monorepo CI Gates Pass**: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, and `pnpm run build` exit with 0 errors across all workspaces.

---

## 8. Definition of Done

- [ ] Shared approval types and constants exported in `@asterim/shared`
- [ ] Team agent routes and turn cancellation protected with RBAC checks
- [ ] Approval resolution endpoint and service methods implemented and verified
- [ ] Team project memory injected into turn execution context
- [ ] Dashboard store and UI updated with approval handling
- [ ] Server and Web test suites updated with comprehensive assertions
- [ ] All monorepo CI gates green

---

## 9. Verification Commands

```bash
# 1. Run Team Agent Backend Integration Tests
pnpm --filter asterim exec tsx src/services/ai/__tests__/TeamAgentService.test.ts

# 2. Run Team Agent UI Integration Tests
pnpm --filter @asterim/web exec tsx src/components/teamAgents/__tests__/TeamAgentUI.test.ts

# 3. Monorepo Quality Gates
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 10. Self-Review Requirements

Verify git diff file-by-file against all acceptance criteria, ensuring no security regressions, permission bypasses, or duplicate types before writing `reports/current.md`.

---

## 11. Required Report

Write execution report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.

