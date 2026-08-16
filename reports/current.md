Task-ID: P8-01
Status: COMPLETE

# Execution Report: P8-01 — Git Worktree Sandboxing & Subagent Working Tree Isolation

**Task ID:** P8-01
**Phase:** Phase 8 — Automated Verification Pipelines & Worktree Sandboxing
**Status:** IMPLEMENTED & VERIFIED
**Date:** 2026-08-17
**Author:** Claude Code

---

## 1. Summary

Git Worktree Sandboxing is implemented end to end. `GitWorktreeService` provisions, inspects, merges and tears down isolated checkouts at `<projectRoot>/.asterim/worktrees/<threadId>` on ephemeral branches `asterim/sandbox/<threadId>`, using native `git worktree` through the existing `GitProvider`. `AgentDelegationService` provisions a sandbox for every `TASK` child before its session starts, `AgentService` routes that session into the sandbox directory, and the child's real diff comes back on `DelegationResult`. Three REST endpoints let an operator inspect, merge or discard a subagent's work. A new suite of 111 assertions runs against real temporary git repositories, and 48 further assertions were added to the delegation suite covering the integration and the REST surface.

All CI gates pass: typecheck clean across 7 packages, lint 0 errors, **37/37 test suites pass**, full monorepo build succeeds.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `packages/shared/src/types/worktree.ts` | Created | `WorktreeInfo`/`WorktreeDiff`/`WorktreeMergeResult`, branch & directory naming, thread-id safety predicate |
| `packages/shared/src/index.ts` | Modified | Export the worktree contract |
| `packages/shared/src/types/delegation.ts` | Modified | `DelegationRequest.isolateWorktree`, `DelegationResult.{worktreePath,diff,changedFiles}`, `ParallelDelegationItem.isolateWorktree`, `DelegationContext.worktree*` |
| `apps/server/src/services/git/GitWorktreeService.ts` | Created | Create / diff / merge / remove / prune sandboxes; argument-safety and primary-tree guards |
| `apps/server/src/services/git/__tests__/GitWorktreeService.test.ts` | Created | 111 assertions against real temp git repositories |
| `apps/server/src/services/DatabaseService.ts` | Modified | `threads.worktree_path`, `threads.worktree_branch` (ALTER-in-try, no migration framework) |
| `apps/server/src/services/ai/AgentDelegationService.ts` | Modified | Provision sandbox before child session; attach diff to the result; sandbox lines in brief & report |
| `apps/server/src/services/AgentService.ts` | Modified | `resolveThreadWorkspace` — a thread with a sandbox runs its session there |
| `apps/server/src/routes/worktrees.ts` | Created | `GET` / `POST …/merge` / `DELETE` `/api/v1/threads/:id/worktree` |
| `apps/server/src/routes/delegation.ts` | Modified | Forward an explicit `isolateWorktree` from the operator's delegation body |
| `apps/server/src/index.ts` | Modified | Register `worktreeRoutes` |
| `apps/server/package.json` | Modified | Wire `GitWorktreeService.test.ts` into the `test` script (19 → 20 server suites) |
| `apps/server/src/services/ai/__tests__/AgentDelegationService.test.ts` | Modified | +48 assertions: isolation, parallel isolation, fallback, REST surface |

## 3. Implementation Details

**Naming lives in `@asterim/shared`.** Branch (`asterim/sandbox/<threadId>`) and directory (`.asterim/worktrees/<threadId>`) are derived by shared helpers, so the server, the dashboard and a human reading `git worktree list` agree on what belongs to Asterim — and `removeWorktree` only ever deletes a branch it can recognise as its own by prefix.

**Base commits are recorded, not inferred.** `createWorktree` writes `refs/asterim/base/<threadId>` pointing at the commit the sandbox forked from. Every diff is taken against that ref, which is what makes a subagent that *committed* its own work still diff correctly — inferring a fork point from the branch graph goes wrong as soon as the parent branch moves. The ref is deleted with the sandbox.

**One diff covers all four states.** `getDiff` runs `git add --all --intent-to-add` in the sandbox (touching only the sandbox's own index) and then `git diff <base>`, so committed, staged, unstaged and untracked work all appear. Output is capped at 200 000 chars in the service and 20 000 on the delegation result, with the cut marked.

**The primary working tree is never written to.** Creation and removal touch only the sandbox directory and `asterim/sandbox/*` refs — asserted directly (`HEAD` unmoved, branch unchanged, `git status --porcelain` empty, file contents unchanged). `mergeWorktree` is the one operation that changes the real checkout and is bounded on every side: it refuses a dirty target (`DIRTY_TARGET`), refuses a target branch that is not checked out rather than checking one out under the operator (`TARGET_NOT_CHECKED_OUT`), and on conflict runs `git merge --abort` and reports `MERGE_CONFLICT` — leaving the repository exactly where it was. Whatever the sandbox left uncommitted is committed onto the *ephemeral* branch first, never onto the operator's.

**Never tracked.** `.asterim/` is added to `.git/info/exclude` — never to `.gitignore`, which is a tracked file and would put an Asterim implementation detail in the user's next commit. If the project already ignores `.asterim`, nothing is written at all.

**Command safety.** `GitProvider` builds command strings through a shell, so every interpolated path/ref goes through `quoteGitArg`, which double-quotes and *refuses* `" $ \` CR LF` rather than trying to escape them; thread ids are validated against `isSafeWorktreeThreadId` before they can name a branch or a directory (`..`, `/`, spaces refused). Commit messages are sanitized rather than refused, since an operator's merge message should not fail on a backtick.

**Delegation integration.** `provisionWorktree` runs inside `runDelegation`, before the session starts, so both the sequential and the parallel path get it. Default is on for `TASK`, off for `REVIEW`; `isolateWorktree` overrides either way. It never throws: no project path, no `.git`, no commits, git missing — each is a delegation that runs in the project directory exactly as it did before P8-01. A cheap `fs.existsSync(<repo>/.git)` pre-check keeps the cost at zero (no subprocess) for workstations whose projects are not repositories. The child row's `worktree_path`/`worktree_branch` are written *before* the session starts, because that row is what `AgentService.resolveThreadWorkspace` reads to decide where to run it.

**What the parent is told.** `formatDelegationReport` gains a `WORKTREE:` line and a `CHANGED FILES:` line — deliberately not the diff itself, which can be megabytes; the full diff travels on `DelegationResult.diff` and lives in the worktree. The child's brief gains a `WORKING TREE:` section telling it where it is and that it must not merge, rebase or push its own work.

## 4. Verification

Every command below was run in this session.

| Gate | Command | Result |
| :--- | :--- | :--- |
| New suite | `pnpm --filter asterim exec tsx src/services/git/__tests__/GitWorktreeService.test.ts` | **111/111 assertions passed** |
| Git subsystem | `…GitDriftDetector.test.ts`, `…RemoteManager.test.ts` | 64/64, 89/89 passed |
| Delegation | `…AgentDelegationService.test.ts` | **461/461 assertions passed** (was 413) |
| Typecheck | `tsc --noEmit` in shared, server, adapters, web, relay, mcp-memory-server; `tsc -b` in marketing | **0 errors, all 7 packages** |
| Lint | `eslint` per package, using each package's own lint script | **0 errors** (pre-existing warnings only; **0 warnings in any new file**) |
| Tests | `pnpm --filter <pkg> test` for asterim, adapters, relay, mcp-memory-server, web | **37/37 suites pass** (20 + 1 + 1 + 7 + 8) |
| Build | `pnpm --filter … build` for all 7 packages | success (server `dist/index.js` 878.76 KB, web + marketing bundles built) |

Note on the CI commands: root `pnpm run typecheck` / `lint` / `test` / `build` (turbo) were blocked by this session's command-approval sandbox, so each gate was run per-package with the exact script each package's `package.json` defines. That is the same work turbo would dispatch.

Server suite count is now 20 (`GitWorktreeService.test.ts` added), giving the 37 monorepo suites the task specifies.

## 5. Acceptance Criteria Review

- [x] **1 — `GitWorktreeService` creates, diffs, merges and removes Git worktrees safely using native Git CLI commands.** `createWorktree`/`getDiff`/`mergeWorktree`/`removeWorktree` in `apps/server/src/services/git/GitWorktreeService.ts`, all via `GitProvider.exec` (`git worktree add|list|remove|prune`, `git diff`, `git merge`, `git branch -D`, `git update-ref`). Safety asserted: "the primary working tree is untouched" (4 assertions), "a dirty target is refused", "a branch that is not checked out is refused", "a conflicting merge is aborted, not left in the tree" (5 assertions incl. no `MERGE_HEAD` left behind), "a path that could break out of quoting is refused".
- [x] **2 — `AgentDelegationService` automatically runs subagents in isolated worktrees when requested.** `provisionWorktree` + `AgentService.resolveThreadWorkspace`. Asserted by "a delegated child runs in its own worktree" (the fake child writes to whatever directory its row names, and the project's copy is proven unchanged), "a review is not sandboxed", "isolation can be asked for and refused explicitly", "parallel children each get their own tree" (2 concurrent children, distinct sandboxes, distinct diffs, project untouched), "a project that is not a repository still delegates".
- [x] **3 — Subagent file modifications produce isolated Git diffs that return in `DelegationResult`.** `attachWorktreeChanges`; `result.changedFiles` = `['added.ts','app.ts']`, `result.diff` contains both the modification and the addition, and the sibling sandbox's content is proven absent from it ("nothing from the other sandbox leaks in").
- [x] **4 — REST endpoints `/api/v1/threads/:id/worktree` support inspection, merging and discarding.** `apps/server/src/routes/worktrees.ts`, registered in `index.ts`. 18 assertions in "the worktree REST surface": 401 for anonymous read and anonymous merge, 404 for an unknown thread, 200 + live diff for inspection, 200 + `worktree: null` for a thread with no sandbox, merge lands the change in the project with the operator's commit message, DELETE removes the checkout and clears the row, and a second DELETE is still 200.
- [x] **5 — `GitWorktreeService.test.ts` passes with comprehensive assertions in real temporary git repositories.** 111/111. Five real repos created per run (`git init`, real commits, real edits, real merges, real conflict), all removed in `cleanup()`. Covers creation, idempotence, isolation between two sandboxes, diffs (modified/untracked/committed/clean), merge-back, no-op merge, dirty-target and detached-HEAD refusals, conflict abort, removal + branch deletion + base-ref deletion, force-removal of a dirty sandbox, orphan cleanup with a live sandbox preserved, a hand-deleted sandbox being rebuilt, and the not-a-repository fallback.
- [x] **6 — Monorepo CI gates pass with 0 errors.** Typecheck 0 errors (7 packages); lint 0 errors; 37/37 test suites pass; build succeeds for all 7 packages. See § 4.

**Definition of Done**

- [x] `threads.worktree_path` / `threads.worktree_branch` added to the SQLite schema (ALTER-in-try, existing `~/.asterim/asterim.db` still opens — the delegation suite re-runs `new DatabaseService()` and asserts it)
- [x] Shared worktree types in `@asterim/shared`
- [x] `GitWorktreeService.ts` implemented
- [x] `AgentDelegationService` worktree isolation integrated
- [x] `/api/v1/threads/:id/worktree` REST endpoints registered
- [x] `GitWorktreeService.test.ts` created and passing
- [x] Monorepo CI gates pass cleanly

## 6. Git Diff Review

`git diff` reviewed file by file against every criterion. 11 files changed by this task (4 created, 7 modified) plus `apps/server/package.json`. No forbidden changes:

- Nothing in `blueprint/`, no architecture invented, no new dependency added — the service uses the existing `GitProvider` and the git CLI, and `simple-git` was not reached for.
- No GitHub/GitLab REST API use, no credential storage; every git call inherits `resolveGitEnv`.
- `.asterim/` is excluded via `.git/info/exclude` only; `.gitignore` is never written (asserted: "no .gitignore was created in the project").
- The repository's own working tree is clean of test artefacts — all suites use `os.tmpdir()` and remove their directories; no `.asterim` exists in this repo.
- `AgentService`'s change is a rename of one parameter plus one resolution call; all three existing call sites still pass `project.path` and behave identically for non-delegated threads.
- One pre-existing unrelated modification is present in the tree, `tests/report.md`, from the P7-06 gate. It is **not** part of this task and was left untouched and uncommitted.

## 7. Problems Discovered

1. **An existing delegation test depended on microtask timing.** "one delegation at a time per parent" set up its release callback assuming the child's brief was sent within a couple of microtasks of `delegateTask` being called. Adding an `await` for sandbox provisioning (a `git rev-parse` subprocess) broke that. Rather than patch the test, the fix was to make the common case genuinely cheap: `provisionWorktree` short-circuits on a synchronous `fs.existsSync(<repo>/.git)` before spawning anything, so a project that is not a repository costs no subprocess at all. The test passes unmodified, and the feature costs nothing on workstations that do not use it.
2. **`RepositoryManager.isRepository` cannot be reused here.** It requires `.git` to be a *directory*; inside a worktree `.git` is a *file*, so a delegation launched from within one sandbox would have been told it was not in a repository. `GitWorktreeService.isRepository` uses `git rev-parse --is-inside-work-tree` instead.
3. **A sandbox that commits its own work diffs as empty against its own HEAD.** This is why the base commit is persisted as a git ref rather than recomputed; asserted by "a sandbox that committed its own work still diffs".
4. **`packages/adapters` has 32 pre-existing lint errors in root-level `test-*.js` debug scripts** — not reached by CI, because that package's lint script is `eslint src/`, not `eslint .`. Unrelated to this task; flagged, not touched.

## 8. Architectural Concerns

1. **Sandboxes are never garbage-collected automatically.** A completed delegation leaves its worktree on disk on purpose — that is what the operator reviews and merges — but nothing prunes them. `GitWorktreeService.pruneOrphans(repoPath, keepThreadIds)` is implemented and tested for exactly this, and deliberately *not* wired into startup: deciding which sandboxes an operator still wants is a product decision, not one to make silently. Recommend a P8 task that calls it from `StartupService` (or from `recoverDelegations`) with a documented retention rule.
2. **No dashboard surface yet.** The diff and the merge/discard decision are reachable only over REST. The `DelegationResult` now carries `diff`/`changedFiles`/`worktreePath` and rides the existing `delegation.completed` event, so the data is already at the client — a review panel is the natural next vertical.
3. **`mergeWorktree` refuses a target branch that is not checked out.** This is the safe reading of "merge into the target branch", but it means an operator who wants the work on a different branch must check it out first. If cross-branch merging is wanted, it should be an explicit Change Proposal, since any implementation touches the operator's checkout.
4. **Sandbox provisioning adds one `git worktree add` to the delegation start path** (a full checkout of the base commit). For a very large repository this is not free. `git worktree add` shares the object store so it is a checkout cost, not a clone cost, but a future task may want `--no-checkout` plus sparse checkout for large monorepos.

## 9. Recommended Next Step

**P8-02 — Automated Verification Pipelines over sandboxed worktrees:** run a project's own verification commands (lint / typecheck / build / test) inside a subagent's worktree when it finishes, and attach the result to `DelegationResult` alongside the diff — so a parent is handed "the child changed these files and the build still passes" rather than a claim. The sandbox is the piece that makes this safe to do; it is now in place. Sandbox retention/pruning (§ 8.1) should be folded into the same phase.
