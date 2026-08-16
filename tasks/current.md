Task-ID: P7-01
Phase: 7

# [P7-01] — Multi-Agent Handoff & Role Delegation Protocol

**Task ID:** P7-01  
**Phase:** Phase 7 — Multi-Agent Orchestration & Collaborative Workflows  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-16  

---

## 1. Objective

Implement the core Multi-Agent Handoff and Role Delegation Protocol in `apps/server`: extend the SQLite schema with thread hierarchy (`threads.parent_thread_id`), author `AgentDelegationService.ts` for spawning, supervising, and resuming child agent sessions across specialized engineering roles, expose built-in delegation meta-tools to agents (`delegate_task`, `request_review`), and wire thread lifecycle events onto the Asterim `EventBus`.

---

## 2. Why This Task Exists

In Phase 6, Asterim established the foundational multi-agent building blocks: MCP server supervision, reusable skills, and role-based agent profiles (Lead Architect, Senior Backend, Frontend, DevOps, Security Auditor, QA).

However, agents currently operate in single-session isolation. Complex engineering tasks require seamless collaboration between specialized personas (e.g. a Lead Architect decomposes a feature and delegates implementation subtasks to a Backend Specialist, then requests a code review from a Security Auditor before merging). The Delegation Protocol provides the structured parent-child coordination mechanism for multi-agent workflows.

---

## 3. Context & Architecture

- **Thread Hierarchy**: Child threads link to their parent thread via `parent_thread_id` and maintain their own isolated session transcripts.
- **Delegation Meta-Tools**:
  - `delegate_task(role: string, task: string, context?: string)`: Spawns a child session under the requested role profile, pauses the parent session (`WAITING_FOR_CHILD`), streams child execution, and returns the child's final outcome to the parent's stdin.
  - `request_review(diff: string, criteria?: string[])`: Spawns a Reviewer or Security Auditor subagent to critique changes and returns structured PASS / NEEDS_FIX feedback.
- **Session State Transitions**:
  - Parent: `ACTIVE` → `WAITING_FOR_CHILD` → `ACTIVE` (resumed with child output).
  - Child: `STARTING` → `ACTIVE` → `COMPLETED` / `FAILED`.
- **Recursion Guard**: Bounded delegation depth (max depth = 3) to prevent infinite delegation loops.

---

## 4. Implementation Scope

1. **Database Schema (`DatabaseService.ts`)**:
   - Add `parent_thread_id TEXT` and `delegation_context_json TEXT` to `threads` table.
   - Create index `idx_threads_parent ON threads(parent_thread_id)`.

2. **Shared Types (`packages/shared/src/types/delegation.ts`)**:
   - `DelegationRequest`: `parentThreadId`, `targetRole` (or `profileId`), `taskDescription`, `inputContext?`, `timeoutMs?`.
   - `DelegationResult`: `childThreadId`, `status` (`COMPLETED` | `FAILED` | `TIMEOUT`), `summary`, `output`, `artifacts?`.
   - Export from `packages/shared/src/index.ts`.

3. **`AgentDelegationService.ts` (`apps/server/src/services/ai/AgentDelegationService.ts`)**:
   - `delegateTask(request: DelegationRequest)`:
     - Resolves the target `AgentProfile` for `targetRole`.
     - Checks delegation depth (rejects with error if `depth > 3`).
     - Creates child thread in SQLite linked via `parent_thread_id`.
     - Spawns child agent session via `AgentService.startAgent(childThreadId, profile.id)`.
     - Puts parent session in waiting state.
     - Monitors child session completion, collects output summary, and resumes parent session with formatted result.

4. **Delegation Meta-Tools in `McpAgentBridge.ts` / `McpToolPrompt.ts`**:
   - Expose `delegate_task` and `request_review` as system meta-tools available to orchestrator/architect profiles.
   - Route tool invocations through `AgentDelegationService.delegateTask`.

5. **REST API Endpoints (`apps/server/src/routes/delegation.ts` or `routes/threads.ts`)**:
   - `POST /api/v1/threads/:id/delegate` — Manually trigger or inspect delegation.
   - `GET /api/v1/threads/:id/children` — List child threads and their delegation status.
   - Register in `apps/server/src/index.ts`.

6. **Automated Unit & Integration Test Suite (`apps/server/src/services/ai/__tests__/AgentDelegationService.test.ts`)**:
   - Test parent-child thread creation and hierarchy linking in SQLite.
   - Test delegation lifecycle: parent delegation → child spawn → child execution → result returned to parent.
   - Test timeout and child crash handling (parent resumes with failure explanation).
   - Test delegation depth limit enforcement (depth > 3 rejected).
   - Wire into `apps/server/package.json` `"test"` script.

---

## 5. Constraints & Forbidden Changes

- Do NOT allow cyclic delegation loops (enforce max delegation depth = 3).
- Child processes must inherit sanitized environments without leaking parent credentials.
- Do NOT break any of the existing 34 test suites.

---

## 6. Acceptance Criteria

1. SQLite schema supports parent-child thread hierarchy (`parent_thread_id`).
2. `AgentDelegationService` successfully spawns child sessions under specified role profiles and passes task context.
3. Parent session pauses and cleanly resumes upon child session completion or timeout.
4. Delegation depth is bounded to prevent infinite recursion (rejects delegation when depth > 3).
5. `delegate_task` and `request_review` are callable by agents as system meta-tools.
6. `AgentDelegationService.test.ts` passes with comprehensive assertions.
7. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`.

---

## 7. Definition of Done

- [ ] `threads.parent_thread_id` added to SQLite schema
- [ ] Shared delegation types added to `@asterim/shared`
- [ ] `AgentDelegationService.ts` implemented
- [ ] Delegation meta-tools registered in `McpAgentBridge`
- [ ] REST routes functional
- [ ] `AgentDelegationService.test.ts` created and passing
- [ ] Monorepo CI gates pass cleanly

---

## 8. Verification Commands

```bash
# Run new Agent Delegation Service test suite
pnpm --filter asterim exec tsx src/services/ai/__tests__/AgentDelegationService.test.ts

# Run all agent AI test suites
pnpm --filter asterim exec tsx src/services/ai/__tests__/ProfileService.test.ts

# Run full monorepo CI pipeline
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 9. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
