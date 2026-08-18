Task-ID: P9-03
Status: COMPLETE

# Execution Report: P9-03 — Pipeline Execution Dashboard, Visual DAG Graph, Step Inspector & PR Synthesis UI

**Task ID:** P9-03
**Phase:** Phase 9 — Multi-Agent Automated Pipelines & Worktree Fleet Execution
**Status:** IMPLEMENTED / VERIFIED
**Date:** 2026-08-18
**Author:** Claude Code

---

## 1. Summary

The declarative pipeline subsystem built in P9-01/P9-02 now has a control plane in the
dashboard. A `Pipelines` view sits beside Team in the workspace navigation and renders a
master-detail surface: the project's definitions and their run history on the left, and on
the right the open run drawn as a dependency graph whose nodes move `PENDING → RUNNING →
PASSED/FAILED` from the `pipeline:*` socket events without polling. A node opens a step
inspector carrying the four separate pieces of evidence the Core kept — the brief, the
transcript, the diff, and the project's own verification report — and a finished run offers
the conflict analysis and the one-click synthesis into `asterim/pipeline/<runId>/pr`.

On the server, `WorktreeFleetService.pruneOldFleetWorktrees` and
`PipelineEngine.pruneOldFleetWorktrees` were added and wired into the boot sequence beside
`pruneOrphanSandboxes`, so `.asterim/worktrees/pipeline/` no longer grows for the life of a
repository.

All monorepo gates are green: typecheck, lint (0 errors), the whole server test battery, the
whole web test battery including the new 252-assertion suite, and a full build.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `apps/web/src/stores/usePipelineStore.ts` | Created | Project-scoped pipeline/run state, REST actions, pure socket reducer, tones, DAG-independent helpers, draft validation and presets |
| `apps/web/src/components/pipelines/PipelineDagGraph.tsx` | Created | Pure layout (`dagColumns`, `computeDagLayout`, `edgeIsActive`) and the native SVG/CSS graph |
| `apps/web/src/components/pipelines/PipelineRunView.tsx` | Created | Run header (status, duration, base commit, PR branch), progress, action toolbar, graph + inspector slot |
| `apps/web/src/components/pipelines/PipelineStepInspector.tsx` | Created | Step brief, transcript, diff, branch/commit, retry badge and verification report |
| `apps/web/src/components/pipelines/PipelineConflictCard.tsx` | Created | Conflict analysis: clean status, conflicted pairs and their paths, missing branches |
| `apps/web/src/components/pipelines/PipelineSynthesisModal.tsx` | Created | Step-subset selection, commit message, synthesis outcome |
| `apps/web/src/components/pipelines/PipelineEditorModal.tsx` | Created | YAML editor with preset templates, inline draft problems and the Core's line-numbered refusal |
| `apps/web/src/components/pipelines/PipelineDashboard.tsx` | Created | Master-detail dashboard and the store-connected container |
| `apps/web/src/components/pipelines/__tests__/PipelineUI.test.ts` | Created | 252 assertions across layout, store, socket reducer and SSR rendering |
| `apps/web/src/stores/useViewStore.ts` | Modified | `'pipelines'` added to `ViewType`/`availableViews`; `VIEW_TYPES` + `isViewType` guard |
| `apps/web/src/Router.tsx` | Modified | Route sync validates the URL's view id instead of casting it |
| `apps/web/src/App.tsx` | Modified | Pipelines nav tab and persistent panel wired to `PipelineDashboard` |
| `apps/web/src/hooks/useSocket.ts` | Modified | Subscribes the five `pipeline:*` events and routes them before the thread filter |
| `apps/web/package.json` | Modified | `PipelineUI.test.ts` added to the `test` script |
| `apps/server/src/services/pipeline/WorktreeFleetService.ts` | Modified | `DEFAULT_FLEET_RETENTION_MS`, `pruneOldFleetWorktrees`, `fleetRunAges` |
| `apps/server/src/services/pipeline/PipelineEngine.ts` | Modified | `pruneOldFleetWorktrees(maxAgeMs?)` over every project, keeping live runs |
| `apps/server/src/server.ts` | Modified | Retention pass called at boot, after `recoverRuns()` |
| `apps/server/src/services/pipeline/__tests__/WorktreeFleet.test.ts` | Modified | 21 new assertions covering retention at fleet and engine level |

## 3. Implementation Details

**Store (`usePipelineStore`).** REST is the snapshot, the socket is the authority. Every
action takes an optional `backendUrl` and goes through `resolveBackendUrl` +
`getAuthHeaders({ backendUrl })`, which is what makes the panel work against a remote
workstation. `reducePipelineEvent` is a pure exported function so the live path is testable
without a socket:

- `pipeline:started` plants a skeleton run from `stepIds` when the run is unknown (its
  payload carries no names or roles, so nodes are labelled by id until dispatched) and
  leaves a fetched run alone.
- `pipeline:step_started` is the first event that knows a step's name, role and attempt; it
  is idempotent for a running step, because a retry publishes it again with a higher attempt
  and clears the failure being retried.
- `pipeline:step_completed` replaces the node with the whole `PipelineStepRun`.
- `pipeline:completed` / `pipeline:failed` replace the run. A cancellation arrives on the
  failure event with `status: 'CANCELLED'` (the engine publishes no sixth event) and stays a
  cancellation.

A run that starts is adopted into the panel only when its pipeline is the one on screen, so
a scheduled pipeline firing elsewhere cannot pull an operator off the run they are reading.

**DAG layout.** A node's column is its *longest* path from a root, computed over
`topologicalPipelineOrder` from `@asterim/shared`; a step that waits on a deep ancestor is
therefore never drawn as if it ran in parallel with a shallow one. Unknown dependencies are
not edges and a cycle falls back to declaration order, so a draft still draws. Edges are
cubic-bezier SVG paths with an arrow marker; nodes are absolutely positioned real `<button>`s
so the graph is keyboard-navigable. No graph library was added.

**Step inspector.** Verification results are read from the existing
`GET /api/v1/threads/:id/worktree/verify` using the step's `threadId` — the report is written
against the thread by `AgentDelegationService`, and `pipeline_step_runs` has no column for it,
so no schema was invented. Selection is a step *id*; the step is read out of the run on every
render, per `blueprint/STORE_ARCHITECTURE.md`, so an open inspector moves when its step does.

**Synthesis and conflicts.** `GET …/conflicts` is a read and is presented as one; the card
names the conflicting pair and every path. The synthesis dialog defaults to the run's passing
steps and sends exactly what was selected, with the branch name it will build shown before
the click. Nothing in the UI can reach the operator's branch — the only write is the
`POST …/synthesize` the Core fail-closes.

**Editor.** A textarea over the YAML rather than a form over the schema, because the Core
stores the text as written and a form would silently rewrite the operator's file on first
save. `validatePipelineDraft` catches only the mistakes worth catching without a round trip
(empty, over the character bound, tabs, missing `name:`/`steps:`/`id:`); the parser stays the
gate and its `line` is prefixed onto the error the store reports.

**Retention.** `pruneOldFleetWorktrees(repoPath, { maxAgeMs, keepRunIds, now })` dates each
run by the *newest* of its fleet directory's mtime and its branches' commit dates, so a
checkout an operator read yesterday is not old because its commits are a fortnight old, and a
run whose directory was deleted by hand is still dated by the branches it left. Only ids that
pass `isSafePipelineRefComponent` and only branches under `asterim/pipeline/` are touched;
teardown failures are logged, never thrown. The engine's wrapper reads the projects itself,
keeps every run that is not terminal plus everything this process is executing, skips projects
that are not repositories or have no fleet directory, and is called `void`-style at boot after
`recoverRuns()` — the same shape as `pruneOrphanSandboxes()`.

## 4. Verification

Commands run in this session (root turbo scripts are refused by this session's sandbox, so
each workspace was driven directly — the same tasks turbo would run):

```
pnpm --filter @asterim/web  exec tsx src/components/pipelines/__tests__/PipelineUI.test.ts
   → 252/252 assertions passed

pnpm --filter @asterim/web  run test        → 13 suites, all green
   19/19, 151/151, 37/37, 134/134, 113/113, 104/104, 85/85, 134/134, 686/686,
   203/203, 207/207, 395/395, 252/252 assertions passed

pnpm --filter asterim run test              → whole server battery, exit 0, 0 FAIL
   includes PipelineEngine.test.ts (199 passed, 0 failed) and
   WorktreeFleet.test.ts (203 passed, 0 failed — 19 assertions added by this task)

pnpm --filter <ws> run typecheck            → clean for @asterim/web, asterim,
   @asterim/shared, @asterim/adapters, @asterim/marketing, @asterim/relay,
   @asterim/mcp-memory-server

eslint over apps/web and apps/server        → 0 errors
   web: 324 problems (0 errors, 324 warnings); server: 319 problems (0 errors).
   The pipelines directory itself contributes 3 react-refresh warnings, the same
   kind the existing views produce for exporting helpers beside components.

pnpm --filter <ws> run build                → shared, adapters, web, asterim,
   marketing, relay, mcp-memory-server all built; web 1275 modules, server tsup OK
```

Two eslint errors were introduced and fixed during the pass: `now = Date.now()` as a default
prop is `react-hooks/purity` ("Cannot call impure function during render"), so the three views
take `now` undefaulted and the store helpers default it — which is the convention the team
agent views already follow.

**Not verified in this session:** a live boot of the packaged server to watch the retention
pass run. The sandbox refuses `node apps/server/dist/index.js`, `bash -c` and `mkdir` outside
the repo, so no end-to-end boot could be staged. The call itself is a one-line `void` beside
the existing `pruneOrphanSandboxes()` call, and the exact method it invokes
(`pipelineEngine.pruneOldFleetWorktrees()`) is covered by the fleet suite against a real git
repository, including the default-retention path that reclaims nothing. No screenshots were
captured for the same reason.

## 5. Acceptance Criteria Review

- [x] **1 — `usePipelineStore.ts` provides complete project-scoped state with REST actions and immutable socket handling.** All nine listed actions plus `fetchStepVerification`; every one asserted against a recording `fetch` for URL, verb, headers and body (`PipelineUI.test.ts` §3, e.g. "to the pipelines route, scoped by workspace", "carrying exactly the steps chosen"). `reducePipelineEvent` builds new arrays and objects throughout; "an unknown run is ignored rather than invented" asserts identity is preserved when nothing applies.
- [x] **2 — `ViewType`, `Router.tsx` and the `App.tsx` tab include `'pipelines'`.** `ViewType`/`VIEW_TYPES`/`availableViews` updated (`useViewStore.ts:13,33,56`); `Router.tsx` now validates `viewId` with `isViewType` on both the full and project+view routes, so `/workspace/project/:id/view/pipelines` syncs and `/view/nonsense` no longer blanks the workspace; `App.tsx:714` renders the tab and `App.tsx:933` the panel.
- [x] **3 — `PipelineDagGraph.tsx` renders dependency edges, role pills, status styling and retry counters.** 21 layout assertions across single-step, chain, fan-out, diamond and longest-path graphs; render assertions "every step is a node", "the edges are drawn", "with arrow heads", "the role is a pill on the node", "a retried node carries its attempt" (`Attempt 3/4`) and "a step that worked first time carries no badge".
- [x] **4 — `PipelineStepInspector.tsx` inspects briefs, transcripts, diffs, branch names and verification outcomes.** Render assertions cover all of them plus the checkout path, short commit, duration and attempt badge; the empty states are distinct ("said nothing yet", "changed nothing", "Nothing was verified"), and `SKIPPED` is not shown as `CANCELLED`.
- [x] **5 — Conflict and synthesis UI displays merge statuses and triggers `POST /api/v1/pipeline-runs/:id/synthesize`.** Store test asserts the exact URL and that the chosen step ids and message are sent, that the run adopts `synthesisBranch`, and that a 409 `SYNTHESIS_CONFLICT` records no branch while surfacing the conflicted path. Card render asserts clean, conflicted (pair + files) and missing-branch states.
- [x] **6 — `PipelineEditorModal.tsx` creates and edits YAML with inline error reporting.** Presets for chain/fan-out/join (each asserted to pass the draft check), `Line 3` reported for a tab, save disabled while a draft is invalid, and the Core's `Line 7: Duplicate step id` shown on refusal.
- [x] **7 — Fleet worktree retention pruning runs cleanly on server startup.** `server.ts:338` calls it after `recoverRuns()`. Fleet-level assertions: a fresh fleet survives the default week; a kept run survives while an aged one is reclaimed (checkout and branch); a second pass is a no-op; a non-repository is safe; `feature/keep` — a branch outside the fleet prefix — is untouched; the working tree stays clean. Engine-level: `engine.pruneOldFleetWorktrees()` reclaims nothing inside the window and reclaims outside it, leaving no fleet branch. *Caveat: the live boot itself was not exercised — see §4.*
- [x] **8 — `PipelineUI.test.ts` passes with comprehensive assertions.** 252/252, covering pure helpers, store, socket reducer and SSR rendering, including "nothing rendered carries a credential".
- [x] **9 — Monorepo CI gates pass with 0 errors.** typecheck, lint, test and build all clean per §4 (run per workspace because the sandbox refuses the root turbo scripts).

## 6. Git Diff Review

Reviewed `git diff` and `git status` in full against every criterion.

- 9 files created (8 under `apps/web/src/components/pipelines/`, 1 store), 9 modified.
- No Phase 7/8 surface changed: the delegation, team-agent, release-channel and worktree
  paths are untouched. The only edits to shared files are additive — one import and one tab
  block in `App.tsx`, one event loop and one router branch in `useSocket.ts`, one entry in
  `ViewType`/`availableViews`, one test in the web `test` script.
- The `Router.tsx` change is the one behavioural edit to existing code: an unknown view id in
  the URL is now ignored rather than set. Every id that previously worked is in `VIEW_TYPES`
  (including `mcp`, which was missing from `availableViews`).
- No third-party graph library was added; `apps/web/package.json` dependencies are unchanged.
- Nothing in the diff performs a git operation against the operator's branch: the UI's only
  write path is the Core's existing synthesize route, and the new server code deletes only
  paths under `.asterim/worktrees/pipeline/` and refs under `asterim/pipeline/`.
- `tests/report.md` shows as modified in `git status`; that change predates this session and
  was left alone and out of the commit.

## 7. Problems Discovered

1. **`Date.now()` in a default prop is a lint error.** `react-hooks/purity` rejects it during
   render. Fixed by leaving `now` undefaulted in the three views and defaulting it in the
   store helpers, which is what the P8-02 views already do.
2. **A step's verification report is not on `pipeline_step_runs`.** It is written against the
   step's *thread* by `attachVerification`. Rather than add a column, the inspector reads the
   existing `GET /api/v1/threads/:id/worktree/verify` by the step's `threadId`, once per
   thread, since the report does not change after the step settles.
3. **`pipeline:started` carries only step ids.** Names and roles arrive with each step's own
   `step_started`. The skeleton run therefore labels nodes by id until they are dispatched,
   which is honest about what is known rather than showing blanks.
4. **A `POST /run` holds the request open until the run is terminal.** So the panel cannot
   rely on it for liveness; the socket adoption rule (§3) is what puts the new run on screen
   when Run is pressed.
5. **`GET /api/v1/pipelines` is scoped by workspace, not by project.** `fetchPipelines` takes
   the project id for store scoping (a project change resets rather than filters) and sends
   the workspace id as the query, which is the only filter the route has.

## 8. Architectural Concerns

1. **`availableViews` and `VIEW_TYPES` are now two lists.** `availableViews` still omits
   `mcp` (it did before this task); `VIEW_TYPES` is complete because the router guard has to
   be. Worth collapsing to one list in a later task, which would be a behaviour change to
   whatever reads `availableViews`.
2. **Retention is time-based only.** A workstation that runs a pipeline hourly will still
   hold a week of fleets. A count-based bound ("keep the last N runs per pipeline") would cap
   disk regardless of frequency; it needs a decision about what an operator is entitled to
   review, so it was not invented here.
3. **`PipelineDashboard` is mounted persistently** like the other views, so it fetches the
   project's pipelines on every workspace mount. That matches `TeamAgentExplorer`, but the
   pipelines list is one more request per project open.
4. **No route lists a project's runs.** Run history comes from `GET /pipelines/:id`, so a run
   started by a trigger for a pipeline the operator has not opened is only visible once its
   definition is selected (or once its `pipeline:started` arrives on the socket).

## 9. Recommended Next Step

Phase 9 Deliverable 4 is complete. The natural next task is the Phase 9 verification gate —
an integration pass driving a real multi-step pipeline end to end (three roles, isolated
worktrees, verification gates, conflict analysis, synthesis) against the dashboard, which is
also where the live boot of the retention pruner and the screenshot capture this session
could not stage should be checked off.
