Task-ID: P8-01
Phase: 8

# [P8-01] — Git Worktree Sandboxing & Subagent Working Tree Isolation

**Task ID:** P8-01  
**Phase:** Phase 8 — Automated Verification Pipelines & Worktree Sandboxing  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-17  

---

## 1. Objective

Implement Git Worktree Sandboxing in `apps/server`: author `GitWorktreeService.ts` to provision, inspect, diff, and prune isolated subagent working trees (`.asterim/worktrees/<threadId>`), extend SQLite `threads` schema with worktree metadata, integrate worktree isolation into `AgentDelegationService` so subagents execute in dedicated file-system sandboxes without dirtying the parent's working copy, and author comprehensive unit tests in real temporary Git repositories.

---

## 2. Why This Task Exists

In Phase 7, Asterim established the Multi-Agent Delegation Protocol (`delegateTask`, `delegateParallel`). However, child subagents currently share the parent thread's primary repository working directory. 

When multiple subagents execute concurrently or when an experimental subagent modifies files, changes collide directly in the parent's working tree. Git Worktree Sandboxing provides physical file-system and Git branch isolation:
1. Each subagent operates on its own ephemeral worktree (`.asterim/worktrees/<threadId>`) branched from the parent's commit.
2. Concurrent subagents (e.g. from `delegate_parallel`) edit files simultaneously with zero Git index locking or file collision.
3. Subagent changes produce clean, isolated Git diffs that the parent or operator can review and merge with one click.

---

## 3. Context & Architecture

- **Git Worktree Primitives**:
  - `git worktree add <path> -b <branchName> <baseCommit>`: Creates an isolated directory sharing the primary repository's `.git/objects` and refs.
  - Ephemeral Branch Naming: `asterim/sandbox/<threadId>`.
  - Directory Path: `<projectRoot>/.asterim/worktrees/<threadId>`.
  - `git worktree remove --force <path>` & `git worktree prune`: Clean teardown.
- **Delegation Integration**:
  - `DelegationRequest` supports `isolateWorktree?: boolean` (defaults to `true` for `TASK` subagents when in a Git repository).
  - Child session `workingDirectory` is set to the provisioned worktree path.
  - On subagent completion, `GitWorktreeService.getDiff` captures the exact changes made and attaches them to `DelegationResult.diff`.

---

## 4. Implementation Scope

1. **Database Schema (`DatabaseService.ts`)**:
   - Add columns to `threads` table:
     ```sql
     ALTER TABLE threads ADD COLUMN worktree_path TEXT;
     ALTER TABLE threads ADD COLUMN worktree_branch TEXT;
     ```

2. **Shared Types (`packages/shared/src/types/worktree.ts` & `delegation.ts`)**:
   - `WorktreeInfo`: `threadId`, `path`, `branch`, `baseCommit`, `createdAt`, `status` (`ACTIVE` | `MERGED` | `PRUNED`).
   - Extend `DelegationRequest` with `isolateWorktree?: boolean`.
   - Extend `DelegationResult` with `diff?: string`, `changedFiles?: string[]`, `worktreePath?: string`.
   - Export from `packages/shared/src/index.ts`.

3. **`GitWorktreeService.ts` (`apps/server/src/services/git/GitWorktreeService.ts`)**:
   - `createWorktree(repoPath: string, threadId: string, baseCommit?: string)`:
     - Validates `repoPath` is a valid Git repository.
     - Provisions `<repoPath>/.asterim/worktrees/<threadId>` on branch `asterim/sandbox/<threadId>`.
     - Ensures `.asterim` is ignored in `.git/info/exclude` if not already present in `.gitignore`.
     - Returns `WorktreeInfo`.
   - `getDiff(worktreePath: string, baseCommit?: string)`:
     - Returns unified git diff of all staged and unstaged changes in the worktree against base commit.
     - Returns list of changed file paths.
   - `mergeWorktree(repoPath: string, threadId: string, targetBranch?: string)`:
     - Merges sandbox branch into the target branch.
   - `removeWorktree(repoPath: string, threadId: string)`:
     - Deletes worktree directory and deletes ephemeral branch `asterim/sandbox/<threadId>`.
     - Executes `git worktree prune`.

4. **Integration with `AgentDelegationService.ts`**:
   - Before launching child session: if `isolateWorktree` is true and project is a Git repository, call `gitWorktreeService.createWorktree`.
   - Set child `session.workingDirectory = worktree.path`.
   - On child session completion: capture diff via `gitWorktreeService.getDiff` and include in child summary.
   - Store `worktree_path` and `worktree_branch` on the child thread row.

5. **REST API Endpoints (`apps/server/src/routes/worktrees.ts`)**:
   - `GET /api/v1/threads/:id/worktree` — Get worktree metadata and live git diff for a thread.
   - `POST /api/v1/threads/:id/worktree/merge` — Merge subagent worktree changes into parent branch.
   - `DELETE /api/v1/threads/:id/worktree` — Discard and prune subagent worktree.
   - Register in `apps/server/src/index.ts`.

6. **Automated Unit Test Suite (`apps/server/src/services/git/__tests__/GitWorktreeService.test.ts`)**:
   - Test worktree creation in real temporary git repositories.
   - Test file modifications within worktree producing isolated diffs.
   - Test merge-back to main branch.
   - Test clean removal, branch deletion, and orphan cleanup.
   - Test fallback behavior if project is not a git repository.
   - Wire into `apps/server/package.json` `"test"` script.

---

## 5. Constraints & Forbidden Changes

- Do NOT corrupt or overwrite the primary repository's working tree during worktree creation or removal.
- Ensure `.asterim/worktrees/` is never committed to upstream Git tracking.
- Do NOT break any of the existing 36 test suites.

---

## 6. Acceptance Criteria

1. `GitWorktreeService` creates, diffs, merges, and removes Git worktrees safely using native Git CLI commands.
2. `AgentDelegationService` automatically runs subagents in isolated worktrees when requested.
3. Subagent file modifications produce isolated Git diffs that return in `DelegationResult`.
4. REST endpoints `/api/v1/threads/:id/worktree` support inspection, merging, and discarding worktrees.
5. `GitWorktreeService.test.ts` passes with comprehensive assertions in real temporary git repositories.
6. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test` (37 test suites), `pnpm run build`.

---

## 7. Definition of Done

- [ ] `threads.worktree_path` columns added to SQLite schema
- [ ] Shared worktree types in `@asterim/shared`
- [ ] `GitWorktreeService.ts` implemented
- [ ] `AgentDelegationService` worktree isolation integrated
- [ ] `/api/v1/threads/:id/worktree` REST endpoints registered
- [ ] `GitWorktreeService.test.ts` created and passing
- [ ] Monorepo CI gates pass cleanly

---

## 8. Verification Commands

```bash
# Run new Git Worktree Service test suite
pnpm --filter asterim exec tsx src/services/git/__tests__/GitWorktreeService.test.ts

# Run all git subsystem test suites
pnpm --filter asterim exec tsx src/services/git/__tests__/RemoteManager.test.ts
pnpm --filter asterim exec tsx src/services/git/__tests__/GitDriftDetector.test.ts

# Run full monorepo CI pipeline
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 9. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
