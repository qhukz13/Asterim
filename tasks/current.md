# Current Task: SEC-01 — Sovereign Mode Air-Gap Switch & Environment Sanitization

**Task ID:** SEC-01  
**Phase:** Phase 5.4-S — Security Hardening Gate  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-14  

---

## 1. Objective

Implement the `ASTERIM_SOVEREIGN_MODE` air-gap switch to guarantee zero outbound network connections initiated by Asterim Core (`RelayClient`, `PushService`), and sanitize environment variable inheritance when spawning agent subprocesses in `ProcessManager.ts`.

---

## 2. Context & Architectural Decisions

* **DEC-028 (Data Sovereignty & Sovereign Mode Mandate)**:
  - When `ASTERIM_SOVEREIGN_MODE=true` (or `--sovereign`), Asterim must operate in a 100% air-gapped local workstation mode.
  - `RelayClient` must not open WebSocket connections to external cloud relays.
  - `PushService` must not send Web Push notifications to external push gateways.
  - `ProcessManager.ts` must scrub internal `ASTERIM_*` secrets before spawning child agent processes.

---

## 3. Repository Evidence & Relevant Files

Inspect:
* [`docs/phase5-4-s-security-audit.md`](file:///c:/Projects/Asterim/docs/phase5-4-s-security-audit.md) (SEC-003 and SEC-004)
* [`decisions.md`](file:///c:/Projects/Asterim/decisions.md) (DEC-028)
* [`apps/server/src/services/RelayClient.ts`](file:///c:/Projects/Asterim/apps/server/src/services/RelayClient.ts)
* [`apps/server/src/services/PushService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/PushService.ts)
* [`apps/server/src/routes/system.ts`](file:///c:/Projects/Asterim/apps/server/src/routes/system.ts)
* [`packages/adapters/src/sdk/ProcessManager.ts`](file:///c:/Projects/Asterim/packages/adapters/src/sdk/ProcessManager.ts)

---

## 4. Implementation Scope

1. **Sovereign Mode Helper (`apps/server/src/services/SovereignMode.ts`)**:
   - Exports `function isSovereignMode(): boolean`:
     - Returns `true` if `process.env.ASTERIM_SOVEREIGN_MODE === 'true'` or `process.argv.includes('--sovereign')`.
   - Expose `sovereignMode: boolean` on `GET /api/v1/system`.
2. **RelayClient Air-Gap Guard (`apps/server/src/services/RelayClient.ts`)**:
   - In `RelayClient.init()`:
     - Check `isSovereignMode()`. If `true`, log `[RelayClient] Sovereign Mode active: Cloud Relay connection disabled.` and return early without calling `io(this.relayUrl)`.
3. **PushService Air-Gap Guard (`apps/server/src/services/PushService.ts`)**:
   - In `PushService.sendPushNotification()`:
     - Check `isSovereignMode()`. If `true`, return early without making external HTTP requests.
4. **Environment Sanitization (`packages/adapters/src/sdk/ProcessManager.ts`)**:
   - When spawning PTY processes in `ProcessManager.start()`:
     - Scrub internal secrets from `process.env`:
       ```ts
       const cleanEnv = { ...process.env };
       for (const key of Object.keys(cleanEnv)) {
         // Preserve ASTERIM_DATA_DIR for local database resolution, strip internal tokens/configs
         if (key.startsWith('ASTERIM_') && key !== 'ASTERIM_DATA_DIR') {
           delete cleanEnv[key];
         }
       }
       ```
     - Pass `cleanEnv` combined with `options.env` to `pty.spawn`.
5. **Automated Verification**:
   - Unit tests in `apps/server/src/services/__tests__/SovereignMode.test.ts`:
     - Test that `isSovereignMode()` correctly detects env var and CLI flag.
     - Test that `RelayClient` does not connect when sovereign mode is active.
     - Test that `PushService` suppresses push notifications in sovereign mode.
   - Unit tests in `packages/adapters/src/sdk/__tests__/ProcessManager.test.ts`:
     - Test that internal `ASTERIM_*` secrets are stripped from child process environment while `ASTERIM_DATA_DIR` is preserved.

---

## 5. Explicitly Forbidden Changes

* Do **NOT** remove or break standard remote relay pairing when sovereign mode is `false` (default development mode).
* Do **NOT** introduce external telemetry or cloud dependencies.

---

## 6. Acceptance Criteria

1. Setting `ASTERIM_SOVEREIGN_MODE=true` completely disables outbound WebSocket connections in `RelayClient`.
2. `PushService` makes zero network requests when sovereign mode is active.
3. `ProcessManager` strips `ASTERIM_*` tokens (e.g. `ASTERIM_RELAY_URL`, `ASTERIM_LOOPBACK_TOKEN`) from child agent environments.
4. `GET /api/v1/system` returns `sovereignMode: true/false`.
5. All test suites pass and `pnpm run build` succeeds with 0 errors.

---

## 7. Verification Commands

```bash
pnpm --filter asterim exec tsx src/services/__tests__/SovereignMode.test.ts
pnpm --filter @asterim/adapters exec tsx src/sdk/__tests__/ProcessManager.test.ts
pnpm --filter asterim exec tsc --noEmit
pnpm --filter @asterim/adapters exec tsc --noEmit
pnpm run build
```

---

## 8. Required Report Format

Upon completion, write the execution result directly to `reports/current.md` using the standard format:
* **Task ID**: SEC-01
* **Status**: `IMPLEMENTED` / `VERIFIED` / `BLOCKED`
* **Summary**: Summary of Sovereign Mode air-gap guards and environment sanitization
* **Files Changed**: List of files created/modified
* **Tests / Verification**: Output of test suites and build commands
* **Problems Discovered & Concerns**: Any issues encountered
* **Recommended Next Step**: Confirmation to proceed with P5.4-03
