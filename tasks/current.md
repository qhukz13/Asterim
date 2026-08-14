# [P5.5-01] — Technical Debt, Security Hardening & CI Typecheck Integration

**Task ID:** P5.5-01  
**Phase:** Phase 5.5 — Hardening & Technical Debt Resolution  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-14  

---

## 1. Objective

Clear all standing pre-existing TypeScript compiler errors across `apps/server`, implement brute-force rate limiting and lockout protection on the device pairing PIN, untrack credential files from Git, enforce `0600`/`0700` local database permissions, and integrate a monorepo-wide `typecheck` task into `turbo.json`.

---

## 2. Why This Task Exists

The Phase 5 Production Gate (`GATE-P5`) verified the complete Project Memory and continuous governance subsystem with 1,488 passing assertions. However, 4 pre-existing `tsc` errors in `apps/server` and several local security gaps were identified:
- `tsup` bundles `apps/server` without running type checks, hiding type errors behind a passing build.
- The 6-digit pairing PIN endpoint has no rate limiting or lockout protection.
- Live `pairing_pin.txt` credential files are tracked in Git.
- `asterim.db` is created with default `0644` permissions instead of owner-only `0600`.

Resolving these issues ensures Asterim enters Phase 6 on a clean, secure, and 100% type-checked foundation.

---

## 3. Context

* **DEC-028**: Local-First Data Sovereignty. Local database files (`asterim.db`) and auth tokens must be restricted to owner-only permissions (`0600` / `0700`).
* **GATE-P5 Audit**: [`docs/phase5-production-gate.md`](file:///c:/Projects/Asterim/docs/phase5-production-gate.md) (§12 Security Findings and §13 Production Blockers).

---

## 4. Repository Evidence

Inspect:
* [`apps/server/src/controllers/AuthController.ts`](file:///c:/Projects/Asterim/apps/server/src/controllers/AuthController.ts#L354)
* [`apps/server/src/services/AgentService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/AgentService.ts#L164)
* [`apps/server/src/services/ContextService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/ContextService.ts#L109)
* [`apps/server/src/services/ai/providers/GeminiProvider.ts`](file:///c:/Projects/Asterim/apps/server/src/services/ai/providers/GeminiProvider.ts#L2)
* [`apps/server/src/services/PairingService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/PairingService.ts)
* [`apps/server/src/routes/auth.ts`](file:///c:/Projects/Asterim/apps/server/src/routes/auth.ts)
* [`apps/server/src/services/DatabaseService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/DatabaseService.ts)
* [`turbo.json`](file:///c:/Projects/Asterim/turbo.json)
* [`.gitignore`](file:///c:/Projects/Asterim/.gitignore)
* [`decisions.md`](file:///c:/Projects/Asterim/decisions.md) (DEC-028)

---

## 5. Implementation Scope

1. **Fix Server `tsc` Type Errors (`apps/server`)**:
   - `AuthController.ts:354`: Fix missing type definition / import for `OAuthCodeExchangeRequest`.
   - `AgentService.ts:164`: Correct reference to `socketManager` on module export.
   - `ContextService.ts:109`: Correct `type` property access on `ContextEntry` interface.
   - `GeminiProvider.ts:2`: Fix import path for `./IAIProvider` interface.
   - **Verification**: `pnpm --filter asterim exec tsc --noEmit` must return **0 errors**.

2. **Pairing PIN Brute-Force Rate Limiting (`PairingService.ts` & `routes/auth.ts`)**:
   - Implement attempt counter and progressive lockout in `PairingService`:
     - Track failed attempts by client identifier / IP.
     - Exponential delay (e.g. 500ms -> 1s -> 2s) and lockout after 5 consecutive failed attempts (15-minute cooldown).
     - Return HTTP 429 Too Many Requests with informative error message on lockout.
     - Reset failed attempt counter on successful pairing.
   - Add unit tests in `apps/server/src/services/__tests__/PairingService.test.ts` verifying rate limiting and lockout behavior.

3. **Untrack Credential Files & Git Hygiene (`.gitignore`)**:
   - Remove `pairing_pin.txt` and `apps/server/pairing_pin.txt` from Git tracking (`git rm --cached`).
   - Add `pairing_pin.txt`, `**/pairing_pin.txt`, and `*.tsbuildinfo` to `.gitignore`.
   - Correct the stale `.agentdeck` reference in `.gitignore` to `.asterim`.

4. **Owner-Only Filesystem Permissions (`DatabaseService.ts`)**:
   - When creating `dataDir` (`~/.asterim`), enforce directory permissions `0700` (`fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })`).
   - When creating or opening `asterim.db`, ensure file mode is set to `0600` (`fs.chmodSync(this.dbPath, 0o600)` on non-Windows/POSIX systems where applicable).

5. **Turbo & CI Typecheck Task (`turbo.json` & `package.json`)**:
   - Add `"typecheck"` task to `turbo.json`:
     ```json
     "typecheck": {
       "dependsOn": ["^build"]
     }
     ```
   - Add `"typecheck": "tsc --noEmit"` to `apps/server/package.json` and ensure all packages expose `typecheck`.
   - Add `"typecheck": "turbo run typecheck"` to root `package.json`.

6. **DEC-028 Clarification (`decisions.md`)**:
   - Update DEC-028 §3 to explicitly note:
     *"Sovereign Mode guarantees zero outbound external network connections from Asterim Core to remote cloud endpoints. Local subnet mDNS discovery (UDP 5353) remains active strictly for zero-config LAN device pairing and does not transmit project memory or telemetry data."*

---

## 6. Explicitly Forbidden Changes

* Do **NOT** weaken security on the loopback relay token (`server.json`) or auth routes.
* Do **NOT** remove or disable `strict` typechecking in `tsconfig.json`.
* Do **NOT** alter the SQLite database schema for project memory tables.

---

## 7. Acceptance Criteria

1. `pnpm --filter asterim exec tsc --noEmit` passes with **0 errors**.
2. `pnpm run typecheck` succeeds across all workspace packages in `turbo.json`.
3. `POST /api/v1/auth/pair` enforces rate limiting and lockout after repeated invalid PIN attempts (verified with automated unit tests).
4. `pairing_pin.txt` is untracked by Git and ignored in `.gitignore`.
5. `DatabaseService` enforces owner-only permissions (`0700`/`0600`) on `~/.asterim/` and `asterim.db`.
6. DEC-028 is updated with the local mDNS discovery boundary.
7. All 20 existing Phase 5 test suites continue to pass with 0 failures, and `pnpm run build` succeeds cleanly.

---

## 8. Definition of Done

- [ ] `tsc --noEmit` passes with 0 errors across entire repository
- [ ] `pnpm run typecheck` passes cleanly via Turbo
- [ ] `pnpm run build` passes (7/7)
- [ ] Pairing PIN brute-force unit tests pass
- [ ] All 20 Phase 5 test suites pass
- [ ] Clean Git diff with no stray or tracked credential files

---

## 9. Verification Commands

```bash
# Typecheck entire monorepo
pnpm run typecheck

# Verify server typecheck specifically
pnpm --filter asterim exec tsc --noEmit

# Run pairing security tests
pnpm --filter asterim exec tsx src/services/__tests__/PairingService.test.ts

# Re-run core Phase 5 verification suites
pnpm --filter asterim exec tsx src/services/memory/__tests__/MemoryRelevanceEngine.test.ts
pnpm --filter asterim exec tsx src/services/git/__tests__/GitDriftDetector.test.ts
pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/retrieval_tools.test.ts

# Full monorepo build
pnpm run build
```

---

## 10. Self-Review Requirements

- Inspect `git diff` to verify all 4 type errors are cleanly resolved without using `@ts-ignore` or `any` workarounds.
- Verify no `pairing_pin.txt` file remains in `git status`.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
