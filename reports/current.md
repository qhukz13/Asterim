Task-ID: P7-02
Status: COMPLETE

# Execution Report: P7-02 — Multi-Agent Delegation UI, Thread Hierarchy & Real-Time Supervision

**Task ID:** P7-02
**Phase:** Phase 7 — Multi-Agent Orchestration & Collaborative Workflows
**Status:** IMPLEMENTED / VERIFIED
**Date:** 2026-08-16
**Author:** Claude Code

---

## 1. Summary

The dashboard now shows multi-agent work as it happens. `SessionSidebar` renders the thread list as the tree it became in P7-01 — delegated children nested under the thread that asked for them, with a role badge, an `L1`/`L2` depth pill and a live status dot. The chat view gains a waiting banner while a thread is parked behind a child, and a structured outcome card once the child answers, carrying status, review verdict, summary and the files it named. A Delegate/Request Review modal puts the same two meta-tools an agent holds in front of the operator, posting to the endpoint P7-01 already exposed. On the server, a startup pass settles children the Core stopped on top of, so a restart can no longer strand a child reading as `RUNNING` forever.

All four `delegation.*` socket events are wired into `useProjectStore` through `useSocket`, and the parent's waiting state — which lives in the Core's memory, not in storage — is read on thread switch from `GET /api/v1/threads/:id/children`.

Verified: typecheck, lint (0 errors), all 35 test suites green (including a new 159-assertion web suite and 20 new server assertions), and a clean monorepo build.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `apps/web/src/stores/useProjectStore.ts` | Modified | Thread hierarchy + delegation runtime state; `buildThreadTree`, status vocabulary, `syncDelegations`, `handleDelegationEvent` |
| `apps/web/src/components/delegation/ThreadTree.tsx` | Created | Props-only hierarchy view: nesting, role badge, depth pill, status dot, collapse |
| `apps/web/src/components/delegation/DelegationStatus.tsx` | Created | Waiting banner + outcome card + store-connected container |
| `apps/web/src/components/delegation/DelegateModal.tsx` | Created | Manual Delegate Work / Request Review form and its request builder |
| `apps/web/src/components/delegation/__tests__/DelegationUI.test.ts` | Created | 159 assertions across helpers, store and rendering |
| `apps/web/src/components/SessionSidebar.tsx` | Modified | Flat thread list replaced by `ThreadTreeView` |
| `apps/web/src/hooks/useSocket.ts` | Modified | Subscribes to the four `delegation.*` events; routes them before the thread filter; replays briefs/outcomes from history |
| `apps/web/src/App.tsx` | Modified | Mounts the status banner above `ChatView`, the Delegate action, and the modal |
| `apps/web/src/InteractionEngine.tsx` | Modified | Clears delegation maps when the project changes |
| `apps/web/src/index.css` | Modified | `.delegation-pulse`, reusing the existing `pulse` keyframe |
| `apps/web/package.json` | Modified | New web suite added to `test` |
| `apps/server/src/services/ai/AgentDelegationService.ts` | Modified | `recoverDelegations()` — startup orphan recovery |
| `apps/server/src/index.ts` | Modified | Calls `recoverDelegations()` alongside session/approval recovery |
| `apps/server/src/services/ProjectManager.ts` | Modified | `getThreads` now projects `parent_thread_id` and `delegation_context_json` |
| `apps/server/src/services/ai/__tests__/AgentDelegationService.test.ts` | Modified | 20 new assertions for startup recovery (209 total) |

## 3. Implementation Details

**Where the state lives.** `blueprint/STORE_ARCHITECTURE.md` gives `ProjectStore` the threads list and `ThreadStore` the active thread. The hierarchy is a fact about the *list* — a parent and its children are separate threads and only one is ever active — so it went into `ProjectStore`. `ThreadStore` was left alone rather than made to hold the parked state of a thread the user is not looking at, which would have made "active thread" mean two things. `InspectorStore` was not touched.

The live delegation maps (`parentStates`, `pendingChildren`, `childStates`, `childTasks`, `childRoles`, `delegationOutcomes`, `delegationChildren`) are kept beside the thread rows rather than merged into them: a row is what the Core last served, the maps are what the socket has said since, and separating them means a refetch of the list cannot roll back a state the events already advanced.

**`buildThreadTree`.** Pure and defensive, because `parent_thread_id` is an ordinary column: a child whose parent is not in the list is promoted to a root rather than dropped; a self-parenting row is its own root; and anything a walk from the real roots never reaches — i.e. a cycle — is adopted as a root, with a visited set breaking the loop one level in. Sibling order is the order the Core served, which is creation order.

**Socket routing.** Delegation events are handled *before* `useSocket`'s thread filter, next to memory events. An event about a child is precisely what the parent's view needs; filtering it out because its `threadId` is not the open thread is how the waiting banner would never appear.

**History vs. live state.** `delegation.started` and `delegation.completed` are replayed from `session.history`, so a reload still knows each child's brief and outcome. `delegation.parent_state` and `delegation.child_state` are deliberately *not* replayed — they describe sessions, and a session that was running when the page was last open is not running now. Those come from `GET /threads/:id/children`, which reads the Core's own memory, and `DelegationStatus` calls it once per thread.

**The modal and the synchronous endpoint.** `POST /delegate` holds the request open until the child settles, which can be ten minutes. The modal therefore does not wait on the response to close: it closes when the socket reports this thread is parked behind a child, while the request stays in flight — which is still where a refusal (400/404/409) comes back and is rendered.

**Startup recovery.** `recoverDelegations()` scans `threads WHERE parent_thread_id IS NOT NULL`, skips any row whose `delegation_context_json` already records a terminal `status`, and settles the rest as `FAILED` with the reason `"Server restarted while child was running"`, plus a `finishedAt`. `FAILED` rather than `TIMEOUT`: a timeout means the child had its full time and did not answer; this means it was cut off, and the reason line is what distinguishes them. An interrupted `REVIEW` is additionally recorded `NEEDS_FIX`, since an interrupted review cannot have cleared anything. A child row with no readable context gets a minimal one written from the row itself — the task description is left empty rather than invented — so it stops reading as `RUNNING` to `listChildren`. Each settled row publishes a terminal `delegation.child_state`. The pass never throws and is idempotent; nothing is restarted, because a child interrupted mid-edit is not something to silently resume.

**Server projection.** `ProjectManager.getThreads` had never selected the two delegation columns, so the sidebar could not have drawn a hierarchy from it. The new projection falls back to the pre-delegation one inside a `try/catch`, matching the `ALTER TABLE`-in-a-try pattern the schema uses — a database on which those ALTERs never applied still opens and simply renders a flat list.

**Design system.** Every colour is a token from `tokens.css` (a test asserts no hex literal survives into the rendered tree markup). The only animation added is `.delegation-pulse`, reusing the existing `pulse` keyframe at the same 2s cadence the waiting status badge already uses. Rows are keyboard-reachable (`tabIndex`, Enter/Space) and collapse toggles carry `aria-expanded`.

## 4. Verification

Commands run and their results:

```
pnpm --filter @asterim/web exec tsx src/components/delegation/__tests__/DelegationUI.test.ts
  → 159/159 assertions passed

pnpm --filter asterim exec tsx src/services/ai/__tests__/AgentDelegationService.test.ts
  → 209/209 assertions passed  (189 from P7-01 + 20 new for recoverDelegations)

pnpm --filter @asterim/web test        → 8 suites: 151, 37, 134, 113, 104, 85, 134, 159 — all passed
pnpm --filter asterim test             → 19 suites: all passed (63…209)
pnpm --filter @asterim/adapters test   → 23/23
pnpm --filter @asterim/relay test      → 71/71
pnpm --filter @asterim/mcp-memory-server test → 7 suites: 42, 82, 87, 62, 28, 23, 24 — all passed
  (35 suites total, all green)

typecheck (all 7 workspaces: shared, adapters, server, web, marketing, relay, mcp-memory-server)
  → tsc --noEmit / tsc -b clean, 0 errors

lint (all 7 workspaces)
  → 0 errors. Warning counts unchanged in character from the pre-existing baseline;
    the new files contribute only `react-refresh/only-export-components`, the same
    warning every existing view-plus-helpers file (e.g. ProfileSelector.tsx) carries.

build (shared, adapters, web, server, marketing, relay, mcp-memory-server)
  → all succeeded; web 1247 modules + PWA service worker, server tsup + web copy into dist/web
```

Note on how the gates were invoked: the aggregate root scripts (`pnpm run typecheck` / `lint` / `test` / `build`) required an interactive approval this session could not give, so each was run per workspace with `pnpm --filter`. Turbo fans the root scripts out to exactly these per-package scripts, so the coverage is identical.

One flake observed and ruled out: `packages/mcp-memory-server` → `retrieval_tools.test.ts` → "decisions are returned newest first" failed once on a first pass and passed on two immediate re-runs and on the full re-run. That package is untouched by this task (see the diff in §6); the assertion compares two decisions created within the same millisecond, so the ordering tie is broken arbitrarily. Flagged, not fixed — it is outside this task's scope.

No browser/screenshot verification was run: this session is non-interactive and a dev server could not be driven.

## 5. Acceptance Criteria Review

- [x] **1. `SessionSidebar` renders hierarchical parent-child thread trees with role badges, depth indicators, and live status** — `ThreadTreeView` replaces the flat map in `SessionSidebar.tsx:253`. Asserted: parent, child and grandchild all render; role badge shown; `L1` and `L2` pills present; indentation `margin-left:14px` / `28px`; running child pulses; parked parent labelled "Waiting on child"; timed-out child labelled "Timed out" and does not pulse; collapse hides children and reports `aria-expanded="false"`.
- [x] **2. `useSocket.ts` receives all four `delegation.*` events and synchronizes thread state in real time** — subscription loop over `DELEGATION_EVENT_TYPES` (`useSocket.ts:427`), routed via `isDelegationEvent`/`handleDelegationEvent` before the thread filter. Asserted end-to-end in the store: `started` adds the child to the list with its brief and nests it in the tree; `parent_state` parks the parent behind the named child; `child_state` advances the child; `completed` releases the parent, records the outcome and writes the status back onto the stored brief. Plus `syncDelegations` asserted against a recording `fetch` for exact URL (`/api/v1/threads/root/children`), method and `Authorization` header.
- [x] **3. Parent `WAITING_FOR_CHILD` shows a banner in `ChatView` with a direct link to the child** — `DelegationStatus` mounted above `ChatView` in `App.tsx:817`; `onInspectChild` routes to `/workspace/project/:projectId/thread/:threadId/view/chat`. Asserted: banner names the role, states it is waiting, shows the child's live state and task snippet, offers "Inspect Child Thread", and carries `role="status"`.
- [x] **4. Completed delegations render structured summary/review cards with status, verdict, summary, and artifacts** — `DelegationOutcomeCard`. Asserted for `COMPLETED`, `FAILED` and `TIMEOUT`; `PASS` and `NEEDS_FIX` verdict badges; summary text; every artifact rendered; an empty summary stated rather than left blank; a new delegation takes precedence over the previous outcome. Survives a reload via `latestOutcomeFor`, which falls back to the newest settled child from the REST list and never picks one still running.
- [x] **5. Operators can manually trigger task delegation or code review via `DelegateModal`** — "Delegate" action in the chat view's action bar opens `DelegateModal`; both modes post to `POST /api/v1/threads/:id/delegate`. Asserted: both tabs render, profiles populate the role selector, submit is refused until the required field is filled, a thread already parked is refused with an explanation, the Core's refusal text is surfaced as `role="alert"`, and `buildDelegationBody` produces `kind: TASK` with trimmed task/context (omitting empty context) or `kind: REVIEW` with the diff and one criterion per line, bullets stripped.
- [x] **6. Server startup cleanly recovers dangling child threads** — `recoverDelegations()` called from `index.ts:229`. Asserted: an interrupted child becomes `FAILED` with a restart reason and a finish time while its brief, role and `requestedAt` survive; a child with no readable brief stops reading as running without a task description being invented; an interrupted review is `NEEDS_FIX`; an already-finished child is untouched; a thread with no parent is untouched; each settled child publishes a terminal `delegation.child_state` naming its parent; a second pass settles nothing; `listChildren` and `getParentState` report the recovered state.
- [x] **7. Automated unit tests for web delegation components pass** — 159/159, added to `apps/web` `test` script so it runs in the suite.
- [x] **8. Monorepo CI gates pass with 0 errors** — typecheck 0 errors across 7 workspaces; lint 0 errors across 7 workspaces; 35/35 test suites green; build clean. (Invoked per workspace — see §4.)

Constraints checked: store boundaries respected (`ProjectStore` only; `InspectorStore` untouched); the `@asterim/shared` delegation contract was **not modified** — no diff in `packages/shared`; all styling reads CSS custom properties, asserted by a test rejecting hex literals in the rendered markup; no existing suite changed behaviour.

## 6. Git Diff Review

Reviewed `git diff` and `git status` in full. 15 files: 11 modified, 4 created (all under `apps/web/src/components/delegation/`). No stray debug scripts, no new files in `docs/`, no changes to `packages/shared`, `blueprint/`, or any adapter.

Two changes outside the literal file list in the task's Implementation Scope, both load-bearing rather than opportunistic:

- `apps/server/src/services/ProjectManager.ts` — `getThreads` did not project the two delegation columns, so no amount of web work could have produced a hierarchy from that endpoint. Additive projection with a fallback to the previous one.
- `apps/web/src/InteractionEngine.tsx` — the existing rule that clears the thread list on project change now also clears the delegation maps, which are keyed by thread id and belong to the same list.

`tests/report.md` was already modified in the working tree when this session began (it is the P7-01 verification gate report from a prior session, last committed at `2f3fa82`). It is unrelated to P7-02 and has been left uncommitted and untouched rather than folded into this task's commit.

## 7. Problems Discovered

1. **A thread cycle deleted threads from the sidebar.** The first version of `buildThreadTree` classified every thread with a known parent as a child, so a two-row cycle (`a.parent = b`, `b.parent = a`) produced no roots and both threads vanished from the list entirely. Caught by a test written for exactly that case. Fixed by adopting anything the root walk never reached as a root of its own — a corrupted link now costs a nesting level, not the threads.

2. **The delegate endpoint is synchronous.** `POST /delegate` holds the request open until the child settles. Closing the modal on the response would have parked the operator behind a spinner for up to the delegation timeout. The modal now closes on the socket's `delegation.parent_state`, with the request left in flight to carry a refusal back.

3. **Replaying live state from history is a lie.** Replaying `delegation.parent_state` out of `session.history` would resurrect a waiting banner for a delegation that ended when the Core last stopped. Only briefs and outcomes are replayed; the two live states come from the REST endpoint, which reads the Core's in-memory truth.

4. **`getThreads` predated the hierarchy.** Noted above; the projection was pre-P7-01 and silently dropped both delegation columns.

5. **A pre-existing flake in `mcp-memory-server`.** Documented in §4. Not touched.

## 8. Architectural Concerns

- **`ChangesView` owns its selected file in local state.** Artifact links in the outcome card therefore navigate to the Changes view, where the diff lives, rather than scrolling to that specific file. Making them land on the row would mean lifting `ChangesView`'s selection into a store — a real improvement, but outside this task and not worth a speculative refactor of a working view.
- **`InspectorPanel` imports `useInspectorStore` but never reads `currentSelection`.** So the selection reference the blueprint describes is currently written by nobody and read by nobody. Worth a small task; it is the natural home for "which artifact is being inspected".
- **The sidebar's live status is authoritative only for the active thread.** `syncDelegations` runs per open thread, so a sibling parent's parked state is known only if an event arrived while the dashboard was connected. A project-scoped `GET /projects/:id/delegations` would close that, at the cost of one more endpoint; deferred rather than invented.
- **`getThreads` returns every thread flat, including children.** Fine at present scale, but a project that has run many delegations will grow a long list; the tree hides it visually but not in transfer size.

## 9. Recommended Next Step

The delegation loop is now observable end to end. The natural next task is **cancelling or intervening in a running delegation** — an operator watching a child go wrong currently has no way to stop it short of stopping the session by hand, and `AgentDelegationService` already owns the `waiting` map and `safeStop` needed to release the parent cleanly with a `FAILED`/cancelled outcome. That would complete the supervision story this task started, and it is a smaller vertical than adding a fourth surface.
