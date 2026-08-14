# Execution Report: P5.5-01 — Technical Debt, Security Hardening & CI Typecheck Integration

**Task ID:** P5.5-01  
**Phase:** Phase 5.5 — Hardening & Technical Debt Resolution  
**Status:** IMPLEMENTED & VERIFIED  
**Date:** 2026-08-14  
**Author:** Claude Code  

---

## 1. Summary

All six scope items are implemented and verified.

The four standing `tsc` errors in `apps/server` are resolved at the source — no `@ts-ignore`, no
`any`, no `tsconfig` relaxation — and `pnpm --filter asterim exec tsc --noEmit` now returns 0
errors. A `typecheck` task was added to `turbo.json` and to every TypeScript workspace, so
`pnpm run typecheck` gates all 7 packages (11 Turbo tasks including the `^build` prerequisites).

The device pairing PIN gained a real brute-force guard, moved out of the route and into
`PairingService`: per-client attempt accounting, exponential back-off (500ms → 1s → 2s → 4s), and a
15-minute lockout after 5 consecutive failures returning HTTP 429 with `Retry-After`. A new
52-assertion suite covers it, including a concurrency case that the first draft of the
implementation failed (see §7).

`pairing_pin.txt` is untracked and ignored, `~/.asterim` is created and enforced at `0700` with
`asterim.db` (and its WAL sidecars) at `0600`, and DEC-028 §3 now states the mDNS network boundary.

All 20 pre-existing Phase 5 suites still pass with 0 failures (1,488 assertions), plus the new
suite: **21 suites, 1,540 assertions, 0 failures**. `pnpm run build` passes 7/7.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `apps/server/src/controllers/AuthController.ts` | Modified | Import `OAuthCodeExchangeRequest` from `@asterim/shared` (the type existed; the import did not) |
| `apps/server/src/services/ai/providers/GeminiProvider.ts` | Modified | Correct `IAIProvider` import path (`./` → `../`) |
| `apps/server/src/services/ContextService.ts` | Modified | Use the real `ContextEntry.entryType` field; label falls back to `path`/`id` |
| `apps/server/src/sockets/socketManager.ts` | Modified | Add `registerSocketManager()` / `getSocketManager()` module accessors |
| `apps/server/src/index.ts` | Modified | Register the constructed `SocketManager` at the composition root |
| `apps/server/src/services/AgentService.ts` | Modified | Resolve the live socket layer through `getSocketManager()` |
| `apps/server/src/services/PairingService.ts` | Modified | Brute-force guard: attempt accounting, exponential back-off, lockout; constant-time PIN compare |
| `apps/server/src/routes/auth.ts` | Modified | `/api/v1/auth/pair` delegates to `attemptPairing()`; 429 + `Retry-After` on lockout |
| `apps/server/src/services/__tests__/PairingService.test.ts` | Created | 52-assertion suite for the guard and the REST route |
| `apps/server/src/services/DatabaseService.ts` | Modified | `enforceOwnerOnly()`: `0700` on the data dir, `0600` on `asterim.db` + WAL sidecars |
| `.gitignore` | Modified | Ignore `pairing_pin.txt` / `**/pairing_pin.txt`; correct the stale `.agentdeck` reference |
| `pairing_pin.txt` | Untracked | `git rm --cached` — live credential removed from Git |
| `apps/server/pairing_pin.txt` | Untracked | `git rm --cached` — live credential removed from Git |
| `packages/shared/tsconfig.tsbuildinfo` | Untracked | `git rm --cached` — build artifact already matched by `*.tsbuildinfo` |
| `packages/adapters/tsconfig.tsbuildinfo` | Untracked | `git rm --cached` — same |
| `turbo.json` | Modified | Add the `typecheck` task (`dependsOn: ["^build"]`) |
| `package.json` (root) | Modified | Add `"typecheck": "turbo run typecheck"` |
| `apps/server/package.json` | Modified | Add `"typecheck": "tsc --noEmit"` |
| `apps/web/package.json` | Modified | Add `"typecheck": "tsc --noEmit"` |
| `apps/relay/package.json` | Modified | Add `"typecheck": "tsc --noEmit"` |
| `apps/marketing/package.json` | Modified | Add `"typecheck": "tsc -b"` (project-references build, `noEmit` already set per project) |
| `packages/shared/package.json` | Modified | Add `"typecheck": "tsc --noEmit"` |
| `packages/adapters/package.json` | Modified | Add `"typecheck": "tsc --noEmit"` |
| `packages/mcp-memory-server/package.json` | Modified | Add `"typecheck": "tsc --noEmit"` (built by `tsup`, previously never typechecked) |
| `.github/workflows/ci.yml` | Modified | Add a `Typecheck` step ahead of Lint/Build — **outside the enumerated file list, see §8** |
| `decisions.md` | Modified | DEC-028 §3: mDNS network-boundary clarification |

## 3. Implementation Details

### 3.1 The four type errors

| Error | Root cause | Fix |
| :--- | :--- | :--- |
| `AuthController.ts:354` `Cannot find name 'OAuthCodeExchangeRequest'` | The interface exists in `packages/shared/src/types/auth.ts` and is re-exported by the package index; only the import statement was missing | Added to the existing `@asterim/shared` import list |
| `AgentService.ts:164` `Property 'socketManager' does not exist` | `socketManager.ts` exports only the `SocketManager` class. The singleton is a `const` local to `index.ts`, so the dynamic import destructured a name that never existed — this code path (`client.clear_chat`) threw at runtime | Module-level `registerSocketManager()` / `getSocketManager()`; `index.ts` registers the instance it constructs; `AgentService` calls `getSocketManager()?.clearRecentLogs(projectId)` |
| `ContextService.ts:109` `Property 'type' does not exist on ContextEntry` | The domain field is `entryType` (`packages/shared/src/events.ts:102`) | Use `entry.entryType`. `entry.label` is optional, so the heading also falls back to `entry.path` then `entry.id` instead of interpolating `undefined` into the assembled context window |
| `GeminiProvider.ts:2` `Cannot find module './IAIProvider'` | The interface lives one directory up, in `services/ai/` | `'../IAIProvider'` |

Registration is done explicitly from `index.ts` rather than assigning `this` inside the
`SocketManager` constructor: self-assignment tripped `@typescript-eslint/no-this-alias`, and the
composition root is the honest place for the wiring anyway.

### 3.2 Pairing brute-force guard

`PairingService` now owns the whole policy; `routes/auth.ts` only maps the result onto HTTP. The
route's previous ad-hoc `Map` (count ≥ 10, no delay, no lockout) is gone.

`attemptPairing(clientId, pin)` returns a discriminated union:

```ts
type PairingAttemptResult =
  | { status: 'paired';  token: string }
  | { status: 'invalid'; remainingAttempts: number }
  | { status: 'locked';  retryAfterMs: number };
```

Policy (defaults, all overridable through the constructor for tests):

- **Back-off** — an attempt following *n* failures waits `min(500ms · 2^(n−1), 8s)` before the PIN
  is compared: 0, 500ms, 1s, 2s, 4s.
- **Lockout** — the 5th consecutive failure locks the client for 15 minutes. While locked, every
  request is refused immediately (no delay paid, no token issued) even if the PIN is correct.
- **Reset** — a correct PIN clears the record. A record is also discarded once its lockout expires
  or its last failure falls outside the 15-minute window, so "consecutive" is time-bounded.
- **Isolation** — records are keyed by client identifier (the request IP); one locked client does
  not affect another.
- **Memory** — an attacker rotating source addresses would grow the map without bound, so entries
  that a read would discard anyway are swept once the map passes 1024 keys.

`validatePin` also moved from `===` to a length-checked `crypto.timingSafeEqual`.

HTTP surface of `POST /api/v1/auth/pair`:

| Case | Status | Body |
| :--- | :---: | :--- |
| Missing PIN | 400 | `{ error }` |
| Wrong PIN, budget left | 401 | `{ error, code: 'PAIRING_INVALID_PIN', remainingAttempts }` |
| Locked out | 429 | `{ error, code: 'PAIRING_RATE_LIMITED', retryAfterSeconds }` + `Retry-After` header |
| Correct PIN | 200 | `{ token }` |

### 3.3 Filesystem permissions (DEC-028)

`enforceOwnerOnly(target, mode)` in `DatabaseService.ts` chmods a path when its current mode
differs. The data dir is created with `mode: 0o700` and then enforced (which also repairs a
pre-existing `~/.asterim` created at `0755` by an older build); `asterim.db` is enforced at `0600`
after `DBSync` opens it, and the WAL sidecars (`-wal`, `-shm`, which hold the same data) after
`init()` creates them. It is a no-op on Windows, where these bits do not map onto ACLs, and it never
throws — a data directory on a filesystem that cannot express the mode must not stop the Core from
starting.

### 3.4 Turbo typecheck

`turbo.json` gains `"typecheck": { "dependsOn": ["^build"] }` — `apps/server` resolves
`@asterim/shared` through the package's emitted `dist/*.d.ts`, so upstream builds must run first.
`@asterim/marketing` uses `tsc -b` because it is a project-references root whose sub-projects
already set `noEmit: true`; every other package uses `tsc --noEmit`. `packages/config-eslint` has no
TypeScript and therefore no script — Turbo skips it.

## 4. Verification

Everything below was run from a clean tree after the final edit.

```
pnpm --filter asterim exec tsc --noEmit      → 0 errors
pnpm run typecheck                           → 11 successful, 11 total (7 typecheck + 4 build deps)
pnpm run build                               → 7 successful, 7 total
```

Suites — each run individually via `pnpm --filter <pkg> exec tsx <path>`, exit code and assertion
tally captured:

| Suite | Result |
| :--- | :--- |
| `asterim` MemoryRelevanceEngine | PASS 63/63 |
| `asterim` DecisionExtractor | PASS 60/60 |
| `asterim` routes/memory | PASS 140/140 |
| `asterim` routes/memory-candidates | PASS 52/52 |
| `asterim` routes/internal | PASS 51/51 |
| `asterim` GitDriftDetector | PASS 64/64 |
| `asterim` SovereignMode | PASS 21/21 |
| `asterim` ProjectMemoryService | PASS 231/231 |
| **`asterim` PairingService (new)** | **PASS 52/52** |
| `@asterim/mcp-memory-server` retrieval_tools | PASS 87/87 |
| `@asterim/mcp-memory-server` record_decision | PASS 82/82 |
| `@asterim/mcp-memory-server` dogfood_scenario | PASS 62/62 |
| `@asterim/mcp-memory-server` relay-client | PASS 23/23 |
| `@asterim/mcp-memory-server` relay_e2e | PASS 24/24 |
| `@asterim/mcp-memory-server` resolver | PASS 42/42 |
| `@asterim/mcp-memory-server` stdio_scaffold | PASS 28/28 |
| `@asterim/web` DecisionExplorer | PASS 151/151 |
| `@asterim/web` CandidateReview | PASS 37/37 |
| `@asterim/web` MemoryTimeline | PASS 134/134 |
| `@asterim/web` useMemoryStore | PASS 113/113 |
| `@asterim/adapters` ProcessManager | PASS 23/23 |

**21/21 suites pass, 1,540/1,540 assertions, 0 failures.** The 20 pre-existing suites account for
1,488 of those — exactly the GATE-P5 baseline, unchanged.

Permission verification (real `DatabaseService` construction against a scratch `ASTERIM_DATA_DIR`,
both on a fresh directory and on one pre-created at `0755`):

```
dir  : 700
db   : 600
wal  : 600
shm  : 600
```

Lint: `eslint` reports **40 errors in `apps/server`, all pre-existing**. Confirmed by linting a
detached worktree at `HEAD` (29d7f04): identical count, and none of the errors are in a file this
task touched. `socketManager.ts` briefly appeared in the list from my own first draft and was fixed
before final verification — the count went 41 → 40. See §7.

## 5. Acceptance Criteria Review

- [x] **1. `pnpm --filter asterim exec tsc --noEmit` passes with 0 errors** — verified; no
      `@ts-ignore`, no `any` cast, no `tsconfig` change (`strict` untouched).
- [x] **2. `pnpm run typecheck` succeeds across all workspace packages** — 11 Turbo tasks
      successful; `typecheck` script present in all 7 TypeScript workspaces.
- [x] **3. `POST /api/v1/auth/pair` enforces rate limiting and lockout, verified by automated unit
      tests** — `PairingService.test.ts`, 52/52. Route-level assertions drive the real Fastify
      handler with `app.inject`: four 401s then a 429 on the fifth failure, 429 thereafter even
      with the correct PIN, `Retry-After` present, `PAIRING_RATE_LIMITED` code, no token issued.
      Service-level assertions cover the back-off ladder `[500, 1000, 2000, 4000]`, per-client
      isolation, reset on success, cooldown expiry, stale-failure expiry, and a 10-request parallel
      burst.
- [x] **4. `pairing_pin.txt` untracked and ignored** — both copies removed with `git rm --cached`;
      `git check-ignore -v` matches them against `.gitignore:25`; `git status` shows them only as
      `!!` (ignored). The stale `.agentdeck` comment is corrected to `.asterim`. `*.tsbuildinfo`
      was already present in `.gitignore`.
- [x] **5. `DatabaseService` enforces `0700`/`0600`** — verified empirically (§4), including
      repair of a pre-existing `0755` directory.
- [x] **6. DEC-028 updated with the mDNS boundary** — `decisions.md`, DEC-028 §3, verbatim wording
      from the task.
- [x] **7. All 20 Phase 5 suites pass with 0 failures, `pnpm run build` succeeds** — 20/20 pass
      (1,488 assertions, matching the GATE-P5 baseline); build 7/7.

Definition of Done:

- [x] `tsc --noEmit` passes with 0 errors across the repository (all 7 packages via `turbo`)
- [x] `pnpm run typecheck` passes cleanly via Turbo
- [x] `pnpm run build` passes (7/7)
- [x] Pairing PIN brute-force unit tests pass (52/52)
- [x] All 20 Phase 5 test suites pass
- [x] Clean Git diff with no stray or tracked credential files

## 6. Git Diff Review

`git status` shows 22 modified files, 4 index deletions (`pairing_pin.txt` ×2,
`tsconfig.tsbuildinfo` ×2 — untracked, still present on disk as ignored files), and 1 new file
(`PairingService.test.ts`). Nothing else.

Reviewed against §6 Explicitly Forbidden Changes:

- **Loopback relay token / auth routes not weakened** — no change to `server.json`, `TokenService`,
  `authMiddleware`, `rbacGuard`, or `entitlementGuard`. The only auth-route change is the pairing
  endpoint, which became strictly *stricter* (5-failure lockout with delays, replacing a
  10-attempt counter with no delay and no lockout).
- **No `strict` relaxation** — no `tsconfig*.json` file is in the diff at all.
- **No schema change** — no `CREATE TABLE` / `ALTER TABLE` statement was touched; the
  `DatabaseService` diff is confined to the constructor and one new module-level function.

Diff hygiene: Prettier reformats large pre-existing regions of `auth.ts`, `DatabaseService.ts`, and
`socketManager.ts` (they were already non-compliant at `HEAD`), so I did not run it over those
files — instead I hand-matched the repo's `trailingComma: "none"` style in the lines I added, to
keep the diff free of unrelated reflow. `PairingService.ts` and the new test file are fully
Prettier-clean.

## 7. Problems Discovered

1. **`AgentService`'s socket import was a live runtime bug, not just a type error.** The dynamic
   `import('../sockets/socketManager')` destructured `socketManager`, which the module has never
   exported — so every `client.clear_chat` event threw `TypeError: Cannot read properties of
   undefined` inside the handler's try/catch, silently skipping the log-buffer clear. Fixing the
   type error fixes the behavior.

2. **My first implementation of the guard was bypassable by a parallel burst.** I initially charged
   the failure *after* awaiting the delay and comparing the PIN. Reviewing my own diff showed that
   *N* concurrent requests from one IP would all read the same failure count, all pay the same small
   delay, and collapse into a single recorded failure — turning "5 attempts per 15 minutes" into
   "unbounded guesses per 15 minutes", the exact attack the task exists to stop. The attempt is now
   charged before the `await`, and a 10-request burst is asserted to yield
   `[invalid ×4, locked ×6]`. This is the most important assertion in the new suite.

3. **`no-this-alias` on constructor self-registration.** Assigning `activeSocketManager = this`
   inside the `SocketManager` constructor introduced the repo's 41st lint error. Replaced with an
   explicit `registerSocketManager(socketManager)` call at the composition root.

4. **Clock coupling in the test harness.** The fake sleeper advances the fake clock, so the
   back-off consumed 7.5s of the 15-minute cooldown and made the cooldown-expiry assertions
   off-by-7500ms. The cooldown block now runs with `baseDelayMs: 0` so it measures only what it
   claims to measure.

5. **`PairingService` writes `pairing_pin.txt` into `process.cwd()`**, so any test that imports
   anything reaching the singleton drops a PIN file into `apps/server/`. The new suite `chdir`s
   into its temp directory to avoid it; the `.gitignore` entry now covers the rest.

## 8. Architectural Concerns

1. **`pnpm run lint` is red on `main`, and CI runs it.** `.github/workflows/ci.yml` runs
   `pnpm run lint` with no `continue-on-error`, and `HEAD` (29d7f04) fails it: 40 errors in
   `apps/server` and 24 in `@asterim/adapters` (mostly `no-empty`, `no-useless-assignment`,
   `preserve-caught-error`, one `no-this-alias`). This is outside P5.5-01's scope and I left it
   alone, but it means CI cannot currently be green, and the new Typecheck step will not be reached
   on a run that stops at Lint. Recommend a dedicated lint-debt task — most of the 64 are
   mechanical.

2. **I added the CI `Typecheck` step, which is outside §5's enumerated files.** The task title and
   objective call for "CI Typecheck Integration", and a `typecheck` task that CI never runs would
   not close the gap that motivated the task (`tsup` hiding type errors behind a green build), so I
   wired it in ahead of Lint and Build. It is a 4-line addition to `.github/workflows/ci.yml` and
   trivially revertible if Antigravity wants it deferred.

3. **I also untracked the two `tsconfig.tsbuildinfo` files.** They were tracked despite
   `.gitignore` already matching `*.tsbuildinfo` — the same class of hygiene defect as
   `pairing_pin.txt`, and the only actionable interpretation of scope item 3's mention of
   `*.tsbuildinfo`. Flagged here since it goes one file-pair beyond the literal instruction.

4. **The pairing lockout is in-memory and per-process.** It resets on server restart, which is the
   right trade-off for a PIN that is *also* regenerated on restart, but it is worth recording: an
   attacker who can crash-loop the Core resets the counter. The PIN changing at the same moment
   makes that a wash rather than an escalation.

5. **The client identifier is `request.ip`.** On a LAN this is the pairing device. If the pairing
   endpoint is ever exposed behind a proxy, Fastify's `trustProxy` must be configured or every
   client will share one bucket. Not a change I made — flagging it as a precondition for any future
   relay-side exposure of this route.

6. **`~/.asterim` is not the only sensitive path.** `packages/mcp-memory-server` opens the same
   database from a separate process; it inherits the tightened modes, since permissions live on the
   file. But `pairing_pin.txt` is still written world-readable into `process.cwd()`. Moving it into
   the (now `0700`) data directory, or chmodding it `0600`, would be the consistent follow-up —
   it was not in this task's scope.

## 9. Recommended Next Step

Two candidates, in priority order:

1. **Lint debt (`P5.5-02`)** — clear the 64 pre-existing ESLint errors across `apps/server` and
   `@asterim/adapters` so CI can actually go green. Without it, the Typecheck gate added here sits
   behind a step that always fails. Largely mechanical: empty `catch` blocks want an explicit
   comment or a logged warning, `preserve-caught-error` wants `{ cause: err }` on rethrows.
2. **Credential-file hardening** — move `pairing_pin.txt` into the `0700` data directory and write
   it `0600`, finishing the DEC-028 sweep that this task started on the database.

Neither blocks Phase 6 on type-safety grounds: the repository is 100% type-checked, the pairing
endpoint is no longer brute-forceable, and local data is owner-only.
