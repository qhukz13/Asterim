# Current Task: P5.2-01 — Project Memory Store & Real-Time Event Integration

**Task ID:** P5.2-01  
**Phase:** Phase 5.2 — Project Decision Explorer & Memory UI  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-14  

---

## 1. Objective

Implement the frontend Project Memory store (`apps/web/src/stores/useMemoryStore.ts`) and integrate real-time WebSocket memory events in `apps/web/src/hooks/useSocket.ts`, enabling the Web UI to fetch briefings, query decisions/rules/intents, and live-update when memory events occur.

---

## 2. Context & Requirements

* In Phase 5.0, 8 REST endpoints were implemented in `apps/server/src/routes/memory.ts` under `/api/projects/:projectId/memory` (or `/memory`).
* The Core server's `EventBus` emits memory events (`memory.decision_created`, `memory.decision_superseded`, `memory.rule_created`, `memory.intent_updated`).
* In Phase 5.2, we build the Decision Explorer, Memory Timeline, and Re-entry Briefing. The first vertical step is establishing the client-side state store and live socket synchronization.

---

## 3. Repository Evidence & Relevant Files

Inspect:
* [`apps/server/src/routes/memory.ts`](file:///c:/Projects/Asterim/apps/server/src/routes/memory.ts)
* [`packages/shared/src/types/memory.ts`](file:///c:/Projects/Asterim/packages/shared/src/types/memory.ts)
* [`apps/web/src/stores/useProjectStore.ts`](file:///c:/Projects/Asterim/apps/web/src/stores/useProjectStore.ts)
* [`apps/web/src/hooks/useSocket.ts`](file:///c:/Projects/Asterim/apps/web/src/hooks/useSocket.ts)
* [`reports/current.md`](file:///c:/Projects/Asterim/reports/current.md)

---

## 4. Implementation Scope

1. **Memory State Store (`apps/web/src/stores/useMemoryStore.ts`)**:
   - Define state interface:
     - `briefing: ProjectBriefing | null`
     - `decisions: ProjectDecision[]`
     - `rules: ArchitecturalRule[]`
     - `activeIntent: ProjectIntent | null`
     - `loading: boolean`
     - `error: string | null`
   - Actions:
     - `fetchBriefing(projectId: string): Promise<void>`
     - `fetchDecisions(projectId: string, filter?: { status?: DecisionStatus }): Promise<void>`
     - `fetchRules(projectId: string): Promise<void>`
     - `fetchIntent(projectId: string): Promise<void>`
     - `createDecision(projectId: string, data: CreateDecisionInput): Promise<ProjectDecision>`
     - `supersedeDecision(projectId: string, decisionId: string, data: SupersedeDecisionInput): Promise<ProjectDecision>`
     - `createRule(projectId: string, data: CreateRuleInput): Promise<ArchitecturalRule>`
     - `createIntent(projectId: string, data: CreateIntentInput): Promise<ProjectIntent>`
     - `handleMemoryEvent(event: AsterimEvent): void` (updates local state in-place on socket event)
2. **WebSocket Hook Integration (`apps/web/src/hooks/useSocket.ts`)**:
   - Listen for memory events (`memory.decision_created`, `memory.decision_superseded`, `memory.rule_created`, `memory.intent_updated`).
   - Forward received memory events to `useMemoryStore.getState().handleMemoryEvent(event)`.
3. **Unit Tests (`apps/web/src/stores/__tests__/useMemoryStore.test.ts` or standalone test)**:
   - Test store initial state, fetch actions with mock HTTP responses, and state updates upon memory events.

---

## 5. Explicitly Forbidden Changes

* Do **NOT** modify existing backend routes or database tables.
* Do **NOT** alter existing socket authentication protocols.

---

## 6. Acceptance Criteria

1. `useMemoryStore.ts` accurately represents the domain models from `@asterim/shared`.
2. REST methods correctly call `/memory/*` endpoints with proper error handling.
3. Socket event listener updates memory state in real-time.
4. `pnpm run build` completes with 0 errors across all monorepo packages.

---

## 7. Verification Commands

```bash
pnpm --filter @asterim/web exec tsc --noEmit
pnpm --filter @asterim/web build
pnpm run build
```

---

## 8. Required Report Format

Upon completion, write the execution result directly to `reports/current.md` using the standard format:
* **Task ID**: P5.2-01
* **Status**: `IMPLEMENTED` / `VERIFIED` / `BLOCKED`
* **Summary**: Summary of memory store implementation and WebSocket integration
* **Files Changed**: List of files created/modified
* **Tests / Verification**: Output of build and typecheck commands
* **Problems Discovered & Concerns**: Any issues encountered
* **Recommended Next Step**: Recommendation for P5.2-02 (Decision Explorer UI Component)
