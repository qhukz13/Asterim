Task-ID: P8-02
Status: COMPLETE

# Execution Report: P8-02 — Collaborative Multi-User Web UI & Team Turn Queue Inspector

**Task ID:** P8-02
**Phase:** Phase 8 — Collaborative Team Agents & Multi-User Governance
**Status:** IMPLEMENTED
**Date:** 2026-08-18
**Author:** Claude Code

---

## 1. Summary

The dashboard side of the Shared Team Agent primitive (DEC-031) is implemented: a zustand store,
four components, navigation and socket integration, and a 282-assertion test suite.

The design decision everything else follows from is that a collaborative thread is a **queue**, not
a chat. The store therefore treats REST as a snapshot and the socket as the live authority: the
queue is rebuilt from `team_turn:*` transitions rather than re-fetched, so a member watching their
position move from #3 to #1 sees it move. The one place the two meet — the agent's answer, which
the Core writes to the transcript with no message event of its own — is handled by a *silent*
refresh on completion that adopts the transcript and history but deliberately leaves the live queue
alone, because it is a snapshot that may predate transitions already applied.

One gap in P8-01 had to be closed to make the specified store real: `tasks/current.md` § 3 requires
`updateTeamAgent` (`PATCH /api/v1/team-agents/:id`) and `deleteTeamAgent`
(`DELETE /api/v1/team-agents/:id`), and P8-01 shipped seven routes with neither, although
`TeamAgentService.updateTeamAgent` / `.deleteTeamAgent` already existed and were tested. Two thin
routes over those methods were added rather than shipping store actions that would 404. See § 7.

All four CI gates are green across every workspace.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `apps/web/src/stores/useTeamAgentStore.ts` | Created | Team agents, threads, transcripts, queue state; 8 REST actions; the turn-event reducer; pure helpers |
| `apps/web/src/components/teamAgents/TeamAgentExplorer.tsx` | Created | Agent card grid, role badges, capability pills, thread entry points; hosts the open thread |
| `apps/web/src/components/teamAgents/CreateTeamAgentModal.tsx` | Created | Create/edit form: persona prompt, model, temperature, MCP + skill selectors, validation |
| `apps/web/src/components/teamAgents/ActiveTurnQueueInspector.tsx` | Created | Thread state badge, active operator, FIFO queue with position badges and withdrawal |
| `apps/web/src/components/teamAgents/TeamThreadChatView.tsx` | Created | Multi-user transcript with author attribution, generation indicator, queueing composer |
| `apps/web/src/components/teamAgents/__tests__/TeamAgentUI.test.ts` | Created | 282 assertions across helpers, store REST, socket transitions and rendering |
| `apps/web/src/hooks/useSocket.ts` | Modified | Joins `workspace:<teamId>`, re-joins on team change, routes the four `team_turn:*` events |
| `apps/web/src/App.tsx` | Modified | `Team` tab and persistent view, scoped to the active environment |
| `apps/web/src/stores/useViewStore.ts` | Modified | `'team'` added to `ViewType` and `availableViews` |
| `apps/web/src/components/icons/Icons.tsx` | Modified | `IconUsers`, in the existing 24×24 stroke style |
| `apps/web/package.json` | Modified | New suite wired into the `test` script |
| `apps/server/src/routes/teamAgents.ts` | Modified | `PATCH` and `DELETE /api/v1/team-agents/:id` (see § 7) |
| `apps/server/src/services/ai/__tests__/TeamAgentService.test.ts` | Modified | 12 assertions covering the two new routes (162 → 174) |

## 3. Implementation Details

### `useTeamAgentStore`

State: `teamAgents`, `teamThreads` (by agent id), `activeAgentId`, `activeThread`,
`activeTranscript`, `activeQueueState`, `turnHistory`, plus separated in-flight flags
(`isLoading` / `isSaving` / `isSubmitting` / `cancellingTurnId`) so one row's spinner is not every
row's, and `error` / `notice` kept apart — a queue position is news, not a failure.

REST, all through `getAuthHeaders` so a remote workstation gets its own token:

| Action | Call |
| :--- | :--- |
| `fetchTeamAgents(teamId)` | `GET /api/v1/team-agents?teamId=` (encoded) |
| `fetchTeamAgent(id)` | `GET /api/v1/team-agents/:id` — the threads the list endpoint does not carry |
| `createTeamAgent(input)` | `POST /api/v1/team-agents` |
| `updateTeamAgent(id, input)` | `PATCH /api/v1/team-agents/:id` |
| `deleteTeamAgent(id)` | `DELETE /api/v1/team-agents/:id` |
| `fetchTeamThread(id, {silent})` | `GET /api/v1/team-threads/:id` |
| `createTeamThread(agentId, …)` | `POST /api/v1/team-agents/:id/threads` |
| `submitTurn(threadId, …)` | `POST /api/v1/team-threads/:id/turns` — 202 adopted as success |
| `cancelTurn(threadId, turnId)` | `DELETE /api/v1/team-threads/:id/turns/:turnId` |

`submitTurn` sends the instruction and its context and **no author**: in a shared thread the name on
a turn is what the whole team reads, so the Core takes it from the session (routes § "Who is
asking"). The 202's `queuePosition` becomes the member's notice — position 0 reads "being served
now" rather than "#0 in queue".

`applyTurnEventToQueue` is exported and pure, and follows `AgentTurnLock`'s own rules: `queued`
appends unless the turn is already known (a submitter has adopted the 202's queue); `started`
promotes and is idempotent, since it fires again when a turn parks on an approval and again when it
resumes; `completed` clears the active turn **only when it names it**, so a late release cannot free
its successor's lock; `cancelled` removes a waiting turn. Terminal turns move into `turnHistory`.
Transitions for other threads still update that thread's status in `teamThreads`, so the explorer
shows which shared threads are busy without opening them.

### Components

Each is a props-only `*View` plus a thin store-connected wrapper — the convention the MCP, skills
and desktop panels established, because zustand v5 serves initial state as the server snapshot and a
store-reading component renders empty under `react-dom/server`.

- **`ActiveTurnQueueInspector`** — state badge (`aria-live="polite"`), active operator with initials,
  status and elapsed time, then the FIFO list with `#N in queue` badges, submission times and a
  `Withdraw` button offered **only for `QUEUED`** turns, since the Core answers 409 for anything else.
- **`TeamThreadChatView`** — every line attributed (initials, name, relative time); the agent's lines
  carry the role name and the accent, people's do not. The composer is never disabled on a busy
  thread — queueing behind a running turn is the designed path — and shows the wait before typing.
  It clears optimistically on submit and restores the text if the Core refuses.
- **`TeamAgentExplorer`** — name, role badge, description, system prompt preview, capability pills
  reusing `capabilitySummary` from `useProfileStore`, and per-agent thread lists with their own turn
  state. Deleting confirms first and names how many transcripts the cascade takes.
- **`CreateTeamAgentModal`** — the persona fields plus All / None / Selected capability controls over
  the servers and skills the Core actually found, preserving the contract's `undefined` ≠ `[]`
  distinction (`capabilityListValue`). Validation runs client-side to save the round trip; the Core's
  copy remains authoritative.

Styling is tokens only (`--color-surface-*`, `--color-accent-*`, `--color-state-*`, `--font-family-*`,
`--radius-*`, `--spacing-*`) — asserted in the suite: no tone resolves to a hex value.

### Integration

`'team'` added to `ViewType`; a `Team` tab in the workspace nav and a persistent view mounted like
the other explorers, given `teamId={activeEnvironmentId}` (an environment is the team) and the open
project so a new thread has a checkout. `useSocket` joins `workspace:<teamId>` from its own effect —
keyed on the team, not only on the project, since the socket is otherwise rebuilt only on a project
change — and routes the four turn events ahead of the thread filter, as delegation events are: a
member watching the queue is by definition watching somebody else's turn.

## 4. Verification

Every workspace, run directly (`pnpm --filter "*" run <script>`; the root aggregate scripts require
interactive approval in this sandbox and fan out to exactly these same per-workspace scripts):

| Gate | Result |
| :--- | :--- |
| `typecheck` | shared, adapters, web, server, relay, marketing, mcp-memory-server — **0 errors** |
| `lint` | **0 errors** in every workspace (warnings unchanged from baseline: web 321, server 294) |
| `test` | every suite passed; web **2155** assertions over 12 suites, server **3473** over 28 suites, mcp-memory-server **348** over 7 |
| `build` | all 7 workspaces built; `apps/server/dist/web` populated by the web-copy step |

New suite: `pnpm --filter @asterim/web exec tsx src/components/teamAgents/__tests__/TeamAgentUI.test.ts`
→ **282/282 assertions passed**, covering:

- pure helpers — error mapping by code and status, filtering, tones, status labels, position labels,
  wait notices, initials, attribution, prompt preview, relative time;
- the queue reducer across the full lifecycle, including the two cases that are silently wrong if
  unasserted: a repeated `queued` event must not duplicate a turn, and a `completed` naming a
  non-active turn must not free the lock;
- the store against a recording `fetch` — exact URLs, verbs, `Content-Type`, bodies, the 202 path,
  the two 409 codes, a 401, and an unreachable Core;
- the four transitions through `handleTeamTurnEvent` (what the socket layer calls), including the
  silent transcript re-read on completion and the fact that a transition for another thread updates
  only that thread and triggers no read;
- static rendering of all four views across idle / processing / awaiting-approval, populated and
  empty, loading, error and no-team states, plus an assertion that no markup carries a token.

Server suite `TeamAgentService.test.ts`: **174/174** (was 162), the 12 new assertions covering the
two added routes — including that a `PATCH` body naming `teamId` or `createdBy` moves neither, and
that a second `DELETE` is 404 rather than 500.

No browser/screenshot verification was run: this task's acceptance criteria are covered by the
static-render suite, and the repo's puppeteer flow needs a running Core with a paired session.

## 5. Acceptance Criteria Review

- [x] **1. `useTeamAgentStore` manages agents, threads, transcripts and queue state with complete REST
  and Socket.IO synchronization** — all nine calls asserted against a recording `fetch` (§ 4 layer 3);
  all four transitions asserted through `handleTeamTurnEvent` (layer 4); `applyTurnEventToQueue`
  asserted independently across the full turn lifecycle.
- [x] **2. `TeamAgentExplorer` renders agent cards, role badges, capability pills and thread entry
  points** — `TeamAgentExplorerView shows what distinguishes one role from another`: name, role badge,
  description, prompt preview, model, `MCP: github`, `Skills: No skills`, expanded thread list with
  per-thread state, `aria-expanded`, collapsed count, empty and no-team states.
- [x] **3. `CreateTeamAgentModal` validates inputs and configures persona prompts, models, MCP tools
  and skills** — `the team agent draft round-trips through the form` (validation order, temperature
  range and boundary, Selected-with-nothing-selected, `undefined` vs `[]`, trimming, PATCH body
  carries no `teamId`) and `CreateTeamAgentModalView offers the whole persona` (every field by
  aria-label, both selectors, disabled save, edit mode).
- [x] **4. `ActiveTurnQueueInspector` displays turn state, active operator and FIFO queued items with
  position badges and cancellation** — `ActiveTurnQueueInspectorView across the three thread states`:
  all three badges distinct, operator named with start time, `#1`/`#2` in service order, one
  withdraw button per *waiting* turn and none for the running one, in-flight and read-only variants.
- [x] **5. `TeamThreadChatView` displays multi-user transcripts with author tags, assistant responses
  and turn queue status** — `TeamThreadChatView attributes every line to somebody`: two members named
  on their own lines, the agent's answer attributed to the role, timestamps, state badge, polite
  generation indicator, the wait spelled out before typing, and the queue inspector embedded.
- [x] **6. `TeamAgentUI.test.ts` passes with comprehensive coverage** — 282/282, wired into
  `apps/web/package.json`'s `test` script and run as part of the web suite (§ 4).
- [x] **7. Monorepo CI gates pass with 0 errors** — typecheck, lint, test and build green in all seven
  workspaces (§ 4).

Definition of Done: store ✔ · explorer + modal ✔ · inspector + chat view ✔ · navigation ✔ · test file ✔ ·
`package.json` ✔ · CI gates ✔.

## 6. Git Diff Review

`git diff` reviewed file by file against the criteria above.

- Seven new files under `apps/web/src/components/teamAgents/` and `apps/web/src/stores/`; no stray
  scratch files, no `test-*.js` at any root.
- Every type crossing the boundary is imported from `@asterim/shared` — no domain type is redeclared
  in the dashboard.
- No existing single-developer flow is altered: the changes to `App.tsx` are one import, one store
  read, one tab and one mounted view; `useSocket` gains listeners and a room join and changes no
  existing branch; `useViewStore` gains one union member.
- `Icons.tsx` gains `IconUsers` only, in the file's existing style.
- The two server routes are additive and sit beside the seven from P8-01, reusing that file's
  `requireUser` / `requireObjectBody` / `sendTeamAgentError` guards.
- `tests/report.md` was already modified in the working tree when this task began (the P8-01
  verification gate report from the preceding session) and is **not** part of this commit.

## 7. Problems Discovered

1. **Two required routes did not exist.** The task specifies `PATCH` and `DELETE
   /api/v1/team-agents/:id` for the store; P8-01 shipped seven routes and neither of these, though
   `TeamAgentService.updateTeamAgent` / `.deleteTeamAgent` existed and were covered. Shipping the
   store actions against absent endpoints would have meant an Edit button whose only outcome is a
   404, so the two routes were added over the existing service methods — no new service behaviour —
   with 12 route assertions. Flagged for review since it is outside the task's literal UI scope.
2. **Completion carries no transcript event.** The Core appends the agent's answer to
   `team_agent_messages` as the turn ends, and the only signal a client gets is `team_turn:completed`.
   Handled with the silent refresh described in § 1; the alternative — a message event — is a Core
   change and therefore a Change Proposal, not something to do quietly here.
3. **The dashboard never joined a workspace room.** `socketManager` has handled `join_workspace`
   since before this task, but nothing in the web app emitted it, so `workspaceId`-roomed events
   reached no one. Now joined from its own effect, keyed on the team so switching teams re-joins.
4. **`Date.now()` in a render body is a lint error** (`Cannot call impure function during render`).
   The `now` prop is left undefined in the app and defaulted inside `formatRelativeTime`, a plain
   module function, which keeps the clock read out of the render and keeps the rendered wording
   assertable.
5. **No display name exists in the dashboard.** There is no "current user" object in the web app, so
   `submitTurn` sends no `userName` and the Core falls back to the session's user id. Attribution is
   correct but reads as an id until a member profile exists. Noted for Antigravity.

## 8. Architectural Concerns

- **Where the team view lives.** `TeamAgentExplorer` is mounted inside `ProjectWorkspace`, so shared
  agents are only reachable once a project is open. A team agent belongs to the team, not to a
  project — a workspace-level route (`/workspace/team/...`) would match the domain better. Left as-is
  because adding a top-level route is a navigation-architecture change, which belongs in a proposal.
- **The socket bridge is `projectId`/`workspaceId`-driven.** Turn events for a thread bound to a
  project are persisted into `events` and replayed on `session.history`. `applyHistory` does not
  route them, so no stale queue is reconstructed on reload — but the rows accumulate. Worth
  considering whether `team_turn:*` should be treated like `agent.log` and buffered rather than
  persisted (ADR-008 territory).
- **`recoverTurns` has no client counterpart.** On restart the Core fails turns that were mid-flight,
  but a dashboard left open sees nothing until it refetches. A `team_turn:completed` broadcast during
  recovery would close that gap.

## 9. Recommended Next Step

Phase 8 Deliverable 4 — multi-user governance over the shared surface now that it is visible: RBAC on
the team agent routes (who may edit a shared role or withdraw a colleague's turn), and the approval
path for `AWAITING_APPROVAL` turns, which the inspector currently reports but offers no way to answer.
