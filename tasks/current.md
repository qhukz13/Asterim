Task-ID: P10-02
Phase: 10

# [P10-02] — Workstation Desktop Daemon Dashboard UI & System Controls

**Task ID:** P10-02  
**Phase:** Phase 10 — Desktop Distribution, Native Shell & Release Readiness  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-17  

---

## 1. Objective

Implement the Workstation Desktop Daemon UI and system control components in `@asterim/web`: author `useDesktopStore.ts` to communicate with the Core desktop REST surface (`/api/v1/desktop/*`), build `DesktopDaemonCard.tsx` to render live daemon state (tray status, thread counts, MCP supervisor health, vault encryption badge, memory usage, uptime, OS login auto-start switch, and native launch actions), integrate into the workstation/settings views, and author a comprehensive automated test suite in `apps/web/src/components/desktop/__tests__/DesktopDaemonUI.test.ts`.

---

## 2. Why This Task Exists

Task P10-01 established the native desktop subsystem on the server, providing OS toast notifications, system tray menu state, launch command runners, and login auto-start configuration across Windows, macOS, and Linux.

To complete the vertical, developer operators need visibility and control directly from the Asterim Web Dashboard:
1. Monitoring whether the local desktop daemon is `ONLINE`, `PAUSED`, or `OFFLINE`, and checking memory footprint and active thread/MCP load.
2. Toggling login auto-start on/off with instant feedback.
3. Quick actions to reveal the `~/.asterim` data directory in the native file explorer, open the server log file, or test native OS notifications.

---

## 3. Context & Architecture

- **Shared Desktop Types (`@asterim/shared`)**:
  - Consume `DesktopStatus`, `DesktopTrayStatus`, `DesktopTrayMenuItem`, `DesktopNotificationType`, `DesktopActionResponse`, `DesktopNotifyResponse`, `DesktopAutoStartResponse` from `@asterim/shared`.
- **Core Desktop REST API (`apps/server/src/routes/desktop.ts`)**:
  - `GET /api/v1/desktop/status` — Returns `{ desktop: DesktopStatus, menu: DesktopTrayMenuItem[] }`.
  - `POST /api/v1/desktop/autostart` — Accepts `{ enabled: boolean }`, returns `DesktopAutoStartResponse`.
  - `POST /api/v1/desktop/open-data-dir` — Launches native file explorer for `~/.asterim`.
  - `POST /api/v1/desktop/open-log` — Opens `server.log` in native editor.
  - `POST /api/v1/desktop/notify` — Dispatches test notification `{ title, body, type }`.
- **UI Design System (`blueprint/DESIGN_SYSTEM.md`)**:
  - Use monochrome surfaces (`--color-surface-1`, `--color-surface-2`), standard borders (`--color-border-default`, `--color-border-subtle`), and semantic state colors (`--color-state-completed`, `--color-state-paused`, `--color-state-error`).
  - Follow the pure view + connected container component pattern established by `SecurityStatusCard.tsx` and `EnvironmentSecretsPanel.tsx`.

---

## 4. Implementation Scope

1. **Zustand Desktop Store (`apps/web/src/stores/useDesktopStore.ts`)**:
   - State:
     - `status: DesktopStatus | null`
     - `menu: DesktopTrayMenuItem[]`
     - `isLoading: boolean`
     - `isTogglingAutoStart: boolean`
     - `error: string | null`
     - `actionNotice: string | null`
   - Actions:
     - `fetchStatus(): Promise<void>`
     - `toggleAutoStart(enabled: boolean): Promise<boolean>`
     - `openDataDirectory(): Promise<boolean>`
     - `openLogFile(): Promise<boolean>`
     - `sendTestNotification(type?: DesktopNotificationType): Promise<boolean>`
     - `clearError(): void`
     - `clearNotice(): void`
   - Include authentication token (`asterim_token` from `localStorage`) on all requests.

2. **Desktop Daemon Card Component (`apps/web/src/components/desktop/DesktopDaemonCard.tsx`)**:
   - Pure View (`DesktopDaemonCardView`):
     - Displays Core tray state badge (`ONLINE` / `PAUSED` / `OFFLINE`) with descriptive status indicator.
     - Grid metrics: Platform (`win32` / `darwin` / `linux`), Active Threads count, Supervised MCP Servers count, Workstation Vault badge (`ENCRYPTED` / `PLAINTEXT` / `UNAVAILABLE`), Memory RSS (MB), Uptime (formatted as readable duration).
     - Headless / CI badge if `isHeadless` is true.
     - Auto-start toggle switch showing configured state and target platform mechanism (Registry / LaunchAgent / XDG).
     - Action buttons: "Reveal Data Directory", "View Server Log", "Test OS Notification".
     - Proper loading spinners, disabled states during pending actions, and error banner handling.
   - Connected Container (`DesktopDaemonCard`):
     - Binds to `useDesktopStore`, triggers `fetchStatus()` on mount, and wires callbacks.

3. **Settings & Workstation Integration**:
   - Mount `DesktopDaemonCard` in `apps/web/src/components/DeveloperSettings.tsx` and/or make it accessible in the Workstation / Environment settings surfaces so developers can easily monitor daemon status.

4. **Automated Unit & Component Test Suite (`apps/web/src/components/desktop/__tests__/DesktopDaemonUI.test.ts`)**:
   - Pure helper tests: tray status verdict mappings, uptime formatter, memory badge text.
   - Store action tests: verify `fetchStatus`, `toggleAutoStart`, `openDataDirectory`, `openLogFile`, and `sendTestNotification` against a mock `fetch` harness recording headers, HTTP methods, and payload bodies.
   - Static markup tests: verify rendering via `react-dom/server` across all states (`ONLINE`, `PAUSED`, `OFFLINE`, `isHeadless: true`, auto-start enabled/disabled, loading, error).
   - Wire the new suite into `apps/web/package.json` `"test"` script (raising web suites from 9 to 10, total suites from 42 to 43).

---

## 5. Constraints & Forbidden Changes

- Do NOT add heavy third-party UI dependencies.
- Do NOT hardcode colors (use CSS variables from `tokens.css`).
- Do NOT modify server-side files or break existing backend contracts.
- Do NOT break any of the existing 42 test suites across the monorepo.

---

## 6. Acceptance Criteria

1. `useDesktopStore.ts` handles desktop status fetching, auto-start toggling, and quick action dispatch with authenticated REST headers and error handling.
2. `DesktopDaemonCard.tsx` renders live daemon metrics (tray state, active threads, MCP servers, vault state, memory, uptime) and provides working controls for auto-start and quick actions.
3. Auto-start toggle accurately reflects server state and sends `POST /api/v1/desktop/autostart`.
4. Quick actions trigger respective endpoints (`open-data-dir`, `open-log`, `notify`) and display clear visual feedback.
5. `DesktopDaemonUI.test.ts` passes with comprehensive assertions covering helpers, store actions, and component rendering.
6. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test` (43 test suites), `pnpm run build`.

---

## 7. Definition of Done

- [ ] `useDesktopStore.ts` implemented in `apps/web/src/stores/`
- [ ] `DesktopDaemonCard.tsx` implemented in `apps/web/src/components/desktop/`
- [ ] Integrated into `DeveloperSettings.tsx` / workstation settings views
- [ ] `DesktopDaemonUI.test.ts` created and wired into `apps/web/package.json` test script
- [ ] Monorepo CI gates pass cleanly (typecheck, lint, 43 test suites, build)

---

## 8. Verification Commands

```bash
# Run new Desktop Daemon UI test suite
pnpm --filter @asterim/web exec tsx src/components/desktop/__tests__/DesktopDaemonUI.test.ts

# Run all web test suites
pnpm --filter @asterim/web run test

# Run full monorepo CI pipeline
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 9. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
