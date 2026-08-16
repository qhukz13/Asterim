Task-ID: P8-02
Phase: 8

# [P8-02] — Automated Verification Pipelines over Sandboxed Worktrees

**Task ID:** P8-02  
**Phase:** Phase 8 — Automated Verification Pipelines & Worktree Sandboxing  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-17  

---

## 1. Objective

Implement the Automated Verification Pipeline engine in `apps/server`: author `VerificationPipelineService.ts` to automatically discover, configure, and execute verification commands (typecheck, lint, test, build, or custom project pipeline steps) within a subagent's sandboxed worktree or project working directory. Integrate automated verification into `AgentDelegationService` so subagent completions produce factual `VerificationPipelineReport` execution evidence alongside Git diffs, expose REST verification triggers at `/api/v1/threads/:id/worktree/verify`, integrate sandbox orphan retention pruning, and author comprehensive unit tests.

---

## 2. Why This Task Exists

With P8-01, delegated subagents execute in isolated Git worktrees (`.asterim/worktrees/<threadId>`), preventing concurrent file collisions and dirtying of the parent workspace.

However, parents and operators currently only receive file diffs and subagent text summaries. Subagents may claim that "all tests pass and types are clean" when syntax errors, broken imports, or test regressions exist.

Automated Verification Pipelines close the trust gap:
1. **Factual Verification**: Asterim autonomously runs the project's actual typechecker, linter, tests, and build inside the subagent's isolated worktree before the task is concluded.
2. **Zero Pollution**: Verification commands execute entirely inside the isolated sandbox directory, producing no temporary build artifacts in the operator's primary tree.
3. **Structured Evidence**: `DelegationResult` receives a structured `VerificationPipelineReport` (`passed`, `steps`, `exitCode`, `stdoutSummary`, `durationMs`) which is formatted into the parent agent's brief and exposed via REST/UI.
4. **Lifecycle Hygiene**: Safe orphan pruning prevents disk accumulation of abandoned worktree sandboxes.

---

## 3. Context & Architecture

- **Verification Pipeline Discovery**:
  - Auto-discovery inspects the target directory for project descriptors:
    - Node / JavaScript / TypeScript: inspects `package.json` `scripts` for standard lifecycle commands (`typecheck`, `lint`, `test`, `build`), detecting the package manager (`pnpm`, `npm`, `yarn`, `bun`).
    - Explicit Configuration: inspects `.asterim/verification.json` (or `.asterim/pipeline.json`) if present for custom multi-language commands (e.g. `cargo test`, `pytest`, `go test`).
  - Safe Execution:
    - Executes steps sequentially via `child_process.spawn` / `exec` with per-step timeouts (default 60s, configurable), environment variable inheritance, and non-blocking stream capture.
    - Output bounds: captures and truncates stdout/stderr per step (capped at 50,000 characters) to prevent memory inflation.
    - Resilience: unhandled exceptions, non-zero exits, or killed processes fail the step cleanly and report `passed: false` without crashing Asterim Core.
- **Delegation Integration**:
  - `DelegationRequest` supports `verifyPipeline?: boolean` (defaults to `true` for `TASK` delegations with an active worktree).
  - On subagent session completion, `AgentDelegationService` triggers `verificationPipelineService.runPipeline(worktreePath)` before returning the result.
  - `DelegationResult` carries `verificationReport?: VerificationPipelineReport`.
  - `formatDelegationReport` includes a `VERIFICATION:` summary section.
- **REST Surface**:
  - `POST /api/v1/threads/:id/worktree/verify` — manually execute verification in the thread's worktree.
  - `GET /api/v1/threads/:id/worktree/verify` — get latest verification report for thread.
- **Worktree Orphan Retention**:
  - Wire `GitWorktreeService.pruneOrphans(repoPath, activeThreadIds)` into `StartupService` / `recoverDelegations` to clean up unreferenced sandboxes safely without touching active delegations.

---

## 4. Implementation Scope

1. **Shared Types (`packages/shared/src/types/verification.ts` & `delegation.ts`)**:
   - Define `VerificationStep`: `name`, `command`, `timeoutMs?`.
   - Define `VerificationStepResult`: `name`, `command`, `passed`, `exitCode`, `durationMs`, `stdoutSummary?`, `stderrSummary?`, `error?`.
   - Define `VerificationPipelineReport`: `passed: boolean`, `totalSteps: number`, `passedSteps: number`, `failedSteps: number`, `durationMs: number`, `steps: VerificationStepResult[]`, `executedAt: number`, `cwd: string`.
   - Extend `DelegationRequest` with `verifyPipeline?: boolean`, `verificationSteps?: string[]`.
   - Extend `DelegationResult` with `verificationReport?: VerificationPipelineReport`.
   - Export from `packages/shared/src/index.ts`.

2. **`VerificationPipelineService.ts` (`apps/server/src/services/verification/VerificationPipelineService.ts`)**:
   - `discoverPipeline(targetDir: string)`: inspects directory for `.asterim/verification.json` or `package.json` scripts, returning ordered `VerificationStep[]`.
   - `runStep(step: VerificationStep, targetDir: string, timeoutMs?: number)`: executes command in `targetDir` with timeout and output capture.
   - `runPipeline(targetDir: string, options?: { steps?: string[]; timeoutMs?: number })`: executes all discovered or specified steps, returning `VerificationPipelineReport`.
   - Safe execution guards against command injection, missing binaries, and hung processes (escalating SIGTERM -> SIGKILL).

3. **Integration with `AgentDelegationService.ts`**:
   - In `runDelegation`: after child session finishes and if `verifyPipeline` is enabled (and worktree/target exists), execute `verificationPipelineService.runPipeline`.
   - Attach `verificationReport` to `DelegationResult`.
   - Update `formatDelegationReport` to format verification results into the brief returned to the parent agent.

4. **REST Endpoints (`apps/server/src/routes/worktrees.ts` or `routes/verification.ts`)**:
   - `POST /api/v1/threads/:id/worktree/verify` — runs verification pipeline in thread's worktree sandbox and returns report.
   - `GET /api/v1/threads/:id/worktree/verify` — returns cached or latest verification report.

5. **Sandbox Retention Pruning Integration**:
   - Wire `gitWorktreeService.pruneOrphans` during `recoverDelegations` on server startup so abandoned worktrees from killed processes are reclaimed.

6. **Unit & Integration Tests (`apps/server/src/services/verification/__tests__/VerificationPipelineService.test.ts`)**:
   - Test auto-discovery from `package.json` (pnpm/npm/yarn/bun).
   - Test custom config via `.asterim/verification.json`.
   - Test passing steps, failing steps (non-zero exit code), and timed-out steps.
   - Test execution inside real temporary directories and Git worktree sandboxes.
   - Test delegation integration asserting `DelegationResult.verificationReport` populated.
   - Wire into `apps/server/package.json` `"test"` script (20 → 21 server test suites).

---

## 5. Explicitly Forbidden Changes

- Do NOT invent external SaaS dependencies or network services.
- Do NOT modify the primary repository files during sandbox verification.
- Do NOT delete active worktrees during orphan pruning.
- Do NOT break any of the existing 37 test suites.

---

## 6. Acceptance Criteria

1. `VerificationPipelineService` automatically discovers verification commands from `package.json` or custom `.asterim/verification.json` configuration.
2. `VerificationPipelineService` executes verification steps sequentially with per-step timeouts, process management, and structured output capture.
3. `AgentDelegationService` automatically runs verification in a subagent's sandboxed worktree upon task completion and attaches `VerificationPipelineReport` to `DelegationResult`.
4. REST endpoint `POST /api/v1/threads/:id/worktree/verify` supports on-demand execution of verification pipelines with authenticated access control.
5. Orphan worktree pruning is safely wired into server startup/recovery.
6. `VerificationPipelineService.test.ts` passes with comprehensive assertions in real temporary directories.
7. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test` (38 test suites), `pnpm run build`.

---

## 7. Definition of Done

- [ ] Shared verification types in `@asterim/shared`
- [ ] `VerificationPipelineService.ts` implemented with auto-discovery and bounded step execution
- [ ] `AgentDelegationService` integrated with automated sandbox verification
- [ ] REST verification endpoints implemented and registered
- [ ] Orphan worktree pruning wired into startup lifecycle
- [ ] `VerificationPipelineService.test.ts` created and passing
- [ ] Monorepo CI gates pass cleanly (38/38 test suites, 0 lint errors, 0 typecheck errors, build succeeds)

---

## 8. Verification Commands

```bash
# Run new Verification Pipeline test suite
pnpm --filter asterim exec tsx src/services/verification/__tests__/VerificationPipelineService.test.ts

# Run Git Worktree and Delegation test suites
pnpm --filter asterim exec tsx src/services/git/__tests__/GitWorktreeService.test.ts
pnpm --filter asterim exec tsx src/services/ai/__tests__/AgentDelegationService.test.ts

# Run full monorepo CI pipeline
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 9. Self-Review Requirements

Execute the mandatory Claude Code self-review cycle:
1. Inspect git diff (`git diff`) before declaring complete.
2. Check every acceptance criterion against real test assertions.
3. Confirm zero regressions across all existing test suites.

---

## 10. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
