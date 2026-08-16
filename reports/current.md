Task-ID: P7-01
Status: COMPLETE

# Execution Report: P7-01 — Multi-Agent Handoff & Role Delegation Protocol

**Task ID:** P7-01
**Phase:** Phase 7 — Multi-Agent Orchestration & Collaborative Workflows
**Status:** IMPLEMENTED & VERIFIED
**Date:** 2026-08-16
**Author:** Claude Code

---

## 1. Summary

The delegation protocol is implemented end to end in `apps/server` and `packages/shared`.

A thread can now hand a self-contained piece of work to another engineering role. `AgentDelegationService` resolves the target profile, refuses the request if it would exceed the depth bound, creates a child thread linked through `threads.parent_thread_id`, starts a session under that role, watches the child's own events on the EventBus until it settles, records the outcome on the child row, stops the child, and releases the parent with a report. A crash, a timeout, and a session that never launched all end the same way: the parent is released and told what happened.

Two meta-tools — `delegate_task` and `request_review` — are offered to sessions whose profile is an orchestrator/architect role, routed through the existing `gateway → bridge` path so they inherit the security policy and approval gate every other agent tool goes through. Two REST routes expose the same service to an operator.

Nothing spawns a process in the new code. Child sessions are started the same way the dashboard starts one (a `client.command` on the bus), so they inherit `ProcessManager`'s `sanitizeAgentEnv` and every other guarantee `AgentService` already owns.

---

## 2. Files Changed

| File | Kind | Purpose |
| :--- | :--- | :--- |
| `packages/shared/src/types/delegation.ts` | new | The contract: `DelegationRequest`/`DelegationResult`/`DelegationContext`, `MAX_DELEGATION_DEPTH`, the four event names + payloads, the meta-tool definitions, `canProfileDelegate`, `parseReviewVerdict`. |
| `packages/shared/src/index.ts` | modified | Exports `./types/delegation`. |
| `apps/server/src/services/DatabaseService.ts` | modified | `threads.parent_thread_id`, `threads.delegation_context_json`, `idx_threads_parent` — additive ALTERs in try/catch, matching the existing no-migration-framework pattern. |
| `apps/server/src/services/ai/AgentDelegationService.ts` | new | The service: depth walk, child creation, lifecycle supervision, parent park/resume, meta-tool execution, `EventBusSessionRunner`. |
| `apps/server/src/services/mcp/McpAgentBridge.ts` | modified | `getDelegationTools(profile)`, `kind: 'delegation'`, and routing of delegation names in `executeTool` (with an optional session context param). |
| `apps/server/src/services/mcp/McpToolGateway.ts` | modified | Passes the calling `projectId`/`threadId` down to the bridge. |
| `apps/server/src/services/AgentService.ts` | modified | Appends the delegation meta-tools to a delegating profile's session catalogue. |
| `apps/server/src/routes/delegation.ts` | new | `POST /api/v1/threads/:id/delegate`, `GET /api/v1/threads/:id/children`. |
| `apps/server/src/index.ts` | modified | Registers `delegationRoutes`. |
| `apps/server/src/services/ai/__tests__/AgentDelegationService.test.ts` | new | 189 assertions. |
| `apps/server/package.json` | modified | The new suite added to the `test` script. |

---

## 3. Implementation Details

**Thread hierarchy.** A child row carries `parent_thread_id`, `profile_id` and `delegation_context_json` (the brief, the depth, and — once known — the outcome), so a child found later explains itself without a join back through the event log. `getDelegationDepth` walks the chain with a visited set; a cycle in a hand-edited row is reported as beyond the bound, so the guard refuses rather than letting a corrupted row through as a shallow chain.

**Depth guard.** A root thread is depth 0. A request whose child would land at depth > 3 throws `DEPTH_EXCEEDED` before any thread is created or session started. The brief handed to each child also states its own depth and tells it to do the work itself.

**Completion detection.** A PTY-driven CLI agent has no "I am finished" signal, so completion is observed: the child has produced agent output *and then* reported itself idle. The `sawOutput` guard separates that from the idle a session reports at startup. `status: 'error'`, and the idle-with-`Error starting agent…` message that `AgentService` publishes when a session cannot launch, both settle as `FAILED` rather than waiting out the timeout. The timeout timer is deliberately not `unref`'d — it is the only thing that will ever settle a child that went quiet.

**Parent park/resume.** `WAITING_FOR_CHILD` is held in memory (it describes a live session, not a fact worth persisting across a restart) and published as `delegation.parent_state`. A second delegation from a parked parent is refused with `ALREADY_DELEGATING`. The child's process is stopped *before* the parent is resumed, so two agents never touch the same working tree at once. When the delegation came from a meta-tool the report is **not** written in as a message: the adapter already writes it into the parent's stdin as the tool-result line, and sending it twice would have the agent read the same answer again and take it for new work. An operator-triggered delegation does get the message, because nothing else would tell the parent.

**Meta-tools.** `getDelegationTools` is deliberately outside `getAvailableTools`: everything in that list is a running server or a user-written skill, filtered by the profile's capability lists; these two are Asterim itself. The calling thread is supplied by the gateway, never read from the agent's arguments — a thread may only delegate from itself. `request_review` returns a `PASS`/`NEEDS_FIX` verdict; anything ambiguous, and any review that did not finish, reads as `NEEDS_FIX` (a review that could not be completed has not cleared the change).

**Environment.** Child sessions go through `client.command` → `AgentService.startAgent` → `SessionManager` → `BaseAdapter` → `ProcessManager`, which already builds every agent subprocess's environment with `sanitizeAgentEnv` (allow-list; only `ASTERIM_DATA_DIR` survives from the `ASTERIM_*` namespace). No new spawn path was introduced and no parent environment is passed to a child.

---

## 4. Verification

All commands run from the repo root unless noted.

| Command | Result |
| :--- | :--- |
| `pnpm --filter asterim exec tsx src/services/ai/__tests__/AgentDelegationService.test.ts` | **189/189 assertions passed** |
| `pnpm typecheck` (turbo, 11 tasks) | **11 successful, 0 errors** |
| `pnpm lint` (turbo, 7 tasks) | **7 successful, 0 errors** (warnings only; `asterim` 266 warnings / 0 errors, unchanged in kind from the pre-existing baseline) |
| `pnpm test` (turbo, 9 tasks) | **9 successful** — 35 suites, every one green (34 pre-existing + the new one) |
| `pnpm build` (turbo, 7 tasks) | **7 successful** |

Server suites after the change (19 files in `apps/server`'s `test` script): 63, 60, 140, 52, 51, 64, 89, 21, 231, 52, 102, 115, 89, 43, 67, 160, 169, 138, **189** — all passing.

What the new suite covers: the schema columns and index; re-opening an existing database (the additive-ALTER path); depth 0→3 and the refusal at 4; the full lifecycle with its four event types and their state sequences (`STARTING→ACTIVE→COMPLETED`, `WAITING_FOR_CHILD→ACTIVE`); child crash; timeout (asserted as `TIMEOUT`, not folded into `FAILED`); a runner that throws on start; the "could not launch" idle message; the startup idle that must *not* end a delegation early; a sibling thread's events being ignored; `ALREADY_DELEGATING`; every validation refusal; role resolution by role, name and profile id; reviews including an inconclusive one; the profile gate on the meta-tools; the bridge and gateway routing (including that the thread comes from the session and not the arguments); the report parsers; the REST surface including a full delegation over HTTP driven through the *default* runner with the test standing in for `AgentService`.

Not run: any check involving a real agent CLI or PTY child — the repository has no agent binary in CI. The session mechanics are exercised through `DelegationSessionRunner`, and the production runner's own output (the three client events, with the fields `AgentService` requires) is asserted separately.

---

## 5. Acceptance Criteria Review

- [x] **1. SQLite schema supports parent-child thread hierarchy (`parent_thread_id`)** — `DatabaseService.init()` adds `parent_thread_id`, `delegation_context_json` and `idx_threads_parent`; asserted by "parent_thread_id is there", "children are indexed by their parent", "opening the same database again is idempotent", and "the child hangs from its parent".
- [x] **2. `AgentDelegationService` spawns child sessions under specified role profiles and passes task context** — asserted by "exactly one child session was started" / "under the resolved profile" / "the child was handed the task" / "and the context", plus role resolution by role, name and id.
- [x] **3. Parent session pauses and cleanly resumes upon child completion or timeout** — asserted by "the parent waits and is then released" (`['WAITING_FOR_CHILD','ACTIVE']`), "the parent is written to exactly once", and the crash/timeout/failed-launch sections, each of which asserts the parent is released and told.
- [x] **4. Delegation depth is bounded (rejects when depth > 3)** — asserted by "a delegation that would reach depth 4 is refused", "and no child was created for it", "nothing was started", plus the 409 over HTTP.
- [x] **5. `delegate_task` and `request_review` are callable by agents as system meta-tools** — `McpAgentBridge.getDelegationTools` offers them to delegating profiles, `executeTool` routes them, the gateway supplies the session context, `AgentService` puts them in the session catalogue and startup instructions; asserted by the "who is offered the meta-tools", "executeDelegationTool", "the bridge routes delegation calls" and "the gateway hands the calling thread down to the bridge" sections.
- [x] **6. `AgentDelegationService.test.ts` passes with comprehensive assertions** — 189/189, wired into `apps/server`'s `test` script.
- [x] **7. Monorepo CI gates pass with 0 errors** — `typecheck` 11/11, `lint` 0 errors, `test` 9/9 (35 suites), `build` 7/7. See § 4.

## Definition of Done

- [x] `threads.parent_thread_id` added to SQLite schema
- [x] Shared delegation types added to `@asterim/shared`
- [x] `AgentDelegationService.ts` implemented
- [x] Delegation meta-tools registered in `McpAgentBridge`
- [x] REST routes functional
- [x] `AgentDelegationService.test.ts` created and passing
- [x] Monorepo CI gates pass cleanly

---

## 6. Git Diff Review

Reviewed `git diff` and the four new files line by line against the criteria.

- Seven files modified, four added. Every modification is additive: the two schema ALTERs follow the existing try/catch idiom, `executeTool` gains an optional fifth parameter (existing callers unaffected), `AgentToolKind` gains a member, `AgentService` concatenates one extra list, `index.ts` registers one route module.
- No forbidden changes: no new spawn path, no environment plumbing, no credential handling, no git/GitHub API use, no changes to `blueprint/`, and nothing outside the task's stated scope.
- Two defects were found by this review and fixed before reporting:
  1. **Double delivery to the parent.** The adapter writes a tool result straight into the parent's PTY; the service was *also* sending the report as a chat message, so a delegating agent would have read the same answer twice. `delegateTask` now takes `{ resumeParent }`, and the meta-tool path sets it false. Covered by "the parent is not written to twice".
  2. **An unreachable timeout.** The timeout timer was `unref`'d, which let the process exit before it fired — the new suite caught this by ending mid-run. The timer is now held, and always cleared by `finish`.
- One deliberate contract decision came out of the review: an **unprofiled** session is *not* offered the meta-tools. My first cut followed the capability-list convention ("unset means everything"), which broke three assertions in `AgentMcpIntegration.test.ts` that pin the session catalogue. The task specifies these tools for "orchestrator/architect profiles", and the specification is authoritative: delegation is something a *role* does, so `canProfileDelegate(null) === false`. A pre-P7-01 catalogue is therefore byte-identical after this change, and choosing the Tech Lead profile is what turns delegation on. `tests/report.md` shows as unmodified in the working tree; I did not touch it.

---

## 7. Problems Discovered

1. **`AgentService.startAgent` is private, and its signature is `(projectId, threadId, workspace, agentType, profileId)`** — not `startAgent(childThreadId, profile.id)` as the task sketched. Rather than widen a privileged API, child sessions are started through the `client.command` event the dashboard already uses. That keeps the workspace check, profile resolution, tool catalogue and sanitized subprocess environment in the one place that owns them, and it made the production path testable: the REST section of the suite plays `AgentService`'s part and drives a real delegation through `EventBusSessionRunner`.
2. **There is no completion signal from a PTY agent.** Documented in § 3. The `sawOutput`-then-idle rule is the best available inference; the brief asks the child to close with `SUMMARY:`/`ARTIFACTS:` so the parent gets an answer rather than a wall of terminal, with the transcript tail as fallback.
3. **`AgentService` reports a failed launch as `status: 'idle'`** with the reason in the message, not as `'error'`. Without special handling a child that never started looked like a child with nothing to say, and the parent would have waited out the full timeout. Handled and asserted.

---

## 8. Architectural Concerns

1. **Resuming a parent whose session is not running restarts it.** The resume goes out as `client.chat_message`, which auto-starts a stopped agent. That is right for the specified `ACTIVE → WAITING_FOR_CHILD → ACTIVE` state machine, but it means an operator-triggered delegation on an idle thread can bring an agent process up. Flagging it as a product question rather than changing the specified behaviour.
2. **`WAITING_FOR_CHILD` does not survive a restart.** By design — a parent that was waiting when the Core stopped is not waiting for anything when it comes back. But a child row whose outcome was never written reads as `RUNNING` forever in `listChildren`. A sweep at startup, alongside `agentService.recoverSessions()`, would close that; it is out of scope here.
3. **No dashboard surface yet.** The four `delegation.*` events are on the bus and reach the project room, and the REST routes exist, but nothing in `apps/web` renders a thread tree or a "waiting on child" state. That is the natural next slice.
4. **Delegation risk classification is generic.** `evaluateToolSecurity` does not recognise `delegate_task`, so it scores as an unproven medium-risk tool — no approval in balanced mode, approval in strict mode. Spawning a sub-agent may deserve a policy entry of its own; that is a decision for Antigravity, not something I invented here.

---

## 9. Recommended Next Step

**P7-02 — Delegation in the dashboard**: a thread-hierarchy view in `apps/web` (child threads under their parent, live `delegation.*` state, the child's transcript reachable from the parent's card), plus the startup sweep that closes out child rows orphaned by a restart (§ 8.2). The store placement should follow `blueprint/STORE_ARCHITECTURE.md` — the hierarchy is thread-scoped data, not an `InspectorStore` selection.
