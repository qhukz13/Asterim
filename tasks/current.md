Task-ID: P10-01
Phase: 10

# [P10-01] — Native Desktop Daemon Management, System Tray & OS Notifications

**Task ID:** P10-01  
**Phase:** Phase 10 — Desktop Distribution, Native Shell & Release Readiness  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-17  

---

## 1. Objective

Implement the Native Desktop Daemon Management subsystem in `apps/server`: author `DesktopDaemonService.ts` and `DesktopNotificationService.ts` to manage native OS desktop notifications for human approval gates and delegation events, provide cross-platform system tray state generation (Windows, macOS, Linux), configure auto-start on OS login, expose desktop management REST endpoints, and author a comprehensive automated test suite.

---

## 2. Why This Task Exists

Asterim has built an enterprise-grade local-first multi-agent engineering platform: project memory, cross-agent MCP tooling, role profiles, Git worktree sandboxing, automated verification pipelines, and encrypted secret vaults.

However, running Asterim as a foreground terminal process is friction for everyday developer use. Developers require a background desktop service:
1. Native OS desktop toast notifications when an agent requests approval (`agent:approval_required`) or finishes a long-running batch delegation.
2. System tray / menu bar integration to monitor status, open the dashboard, inspect logs, or reveal `~/.asterim` in the native file explorer.
3. Configurable auto-start on user login so Asterim is always ready on the developer's workstation.

---

## 3. Context & Architecture

- **Cross-Platform OS Notifications**:
  - Windows: PowerShell WinRT / `ToastNotification` or native toast fallback.
  - macOS: `osascript` / `NSUserNotification` fallback.
  - Linux: `notify-send` / Freedesktop notification spec.
  - Non-blocking execution: notification dispatches must never block event loops or fail-crash on headless/CI systems.
- **System Tray Menu & Status Protocol**:
  - Real-time status model: Core state (`ONLINE` / `PAUSED`), active thread count, active MCP servers count, vault status (`ENCRYPTED`), memory usage.
  - Quick action commands: Open Dashboard in default browser, Open Data Folder in OS explorer (`explorer.exe` / `open` / `xdg-open`), View Server Log.
- **Login Auto-Start**:
  - Windows: HKCU Run registry key (`Software\Microsoft\Windows\CurrentVersion\Run`).
  - macOS: `~/Library/LaunchAgents/io.asterim.desktop.plist`.
  - Linux: `~/.config/autostart/asterim.desktop`.

---

## 4. Implementation Scope

1. **Shared Types (`packages/shared/src/types/desktop.ts`)**:
   - `DesktopStatus`: `isHeadless`, `platform`, `autoStartEnabled`, `trayStatus`, `activeAgentsCount`, `vaultEncrypted`, `webUrl`, `dataDir`.
   - `DesktopNotificationInput`: `title`, `body`, `type` (`APPROVAL_REQUIRED` | `DELEGATION_COMPLETED` | `PIPELINE_FAILED` | `SYSTEM`), `actionUrl?`.
   - Export from `packages/shared/src/index.ts`.

2. **`DesktopNotificationService.ts` (`apps/server/src/services/desktop/DesktopNotificationService.ts`)**:
   - `notify(input: DesktopNotificationInput): Promise<boolean>`:
     - Dispatches native OS notification using platform-appropriate commands without third-party native binary dependencies.
     - Gracefully degrades / skips in headless or CI environments (`ASTERIM_HEADLESS=true` or `CI=true`).
     - Subscribes to `EventBus` events (`agent:approval_required`, `delegation.completed`, `verification.failed`) to trigger notifications automatically.

3. **`DesktopDaemonService.ts` (`apps/server/src/services/desktop/DesktopDaemonService.ts`)**:
   - `getStatus(): DesktopStatus`: Assembles live desktop metrics (vault status, port, active sessions).
   - `openDashboard(): Promise<void>`: Launches system default browser pointing to the Web UI.
   - `openDataDirectory(): Promise<void>`: Reveals `~/.asterim` in native file manager.
   - `openLogFile(): Promise<void>`: Opens `server.log` in default text editor.
   - `setAutoStart(enabled: boolean): Promise<boolean>`: Configures or removes OS login auto-start entry.
   - `getAutoStart(): Promise<boolean>`: Checks if auto-start is configured.

4. **REST API Endpoints (`apps/server/src/routes/desktop.ts`)**:
   - `GET /api/v1/desktop/status` — Get desktop daemon status and metrics.
   - `POST /api/v1/desktop/open-dashboard` — Launch default browser.
   - `POST /api/v1/desktop/open-data-dir` — Reveal data folder in OS explorer.
   - `POST /api/v1/desktop/notify` — Test / dispatch desktop notification.
   - `POST /api/v1/desktop/autostart` — Toggle auto-start on login (`{ enabled: boolean }`).
   - Register in `apps/server/src/index.ts`.

5. **Automated Unit & Integration Test Suite (`apps/server/src/services/desktop/__tests__/DesktopDaemonService.test.ts`)**:
   - Test notification payload formatting and platform command generation.
   - Test headless / CI environment detection (skips execution without throwing).
   - Test auto-start path generation across Windows, macOS, and Linux.
   - Test REST route handlers with `fastify.inject()`.
   - Wire into `apps/server/package.json` `"test"` script.

---

## 5. Constraints & Forbidden Changes

- Do NOT add heavy native binary dependencies (e.g. Electron / node-gyp native addons) to `apps/server` (use pure Node.js + OS CLI wrappers for maximum portability).
- Notification dispatch must be completely asynchronous and fail-safe (a failed notification must never impact Core server stability).
- Do NOT break any of the existing 41 test suites.

---

## 6. Acceptance Criteria

1. `DesktopNotificationService` generates cross-platform notifications and safely degrades in headless/CI environments.
2. `DesktopDaemonService` opens browser, data folder, and log files using platform-native launch commands.
3. Auto-start configuration generates valid platform-native startup entries (Registry / LaunchAgent / XDG).
4. Authenticated REST endpoints under `/api/v1/desktop/` return accurate status and handle actions cleanly.
5. `DesktopDaemonService.test.ts` passes with comprehensive cross-platform assertions.
6. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test` (42 test suites), `pnpm run build`.

---

## 7. Definition of Done

- [ ] Shared desktop types defined in `@asterim/shared`
- [ ] `DesktopNotificationService.ts` implemented
- [ ] `DesktopDaemonService.ts` implemented
- [ ] REST routes `/api/v1/desktop/` registered and tested
- [ ] `DesktopDaemonService.test.ts` passing
- [ ] Monorepo CI gates pass cleanly

---

## 8. Verification Commands

```bash
# Run new Desktop Daemon test suite
pnpm --filter asterim exec tsx src/services/desktop/__tests__/DesktopDaemonService.test.ts

# Run all security & system test suites
pnpm --filter asterim exec tsx src/services/security/__tests__/SecretVaultService.test.ts

# Run full monorepo CI pipeline
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 9. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
