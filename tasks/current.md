Task-ID: P7-01
Phase: 7

# [P7-01] — Release Channels (Stable vs Development) & Runtime Data Isolation

**Task ID:** P7-01  
**Phase:** Phase 7 — Release Channels, Database Migration Engine & Runtime Isolation  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-18  

---

## 1. Objective

Implement Channel Runtime Isolation governed by `DEC-029`: introduce `ASTERIM_CHANNEL` (`stable` vs `dev`), dynamically resolve data directories (`~/.asterim` for Stable vs `~/.asterim-dev` for Development), isolate default ports and loopback connection descriptors (`server.json`), expose channel status via REST API, render a styled `[DEV-CHANNEL]` badge in the Web UI header during development runs, and author a comprehensive automated test suite.

---

## 2. Why This Task Exists

As established in `DEC-029` and the post-Phase-6 reconciliation, Asterim is both an active development project and a developer's daily-driver tool. 

Running development builds, running tests, or experimenting with new features against the default `~/.asterim/` directory risks clobbering production SQLite databases, schema migrations, and user credentials. Channel Runtime Isolation guarantees physical file-system, database, and port separation between Stable daily usage and Development experiments.

---

## 3. Context & Architecture (DEC-029)

- **Channel Determination**:
  - Explicit: `process.env.ASTERIM_CHANNEL` (`'stable'` | `'dev'`).
  - Fallback: If unset, defaults to `'dev'` when `process.env.NODE_ENV === 'development'`, and `'stable'` in production/packaged builds.
- **Data Directory Mapping**:
  - `stable` → `path.join(os.homedir(), '.asterim')` (or `ASTERIM_DATA_DIR` if explicitly passed).
  - `dev` → `path.join(os.homedir(), '.asterim-dev')` (or `ASTERIM_DATA_DIR` if explicitly passed).
- **Port & Descriptor Mapping**:
  - `stable` → Default Port `3000`, descriptor at `<dataDir>/server.json`.
  - `dev` → Default Port `3001` (or offset by +1), descriptor at `<dataDir>/server.json`.
- **UI State**:
  - Web UI inspects the active channel via `GET /api/v1/system/channel` or socket metadata and renders a distinct `[DEV-CHANNEL]` indicator in the top navbar when `channel === 'dev'`.

---

## 4. Implementation Scope

1. **Shared Channel Types & Constants (`packages/shared/src/types/channels.ts` & `packages/shared/src/constants/channels.ts`)**:
   - `AsterimChannel`: `'stable'` | `'dev'`.
   - `ChannelInfo`: `channel: AsterimChannel`, `dataDir: string`, `port: number`, `isDev: boolean`, `version: string`.
   - Constants: `DEFAULT_STABLE_PORT = 3000`, `DEFAULT_DEV_PORT = 3001`, `DATA_DIR_STABLE_NAME = '.asterim'`, `DATA_DIR_DEV_NAME = '.asterim-dev'`.
   - Export from `packages/shared/src/index.ts`.

2. **Channel & Data Directory Resolver (`apps/server/src/utils/channel.ts` & `DatabaseService.ts`)**:
   - `getAsterimChannel(): AsterimChannel`: Evaluates `process.env.ASTERIM_CHANNEL` and `process.env.NODE_ENV`.
   - `resolveDataDir(channel?: AsterimChannel): string`: Returns appropriate path based on channel and `ASTERIM_DATA_DIR`.
   - Update `DatabaseService.ts`, `ServerRegistry.ts`, `DesktopDaemonService.ts`, `SecretVaultService.ts`, and `SkillService.ts` to use the unified channel resolver.

3. **REST API Endpoint (`apps/server/src/routes/system.ts`)**:
   - `GET /api/v1/system/channel` — Returns `ChannelInfo`.
   - Log active channel and data directory on Core startup.

4. **Web UI Header Channel Badge (`apps/web/src/components/NavigationSidebar.tsx` / Header)**:
   - Display a subtle, styled amber/cyan `[DEV-CHANNEL]` pill in the top header or sidebar when connected to a development channel instance.

5. **Automated Unit & Integration Test Suite (`apps/server/src/services/__tests__/ChannelIsolation.test.ts`)**:
   - Test channel resolution for explicit `ASTERIM_CHANNEL=stable` vs `ASTERIM_CHANNEL=dev`.
   - Test fallback to `'dev'` when `NODE_ENV=development`.
   - Test `ASTERIM_DATA_DIR` override precedence over channel defaults.
   - Test directory creation with owner-only permissions (`0700`).
   - Test REST route `GET /api/v1/system/channel` returning accurate channel metadata.
   - Wire into `apps/server/package.json` `"test"` script.

---

## 5. Constraints & Forbidden Changes

- Do NOT break `ASTERIM_DATA_DIR` override support (existing test suites rely on temp directories).
- Do NOT modify user files in `~/.asterim` when running under `ASTERIM_CHANNEL=dev`.
- Maintain 100% test pass rate across all existing monorepo test suites.

---

## 6. Acceptance Criteria

1. `getAsterimChannel()` correctly identifies `stable` vs `dev` based on environment variables.
2. `resolveDataDir()` resolves `~/.asterim` for Stable and `~/.asterim-dev` for Development by default.
3. `GET /api/v1/system/channel` returns accurate channel and data directory metadata.
4. Web UI displays the `[DEV-CHANNEL]` badge when connected to a development backend.
5. `ChannelIsolation.test.ts` passes with comprehensive assertions.
6. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`.

---

## 7. Definition of Done

- [ ] Shared channel types and constants added to `@asterim/shared`
- [ ] `getAsterimChannel()` and channel-aware `resolveDataDir()` implemented
- [ ] Core services (`DatabaseService`, `ServerRegistry`, `SecretVaultService`, etc.) updated
- [ ] `GET /api/v1/system/channel` endpoint registered
- [ ] Web UI `[DEV-CHANNEL]` badge rendered
- [ ] `ChannelIsolation.test.ts` created and passing
- [ ] Monorepo CI gates pass cleanly

---

## 8. Verification Commands

```bash
# Run new Channel Isolation test suite
pnpm --filter asterim exec tsx src/services/__tests__/ChannelIsolation.test.ts

# Run all system routes & database tests
pnpm --filter asterim exec tsx src/services/__tests__/DatabaseService.test.ts

# Run full monorepo CI pipeline
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 9. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
