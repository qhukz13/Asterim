Task-ID: P8-04
Phase: 8

# [P8-04] — End-to-End Destructive Tool Approval Interception & EventBus Resolution for Shared Team Agents

**Task ID:** P8-04  
**Phase:** Phase 8 — Collaborative Team Agents & Multi-User Governance  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-18  

---

## 1. Objective

Wire end-to-end destructive tool and command approval interception into shared team agent execution: subscribe `EventBusTeamTurnExecutor` to `agent.approval_request` events so active team turns automatically transition to `AWAITING_APPROVAL` with tool action metadata (`actionId`, `command`, `description`, `securityAnalysis`); update `TeamAgentService.resolveTurnApproval` to publish `client.approval_response` to the `EventBus` (unblocking `ApprovalManager` and signaling `'y'`/`'n'` to the agent session); update `@asterim/shared` types and web UI (`TurnApprovalCard`, `ActiveTurnQueueInspector`, `TeamThreadChatView`) to display specific tool command details, risk level badges, and security warnings; and write comprehensive end-to-end integration tests in `TeamAgentService.test.ts` and `TeamAgentUI.test.ts`.

---

## 2. Why This Task Exists

In P8-03, multi-user governance policies (`ANY_MEMBER`, `ADMIN_ONLY`, `TURN_INITIATOR`), team-scoped RBAC, and approval resolution endpoints were implemented. However, as documented in the P8-03 execution and verification reports:
1. **Disconnected Interception**: `TeamAgentService.markTurnAwaitingApproval` is not wired to real adapter or MCP tool approval events (`agent.approval_request`). When an agent halts execution on a destructive command, the team turn does not automatically park in `AWAITING_APPROVAL`.
2. **Missing Downstream Resolution Signal**: When `POST /api/v1/team-threads/:id/approvals` resolves a turn approval, `resolveTurnApproval` updates the internal turn lock and SQLite row but does not publish `client.approval_response` on the `EventBus`. Consequently, `ApprovalManager`'s pending promise is never resolved and `AgentService` never sends `'y'`/`'n'` to the PTY adapter process.
3. **Missing Tool Action Metadata on Approval Cards**: The UI `TurnApprovalCard` currently only displays the user's initial instruction text rather than the specific tool command, file operation, or security warnings (e.g. `rm -rf`, path traversal, critical MCP tool execution) that triggered the approval checkpoint.

Connecting these seams closes the final functional gap in Phase 8 (`DEC-031` § 3).

---

## 3. Context & Architecture (DEC-031, DEC-028 & ARCHITECTURE.md)

- **Approval Interception Flow (`DEC-031` § 3)**:
  - Agent process or MCP gateway requests tool approval → `ApprovalManager.requestApproval` emits `agent.approval_request` on the `EventBus` with `{ projectId, threadId, actionId, description, command, securityAnalysis }`.
  - `EventBusTeamTurnExecutor` (or `TeamAgentService` listener) observes `agent.approval_request` for its active `threadId`.
  - `TeamAgentService.markTurnAwaitingApproval` is called with the pending action details:
    - Sets turn status to `AWAITING_APPROVAL`.
    - Attaches `pendingApproval: { actionId, command, description, riskLevel, warnings }` to the turn queue state and persists/broadcasts it via `team_turn:started`.
- **Approval Resolution Bridge (`EventBus` & `ApprovalManager`)**:
  - Caller invokes `POST /api/v1/team-threads/:id/approvals` with `{ turnId, decision, comment }`.
  - `resolveTurnApproval` authorizes the caller against the thread's `approvalPolicy`.
  - If authorized:
    - Emits `client.approval_response` on the `EventBus` with `{ actionId, approved: decision === 'APPROVED', threadId }`.
    - `ApprovalManager` receives the event and resolves its pending execution promise.
    - `AgentService` forwards `'y'` or `'n'` to the active adapter session.
    - `AgentTurnLock.resumeFromApproval` (on `APPROVED`) or `releaseTurn` (on `REJECTED`) updates the turn concurrency lock.
- **Shared Types & UI Integration**:
  - Add `TeamPendingApprovalInfo` to `TeamTurnQueueItem` in `@asterim/shared`.
  - In `TurnApprovalCard.tsx`, render the action command snippet, description, risk level badge (`low`, `medium`, `high`, `critical`), and security warnings if present.

---

## 4. Repository Evidence

- `apps/server/src/services/ai/TeamAgentService.ts` — `EventBusTeamTurnExecutor` and `resolveTurnApproval` methods to update.
- `apps/server/src/services/ApprovalManager.ts` — Emits `agent.approval_request` and listens for `client.approval_response`.
- `apps/server/src/services/mcp/McpToolGateway.ts` — Evaluates tool security and requests human approval via `ApprovalManager`.
- `apps/server/src/services/AgentService.ts` — Listens for `client.approval_response` and forwards `'y'`/`'n'` to adapter sessions.
- `packages/shared/src/types/teamAgent.ts` — Shared domain interfaces for team turns and approvals.
- `apps/web/src/components/teamAgents/ActiveTurnQueueInspector.tsx` & `TeamThreadChatView.tsx` — UI rendering `TurnApprovalCard`.
- `apps/web/src/stores/useTeamAgentStore.ts` — Zustand store managing team agent state.

---

## 5. Implementation Scope

1. **Shared Types (`packages/shared/src/types/teamAgent.ts`)**:
   - Define `TeamPendingApprovalInfo` containing `actionId`, `command?`, `description?`, `riskLevel?`, and `warnings?`.
   - Add optional `pendingApproval?: TeamPendingApprovalInfo` to `TeamTurnQueueItem` and `TeamTurnEventPayload`.

2. **EventBus Interception & Auto-Parking (`apps/server/src/services/ai/TeamAgentService.ts`)**:
   - In `EventBusTeamTurnExecutor` (or `TeamAgentService`), subscribe to `agent.approval_request` matching the active turn's `threadId`.
   - On approval request, call `markTurnAwaitingApproval(threadId, turnId, pendingApproval)` to park the turn and broadcast the updated queue state with tool action details.
   - On `agent.approval_cancelled`, handle cancellation gracefully if the turn is parked.

3. **EventBus Resolution Bridge (`apps/server/src/services/ai/TeamAgentService.ts`)**:
   - In `resolveTurnApproval`, publish `client.approval_response` to the `EventBus` with `{ actionId, approved: decision === 'APPROVED', threadId }`.
   - If decision is `REJECTED`, also ensure any pending approvals for that thread are cancelled via `ApprovalManager`.

4. **Web UI & Store Enhancement (`apps/web/src/`)**:
   - Update `useTeamAgentStore.ts` to retain `pendingApproval` metadata on the active turn.
   - Update `TurnApprovalCard` (in `ActiveTurnQueueInspector.tsx` and `TeamThreadChatView.tsx`) to display the tool command/action description, security risk badge, and any warning callouts.

5. **Automated Unit & Integration Tests**:
   - Expand `apps/server/src/services/ai/__tests__/TeamAgentService.test.ts` to verify:
     - `agent.approval_request` triggers automatic transition to `AWAITING_APPROVAL` with `pendingApproval` metadata.
     - `resolveTurnApproval(APPROVED)` emits `client.approval_response` (`approved: true`) and resumes the turn to completion.
     - `resolveTurnApproval(REJECTED)` emits `client.approval_response` (`approved: false`), cancels the turn, and advances the queue.
   - Expand `apps/web/src/components/teamAgents/__tests__/TeamAgentUI.test.ts` to verify `TurnApprovalCard` renders tool command snippets, risk badges, and security warnings.

---

## 6. Explicitly Forbidden Changes

- Do NOT bypass `AgentTurnLock` atomicity guarantees.
- Do NOT weaken data sovereignty (`DEC-028` / `DEC-032`); all agent transcripts, memory, and code must stay on the host workstation.
- Do NOT duplicate types between server and web packages; import exclusively from `@asterim/shared`.
- Do NOT break existing single-developer sessions or unauthenticated local fallback modes.

---

## 7. Acceptance Criteria

1. **Automatic Approval Parking**: When an `agent.approval_request` event occurs for an active team thread, the turn transitions to `AWAITING_APPROVAL` and carries `pendingApproval` details (`actionId`, `command`, `description`, `riskLevel`, `warnings`).
2. **EventBus Resolution Dispatch**: `resolveTurnApproval` publishes `client.approval_response` to the `EventBus` with the appropriate `actionId` and `approved` boolean, unblocking downstream `ApprovalManager` resolvers.
3. **Rejection Queue Advancement**: Rejecting an approval immediately cancels the turn, signals the rejection error to the running turn, advances the FIFO queue to the next waiting member, and notifies `ApprovalManager`.
4. **UI Tool Command & Risk Rendering**: `TurnApprovalCard` renders the specific tool command/description, risk level badge, and security warnings alongside submitter attribution and approval controls.
5. **Automated Tests Pass**: `TeamAgentService.test.ts` and `TeamAgentUI.test.ts` pass 100% with new coverage for end-to-end tool approval interception and resolution.
6. **Monorepo CI Gates Pass**: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, and `pnpm run build` exit with 0 errors across all workspaces.

---

## 8. Definition of Done

- [ ] `TeamPendingApprovalInfo` exported in `@asterim/shared`
- [ ] `agent.approval_request` intercepted in team turn execution, transitioning turn to `AWAITING_APPROVAL`
- [ ] `resolveTurnApproval` emits `client.approval_response` to EventBus on resolution
- [ ] UI `TurnApprovalCard` updated with tool command, risk badges, and security warnings
- [ ] Server and Web integration test suites updated and passing 100%
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

Verify git diff file-by-file against all acceptance criteria, ensuring clean separation of concerns, no duplicate types, and robust error handling before writing `reports/current.md`.

---

## 11. Required Report

Write execution report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.

