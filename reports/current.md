Task-ID: P10-01
Status: COMPLETE

# Execution Report: P10-01 — Native Desktop Daemon Management, System Tray & OS Notifications

**Task ID:** P10-01
**Phase:** Phase 10 — Desktop Distribution, Native Shell & Release Readiness
**Status:** IMPLEMENTED / VERIFIED
**Date:** 2026-08-17
**Author:** Claude Code

---

## 1. Summary

The Native Desktop Daemon subsystem is implemented in `apps/server` with its contract in
`@asterim/shared`. The Core now raises native OS toast notifications for the three moments that
block or surprise a developer (approval gate, delegation finished, verification pipeline failed),
generates cross-platform system-tray state and menu rows, configures auto-start on OS login on all
three platforms, and exposes the whole thing over authenticated REST under `/api/v1/desktop/`.

A new 207-assertion suite covers it. The monorepo now has **42 test suites** (server 24, web 9,
mcp-memory-server 7, adapters 1, relay 1) and all four CI gates — typecheck, lint, test, build —
pass with 0 errors.

No native binary dependency was added; every platform is driven through a CLI it already ships
(`notify-send` / `kdialog`, `osascript`, `powershell.exe`, `reg`, `open`, `xdg-open`, `explorer.exe`),
invoked through `execFile` with argv arrays so no notification text ever reaches a shell.

---

## 2. Files Changed

| File | Status | Purpose |
| :--- | :--- | :--- |
| `packages/shared/src/types/desktop.ts` | created | The desktop contract: `DesktopStatus`, `DesktopTrayStatus`, `DesktopNotificationInput`, `DesktopLaunchCommand`, tray menu / response shapes, and the platform-entry constants (HKCU Run key, `io.asterim.desktop.plist`, `asterim.desktop`). |
| `packages/shared/src/index.ts` | modified | Re-exports `./types/desktop`. |
| `apps/server/src/services/desktop/DesktopNotificationService.ts` | created | Cross-platform toast dispatch, headless/CI degradation, text sanitising + per-language escaping, per-type rate limiting, EventBus subscriptions. |
| `apps/server/src/services/desktop/DesktopDaemonService.ts` | created | Tray status/menu generation, native launchers (dashboard / data folder / log), login auto-start install-detect-remove for Registry / LaunchAgent / XDG. |
| `apps/server/src/routes/desktop.ts` | created | Six authenticated endpoints under `/api/v1/desktop/`. |
| `apps/server/src/index.ts` | modified | Registers `desktopRoutes` and calls `desktopNotificationService.initEventBusListeners()` alongside the other bus subscriptions, before the first request is served. |
| `apps/server/src/services/desktop/__tests__/DesktopDaemonService.test.ts` | created | 207 assertions across 20 sections. |
| `apps/server/package.json` | modified | Appends the new suite to the `test` script (23 → 24 server suites). |

---

## 3. Implementation Details

### 3.1 Notification dispatch

`buildNotificationCommands(input, platform)` is a **pure** function returning an ordered chain of
`DesktopLaunchCommand` candidates; `notify` walks the chain and stops at the first that exits zero.
That shape is what makes the Windows and macOS paths assertable from a Linux CI runner.

| Platform | Primary | Fallback |
| :--- | :--- | :--- |
| Linux | `notify-send --app-name Asterim --urgency <u> --expire-time <t> <title> <body>` | `kdialog --passivepopup` |
| macOS | `osascript -e 'display notification "…" with title "Asterim" subtitle "…"'` | — |
| Windows | `powershell.exe` driving the WinRT `ToastNotificationManager` | `powershell.exe` driving a `System.Windows.Forms.NotifyIcon` balloon |
| other | (none — reported as `UNSUPPORTED_PLATFORM`) | — |

Urgency is derived from the notification type via the shared `DESKTOP_NOTIFICATION_URGENCY` map —
`APPROVAL_REQUIRED` and `PIPELINE_FAILED` are `critical` and do not auto-expire.

**Injection safety.** Titles and bodies contain whatever an agent printed. Linux passes them as argv
elements (execFile, no shell), so metacharacters are inert. The two platforms whose CLI takes a
*script* get language-specific escaping — `escapeAppleScript` (backslash first, then `"`) and
`escapePowerShell` (`'` → `''`) — after `sanitizeNotificationText` folds whitespace and strips C0/DEL/C1
codepoints. All three are exported and directly asserted on with a hostile payload.

**Fail-safety.** `notify` resolves `false` and never rejects. Missing binary, non-zero exit,
malformed input, thrown runner — every one returns a reason. Bus handlers use `void this.notify(...)`
so a spawned process is never on the critical path of `eventBus.publish`.

**Rate limiting.** `NOTIFICATION_COOLDOWN_MS = 1500`, tracked per notification type. An agent raising
approval gates in a burst produces one toast, not twenty; an unrelated type is unaffected. The window
is claimed *before* the first attempt (so two events in one tick cannot both pass) and released if the
whole chain failed (so a total failure does not suppress the retry).

**Headless detection.** `ASTERIM_HEADLESS` is authoritative in both directions; otherwise `CI` truthy
→ headless, `unsupported` platform → headless, and Linux without `DISPLAY` *and* `WAYLAND_DISPLAY` →
headless. Read from `process.env` on every call, never cached at import.

### 3.2 EventBus wiring

Subscribed to the event names the Core **actually publishes** (see § 7):

- `agent.approval_request` → `APPROVAL_REQUIRED`
- `delegation.completed` → `PIPELINE_FAILED` when `result.verificationReport.totalSteps > 0 && !passed`, otherwise `DELEGATION_COMPLETED`
- `delegation.batch_completed` → `DELEGATION_COMPLETED` with the child count

`initEventBusListeners()` is idempotent.

### 3.3 Daemon service

- `getStatus(): DesktopStatus` — synchronous per spec. `autoStartEnabled` is a cached value refreshed by every `getAutoStart()` / successful `setAutoStart()`, because the truthful Windows answer requires spawning `reg` and a status read must not block on a child process. The REST route awaits `getAutoStart()` before reading, so the response is always fresh.
- `getTrayStatus()` — `ONLINE` / `PAUSED` (via `setPaused`) / `OFFLINE` (the session count could not be read). Assembled defensively one probe at a time: an unavailable MCP supervisor or vault costs its own field only, never the whole status. Carries active thread count (`SELECT COUNT(*) FROM sessions WHERE status='running'`), running MCP server count, vault badge, RSS in MB, uptime, and a composed tooltip label.
- `getTrayMenu()` — status header + Open Dashboard / Open Data Folder / View Server Log / Start at Login, each with an `enabled` flag rather than being hidden.
- Launchers — `openDashboard()` (URL → `cmd /c start ""` / `open` / `xdg-open`), `openDataDirectory()` (path → `explorer.exe` / `open` / `xdg-open`, creating `~/.asterim` at 0700 if absent), `openLogFile()` (returns `false` rather than launching when no log exists). All return `Promise<boolean>` rather than the spec's `Promise<void>` so the route can report success; this is a superset of the specified signature.
- Auto-start — `buildAutoStartPlan(platform, homeDir, argv)` is pure and returns either an entry file + contents or the `reg add`/`delete`/`query` argv triple:

| Platform | Mechanism |
| :--- | :--- |
| Windows | `reg add HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v Asterim /t REG_SZ /d "<cmdline>" /f`; the command line is re-quoted because the Run key holds one string the shell re-splits at login |
| macOS | `~/Library/LaunchAgents/io.asterim.desktop.plist` — `Label`, `ProgramArguments`, `RunAtLoad`, `ProcessType=Background`; argv XML-escaped so an `&` in a home path cannot produce a plist `launchd` silently refuses |
| Linux | `~/.config/autostart/asterim.desktop` — XDG entry with `Terminal=false`, `NoDisplay=true`, quoted `Exec` |
| other | `mechanism: 'none'` — a state, not a failure |

`setAutoStart` returns the state auto-start is *actually* in afterwards, and on an exception re-reads
rather than assuming, so a partial write can never be reported as a clean success.

### 3.4 REST surface

| Method | Route |
| :--- | :--- |
| GET | `/api/v1/desktop/status` |
| POST | `/api/v1/desktop/open-dashboard` |
| POST | `/api/v1/desktop/open-data-dir` |
| POST | `/api/v1/desktop/open-log` |
| POST | `/api/v1/desktop/notify` |
| POST | `/api/v1/desktop/autostart` |

All six require `request.user` (401 otherwise) — each POST causes a side effect on the operator's
physical desktop, so none may be reachable without a session. No route accepts a client-supplied
path: every launch target is computed by the Core, deliberately, so a session cannot become "open any
file on this machine with its default handler". `POST /notify` answers 200 with `dispatched:false,
skipped:'HEADLESS'` on a headless host — a skip is the designed behaviour, not a failed request.

`/open-log` is one endpoint beyond the five the task enumerates. It is required to reach the
specified `openLogFile()` method and the specified "View Server Log" tray action; without it that
part of § 4.3 would be unreachable from any surface.

---

## 4. Verification

Root scripts (`pnpm run typecheck|lint|test|build`) could not be invoked directly in this sandboxed
session — the harness declined the root/turbo command forms. Every workspace was therefore run
individually with `pnpm --filter <pkg> run <script>`, which is exactly what `turbo run <script>`
fans out to. All seven workspaces were covered.

### Typecheck — 0 errors

```
pnpm --filter @asterim/shared run typecheck              ✔ tsc --noEmit
pnpm --filter @asterim/adapters run typecheck            ✔ tsc --noEmit
pnpm --filter asterim run typecheck                      ✔ tsc --noEmit
pnpm --filter @asterim/web run typecheck                 ✔ tsc --noEmit
pnpm --filter @asterim/marketing run typecheck           ✔ tsc -b
pnpm --filter @asterim/relay run typecheck               ✔ tsc --noEmit
pnpm --filter @asterim/mcp-memory-server run typecheck   ✔ tsc --noEmit
```

### Lint — 0 errors

| Workspace | Result |
| :--- | :--- |
| asterim | 312 problems (0 errors, 312 warnings) |
| @asterim/web | 304 problems (0 errors, 304 warnings) |
| @asterim/adapters | 28 problems (0 errors, 28 warnings) |
| @asterim/marketing | 18 problems (0 errors, 18 warnings) |
| @asterim/mcp-memory-server | 12 problems (0 errors, 12 warnings) |
| @asterim/shared | 3 problems (0 errors, 3 warnings) |
| @asterim/relay | clean |

The new files contribute 14 warnings, all `@typescript-eslint/no-explicit-any` on Fastify
request/reply handler parameters and test-harness casts, matching the existing route and test files.
Two `no-useless-assignment` **errors** were introduced and fixed during self-review (see § 7).

### Test — 42/42 suites, 0 failing assertions

| Workspace | Suites | Result |
| :--- | :--- | :--- |
| asterim | 24 | all pass (was 23) |
| @asterim/web | 9 | all pass |
| @asterim/mcp-memory-server | 7 | all pass |
| @asterim/adapters | 1 | 29/29 |
| @asterim/relay | 1 | 71/71 |

New suite:

```
pnpm --filter asterim exec tsx src/services/desktop/__tests__/DesktopDaemonService.test.ts
→ 207/207 assertions passed
```

Full server run: 24 suites, every one reporting `N/N assertions passed`, no `FAIL`, no `UNCAUGHT`.

### Build — all 7 workspaces

```
@asterim/shared      ✔ tsc
@asterim/adapters    ✔ tsc
@asterim/web         ✔ vite + PWA (11 precache entries)
asterim              ✔ tsup → dist/index.js 987.10 KB, apps/web/dist copied to dist/web
@asterim/marketing   ✔ vite
@asterim/relay       ✔ tsc
@asterim/mcp-memory-server ✔ tsup
```

`grep -c desktop apps/server/dist/index.js` → 48, confirming the subsystem is in the shipped bundle.

### What the 207 assertions cover

Platform normalisation · text sanitising (newline folding, control-character stripping, truncation,
null input) · AppleScript and PowerShell escaping · the full command chain for all four platforms
including urgency and expiry · a hostile metacharacter payload on all three platforms · headless
detection (CI, no-display Linux, Wayland, `ASTERIM_HEADLESS` in both directions, unsupported
platform) · successful dispatch · fallback-after-primary-failure · total failure without throwing ·
rate limiting across a simulated clock, including per-type isolation and window release after total
failure · malformed input · all five EventBus paths plus the idempotence of `initEventBusListeners`
and the no-result case · auto-start plans for all four platforms including Windows command-line
quoting and XML/shell escaping of hostile home paths · **real** LaunchAgent and XDG entries written
to and removed from a temp home and read back · Windows `reg` driven through a recording runner in
both the present and absent cases, asserting no file was written · the no-mechanism platform · open
commands per platform · the daemon launching the right target for all three actions including the
missing-log case · unsupported-platform refusal without spawning · tray status with live numbers and
the paused state · full degradation when the database, supervisor and vault all throw · tray menu
rows and their enabled flags · the live `sessions` counter against real rows · and the REST surface
through `fastify.inject()` — 200s, response shapes, 400s, the headless notify contract, a real
auto-start round trip, all three launchers via a recording seam, and a 401 on every one of the six
routes with no launcher having run.

Two deliberate test-safety measures: `ASTERIM_HEADLESS=true` and `ASTERIM_SOVEREIGN_MODE=true` are
set before the first import, so the suite can never put a real toast on the operator's screen or open
a relay socket; and the REST auto-start round trip snapshots and restores any pre-existing login
entry, skipping entirely on Windows where a registry write has no equivalent restore. Verified after
the run that no `asterim.desktop` entry was left behind.

---

## 5. Acceptance Criteria Review

- [x] **1. `DesktopNotificationService` generates cross-platform notifications and safely degrades in headless/CI environments.** — `buildNotificationCommands` returns the documented chain for linux/darwin/win32 and `[]` for unsupported; asserted per platform including urgency, expiry, arg order and both fallbacks. Headless degradation asserted for `CI=true`, no-display Linux, `ASTERIM_HEADLESS` in both directions, and unsupported platforms, each returning `skipped:'HEADLESS'` with **zero** processes spawned. Total-backend-failure and malformed input return a reason rather than throwing.
- [x] **2. `DesktopDaemonService` opens browser, data folder, and log files using platform-native launch commands.** — `buildOpenCommand` asserted for all four platforms (`cmd.exe /c start ""` for Windows URLs, `explorer.exe` for Windows paths, `open`, `xdg-open`, `null`). End-to-end: the dashboard launch carries `http://localhost:4321` from `PORT`, the data folder launch carries the resolved data dir, the log launch carries `<dataDir>/server.log` and correctly refuses (`false`, nothing spawned) when no log exists.
- [x] **3. Auto-start configuration generates valid platform-native startup entries (Registry / LaunchAgent / XDG).** — Registry: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, `REG_SZ`, `/f`, with `"/opt/Asterim App/dist/index.js"` correctly quoted; add/delete/query all asserted. LaunchAgent: real plist written to `~/Library/LaunchAgents/io.asterim.desktop.plist`, containing the DOCTYPE, `ProgramArguments`, `RunAtLoad`, `Background`, one `<string>` per argv element, with `&`/`<`/`>` entity-escaped. XDG: real `~/.config/autostart/asterim.desktop` with `[Desktop Entry]`, `Type=Application`, `NoDisplay=true` and a quoted `Exec`. Enable → detect → re-enable → disable → detect round trips asserted on both file-based platforms; `mechanism:'none'` refuses rather than fakes.
- [x] **4. Authenticated REST endpoints under `/api/v1/desktop/` return accurate status and handle actions cleanly.** — All six routes exercised via `fastify.inject()`. `GET /status` returns the desktop status, tray status and 5 menu rows and is asserted to carry no vault envelope material. `POST /notify` returns 200 / `dispatched:false` / `skipped:'HEADLESS'` / `success:true` on a headless host, 400 with no title, and coerces an unknown type. `POST /autostart` 400s on a non-boolean and round-trips a real entry, reporting `entryPath`. The three launchers return `success:true` and are asserted to have launched the right target. Every one of the six returns **401** without `request.user`, with no launcher having run.
- [x] **5. `DesktopDaemonService.test.ts` passes with comprehensive cross-platform assertions.** — 207/207. Windows, macOS and Linux behaviour are all asserted from this Linux host via injected platform, plus the `unsupported` case; wired into `apps/server/package.json`'s `test` script.
- [x] **6. Monorepo CI gates pass with 0 errors: typecheck, lint, test (42 test suites), build.** — Typecheck 0 errors across all 7 workspaces. Lint 0 errors across all 7. Test: 42 suites (24 + 9 + 7 + 1 + 1), every assertion passing. Build: all 7 workspaces, server bundle 987.10 KB with the desktop code present. See § 4 for the caveat on how the root scripts were invoked.

### Definition of Done

- [x] Shared desktop types defined in `@asterim/shared` and exported from its index
- [x] `DesktopNotificationService.ts` implemented
- [x] `DesktopDaemonService.ts` implemented
- [x] REST routes `/api/v1/desktop/` registered in `index.ts` and tested
- [x] `DesktopDaemonService.test.ts` passing (207/207)
- [x] Monorepo CI gates pass cleanly

### Forbidden changes — respected

- [x] **No heavy native binary dependency.** No dependency was added to any `package.json`. Zero Electron, zero node-gyp, zero native addon. Only `node:child_process`, `node:fs`, `node:os`, `node:path`.
- [x] **Notification dispatch is asynchronous and fail-safe.** `notify` never rejects; every bus handler uses `void`; the default runner swallows both the rejection and the synchronous throw.
- [x] **The existing 41 test suites still pass.** All 41 pre-existing suites plus the 1 new one = 42, every assertion passing.

---

## 6. Git Diff Review

Reviewed `git status --short` and `git diff` line by line against the acceptance criteria.

Three files modified, four created. The modifications are minimal and additive:

- `apps/server/src/index.ts` — two import lines, one `fastify.register(desktopRoutes)` following the existing `console.log('[DEBUG] Registering …')` convention, and one `desktopNotificationService.initEventBusListeners()` placed beside the existing `projectMemoryService.initEventBusListeners()`. No existing line altered.
- `packages/shared/src/index.ts` — one export line appended.
- `apps/server/package.json` — one suite appended to the `test` script. No dependency added or changed.

No change to `DatabaseService` (no schema change was needed), the EventBus, auth/RBAC, the git subsystem, adapters, or any store. No blueprint rationale duplicated into code comments. No new files under `docs/`. No debug scripts added.

`tests/report.md` shows as modified in the working tree but was **already modified before this task
began** (it is in the session's opening `git status` snapshot). It is unrelated to P10-01 and was
deliberately left out of the commit.

---

## 7. Problems Discovered

1. **The task's event names do not match the codebase's.** § 4.2 names `agent:approval_required` and `verification.failed`. The Core actually publishes `agent.approval_request` (`ApprovalManager.ts:435`, and `PushService` already subscribes to exactly that string), and **there is no verification event on the EventBus at all** — `VerificationPipelineService` never publishes; its report rides on `DelegationResult.verificationReport` inside `delegation.completed`. The implementation subscribes to the real names and derives `PIPELINE_FAILED` from `result.verificationReport.passed === false`, which is the only place that fact is observable. `delegation.completed` matched the task exactly.

2. **`getStatus()` cannot be both synchronous and truthful about auto-start on Windows.** The spec asks for `getStatus(): DesktopStatus` including `autoStartEnabled`, but the only truthful Windows check is `reg query`, which is async. Resolved with a cache refreshed by `getAutoStart()`, and the REST route awaits that refresh before reading. Documented in the source.

3. **Two lint errors introduced and fixed during self-review.** `no-useless-assignment` on the `activeMcpServers` and `vault` try/catch initialisers in `getTrayStatus`; replaced with an `attempt(probe, fallback)` helper. Also removed an `eslint-disable` directive that the config reported as unused. Caught by running eslint on the new files before reporting, not after.

4. **A control-character class cannot safely be written as a regex literal here.** The first draft of `sanitizeNotificationText` used `/[ -…]/`, which landed in the file as raw control bytes. Rewritten as a codepoint filter (`stripControlCharacters`) so no control byte appears in the source at all. Verified with a byte-level grep.

5. **The test suite initially reconfigured the developer's real machine.** The REST auto-start case drives the real singleton, so it wrote (and would have deleted) a real `~/.config/autostart/asterim.desktop` — silently disabling auto-start for anyone who had it on, and on Windows writing an unrecoverable registry value. Fixed: snapshot-and-restore on POSIX, skip entirely on Windows.

6. **`CLAUDE.md` § Commands is stale on two points.** It states "There is **no test runner or test script anywhere in the repo**" and that CI runs only lint and build. Both are now false — there are 42 suites wired into `test` scripts across 5 workspaces, and `.github/workflows/ci.yml` runs typecheck → lint → test → build. Not corrected here, as editing `CLAUDE.md` is outside this task's scope.

---

## 8. Architectural Concerns

1. **Phase 10 in `blueprint/ROADMAP.md` does not describe this work.** The roadmap's Phase 10 is "AI Operating System Vision" — unified agent orchestration, distributed execution, autonomous lifecycle — described as "Architectural Vision / Strategic Direction (Ongoing)". This task is titled "Phase 10 — Desktop Distribution, Native Shell & Release Readiness", which is coherent product work but is not the Phase 10 the normative roadmap defines, and desktop daemon / tray / auto-start appears in no blueprint document. Per `AGENTS.md` § 1.3 this is a specification discrepancy: the roadmap should either gain a Desktop Distribution phase or this work should be filed under a phase that exists. Flagging rather than blocking, since the task itself is unambiguous and self-contained. **Recommend Antigravity author a Change Proposal against `blueprint/ROADMAP.md`.**

2. **There is no tray widget, and there cannot be one in this process.** Drawing a real tray icon needs a GUI toolkit, which needs a native addon, which § 5 forbids. What the Core owns is the tray *state and command set*; something has to render it. The natural next step is a dashboard "Workstation" card consuming `GET /api/v1/desktop/status` (the P9-03 vault status card is the precedent), with a packaged native shell later. `DesktopStatusResponse` was shaped for exactly that consumer.

3. **`setPaused()` has no caller.** The task's tray protocol requires an `ONLINE`/`PAUSED` distinction, so the state exists and is asserted, but nothing in the Core currently pauses itself. If "pause the Core" is intended to be a real product capability it needs its own task defining what pausing actually suspends (new sessions? the queue? the pipeline?); if not, the state should be dropped from the contract rather than left permanently `ONLINE`.

4. **`initLogger` ignores `ASTERIM_DATA_DIR`.** It writes to `~/.asterim/server.log` unconditionally while everything else honours the override. `logFilePath()` works around this by preferring the data-dir copy when one exists and falling back to the home-dir location. Worth fixing at the source in a later task rather than accumulating more workarounds.

5. **`DESKTOP_NOTIFICATION_URGENCY` is a policy the user cannot change.** Approval gates are `critical` and never auto-expire, which is right by default but will annoy someone. A per-type preference in settings is the obvious follow-up; the map is already in `@asterim/shared`, so it is a natural override point.

---

## 9. Recommended Next Step

**P10-02 — Workstation & Desktop Daemon UI**: a dashboard surface consuming `GET /api/v1/desktop/status`
— tray status card (Core state, active threads, MCP servers, vault badge, memory, uptime), the three
quick actions, and an auto-start toggle — following the P9-03 vault status card pattern and
`blueprint/DESIGN_SYSTEM.md`. That closes the vertical: the Core owns the state and commands, the
dashboard renders them, and the packaged native shell can adopt the same contract later.

In parallel, a Change Proposal reconciling `blueprint/ROADMAP.md` Phase 10 with the Desktop
Distribution work now shipping under that name (§ 8.1).
