Task-ID: P10-03
Status: COMPLETE

# Execution Report: P10-03 — Phase 10 Comprehensive Production Gate & Desktop Release Readiness Audit

**Task ID:** P10-03
**Phase:** Phase 10 — Desktop Distribution, Native Shell & Release Readiness
**Status:** VERIFIED
**Date:** 2026-08-17
**Author:** Claude Code
**Commit under audit:** `8e89347` (`pipeline: dispatch task P10-03`)
**Toolchain:** Node v24.13.1, pnpm 9.0.0, turbo 2.9.18, TypeScript 5.4

---

## 1. Summary

Phase 10's production gate was executed and `docs/phase10-production-gate.md` authored.
**Verdict: PASS — READY FOR NEXT PHASE.**

Both Phase 10 workstreams were re-audited against the code at `8e89347` rather than against their
own reports: P10-01 (native desktop daemon, tray state protocol, OS notifications, login auto-start,
`/api/v1/desktop/*`) and P10-02 (`useDesktopStore`, `DesktopDaemonCard`, settings integration). All
twelve acceptance criteria across the two workstreams hold.

All four monorepo quality gates were run live **per workspace**, so Turbo's cache could not replay a
prior run: 0 TypeScript errors across 7 packages, 0 ESLint errors across 7 packages, **43 suites /
5,297 assertions / 0 failures**, and a clean 7-package build. The Turbo aggregate form was run
afterwards for the record (11/11, 7/7, 9/9, 7/7 tasks).

Beyond the suites, a **live pass over the packaged standalone distribution** was executed, because
that is the one audited subsystem the 43 suites structurally cannot cover — none of them boots the
artefact `pnpm build` produces. Two Cores were spawned from `apps/server/dist/index.js` against
throwaway data directories on ephemeral ports, and driven over real HTTP: SPA serving and the `/api`
catch-all, the authentication boundary on all six desktop routes, a real pairing handshake, the live
tray protocol, the headless notification skip, input validation, and the property that no
client-supplied path is ever launched. **67/67 live checks passed.**

No product code was modified. No validation rule, error path or security boundary was weakened.
Eight observations are recorded in §8 of the gate document; none blocks the phase, and two warrant
an explicit orchestrator decision before a public release.

---

## 2. Files Changed

| File | Change | Purpose |
| :--- | :--- | :--- |
| `docs/phase10-production-gate.md` | **created** (the only committed change) | The authoritative Phase 10 sign-off: executive verdict, 25-row subsystem audit matrix, per-workstream acceptance-criteria audit for P10-01 and P10-02, full 43-suite census, 11 desktop invariant verifications, the live packaged-distribution pass, reproduction commands, 8 observations, sign-off table |
| `reports/current.md` | overwritten | This report |
| `scratch/p10-live-gate.ts` | created, **git-ignored** | Driver for the live pass over the packaged binary. `scratch/` is in `.gitignore` (line 51) and is part of no build, matching the P9-04 precedent (`scratch/p9-gate-live-check.ts`) |
| `scratch/p10-gate-run.sh` | created, **git-ignored** | Throwaway gate-runner scaffold, superseded by running each gate directly |

**No product source file, `package.json`, config or blueprint document was modified.**

---

## 3. Implementation Details

### 3.1 What the audit re-derived rather than inherited

Every matrix row cites a file and line read in this session. Specifically re-verified against source
rather than accepted from the P10-01/P10-02 reports:

- **The EventBus subscriptions are real events.** The P10-01 brief named `agent:approval_required`
  and `verification.failed`; neither exists. Grep against the publishers confirms the implementation
  subscribes to `agent.approval_request` (`ApprovalManager.ts:435`), `delegation.completed` and
  `delegation.batch_completed` (`packages/shared/src/types/delegation.ts:346,356`), and derives
  `PIPELINE_FAILED` from the `verificationReport` on a completed delegation. Same coverage, correct
  names — audited and accepted, recorded as observation §8.4.
- **Design-token compliance.** `DesktopDaemonCard.tsx` and `useDesktopStore.ts` were grepped for hex
  and `rgb`/`rgba` literals: **zero of each**. All seven referenced custom properties were confirmed
  to exist in `apps/web/src/styles/tokens.css`. One hex literal *was* introduced in
  `EnvironmentSettingsView.tsx:943` — observation §8.2.
- **Operator reachability.** `DeveloperSettings.tsx` is still imported by nothing; the card is
  reachable through the `Workstation Daemon` tab in `EnvironmentSettingsView.tsx:209,941`.
- **No new dependency.** `git diff HEAD~4 HEAD -- apps/*/package.json` touches only the two `test`
  script chains.

### 3.2 The live pass (`scratch/p10-live-gate.ts`, 67 checks)

The unit suites deliberately fake process launch and inject the platform — correct for a unit suite,
and it leaves the packaged artefact untested. The live driver closes that:

1. **Artefacts (7).** `dist/index.js`, `bin.asterim → ./dist/index.js`, `files:["dist"]`,
   `dist/web/index.html` containing a real root node, the hashed asset bundle, `sw.js`.
2. **The argv boundary, for real (2).** `execFile('/bin/echo', ['"; touch …; echo "'])` on this host:
   the argument came back intact and the sentinel file was never created — the shell-injection
   property proven with a real process rather than by inspecting a recorder.
3. **Packaged boot + SPA (14).** `apps/server/dist/index.js` spawned under `NODE_ENV=production`.
   `/` serves the dashboard; a deep client route serves **byte-identical** `index.html`; the hashed
   bundle is served as JavaScript; an unknown `/api` route is a JSON **404**, not the SPA shell; all
   six desktop routes answer **401** anonymously.
4. **Paired live status (22).** The real PIN was read from the Core's own `pairing_pin.txt`, exchanged
   at `POST /api/v1/auth/pair`, and used to read `GET /api/v1/desktop/status`. Platform, `isHeadless`,
   `dataDir` and `webUrl` all match this run exactly; tray state `ONLINE`; RSS > 0; uptime ≥ 0; vault
   `ENCRYPTED`; five menu rows in the declared order. The **raw HTTP body** carries neither the
   bearer token used to fetch it, nor a `vault:v1:` envelope, nor the PIN.
5. **Notify validation & headless skip (8).** Missing / whitespace-only title and non-string body all
   400; a valid call on a headless host is a **200 with `dispatched:false, skipped:'HEADLESS',
   success:true`**; an unrecognised `type` is coerced to `SYSTEM` rather than rejected.
6. **Autostart validation & no client path (5).** Missing and non-boolean `enabled` both 400;
   `POST /open-data-dir` with `{path:'/etc', target:'/etc/shadow'}` is accepted, ignored, and the
   Core answers about its own directory.
7. **Crash safety (4).** After every route was exercised, `/health` is still 200, the child is alive,
   `desktopRoutes` registered at boot, and no `[DesktopRoute]` failure was logged.
8. **The development posture (4).** A second Core under `NODE_ENV=development` serves
   `/api/v1/desktop/status` *and* `/api/v1/security/vault-status` without a token — evidencing that
   this is the shared `authMiddleware` fallback and not a desktop-route exemption (observation §8.1).

Both boots used throwaway `ASTERIM_DATA_DIR`s, removed afterwards, and forced `ASTERIM_HEADLESS=true`
so no check could put a real toast on the operator's screen.

---

## 4. Verification

Everything below was executed in this session. Nothing is quoted from a prior report.

### 4.1 Phase 10 specialised suites

```
pnpm --filter asterim exec tsx src/services/desktop/__tests__/DesktopDaemonService.test.ts
  → 207/207 assertions passed   (exit 0)

pnpm --filter @asterim/web exec tsx src/components/desktop/__tests__/DesktopDaemonUI.test.ts
  → 207/207 assertions passed   (exit 0)
```

### 4.2 Monorepo gates, per workspace (Turbo cache bypassed)

| Gate | Command | Result |
| :--- | :--- | :--- |
| Typecheck | `pnpm --filter "*" run typecheck` | **PASS** — shared, relay, marketing, web, adapters, server, mcp-memory-server all `Done`; **0 errors** |
| Lint | `pnpm --filter "*" run lint` | **PASS** — `0 errors` in all 7: shared 3 / adapters 28 / marketing 18 / web 309 / server 312 / mcp-memory-server 12 warnings = **682 warnings, 0 errors** |
| Test | `pnpm --filter "*" run test` | **PASS** — **43 suites, 5,297 assertions, 0 failures** |
| Build | `pnpm --filter "*" run build` | **PASS** — 7/7; web `✓ built in 7.53s` + PWA precache 11 entries; server `tsup` CJS `dist/index.js 987.10 KB` then `dist/web` copy; mcp-memory-server `dist/index.js 88.54 KB` |

### 4.3 Turbo aggregate form (the literal commands in the brief)

```
pnpm typecheck  → Tasks: 11 successful, 11 total
pnpm lint       → Tasks:  7 successful,  7 total
pnpm test       → Tasks:  9 successful,  9 total
pnpm build      → Tasks:  7 successful,  7 total
```

*(These four ran from a warm cache, which is why §4.2 was run first and uncached — the aggregate is
recorded for completeness, not as the evidence.)*

### 4.4 Suite census — 43 suites, 5,297 assertions

| Workspace | Suites | Assertions |
| :--- | :-: | ---: |
| `asterim` (server) | 24 | 2,995 |
| `@asterim/web` | 10 | 1,854 |
| `@asterim/mcp-memory-server` | 7 | 348 |
| `@asterim/relay` | 1 | 71 |
| `@asterim/adapters` | 1 | 29 |
| **Total** | **43** | **5,297** |

The per-suite breakdown is §4 of `docs/phase10-production-gate.md`. `@asterim/shared`,
`@asterim/marketing` and `@asterim/eslint-config` declare no `test` script.

### 4.5 Live pass over the packaged distribution

```
pnpm --filter asterim exec tsx ../../scratch/p10-live-gate.ts
  → 67/67 live checks passed
```

---

## 5. Acceptance Criteria Review

- [x] **1 — `docs/phase10-production-gate.md` is authored with complete subsystem audit matrices, workstream audits (P10-01 and P10-02) and verification evidence.**
  Created. Contains the executive verdict, a **25-row subsystem audit matrix** covering every
  subsystem the brief listed (daemon management, OS notifications engine, tray state protocol,
  auto-start lifecycle, desktop REST surface, shared domain contracts, workstation UI & operator
  controls, standalone binary packaging & SPA distribution), the per-workstream acceptance-criteria
  audit (§3.1 P10-01, §3.2 P10-02), the full test census (§4), 11 desktop invariant verifications
  (§5), the live packaged-distribution pass (§6), reproduction commands (§7), 8 observations (§8)
  and the sign-off table (§9).
- [x] **2 — Both Phase 10 workstreams (P10-01, P10-02) are audited and verified against their acceptance criteria.**
  Each brief was recovered from its dispatch commit (`git show ff079cb:tasks/current.md`,
  `git show c00c1a7:tasks/current.md`) and each criterion quoted and re-verified against source at
  `8e89347`. **P10-01: 6/6 PASS. P10-02: 6/6 PASS.** Two scope divergences in P10-01 (the brief's
  non-existent event names; a sixth route `open-log` beyond the five specified) are recorded,
  justified and accepted in §3.1.
- [x] **3 — 0 TypeScript compiler errors across all packages.**
  `pnpm --filter "*" run typecheck` — 7/7 packages `Done`, 0 errors. `pnpm typecheck` — 11/11 tasks.
- [x] **4 — 0 ESLint errors across all packages.**
  `pnpm --filter "*" run lint` — every workspace reports `0 errors`; 682 warnings, all pre-existing
  `no-explicit-any` / `no-unused-vars`. `pnpm lint` — 7/7 tasks.
- [x] **5 — All automated test suites pass with 0 failures (43 suites).**
  `pnpm --filter "*" run test` — 43 summary lines observed and tabulated (§4.4), 5,297 assertions,
  **0 failures**. Both Phase 10 suites at 207/207 individually (§4.1).
- [x] **6 — Monorepo production build succeeds cleanly.**
  `pnpm --filter "*" run build` — 7/7 packages, every artefact produced; `pnpm build` — 7/7 tasks.
  Additionally verified **beyond** the criterion: the produced binary boots and serves the SPA
  (§4.5).

### Definition of Done

- [x] `docs/phase10-production-gate.md` created and complete
- [x] Monorepo typecheck clean (0 errors)
- [x] Monorepo lint clean (0 errors)
- [x] Full test battery passing (0 failures, 43 suites)
- [x] Production build clean

---

## 6. Git Diff Review

`git status` before the audit: clean apart from `tests/report.md`. `git diff` was reviewed against
every acceptance criterion and every constraint in §5 of the brief.

- **Committed by this task: one file.** `docs/phase10-production-gate.md` (new), plus this report.
- **No product code touched.** No `.ts`/`.tsx` under `apps/` or `packages/`, no `package.json`, no
  config, no blueprint document, no `decisions.md` entry.
- **No desktop validation rule, error-handling path or security boundary weakened** — nothing in
  those files was edited at all.
- **No arbitrary docs created.** `docs/phase10-production-gate.md` is the exact path the brief
  specified; nothing else was added under `docs/`.
- **Nothing stray committed.** The two audit helpers live in `scratch/`, which `.gitignore:51`
  excludes and no build reads — the same arrangement as the P9-04 gate.
- **`tests/report.md` left untouched.** It carries the uncommitted P10-02 test-gate record from the
  prior verification session. It is not this task's artefact, so it was neither modified nor
  committed; it remains in the working tree for the orchestrator to dispose of.

---

## 7. Problems Discovered

1. **The desktop REST surface is only authenticated under `NODE_ENV=production`.** The first live
   run returned 200 to every anonymous desktop request. The cause is not in the desktop routes:
   `authMiddleware.ts:76` hands every `/api/v1/*` caller a fully-entitled `defaultDevUser` whenever
   `NODE_ENV !== 'production'`, and neither the `dev` nor the `build` script sets it. That posture is
   pre-existing and repo-wide — the live pass confirms `/api/v1/security/vault-status` behaves
   identically — but Phase 10 changes what it exposes: an unauthenticated caller on any interface
   (`index.ts:246` binds `::`) can now launch processes on the operator's desktop and write an OS
   login entry. The gate re-ran under `NODE_ENV=production`, where all six routes correctly 401.
   Recorded as observation §8.1 with a recommendation; **not fixed here**, because narrowing the
   auth fallback is an architectural change to a shared middleware and belongs in a task of its own.
2. **`initLogger` ignores `ASTERIM_DATA_DIR`.** `utils/logger.ts:48` writes to
   `os.homedir()/.asterim/server.log` unconditionally and truncates it on every start. Two
   consequences: the live driver's first attempt to read the child's boot log from its temp data
   directory found nothing (fixed in the driver by reading both locations), and **this audit's two
   live boots truncated and overwrote the workstation's own `~/.asterim/server.log`** — a
   development log, not data, but a real side effect worth stating plainly. No Phase 10 defect
   follows from it: `DesktopDaemonService.logFilePath:347` already checks the data directory first
   and falls back to `~/.asterim`, so `View Server Log` opens the right file either way. Recorded as
   observation §8.5.
3. **`PairingService` writes `pairing_pin.txt` to `process.cwd()`, not the data directory**
   (`PairingService.ts:82`). The first live boot therefore dropped a PIN file into `apps/server/dist/`.
   The driver now runs each child with its cwd set to its own temp data directory and removes any
   stray copy on start; `apps/server/dist/` was verified clean afterwards. `dist/` is git-ignored, so
   nothing leaked into the repository.
4. **`.claude/settings.json` does not allow the `pnpm run <script>` spelling.** The brief's literal
   commands (`pnpm run typecheck`, etc.) are rejected at the permission layer; the allowlist has
   `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` and `pnpm --filter *`. Both accepted
   spellings were run, which is strictly stronger than the brief asked for. The P10-02 report and the
   P10-02 test gate flagged the same friction — aligning the allowlist or the brief wording would
   settle it.
5. **`pnpm typecheck -- --force` does not do what it looks like.** The `--` forwards `--force` to the
   underlying script rather than to Turbo, so `tsc` receives it and fails with `TS5093`. The gates
   were instead run per workspace (`pnpm --filter "*" run …`), which bypasses the Turbo cache
   entirely and is the stronger form.

---

## 8. Architectural Concerns

Full detail in §8 of `docs/phase10-production-gate.md`. Ranked by what needs a decision:

1. **The `NODE_ENV` auth fallback (§8.1).** Worth an explicit decision before any public release:
   either the packaged binary defaults to `NODE_ENV=production`, or the dev fallback is narrowed to
   loopback sources. The desktop routes raised the stakes; they did not create the gap.
2. **`EnvironmentSettingsView.tsx` design-token debt (§8.2).** 23 hex literals, one of them added by
   P10-02. Not fixed here — a single tokenised line among 22 raw ones is worse than either
   endpoint. Worth a dedicated one-pass migration task.
3. **`DeveloperSettings.tsx` is still orphaned (§8.3).** Two consecutive phase briefs have now named
   it as an integration point. Delete it or route to it before a third does.
4. **Brief-vs-code event naming drift (§8.4).** The P10-01 brief's event names were wrong and the
   error propagated into the P10-03 brief. A pass over the phase plan to quote real event names
   would stop it recurring.
5. **Tray status is pull-only (§8.6).** Fine for a polled card; a native tray shell will want a
   `desktop.status_changed` event rather than a shorter poll interval.
6. **`setPaused` has no writer (§8.7).** `PAUSED` is unreachable in production today. Deliberate and
   documented — recorded so it is not mistaken for dead code and deleted.
7. **`&&`-chained `test` scripts (§8.8).** A red run reports partial results. Repo-wide, long-standing.

---

## 9. Recommended Next Step

Phase 10 is signed off. Recommended sequence:

1. **Orchestrator review of this gate** against `docs/phase10-production-gate.md` and the diff (one
   new document).
2. **A hardening task for observation §8.1** — decide and implement the `NODE_ENV` / loopback policy
   for the authenticated REST surface. This is the only finding with a security dimension, it is
   cheap to fix, and it is the sort of thing that should not be discovered after a binary ships.
3. **Phase 11 dispatch.** The desktop vertical's natural continuation is the native shell that
   consumes the tray protocol P10-01 already publishes — the Core owns the state and the commands,
   and nothing renders them as an actual tray icon yet. A `desktop.status_changed` event (§8.6) and a
   writer for `setPaused` (§8.7) would land naturally with it.
4. **Optional housekeeping**, if the orchestrator wants it as its own task: the
   `EnvironmentSettingsView.tsx` token migration (§8.2) and the `DeveloperSettings.tsx` disposition
   (§8.3).
