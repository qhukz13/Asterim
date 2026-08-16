Task-ID: P8-02
Status: COMPLETE

# Execution Report: P8-02 — Automated Verification Pipelines over Sandboxed Worktrees

**Task ID:** P8-02
**Phase:** Phase 8 — Automated Verification Pipelines & Worktree Sandboxing
**Status:** IMPLEMENTED / VERIFIED
**Date:** 2026-08-17
**Author:** Claude Code

---

## 1. Summary

Asterim now runs a project's own verification commands over a delegated subagent's
work and reports the exit codes, so "types are clean and the tests pass" stops
being a sentence an agent writes and becomes something the Core established.

`VerificationPipelineService` discovers a pipeline (an explicit
`.asterim/verification.json`, otherwise the lifecycle scripts in `package.json`
run through whichever package manager the lockfile names), executes the steps
sequentially in one directory with per-step timeouts and bounded output capture,
and returns a `VerificationPipelineReport`. `AgentDelegationService` runs it
automatically in a `TASK` child's worktree sandbox once the child's session has
been stopped and before the parent is released, attaches the report to
`DelegationResult`, and writes a `VERIFICATION:` section — including the failing
step's own output — into the brief the parent reads.
`POST`/`GET /api/v1/threads/:id/worktree/verify` expose the same thing on demand,
and orphaned sandboxes are reclaimed at startup.

Verified: 196/196 new assertions against real subprocesses, real temp
directories and a real `git worktree`; 38/38 monorepo suites (2468 server
assertions, no regressions); typecheck clean in all 7 packages; 0 lint errors;
every package builds.

---

## 2. Files Changed

| File | Status | Purpose |
| :--- | :--- | :--- |
| `packages/shared/src/types/verification.ts` | created | The contract: `VerificationStep`, `VerificationStepResult`, `VerificationPipelineReport`, the discovery constants, `isSafeScriptName`, `summarizeVerificationReport`. |
| `packages/shared/src/types/delegation.ts` | modified | `DelegationRequest.verifyPipeline` / `.verificationSteps`, the same two on `ParallelDelegationItem`, `DelegationResult.verificationReport`. |
| `packages/shared/src/index.ts` | modified | Exports `./types/verification`. |
| `apps/server/src/services/verification/VerificationPipelineService.ts` | created | Discovery, bounded step execution, whole-pipeline runs. |
| `apps/server/src/services/verification/threadVerificationStore.ts` | created | Reads/writes a thread's latest report, shared by the delegation service and the REST surface. |
| `apps/server/src/services/verification/__tests__/VerificationPipelineService.test.ts` | created | 196 assertions (suite 21 of the server's 21). |
| `apps/server/src/services/ai/AgentDelegationService.ts` | modified | `attachVerification`, `pruneOrphanSandboxes`, `compactVerificationReport`, `normalizeStepNames`, `formatVerificationFailures`, and the `VERIFICATION:` section of `formatDelegationReport`. |
| `apps/server/src/routes/worktrees.ts` | modified | `POST` and `GET /api/v1/threads/:id/worktree/verify`. |
| `apps/server/src/services/DatabaseService.ts` | modified | `threads.verification_report_json`, via the existing ALTER-in-a-try pattern. |
| `apps/server/src/index.ts` | modified | `pruneOrphanSandboxes()` after `recoverDelegations()`. |
| `apps/server/package.json` | modified | The new suite in `test` (20 → 21 server suites, 37 → 38 monorepo). |

---

## 3. Implementation Details

### Discovery

`discoverPipeline(targetDir, { configDir })` returns ordered `VerificationStep[]`:

1. `.asterim/verification.json`, then `.asterim/pipeline.json`. Both a bare array
   and `{ steps: [...] }` are accepted; an entry may be a string. An explicit
   configuration wins outright **including when it is empty** — an operator who
   configured no steps has said not to verify this project. A file that is not
   readable JSON falls through to `package.json` rather than failing.
2. Otherwise `package.json` scripts, in the order `typecheck → lint → test →
   build` (cheapest and most localising first), each with its common alternate
   spellings (`type-check`, `types`). The package manager comes from the lockfile
   (`pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`/`bun.lock`, `package-lock.json`),
   then from `packageManager`, then npm.

`configDir` is the fix for a real hole: `.asterim/` is excluded from Git
tracking (P8-01), so a worktree sandbox — a checkout of *tracked* files — does
not carry the operator's configured pipeline. The delegation path passes the
project root, so a sandbox is verified with the pipeline the operator actually
wrote.

### Execution

`runStep` spawns through the platform shell in the target directory with
`detached` (its own process group, so a timeout kills the whole tree, not just
the shell), `stdio: ['ignore','pipe','pipe']`, and an environment carrying
`CI=1`, `NO_COLOR`, `FORCE_COLOR=0`, `GIT_TERMINAL_PROMPT=0` — each of which
turns something that would block forever with no terminal attached into an
immediate answer. Output is bounded **as it arrives** (50,000 chars per stream)
rather than trimmed afterwards. The timeout escalates SIGTERM → SIGKILL after a
5s grace. It never throws and never rejects: a missing binary, an unspawnable
shell, a non-existent directory and a hung process are all
`{ passed: false, error }`.

`runPipeline` runs every step sequentially and **does not stop at the first
failure** — a parent told only that the typecheck failed does not know whether
the tests would have passed, and steps in the same directory contend for the
same build output.

`passed` is `totalSteps > 0 && failedSteps === 0`. A pipeline that discovered
nothing has verified nothing, so it is not a pass; `summarizeVerificationReport`
prints "no verification pipeline was discovered in …" rather than "failed", so
the two are never confused.

### Delegation integration

Default: on for a `TASK` that got a sandbox, off for `REVIEW` (nothing changed
to verify) and for a task with no sandbox (a build in the project directory
would write artefacts into the operator's own tree). `verifyPipeline` overrides
both ways; set explicitly it will also run in the project directory.

Ordering inside `runDelegation` is deliberate: diff → record outcome → publish
child state → **stop the child's session** → verify → release the parent → write
the report. Verifying after the stop means a build never races an agent still
writing files; verifying before the release means the parent reads the verdict
at the same time as the claim. A **cancelled** delegation is never verified —
`cancelDelegation` answers with what the delegation settles as, and a
four-minute build there would be four minutes of a cancel button that has not
done anything yet, about work that has been abandoned.

The full report is stored on the thread row; a **compacted** copy (per-step
output tail-bounded to 2,000 chars) goes onto `DelegationResult`, because that
becomes a `delegation.completed` payload broadcast to every dashboard watching
the project — the same rule `MAX_DIFF_CHARS` follows in P8-01.

### Command-injection surface

The only string Asterim assembles itself is `<manager> run <script>`, and the
script name is refused unless `isSafeScriptName` accepts it. The REST endpoint
and `DelegationRequest` accept **step names**, never commands, so a caller can
only choose among what the project already declares (`{"steps":["test; touch
/tmp/x"]}` is a 400, asserted). A command inside `.asterim/verification.json` is
run as written — that is the file's entire purpose, and it is trusted exactly as
much as the repository's own build scripts already are.

### Orphan pruning

`agentDelegationService.pruneOrphanSandboxes()` runs at startup after
`recoverDelegations()`, un-awaited. It skips projects with no `.git`, and
projects that have neither a recorded sandbox nor an `.asterim/worktrees`
directory, so startup costs nothing on a workstation not using the feature. It
passes every thread that still records a sandbox as the keep list, and
`pruneOrphans` itself deletes nothing whose directory still exists — a finished
delegation whose diff is waiting to be reviewed survives any number of restarts.

---

## 4. Verification

Every command below was run in this session.

| Gate | Command | Result |
| :--- | :--- | :--- |
| New suite | `pnpm --filter asterim exec tsx src/services/verification/__tests__/VerificationPipelineService.test.ts` | **196/196 assertions passed** |
| Worktree suite (P8-01) | `… GitWorktreeService.test.ts` | 111/111 |
| Delegation suite (P7) | `… AgentDelegationService.test.ts` | 461/461 |
| Server suites | `pnpm --filter asterim test` | **21/21 suites, 2468 assertions, 0 failures** |
| Web suites | `pnpm --filter @asterim/web test` | 8/8 suites, 1159 assertions |
| Relay suite | `pnpm --filter @asterim/relay test` | 71/71 |
| Adapters suite | `pnpm --filter @asterim/adapters test` | 23/23 |
| MCP memory suites | `pnpm --filter @asterim/mcp-memory-server test` | 7/7 suites, 348 assertions |
| **Total** | | **38/38 suites** |
| Typecheck | `tsc --noEmit` in shared, server, web, relay, adapters, mcp-memory-server; `tsc -b` in marketing | **0 errors in all 7** |
| Lint | `eslint` in server, shared, web | **0 errors** (warnings only, all pre-existing `no-explicit-any`/`no-unused-vars` in untouched files) |
| Build | `pnpm --filter <pkg> build` for shared, adapters, web, asterim, marketing, relay, mcp-memory-server | **all succeed** |

`pnpm run typecheck` / `lint` / `test` / `build` at the repo root were blocked by
this session's command sandbox, so each was run per workspace instead — the same
work turbo would fan out, covering every package that defines the script.

What the new suite actually exercises, with no mocks: discovery across four
package managers and both configuration filenames; a passing command, a
non-zero exit, a missing binary, a 200,000-character build and a process that
never returns (killed at 400ms); execution inside a real `git worktree` with the
primary checkout asserted clean (`git status --porcelain` empty, no artefact at
the repo root) afterwards; a delegated child whose claim "everything typechecks
and all tests pass" is contradicted by the project's own typecheck exiting 1;
the REST surface including the injection attempt; and orphan pruning against a
repository with one abandoned and one under-review sandbox.

---

## 5. Acceptance Criteria Review

- [x] **1. Auto-discovery from `package.json` or `.asterim/verification.json`** —
  `discoverPipeline`. Asserted for pnpm/yarn/bun/npm lockfiles, the
  `packageManager` field, the npm fallback, script ordering, alternate
  spellings, partial script sets, both configuration filenames, both
  configuration shapes, precedence over `package.json`, explicit-empty,
  malformed-JSON fallback, junk entries, and the `configDir` fallback a sandbox
  depends on. Suite § *"discoverPipeline reads a Node project's own lifecycle
  scripts"* through *"a sandbox is verified with the pipeline the project
  configured"*.
- [x] **2. Sequential execution with per-step timeouts, process management and
  structured capture** — `runStep`/`runPipeline`. Asserted: order preserved and
  a failing step does not stop the ones behind it (`order.txt === '123'`); real
  exit codes; SIGTERM→SIGKILL kill of a hung step inside 5s; a 200,000-char
  stream bounded to ~50,000 with a truncation marker; correct cwd; caller
  timeout override. Suite § *"runStep — …"* and *"runPipeline — …"*.
- [x] **3. `AgentDelegationService` verifies a sandbox on completion and attaches
  `VerificationPipelineReport` to `DelegationResult`** — `attachVerification`.
  Asserted: report present, `cwd` equals the sandbox path, `passed: true` for
  good work and `passed: false` naming `typecheck` with `exitCode: 1` for a
  child that claimed otherwise; the diff excludes verification artefacts; a
  `REVIEW`, an opted-out task and a cancelled delegation are not verified.
  Suite § *"a delegated child's work is verified before the parent hears about
  it"*, *"a child that broke the build cannot report otherwise"*, *"what is not
  verified, and why"*.
- [x] **4. `POST /api/v1/threads/:id/worktree/verify` with authenticated access
  control** — `apps/server/src/routes/worktrees.ts`. Asserted: 401 anonymous
  (POST and GET), 404 unknown thread, 400 for a command dressed up as a step
  name / non-array steps / negative timeout, 200 with the report, `sandboxed`
  flag, subset execution, and `GET` returning the persisted report (and `null`,
  not 404, for a thread never verified). Suite § *"POST and GET
  /api/v1/threads/:id/worktree/verify"*.
- [x] **5. Orphan pruning safely wired into startup/recovery** —
  `pruneOrphanSandboxes()` in `AgentDelegationService`, called from
  `apps/server/src/index.ts:239` immediately after `recoverDelegations()`.
  Asserted: the sandbox whose directory was deleted is de-registered and its
  branch removed; the one awaiting review keeps its directory, its registration
  and its branch; a second pass is a no-op; a non-repository project and a
  project whose directory is gone do not break the pass. Suite §
  *"pruneOrphanSandboxes reclaims what nothing is using"*.
- [x] **6. `VerificationPipelineService.test.ts` passes with comprehensive
  assertions in real temporary directories** — 196/196, 48 temp directories,
  real subprocesses, a real git repository and a real worktree. No mocks except
  the agent PTY.
- [x] **7. CI gates pass with 0 errors** — typecheck 0 errors (7 packages), lint
  0 errors, **38/38 test suites**, every package builds. Table in § 4.

**Definition of Done**

- [x] Shared verification types in `@asterim/shared`
- [x] `VerificationPipelineService.ts` with auto-discovery and bounded step execution
- [x] `AgentDelegationService` integrated with automated sandbox verification
- [x] REST verification endpoints implemented and registered (the existing
      `worktreeRoutes` registration in `index.ts:161` covers them)
- [x] Orphan worktree pruning wired into the startup lifecycle
- [x] `VerificationPipelineService.test.ts` created and passing
- [x] Monorepo CI gates pass cleanly (38/38, 0 lint errors, 0 typecheck errors, build succeeds)

---

## 6. Git Diff Review

Reviewed `git diff` and `git status` file by file against § 5 of the task
(Explicitly Forbidden Changes):

- **No external SaaS dependency or network service.** No new package was added
  to any `package.json`; the only new runtime import is `child_process.spawn`.
- **The primary repository is not modified during sandbox verification.** Every
  step runs in the directory passed to `runPipeline`, which for a delegation is
  the sandbox. The suite asserts this against a real repository: after a step
  that writes `dist.txt`, the file is inside the worktree, absent from the repo
  root, and `git status --porcelain` on the primary checkout is empty. The only
  path on which verification touches the project directory is an explicit
  `verifyPipeline: true` with no sandbox, or the REST endpoint on a thread that
  has none — both operator-initiated.
- **No active worktree is deleted during pruning.** The keep list names every
  thread that still records a sandbox, and `pruneOrphans` skips anything whose
  directory exists; asserted directly.
- **No existing suite broken.** All 37 pre-existing suites pass unchanged,
  including the 461-assertion delegation suite and the 111-assertion worktree
  suite. The only edits to existing files are additive: five optional fields on
  two shared interfaces, one nullable column, one constructor parameter with a
  default, two new routes, one startup call, and one new section in
  `formatDelegationReport` guarded by `if (result.verificationReport)`.

One change outside the strict letter of the scope, for a reason worth flagging:
`import type` was needed in `packages/shared/src/types/delegation.ts` because
`apps/marketing` compiles with `verbatimModuleSyntax`. Without it the marketing
build fails.

`tests/report.md` was already modified in the working tree when this task
started (it is in the pre-task `git status`). It is unrelated to P8-02 and has
been left uncommitted rather than folded into this commit.

---

## 7. Problems Discovered

1. **A sandbox has no `node_modules`, and that is not the subagent's fault.** A
   `git worktree` checks out tracked files; `node_modules` is not one. Running
   `pnpm run typecheck` in a fresh sandbox therefore fails because `tsc` is not
   installed there — which, reported as a failed verification, is exactly the
   false signal this subsystem exists to remove. So package.json discovery
   requires `node_modules` to be present in the target directory; a sandbox
   without it reports `totalSteps: 0` ("nothing was verified") rather than a
   fabricated failure. An explicit `.asterim/verification.json` is unaffected.
   The consequence is in § 8.
2. **`.asterim/` is untracked, so a sandbox does not carry the operator's
   pipeline configuration.** Found while wiring the delegation path; solved with
   the `configDir` fallback, which is now the mechanism by which any sandboxed
   Node monorepo gets verified at all.
3. **Bounded capture is not the same as a bounded payload.** 20 steps × 50,000
   characters is megabytes in a `delegation.completed` event going out to every
   connected dashboard. Split into a stored full report and a compacted one on
   the result, following the P8-01 precedent for the diff.
4. **`tsc -b` in `apps/marketing` runs with `verbatimModuleSyntax`**, which the
   rest of the monorepo does not. A plain `import` of a type in `packages/shared`
   compiles everywhere else and fails there. Worth knowing before the next
   shared-types change.

---

## 8. Architectural Concerns

**The one that needs a decision (recommend a Change Proposal, not a quiet fix).**
Because of § 7.1, the flagship path — delegate a task, get it sandboxed, get it
verified — currently reports "no pipeline discovered" for a Node project unless
the operator writes a `.asterim/verification.json` whose commands do not need
`node_modules`. Making it work out of the box means giving a sandbox access to
the project's installed dependencies, and every way of doing that is an
architectural decision, not an implementation detail:

- symlink the primary repo's `node_modules` into the sandbox (fails for pnpm
  workspaces, where each package has its own, and shares a mutable
  `node_modules/.cache` between an agent's build and the operator's);
- run an install in the sandbox (minutes per delegation, and network access from
  a directory an agent controls);
- run the pipeline in the primary tree against the merged result instead
  (contradicts the zero-pollution property P8-01 exists for).

I have deliberately not chosen one. The honest "nothing was verified" is correct
and safe in the meantime, and it is visible to the operator rather than silent.

**Smaller notes.**
- Every one of `refs/asterim/base/<threadId>` outlives its sandbox; `pruneOrphans`
  reclaims worktrees and branches but not those refs. Bytes, not a bug, but they
  accumulate.
- `verification_report_json` keeps only the latest report per thread. If a phase
  ever wants "did this delegation verify at the time it finished, and does it
  still?", that needs a table rather than a column.
- The verification pipeline is currently only reachable for a *thread*. A
  workspace-level or pre-merge gate ("verify before `POST /worktree/merge`
  succeeds") is the obvious next surface, and would make the merge route refuse
  unverified work — but that is a product decision about whether an operator may
  merge something red.

---

## 9. Recommended Next Step

Antigravity to review, then either:

- **P8-03 — Verification evidence in the dashboard**: surface
  `VerificationPipelineReport` on the delegation/worktree UI (a per-step
  pass/fail row against `blueprint/DESIGN_SYSTEM.md` tokens, the failing step's
  output in the Inspector, a "Verify" action on a sandbox). The data and both
  endpoints exist; nothing renders them yet.
- or resolve § 8 first via a Change Proposal on sandbox dependency provisioning,
  since it decides how much of the Node ecosystem P8-02 actually covers.
