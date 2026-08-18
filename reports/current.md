Task-ID: P9-01
Status: COMPLETE

# Execution Report: P9-01 — Declarative Pipeline Engine, Schema & Multi-Step Execution Controller

**Task ID:** P9-01
**Phase:** Phase 9 — Multi-Agent Automated Pipelines & Worktree Fleet Execution
**Status:** IMPLEMENTED (verified: 199/199 new pipeline assertions, all server suites green, monorepo typecheck / lint / test / build clean)
**Date:** 2026-08-18
**Author:** Claude Code

---

## 1. Summary

A pipeline is now a declarative DAG that Asterim can read, refuse, run, watch and stop.

1. **Schema.** Migration `004_pipelines` adds `pipelines`, `pipeline_runs` and
   `pipeline_step_runs` with the two required indexes and `ON DELETE CASCADE` down both
   foreign keys. The declaration keeps its YAML verbatim; the run keeps its own step rows,
   so a months-old run stays readable after the pipeline it came from has been rewritten.
2. **Grammar.** `SafeYaml.ts` is a deliberately small YAML reader — block mappings and
   sequences, quoted and plain scalars, `|`/`>` block scalars, flow collections, one
   document — that refuses anchors, aliases, tags, directives, tab indentation, second
   documents and prototype-reaching keys. A definition file is something an agent can write
   into a repository, so the reader is part of the trust boundary and no general-purpose
   YAML dependency was added to it.
3. **Validation.** `PipelineParser.ts` turns a document into a `PipelineDefinition` or
   refuses it with the line that stopped it: unique step ids, resolvable `roleProfileId`s
   (id, role or profile name, exactly as a delegation resolves one), dependencies that
   exist, no self-dependency, and no cycle — the error names the path that closes it.
4. **Execution.** `PipelineEngine.ts` walks the DAG: ready set → dispatch → record → repeat.
   Every step is a delegated child of one root thread per run, so a step inherits the
   Phase 7/8 machinery already verified — profile resolution, worktree sandbox, verification
   pipeline, timeout, stop-before-resume — and the engine adds scheduling and persistence
   rather than a second way to run an agent. Steps with no dependency path between them run
   concurrently; a ready set wider than the delegation concurrency bound runs in batches.
   Each step is handed its transitive ancestors' summaries, output and diffs, plus the run's
   parameters, with `{{ name }}` substitution.
5. **Fail-closed.** One failed step ends the run: everything still pending is marked
   `SKIPPED` rather than run on input that never arrived, and no session is left behind —
   the delegation that failed stopped its own child before returning. A cancellation is a
   different answer (`CANCELLED`, not `FAILED`) and reaches running steps through the
   delegation service that owns their sessions.
6. **Surface.** Six authenticated routes under `/api/v1/pipelines` and
   `/api/v1/pipeline-runs`, registered in `server.ts`, with workspace RBAC and a
   line-numbered 400 for a definition that will not parse.

---

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `packages/shared/src/types/pipeline.ts` | Created | The contract: `PipelineDefinition`/`PipelineStep`/`PipelineRun`/`PipelineStepRun`, the three status/trigger unions, bounds, the five event names and payloads, and the pure DAG algebra (`findPipelineCycle`, `topologicalPipelineOrder`, `pipelineAncestorIds`, `readyPipelineStepIds`, `aggregatePipelineRunStatus`). |
| `packages/shared/src/index.ts` | Modified | Exports `./types/pipeline`. |
| `apps/server/src/migrations/004_pipelines.ts` | Created | The three tables, `idx_pipeline_runs_pipeline`, `idx_pipeline_step_runs_run`, `idx_pipelines_workspace`. |
| `apps/server/src/migrations/index.ts` | Modified | Registers migration 4; `LATEST_SCHEMA_VERSION` follows. |
| `apps/server/src/services/pipeline/SafeYaml.ts` | Created | The restricted YAML reader and its refusals. |
| `apps/server/src/services/pipeline/PipelineParser.ts` | Created | Document → validated `PipelineDefinition`; DAG and role validation; `.asterim/pipelines/` directory reader. |
| `apps/server/src/services/pipeline/PipelineEngine.ts` | Created | Pipeline CRUD, `runPipeline`, `cancelPipeline`, `recoverRuns`, run/step persistence, context handoff, the five Socket.IO events. |
| `apps/server/src/routes/pipelines.ts` | Created | The six REST endpoints with auth and workspace RBAC. |
| `apps/server/src/server.ts` | Modified | Registers `pipelineRoutes`; settles runs a previous process left `RUNNING` at startup. |
| `apps/server/src/services/pipeline/__tests__/PipelineEngine.test.ts` | Created | 199 assertions across schema, grammar, validation, DAG algebra, storage, sequential/parallel/batched execution, context handoff, failure, cancellation, recovery and REST. |
| `apps/server/package.json` | Modified | Wires the suite into `"test"`. |

---

## 3. Implementation Details

**Scheduling.** `readyPipelineStepIds` is the whole schedule: a step is ready when it is
`PENDING` and every declared dependency is `PASSED`. Nothing in a definition states what runs
in parallel, so a definition cannot claim a parallelism its data dependencies contradict. A
ready set is dispatched in slices of `PIPELINE_MAX_PARALLEL_STEPS` (= `MAX_CONCURRENT_DELEGATIONS`,
4); one ready step goes through `delegateTask`, several through `delegateParallel`, whose
results are positionally matched back to their steps.

**Context handoff.** `buildStepContext` collects the run's parameters and every transitive
ancestor's summary, changed files, output (≤4k) and diff (≤6k), newest-last, then bounds the
whole thing to `MAX_PIPELINE_CONTEXT_CHARS` *including* the "earlier context omitted" notice —
the delegation service refuses an over-long `inputContext` rather than trimming one, so a brief
that was not cut here would be a step that failed to dispatch. The same reasoning applies to
`taskDescription`: parameter substitution can lengthen a task the parser already bounded, so
the substituted brief is truncated to `MAX_PIPELINE_TASK_CHARS`.

**Cancellation.** `cancelPipeline` records the reason on the in-memory run record and then asks
`AgentDelegationService.cancelAllDelegations` to stop the children — the service owns their
sessions, ends each wait, stops each process and settles each row. The loop reads the reason
when the batch it was waiting on returns and marks the batch and everything after it
`CANCELLED`. A run this process is not executing (one a restart left behind) is settled in
storage alone, which is also what `recoverRuns()` does at startup.

**Safety.** The YAML reader bounds input size, line count, nesting depth and collection size
while reading rather than after; refuses `&`, `*`, `!`, `%`, `?`, tab indentation, a second
document, duplicate keys and `__proto__`/`constructor`/`prototype` keys. The parser refuses
unknown keys, so a silently-ignored `depends_on:` cannot become a pipeline that runs its steps
in the wrong order while looking correct.

**Authorization.** Reads require `workspace:read`, saves `workspace:write`, and running or
cancelling `agent:spawn` — a pipeline starts agent sessions against a checkout. An existing
pipeline is governed by the workspace it already belongs to, never by a `workspaceId` in the
request. A workspace with no membership rows at all is treated as unmanaged (DEC-028), matching
the team-agent and environment-secret surfaces.

---

## 4. Verification

All commands run from the repository root unless noted.

```
pnpm --filter asterim exec tsx src/services/pipeline/__tests__/PipelineEngine.test.ts
  → 199 passed, 0 failed

pnpm typecheck   → Tasks: 11 successful, 11 total   (tsc --noEmit in every workspace)
pnpm lint        → Tasks: 7 successful, 7 total     (0 errors; warnings are the pre-existing
                                                     `no-explicit-any` style warnings, and the
                                                     11 added are in the new test file, matching
                                                     every other suite in the repo)
pnpm test        → Tasks: 10 successful, 10 total   (0 `FAIL` lines across all suites;
                                                     asterim: 199 passed, 0 failed)
pnpm build       → Tasks: 7 successful, 7 total     (server bundle 1.18 MB, web + marketing built)
```

The AI/delegation/team suites named in the task ran as part of `pnpm test` and are green
(`AgentDelegationService.test.ts`, `TeamAgentService.test.ts`, `VerificationPipelineService.test.ts`).

What the 199 assertions cover:

- **Migration** — the three tables, every required column, both required indexes, the
  `schema_migrations` row for version 4, and that re-opening the same database is idempotent.
- **Grammar** — scalars, numbers, booleans, `~`, nested sequences of mappings, flow lists,
  literal and folded block scalars, comment stripping that respects quotes; and refusals for
  anchors, aliases, tags, tabs, a second document, duplicate keys, prototype keys, a
  non-mapping line and an unterminated quote.
- **Validation** — a good definition parses; missing name/steps/role/task, duplicate ids, an
  unknown dependency, a self-dependency, two- and three-step cycles, an unplayed role, an
  unknown key, a bad trigger, an unusable step id and too many steps are each refused, and the
  cycle error names the path.
- **DAG algebra** — order, ancestors, readiness at each stage, "a failed dependency leaves its
  dependents unready forever", cycle detection, and status aggregation.
- **Execution** — a sequential run passes in dependency order with peak concurrency 1; a
  fan-out/fan-in run reaches peak concurrency ≥ 3 and the join is handed all four ancestors'
  answers; six independent steps run in batches that never exceed the bound; the downstream
  brief carries the upstream summary and the run parameters, and never anything from a step
  that has not run.
- **Events** — one `pipeline:started` listing every planned step, one `pipeline:step_started`
  and one `pipeline:step_completed` per step carrying the settled row, one `pipeline:completed`
  on success and `pipeline:failed` otherwise, all routed to the project.
- **Failure** — the failing step is `FAILED` with its reason, the two steps behind it are
  `SKIPPED` with no thread, no further session was started, the failing child was stopped, and
  the run explains which step stopped it.
- **Cancellation** — a run stopped mid-step ends `CANCELLED` (not `FAILED`), the running step
  and everything behind it are `CANCELLED` with the operator's reason, the running child was
  stopped, cancelling a settled run reports `false`, and an unknown run is refused.
- **Bounds** — an enormous ancestor diff and an enormous parameter still produce a brief the
  delegation service accepts, and a run with a 2 000-character parameter passes.
- **Recovery** — a run left `RUNNING` by a previous process is settled once and only once.
- **REST** — 401 anonymous on read and run, 201 create, 400 with a line number for unreadable
  YAML, 400 naming the cycle for a cyclic definition, 400 for an empty body, list, read, 404 for
  unknown ids, a run that passes end-to-end **through the production `EventBusSessionRunner`**
  (the test stands in for `AgentService` on the bus rather than using the fake), run read-back
  with per-step progress, and cancel-after-settle.

Not run: no browser/screenshot verification — this task adds no UI (the Pipeline Execution
Dashboard is a later Phase 9 deliverable).

---

## 5. Acceptance Criteria Review

- [x] **1. Migration applies cleanly via `MigrationEngine`** — `004_pipelines` applies in order
  after 001–003 on a fresh database (`[MigrationEngine] Applied 4 (004_pipelines)`); the test
  asserts all three tables, every column named in the task, both required indexes, and the
  `schema_migrations` row `version 4 / 004_pipelines`. Re-opening the database is idempotent.
  *Deviation, deliberate:* the task names `packages/server/src/migrations/003_pipelines.sql`.
  There is no `packages/server` workspace — the server is `apps/server` — migrations in this
  repo are `.ts` modules by the rationale in `migrations/index.ts` (the Core ships as one
  bundled `dist/index.js`, so a migration a runtime `readdir` cannot find is a database that
  cannot be opened), and version 3 is already taken by `003_team_approval_governance`.
  Renumbering an applied migration would break every existing database's checksum, so the
  migration is `apps/server/src/migrations/004_pipelines.ts` with exactly the schema the task
  specified.
- [x] **2. `PipelineParser` validates YAML and rejects cyclic DAGs** — 15 refusal assertions
  including two- and three-step cycles, self-dependency, duplicate ids and unknown
  dependencies; the cycle error names the path (`a → c → b → a`). A cyclic definition never
  reaches storage (`savePipeline` refuses it) and a cyclic definition posted over HTTP is a 400.
- [x] **3. `PipelineEngine` executes sequential and parallel steps by DAG topology** — the
  sequential run has peak concurrency 1 and starts its second child only after the first
  settled; the fan-out run reaches peak concurrency ≥ 3 with the join starting after all three
  of its dependencies completed; a six-wide ready set runs in batches bounded by
  `PIPELINE_MAX_PARALLEL_STEPS` and all six pass.
- [x] **4. Outputs and context flow to downstream steps** — the second step's brief contains
  `done:TOKEN-IMPLEMENT` and the upstream step's id; the four-ancestor join is handed all four
  answers; the first step is told nothing about steps that have not run; run parameters travel
  with every brief. Bounds are asserted so an enormous ancestor diff still dispatches.
- [x] **5. Authenticated REST endpoints function correctly** — all six routes exercised over
  `fastify.inject`, including 401s for anonymous callers, the 400/404/409 mapping, and a full
  run driven through the production session runner. RBAC is enforced against the pipeline's own
  workspace with the DEC-028 unmanaged-workspace exception.
- [x] **6. `PipelineEngine.test.ts` passes with comprehensive DAG and execution assertions** —
  199 passed, 0 failed; wired into `apps/server` `"test"` between the team-agent and
  verification suites.
- [x] **7. Monorepo CI gates pass with 0 errors** — `pnpm typecheck` 11/11, `pnpm lint` 7/7 with
  0 errors, `pnpm test` 10/10 with no `FAIL` line anywhere, `pnpm build` 7/7.

**Definition of Done**

- [x] `004_pipelines` created and verified
- [x] Shared pipeline types in `@asterim/shared`
- [x] `PipelineParser.ts` implemented (with `SafeYaml.ts` beside it)
- [x] `PipelineEngine.ts` implemented
- [x] REST routes registered in `server.ts`
- [x] `PipelineEngine.test.ts` created and passing
- [x] Monorepo CI gates pass cleanly

---

## 6. Git Diff Review

`git status` after the work: four modified files (`apps/server/package.json`,
`apps/server/src/migrations/index.ts`, `apps/server/src/server.ts`,
`packages/shared/src/index.ts`) and five new ones (the migration, the three pipeline service
modules plus the test, the route, the shared type module).

Reviewed line by line:

- `server.ts` — one import, one `register` call in the existing sequence, one `recoverRuns()`
  next to the other recovery calls. No existing route, hook or startup step was touched.
- `migrations/index.ts` — one import, one array entry. No applied migration was edited, so no
  existing database's checksum changes.
- `packages/shared/src/index.ts` — one export line.
- `apps/server/package.json` — the new suite inserted into the `"test"` chain; nothing else,
  and **no dependency was added** (the YAML reader is hand-written for exactly that reason).
- No forbidden changes: nothing under `blueprint/`, no ADR or decision edited, no change to
  `AgentDelegationService`, `GitWorktreeService`, `VerificationPipelineService`, the EventBus,
  the socket manager or any existing route. No debug scripts or scratch files were added; the
  test writes only into its own temp directory and cleans it up.

One unrelated file, `tests/report.md`, was already modified in the working tree when this task
started (the P8-04 verification gate report). It is **not** part of this commit and was left
untouched.

---

## 7. Problems Discovered

1. **No YAML dependency exists in the monorepo**, and adding one is a speculative-dependency
   decision that is not this task's to make. `SafeYaml.ts` is the answer: a restricted reader
   whose refusals are the contract. It is also the safer answer — a pipeline definition is a
   file an agent can write, and anchors/aliases alone are an expansion bomb.
2. **The delegation service refuses over-long input rather than trimming it.**
   `optionalText(..., MAX_CONTEXT_CHARS)` throws, so the first draft of `buildStepContext` —
   which bounded the body but then prefixed a notice — could have produced a 60 034-character
   context and failed the batch it was building. Both the context and the substituted task are
   now cut *inside* the bound, with regression assertions for a 200 KB ancestor diff and a
   100 KB parameter.
3. **One parent may not have two delegations in flight from the same call site.**
   `delegateTask` refuses `ALREADY_DELEGATING`, and `delegateParallel` caps a batch at
   `MAX_CONCURRENT_DELEGATIONS`. Rather than build a second execution path, the engine slices
   each ready set to that bound and dispatches successive batches — the DAG is honoured either
   way, and the machine is not asked to run more agent processes than the rest of the Core
   already allows.
4. **Version 3 was taken.** See the criterion-1 note: renumbering is not an option once a
   migration has been applied, so the pipeline migration is 4.
5. **A run left `RUNNING` by a crash would show as live forever.** The schema this task adds
   makes that state representable, so `recoverRuns()` and its startup call were added with it
   rather than left for a later task to discover.

---

## 8. Architectural Concerns

1. **`pipelines` is scoped by `workspace_id`, but a run needs a `project_id`.** The definition
   declares `projectId:` (or the run context supplies one), and the engine refuses a run that
   can find neither. If Phase 9 wants pipelines bound to a project rather than to a workspace,
   that is a schema decision worth making before the dashboard reads it.
2. **Batching is per ready set, not per step.** A ready set of six runs as 4 + 2, so the two
   wait for the slowest of the four rather than for the first free slot. A true slot scheduler
   would be a change to how a delegation registers concurrency, not to the engine, and is worth
   doing only if pipelines routinely go wider than four.
3. **Cancellation is a five-event vocabulary.** A cancelled run publishes `pipeline:failed` with
   `run.status === 'CANCELLED'`, because the task specifies five events and a sixth terminal
   event a dashboard did not know about would leave the run showing as live. If the UI wants to
   distinguish them without reading the payload, `pipeline:cancelled` is a one-line addition —
   but it needs a decision, not an invention.
4. **Retry policies and step-level triggers are declared in the roadmap but not in this task.**
   `PipelineTriggerType` carries `GIT_COMMIT`, `FILE_CHANGE` and `SCHEDULE`, and nothing yet
   fires them: every run today is `MANUAL`, through the REST surface. The trigger listeners are
   a task of their own.
5. **`importFromDirectory` matches definitions by name**, so renaming a pipeline in its file
   creates a second row rather than renaming the first. That is the right default for an import
   with no id in the file; if `.asterim/pipelines/` is to be the source of truth, the file's
   path should become the identity.

---

## 9. Recommended Next Step

**P9-02 — Worktree Fleet Orchestrator & pipeline trigger listeners.** The engine already gives
every step its own sandbox through the delegation path, so the next vertical is the fleet view
of them: `.asterim/worktrees/pipeline-<runId>-step-<stepId>` naming, conflict detection across
concurrent step worktrees, and the branch-merge/PR-synthesis path the roadmap names. Wiring
`GIT_COMMIT` / `FILE_CHANGE` / `SCHEDULE` triggers onto the EventBus and `workspaceMonitor`
belongs in the same task or the one after it; the Pipeline Execution Dashboard (the DAG graph,
live step progress, diff artifacts) should follow once the run shape it renders is settled.
