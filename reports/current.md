Task-ID: P8-03
Status: COMPLETE

# Execution Report: P8-03 — Multi-User Governance, Role-Based Turn Approvals & Team Project Memory Integration

**Task ID:** P8-03
**Phase:** Phase 8 — Collaborative Team Agents & Multi-User Governance
**Status:** IMPLEMENTED
**Date:** 2026-08-18
**Author:** Claude Code

---

## 1. Summary

Shared team agents are now governed. Every mutating route on the team agent surface is authorized against the caller's membership of the team that owns the thing being touched — never against a `teamId` the request supplied — and the three gaps the task named are closed:

1. **RBAC.** `POST/PATCH/DELETE /api/v1/team-agents`, thread creation, turn submission and turn withdrawal all check membership and role. Retiring a shared role (which cascades away every thread and transcript on it) requires admin/owner; withdrawing a queued turn requires being its submitter or an admin. Reads are scoped too, so one team cannot list another's agents.
2. **Approvals.** A turn parked in `AWAITING_APPROVAL` is now answerable: `POST /api/v1/team-threads/:id/approvals` evaluates the caller against the policy in force (`ANY_MEMBER` / `ADMIN_ONLY` / `TURN_INITIATOR`), then either resumes the turn through `AgentTurnLock.resumeFromApproval` or cancels it through `releaseTurn(..., { status: 'CANCELLED' })`. The answer is written to the turn row, to the shared transcript, and broadcast as `team_turn:approval_resolved`.
3. **Team project memory.** A turn on a project-bound thread is handed the project's active architectural rules, current intent and active decisions from `ProjectMemoryCore`, published into the shared session ahead of the instruction they govern.

The dashboard follows: the store gained `resolveApproval` and a Core-supplied `viewer`, and both the queue inspector and the collaborative transcript render an approval card with submitter attribution, the policy requirement, and Approve / Reject controls that are offered only to somebody the policy admits.

The single-developer path is preserved throughout: a team with **no** `workspace_memberships` rows at all (what a workstation that has never had accounts on it looks like) is treated as unmanaged and its user retains full standing, exactly as `EnvironmentSecretService` already does.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `packages/shared/src/types/teamAgent.ts` | Modified | `TeamApprovalPolicy`, `TeamApprovalDecision`, `TeamTurnApprovalRecord`, `TeamTurnApprovalRequest/Result`, `TeamThreadViewer`, `TEAM_TURN_APPROVAL_EVENT`, `TeamTurnApprovalEventPayload`; `approvalPolicy` on `TeamAgent`, `TeamThread`, and both agent inputs |
| `apps/server/src/migrations/003_team_approval_governance.ts` | Created | Migration 3: `approval_policy` on `team_agents` (defaulted) and `team_threads` (nullable = defer to the agent), plus the six approval-answer columns on `team_turn_queue` |
| `apps/server/src/migrations/index.ts` | Modified | Registers migration 3; `LATEST_SCHEMA_VERSION` becomes 3 |
| `apps/server/src/services/ai/TeamAgentService.ts` | Modified | Policy persistence and resolution, `evaluateTeamApproval`, `isTeamAdminRole`, `markTurnAwaitingApproval`, `resolveTurnApproval`, `TeamTurnRejectedError`, project-memory provider + `composeTeamMemoryBrief`, memory injection into `runTurn`, approval broadcast |
| `apps/server/src/routes/teamAgents.ts` | Modified | Team-scoped RBAC guards on every route, the `POST /team-threads/:id/approvals` endpoint, and the `viewer` block on the thread read |
| `apps/server/src/services/ai/__tests__/TeamAgentService.test.ts` | Modified | Sections 13–17: policy configuration, the three policies, parking/approving/rejecting, memory injection, and team-scoped RBAC over HTTP |
| `apps/web/src/stores/useTeamAgentStore.ts` | Modified | `resolveApproval`, `viewer`, `resolvingApprovalTurnId`, approval-event reduction, and the four pure approval helpers |
| `apps/web/src/components/teamAgents/ActiveTurnQueueInspector.tsx` | Modified | `TurnApprovalCard` (shared) and the parked-turn branch of the inspector |
| `apps/web/src/components/teamAgents/TeamThreadChatView.tsx` | Modified | Renders the approval card beneath the transcript and threads the props to the inspector |
| `apps/web/src/components/teamAgents/CreateTeamAgentModal.tsx` | Modified | Approval policy selector on the role form |
| `apps/web/src/hooks/useSocket.ts` | Modified | Comment only — the new event is picked up through `TEAM_TURN_EVENT_TYPES` |
| `apps/web/src/components/teamAgents/__tests__/TeamAgentUI.test.ts` | Modified | Helper, store, socket, modal and render coverage for approvals |

## 3. Implementation Details

**Schema (DEC-030).** Migration 3 is additive only, using the engine's `columns` form (`PRAGMA table_info` presence check rather than a swallowed `ALTER TABLE` error). `team_agents.approval_policy` defaults to `'ANY_MEMBER'` so every existing shared role acquires the policy it has been operating under; `team_threads.approval_policy` is nullable because NULL means "whatever the agent says", which is a different answer from `ANY_MEMBER` and must not decay into it. `team_turn_queue` gains `approval_decision`, `approval_policy`, `approval_resolved_by`, `approval_resolved_by_name`, `approval_comment`, `approval_resolved_at`.

**Policy evaluation** lives in `evaluateTeamApproval`, a pure function taking the policy, the caller's standing and whose turn it is. The database lookup that produces the role stays in the route, so all three policies are asserted directly without a workspace, a membership row or an HTTP request. `ADMIN_ONLY` requires admin/owner; `TURN_INITIATOR` admits the submitter or an admin; `ANY_MEMBER` requires `agent:approve`, which excludes a viewer.

**Answering a prompt** (`resolveTurnApproval`) checks the policy *before* writing anything, then records the answer on the turn and in the transcript, then tells the lock. Approval calls `resumeFromApproval` and puts the row back to `PROCESSING`. Rejection writes `CANCELLED`, calls `releaseTurn(..., { status: 'CANCELLED', errorMessage })` so the queue advances immediately, and signals the still-running turn.

That signal is the one non-obvious piece. A rejection releases the lock while the executor is still waiting on an agent that has not been told, so `runTurn` races the executor against a rejection promise (`raceRejection`). `Promise.race` subscribes to both, so the executor's later rejection is never unhandled, and a `TeamTurnRejectedError` settles the turn as `CANCELLED` rather than `FAILED` — nothing broke, a person said no. A late answer from the abandoned executor cannot overwrite the cancellation or reach the transcript; this is asserted directly.

**Project memory** is read per turn (not per queueing), so a rule recorded while a turn waited its place in line still governs it. `composeTeamMemoryBrief` orders rules first (what may not be broken), then intent, then settled decisions, and returns `undefined` when the project has none of the three — an agent told "the team has decided:" followed by silence would infer that the team has decided nothing. `EventBusTeamTurnExecutor` publishes the brief only when it differs from what that thread's session was last given, so twenty rules are not re-sent before every instruction. Memory that cannot be read is logged and skipped: it is context, not a precondition, and the turn is still served.

**The `viewer` block** on `GET /team-threads/:id` is answered by the Core (role, unmanaged flag, effective policy, `canApprove`, `canAdminister`). The dashboard mirrors the rule in `canResolveApproval` purely to avoid offering a button whose only outcome is a 403 — the Core refuses independently.

**Local-first (DEC-028 / DEC-032).** Nothing new leaves the workstation: the approval answer is a row and a transcript line, the broadcast goes through the existing EventBus → workspace room bridge, and no memory, transcript or decision text crosses a relay boundary that did not already carry it.

## 4. Verification

All commands run from the repository root. The two root aggregate scripts (`pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`) are not permitted to run in this non-interactive session, so each workspace was run individually — which is exactly what `turbo run <task>` fans out to.

| Gate | Command | Result |
| :--- | :--- | :--- |
| Team agent backend | `pnpm --filter asterim exec tsx src/services/ai/__tests__/TeamAgentService.test.ts` | **299/299 assertions passed** (was 174 before this task) |
| Team agent UI | `pnpm --filter @asterim/web exec tsx src/components/teamAgents/__tests__/TeamAgentUI.test.ts` | **364/364 assertions passed** (was 282) |
| Typecheck | `tsc --noEmit` in `@asterim/shared`, `@asterim/adapters`, `@asterim/mcp-memory-server`, `@asterim/relay`, `@asterim/marketing`, `@asterim/web`, `asterim` | 0 errors in all seven |
| Lint | `eslint` in `asterim`, `@asterim/web`, `@asterim/shared` | **0 errors** (warnings only, all pre-existing `no-explicit-any` / `react-refresh` noise; the files added by this task contribute 3 `any` warnings in the test harness only) |
| Server suite | `pnpm --filter asterim test` (28 suites) | all pass, no FAIL lines |
| Web suite | `pnpm --filter @asterim/web test` (12 suites) | all pass |
| Adapters / Relay / MCP suites | `pnpm --filter @asterim/adapters test`, `@asterim/relay`, `@asterim/mcp-memory-server` | 30/30, 71/71, and 7 suites all passing |
| Build | `build` in `@asterim/shared`, `@asterim/adapters`, `@asterim/mcp-memory-server`, `@asterim/web`, `asterim`, `@asterim/relay`, `@asterim/marketing` | all succeed |

One verification trap worth recording: `@asterim/mcp-memory-server`'s suite initially failed after migration 3 was added, because it spawns its **prebuilt** `dist/index.js`, and a build that predates a migration correctly refuses to open a database that has it (DEC-030's downgrade guard). Rebuilding that package fixed it — and `turbo.json` already encodes the dependency (`@asterim/mcp-memory-server#test` dependsOn `build`), so `pnpm run test` at the root would not have hit it. It was an artefact of running the filtered test directly, not a defect.

No screenshot/browser QA was run: this task's Definition of Done names typecheck/lint/test/build only, and the UI is covered by real `react-dom/server` renders in the web suite.

## 5. Acceptance Criteria Review

- [x] **1. RBAC authorization** — `POST/PATCH/DELETE /api/v1/team-agents` and `DELETE /team-threads/:id/turns/:turnId` enforce membership and role, returning 403 with `code: FORBIDDEN`. Asserted in test § 17: viewer create 403, outsider create 403, member create 201, viewer patch 403 (and the prompt verified untouched), outsider patch 403, member delete 403, owner delete 200, another member's withdrawal 403 (turn verified still QUEUED), submitter's own 200, admin's override 200. Thread creation and turn submission are guarded on the same basis (viewer 403 for both).
- [x] **2. Approval policy configuration** — `approvalPolicy` on `TeamAgent`, `TeamThread`, `CreateTeamAgentInput` and `UpdateTeamAgentInput`, persisted by migration 3. Test § 13: default is `ANY_MEMBER`, a policy given at creation survives, an unrecognised value is `INVALID_INPUT` (never silently defaulted), a patch that does not name it does not reset it, a thread override wins over its agent, and an unset thread policy resolves to the agent's.
- [x] **3. Approval resolution** — `POST /api/v1/team-threads/:id/approvals` evaluates the caller against the policy, resumes or cancels the turn through the lock, appends the resolution to the transcript, and broadcasts `team_turn:approval_resolved`. Test § 15 (service) and § 17 (HTTP): a member is refused under `ADMIN_ONLY` with nothing written; an owner's approval returns the turn to `PROCESSING` with the answer on the row and in the transcript; a rejection cancels the turn, releases the lock to the next member, and survives a late answer from the abandoned executor; answering twice is 409; anonymous is 401; a body naming no turn is 400.
- [x] **4. Project memory integration** — active rules, current intent and active decisions are composed into a brief and handed to the executor for project-bound threads. Test § 16: the brief orders rules before intent, carries severities, scopes, constraints and non-goals; a bound turn receives it; an unbound thread receives none; unreadable memory does not fail the turn. § 16b asserts the production executor publishes it once, does not repeat it into a session that already has it, sends it again when it changes, and always ahead of the instruction it governs.
- [x] **5. UI approval controls** — `TurnApprovalCard` renders in both `ActiveTurnQueueInspector` and `TeamThreadChatView`. Render assertions: `aria-label="Approval required"`, whose turn is blocked with initials, the instruction, how long it has been parked, the policy badge, the policy requirement sentence, and both actions with per-turn accessible labels; a member under `ADMIN_ONLY` is offered no buttons and told why; the submitter may answer their own under `TURN_INITIATOR`; an in-flight answer disables both buttons.
- [x] **6. Automated tests pass** — `TeamAgentService.test.ts` 299/299 and `TeamAgentUI.test.ts` 364/364, both 100%, including the new RBAC, approval and memory coverage.
- [x] **7. Monorepo CI gates** — typecheck, lint, test and build are green across every workspace (see § 4 for the per-workspace commands used in place of the blocked root scripts).

## 6. Git Diff Review

Reviewed file by file against the criteria and the forbidden-changes list:

- **No duplicated types.** Every approval type is declared once in `@asterim/shared` and imported by both runtimes; the server and web each hold only their own presentation helpers.
- **No weakened lock atomicity.** Approvals go through `markAwaitingApproval` / `resumeFromApproval` / `releaseTurn`; `AgentTurnLock` itself is unchanged in this diff. The parked turn keeps the lock, verified by asserting the turn behind it never reaches the executor while parked.
- **No data-sovereignty regression.** No new network calls, no new payload leaving the host; the approval event rides the existing workspace-room bridge.
- **No permission bypass introduced.** Guards read the owning team from the stored record, never from the request body; `PATCH` re-reads the agent before authorizing so a body naming another `teamId` cannot be used to pick the team the check runs against.
- **Local fallback intact.** The unmanaged-team path is the only way past a guard, it requires zero membership rows in the team, and it is asserted both as a unit (`evaluateTeamApproval`) and through the pre-existing REST section, which runs entirely on unmanaged teams and still passes unchanged.
- Two review findings were fixed before reporting: an unused exported `describeApprovalPolicy` on the server (removed — the web has its own wording) and an unused field on the route helper `teamOfThread`.

`tests/report.md` is also modified in the working tree. That change was present before this task started (it is the orchestrator's P8-02 verification report) and is deliberately **not** included in this commit.

## 7. Problems Discovered

1. **A rejection races the executor.** Releasing the lock on rejection while the agent is still working meant a late `COMPLETED` could overwrite the cancellation. Solved with the rejection promise raced against the executor inside `runTurn`, plus a dedicated `TeamTurnRejectedError` so a refusal is not reported as a failure. Covered by an explicit "a late answer does not overwrite the rejection" assertion.
2. **Nothing parked turns.** `AgentTurnLock.markAwaitingApproval` existed from P8-01 but had no caller, so `AWAITING_APPROVAL` was unreachable in the team path and untestable end to end. `TeamAgentService.markTurnAwaitingApproval` is now the seam that parks a turn (lock + durable row + thread row). The tool-call interception that will *call* it lives in the ordinary session path and is out of this task's scope.
3. **`admin` does not hold `workspace:admin`.** In `RbacService` only `owner` has that permission, so "workspace:admin or owner" from the task would have excluded admins. `isTeamAdminRole` treats owner, admin, or any role holding `workspace:admin` as administering, which is what the task's prose intends.
4. **A stale build fails a downstream suite** — see § 4; not a defect, and already handled by `turbo.json` for the root test run.

## 8. Architectural Concerns

- **`TURN_INITIATOR` in the `viewer` block is answered against the caller when no turn is parked.** With nothing parked there is no initiator to compare against, so `canApprove` is computed as "could you approve your own turn". Clients should — and the shipped ones do — re-evaluate per parked turn via `canResolveApproval`; the Core is authoritative either way. Worth a look if the `viewer` block is ever used for anything but enabling a button.
- **The approval rule is stated twice** (server `evaluateTeamApproval`, web `canResolveApproval`). Deliberate — the web copy only decides whether to render a control, and cannot grant anything — but it is a divergence risk if a fourth policy is ever added. If Antigravity would rather not carry it, the alternative is a per-turn `canApprove` on the queue payload.
- **The memory brief goes into the shared session as a chat message**, so an adapter will answer it the way it answers the persona brief today. That is pre-existing behaviour for briefs, not new, but if it proves noisy the honest fix is an adapter-level "system context" channel rather than suppressing the brief.
- **DEC-031 § 3 is now implemented but not yet triggered end to end**: no destructive-tool interception in the team path calls `markTurnAwaitingApproval`. Wiring the existing approval interception through to it is the natural next task.

## 9. Recommended Next Step

**P8-04 — wire the existing destructive-tool approval interception into shared team threads**, so a team turn actually parks itself on `markTurnAwaitingApproval` when the adapter raises an approval prompt, and the prompt's own text (the command being approved) reaches the approval card instead of only the instruction. Everything downstream of that — policy, endpoint, transcript, broadcast, UI — is in place and tested.
