# Phase 10 Production Gate — Desktop Distribution, Native Shell & Release Readiness

**Gate ID:** P10-03
**Phase:** Phase 10 — Desktop Distribution, Native Shell & Release Readiness
**Date:** 2026-08-17
**Auditor:** Claude Code (Execution Engineer)
**Orchestrator:** Antigravity
**Governance:** `AGENTS.md`, `CLAUDE.md`, `blueprint/AI_CONTEXT.md`, `blueprint/DESIGN_SYSTEM.md`, `decisions.md` (DEC-026, DEC-028)
**Commit under audit:** `8e89347` (`pipeline: dispatch task P10-03`) — working tree clean apart from `tests/report.md`, the uncommitted P10-02 test-gate record carried over from the prior verification session and deliberately untouched by this audit
**Toolchain:** Node v24.13.1, pnpm 9.0.0, turbo 2.9.18, TypeScript 5.4

---

## 1. Executive Verdict

**PASS — READY FOR NEXT PHASE.**

Phase 10 delivers the desktop vertical across two workstreams: P10-01 put the Core's desktop
behaviour in the Core (tray state, native launchers, OS toasts, login auto-start, a REST surface),
and P10-02 gave it an operator surface in the dashboard. Every acceptance criterion of both
workstreams was re-checked against the code at `8e89347` rather than against the prior reports.

All four monorepo quality gates were executed live in this session, **per workspace so that Turbo's
cache could not replay a previous run**, because a gate audit that accepts a cached log is not
evidence:

| Gate | Command | Result |
| :--- | :--- | :--- |
| Typecheck | `pnpm --filter "*" run typecheck` | **PASS** — 7/7 packages, **0 TypeScript errors** |
| Lint | `pnpm --filter "*" run lint` | **PASS** — 7/7 packages, **0 errors** (682 warnings, all pre-existing `no-explicit-any` / `no-unused-vars`) |
| Test | `pnpm --filter "*" run test` | **PASS** — **43 suites, 5,297 assertions, 0 failures** |
| Build | `pnpm --filter "*" run build` | **PASS** — 7/7 packages, every artefact produced |
| Turbo aggregate | `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` | **PASS** — 11/11, 7/7, 9/9, 7/7 tasks |

Beyond the suites, a **live pass over the packaged standalone distribution** was executed (§6). This
is the gap the 43 suites structurally cannot close: `DesktopDaemonService.test.ts` drives the desktop
routes through `fastify.inject()` with an injected platform and a recording runner — the right shape
for a unit suite — and `DesktopDaemonUI.test.ts` renders through `react-dom/server` against a mock
`fetch`. Neither boots the artefact `pnpm build` produces. The live pass spawns
**`apps/server/dist/index.js` as a child process under `NODE_ENV=production`**, pairs with the real
PIN over the real HTTP surface, and asserts the SPA distribution, the `/api` catch-all, the
authentication boundary on all six desktop routes, the live tray protocol, the headless skip, input
validation, and that no client-supplied path is honoured. **67/67 live checks passed.**

No product code was modified by this audit. No desktop validation rule, error-handling path or
security boundary was weakened. Eight observations are recorded in §8; none blocks the phase, and
two of them (§8.1, §8.2) are worth an explicit decision from the orchestrator before a public
release.

---

## 2. Subsystem Audit Matrix

| # | Subsystem | Source of truth | Verdict | Evidence |
| :-: | :--- | :--- | :---: | :--- |
| 1 | **Desktop daemon management** | `DesktopDaemonService` (`apps/server/src/services/desktop/DesktopDaemonService.ts:275`) | **PASS** | One class, no GUI toolkit, no native addon. Every OS-specific decision is a pure exported function (`buildAutoStartPlan:186`, `buildOpenCommand:252`, `buildLaunchAgentPlist:139`, `buildXdgAutostartEntry:168`) taking the platform as an argument, so the Windows registry argv and the macOS plist are asserted from a Linux runner rather than assumed |
| 2 | **Crash isolation** | `getTrayStatus:522`, `launch:604`, `setAutoStart:425`, `attempt:616` | **PASS** | Nothing in the daemon layer throws. A database that cannot be read costs the thread count and downgrades the state to `OFFLINE` while the vault badge and the memory figure stay true; a launcher resolves a boolean; a failed auto-start write re-reads rather than assuming. Live §6.7 confirms the Core still answers `/health` after every desktop route has been exercised |
| 3 | **OS notifications engine** | `DesktopNotificationService` (`DesktopNotificationService.ts:253`), `buildNotificationCommands:162` | **PASS** | Three platforms, five commands, zero new dependencies — `notify-send` with a `kdialog` fallback, `osascript`, and PowerShell WinRT toast with a `NotifyIcon` balloon fallback. `notify` resolves `false` for every failure mode and `dispatch` wraps its whole body in a try/catch. Suite: 207 assertions |
| 4 | **Notification injection boundary** | `DESKTOP_APP_NAME` argv construction, `escapeAppleScript:141`, `escapePowerShell:146`, `stripControlCharacters:113`, `defaultRunner:470` | **PASS** | Commands are argv arrays handed to `execFile` — never a shell. The two platforms whose CLI takes a *script* rather than arguments get their interpolated values escaped for that specific language (backslash-then-quote for AppleScript, doubled `'` for PowerShell), with C0/DEL/C1 stripped and whitespace folded first, so a literal newline cannot terminate a script statement. Live §6.2 proves the `execFile` property on this host with a real process: an argument containing `"; touch …; echo "` came back as one argument and created nothing |
| 5 | **Headless / CI degradation** | `DesktopNotificationService.isHeadless:299`, `DesktopDaemonService.isHeadless:584` | **PASS** | `ASTERIM_HEADLESS` is authoritative in **both** directions, so a container with a forwarded display opts back in. Otherwise: any truthy `CI`, an unsupported platform, or a Linux host with neither `DISPLAY` nor `WAYLAND_DISPLAY`. Read on every call rather than cached, because the singletons are constructed at import time and predate anything a launcher sets. Live §6.5: a valid `POST /notify` on a headless host is **200 with `dispatched:false, skipped:'HEADLESS', success:true`** — a skip is the designed behaviour, not a failed request |
| 6 | **Notification rate limiting** | `NOTIFICATION_COOLDOWN_MS:68`, `dispatch:341` | **PASS** | Per notification *type*, so a delegation finishing is never suppressed by an unrelated approval storm. The window is claimed **before** the first attempt, so two approvals in the same tick cannot both pass the check while the first is still awaiting its child process, and it is released again if nothing was actually shown (`:383`) |
| 7 | **EventBus subscriptions** | `initEventBusListeners:402`, wired at `apps/server/src/index.ts:235` | **PASS** | Three subscriptions — `agent.approval_request` (`ApprovalManager.ts:435`), `delegation.completed` and `delegation.batch_completed` (`packages/shared/src/types/delegation.ts:346,356`) — every one a real event this Core publishes, verified by grep against the publishers rather than against the brief (see §8.1). Idempotent via `listenersRegistered`. Every handler dispatches with `void` rather than awaiting, so a spawned toast process is never on the critical path of an approval |
| 8 | **System tray state protocol** | `getTrayStatus:522`, `getTrayMenu:492`, `DesktopTrayStatus` (`packages/shared/src/types/desktop.ts:105`) | **PASS** | `PAUSED` (running, deliberately not acting) is kept distinct from `OFFLINE` (cannot answer for itself) — collapsing them would make a degraded daemon look like a deliberate one. The tooltip line is composed **by the Core** so the tray and the dashboard cannot disagree about what ONLINE means. Live §6.4 reads the real protocol off the packaged binary: `ONLINE`, five menu rows in the declared order, numeric thread/MCP counts, RSS > 0, uptime ≥ 0, vault `ENCRYPTED` |
| 9 | **Login auto-start lifecycle** | `buildAutoStartPlan:186`, `getAutoStart:395`, `setAutoStart:425` | **PASS** | Windows `HKCU\…\CurrentVersion\Run` via `reg add/delete/query` with each argv element quoted for a command line the shell re-splits at login (`quoteForWindowsCommandLine:119` — `C:\Program Files\…` is the normal case); macOS `~/Library/LaunchAgents/io.asterim.desktop.plist` with XML-escaped argv (`escapeXml:130` — a `&` in a home directory would otherwise produce a plist `launchd` silently refuses); Linux `~/.config/autostart/asterim.desktop` with `NoDisplay=true`. `unsupported` returns `mechanism: 'none'` and `setAutoStart(true)` answers `false` — a real state, not an error. The suite writes and reads back **real files in a real temp home** |
| 10 | **Auto-start truthfulness** | `setAutoStart` return contract (`:425`), `autoStartCache:306` | **PASS** | Returns the state auto-start is *actually* in, not the state requested, and the route reports `success: actual === enabled` with a reason. Removing an absent registry value exits non-zero and is correctly **not** treated as a failure. `getStatus` is synchronous by contract so it reads a cache, and the route refreshes it with `await getAutoStart()` before every read (`routes/desktop.ts:53`) rather than blocking a status call on `reg` |
| 11 | **Desktop REST surface** | `apps/server/src/routes/desktop.ts` | **PASS** | Six routes, all under `/api/v1/desktop/`, registered at `index.ts:215`. Every one requires `request.user`. Live §6.3: all six answer **401** to an anonymous caller under `NODE_ENV=production`; §6.5–6.6: `title` required and non-empty, `body`/`actionUrl` must be strings, `enabled` must be a boolean, an unrecognised notification `type` is coerced to `SYSTEM` rather than rejected |
| 12 | **No client-chosen launch target** | `routes/desktop.ts:12–15`, `openDashboard:469`, `openDataDirectory:474`, `openLogFile:485` | **PASS** | There is no `POST { path }` variant of any launcher; each opens a target the Core computed for itself. This is the difference between a desktop API and "open anything on this machine with the default handler for its extension". Live §6.6 posts `{path:'/etc', target:'/etc/shadow'}` at `open-data-dir`: accepted, ignored, and the Core answered about its own directory |
| 13 | **Status surface carries no credential** | `getStatus:563`, `DesktopStatus` (`desktop.ts:120`) | **PASS** | Counts, enum states and two paths. Live §6.4 asserts against the **raw HTTP body** of the packaged Core that it contains neither the bearer token used to fetch it, nor a `vault:v1:` envelope, nor the pairing PIN |
| 14 | **Shared domain contracts** | `packages/shared/src/types/desktop.ts`, exported at `packages/shared/src/index.ts:18` | **PASS** | Platform strings match `process.platform` values so no caller translates; `unsupported` is a first-class state. Tray state, vault state, notification type, urgency map, app name, autostart id, registry key, plist and `.desktop` filenames, launch command, tray status, menu item and all four response envelopes are declared **once** and imported by the Core, the routes and the dashboard. `CLAUDE.md`'s stated anti-pattern — a second definition of "what ONLINE means" — is avoided structurally |
| 15 | **Dashboard store** | `apps/web/src/stores/useDesktopStore.ts` | **PASS** | Five calls, one read. Three distinct "it did not happen" shapes are kept apart: a non-2xx (`error`), a 200 with `success:false` because the platform has no launcher (`error`), and a 200 with `dispatched:false, skipped:'HEADLESS'` (`actionNotice` — the designed behaviour of the endpoint). The Core's `enabled` is authoritative even when it disagrees with the request, so the switch settles back rather than lying. A transient 500 leaves the previously loaded status in place rather than blanking a card the operator is reading |
| 16 | **Dashboard store — authentication** | `useDesktopStore.ts:11,118`, `apps/web/src/utils/auth.ts` | **PASS** | Every request carries `getAuthHeaders()`, which resolves the **per-backend** token key first and falls back to the legacy plain `asterim_token`. That is what makes the card work against a LAN workstation and not only against localhost. No credential is ever stored in the store |
| 17 | **Dashboard card — view/container split** | `DesktopDaemonCardView:247` / `DesktopDaemonCard:549` | **PASS** | The pure view takes eleven props and holds no store reference; the container binds `useDesktopStore` with per-field selectors and fetches once on mount. Every helper that decides wording (`trayVerdictOf:38`, `formatUptime:79`, `formatMemory:94`, `vaultBadgeOf:100`, `autoStartMechanismOf:128`) is exported and pure, which is why the suite can assert the wording of each state without rendering |
| 18 | **Dashboard card — no second opinion** | `trayVerdictOf:38` | **PASS** | The card computes no health of its own: it maps the Core's own `DesktopTrayState` and keeps `PAUSED` and `OFFLINE` visually and textually distinct. A missing status is a fourth, explicitly-worded case rather than a silent fall-through to "offline" |
| 19 | **Dashboard card — state coverage** | `DesktopDaemonCardView:247–545` | **PASS** | Loading (`Reading daemon status…`), error (`role="alert"`), notice (`role="status"`), headless (a `Headless / CI` badge, and the Test-Notification button additionally disabled), no-status (metrics, toggle, actions and the path line all withheld), and per-action pending labels so only the pressed button shows progress. Suite: 207 assertions across helpers, store actions and `react-dom/server` markup |
| 20 | **Design system compliance** | `blueprint/DESIGN_SYSTEM.md`, `apps/web/src/styles/tokens.css` | **PASS** | `DesktopDaemonCard.tsx` and `useDesktopStore.ts` contain **zero** hex literals and **zero** `rgb`/`rgba` literals — verified by grep. Every colour is a `tokens.css` custom property, and all seven referenced (`--color-accent-subtle`, `--color-accent-hover`, `--color-surface-3`, `--color-border-subtle`, `--color-state-*-bg`, `--font-family-mono`) exist. All three transitions are 150 ms, inside the ≤200 ms rule. One hex literal was introduced in `EnvironmentSettingsView.tsx` — see §8.2 |
| 21 | **Keyboard & assistive access** | `DesktopDaemonCardView:271,325,381,396,464` | **PASS** | Every control is a real `<button>`, so tab order and Enter/Space come free. The toggle is `role="switch"` with `aria-checked` tracking the Core's state and an `aria-label`; the section is labelled; the error banner is `role="alert"` and the notice `role="status"`; pending buttons carry `aria-busy` |
| 22 | **Operator reachability** | `EnvironmentSettingsView.tsx:209,941` | **PASS** | A `Workstation Daemon` tab in the settings surface `App.tsx` actually renders, with copy stating the daemon is a property of the workstation rather than of the Environment. Also mounted in `DeveloperSettings.tsx` as the brief specified — a component nothing imports (§8.3) |
| 23 | **Standalone binary packaging** | `apps/server/package.json:4–10`, `tsup.config.ts` | **PASS** | `bin.asterim → ./dist/index.js`, `files: ["dist"]`, CJS bundle for node22 at 987 KB. Live §6.1 asserts the artefact exists, the bin mapping, and that the package ships nothing but `dist/` |
| 24 | **SPA distribution & catch-all** | `apps/server/package.json:13` (build), `index.ts:78–99` | **PASS** | The server build copies `apps/web/dist` into `dist/web` (encoded as `asterim#build` in `turbo.json`), with a `__dirname/..` fallback for `tsx watch`. Live §6.1/6.3 boots the built binary: `/` serves the dashboard document, a deep client route (`/workspace/project/…/thread/…/view/chat`) serves **byte-identical** `index.html`, the hashed bundle is served as JavaScript, the service worker shipped, and `/api/v1/there-is-no-such-route` is a JSON **404** — not the SPA shell |
| 25 | **Data sovereignty (DEC-028)** | §5 | **PASS** | The entire Phase 10 server surface contains zero network primitives. Every command it can run is a CLI already on the host; every path it touches is under `~/.asterim` or the user's own config directory |

---

## 3. Workstream Acceptance-Criteria Audit

Each criterion is quoted from the brief that was dispatched for it (recovered from
`git show <dispatch-commit>:tasks/current.md`) and re-verified against the code at `8e89347`.

### 3.1 P10-01 — Native Desktop Daemon, System Tray & OS Notifications (`2a5c407`)

| # | Criterion | Verdict | Evidence |
| :-: | :--- | :---: | :--- |
| 1 | `DesktopNotificationService` generates cross-platform notifications and safely degrades in headless/CI environments | **PASS** | `buildNotificationCommands:162` returns the exact argv for Linux (`notify-send` → `kdialog`), macOS (`osascript`) and Windows (WinRT toast → `NotifyIcon` balloon), and `[]` for `unsupported`. `isHeadless:299` covers `ASTERIM_HEADLESS` in both directions, truthy `CI`, unsupported platforms and a Linux host with no display. Matrix rows 3–6; live §6.5 drives the real headless skip through the packaged binary |
| 2 | `DesktopDaemonService` opens browser, data folder and log files using platform-native launch commands | **PASS** | `buildOpenCommand:252` — `cmd /c start ""` for a URL on Windows and `explorer.exe` for a path (the split is deliberate: `explorer.exe` does not open a URL in the default browser), `open` on macOS, `xdg-open` on Linux, `null` elsewhere. `openDataDirectory` creates `~/.asterim` at `0o700` if absent; `openLogFile` returns `false` rather than launching a missing file. Matrix rows 1, 12 |
| 3 | Auto-start configuration generates valid platform-native startup entries (Registry / LaunchAgent / XDG) | **PASS** | Matrix rows 9–10. Registry argv, plist XML and `.desktop` body all asserted, including the two escaping traps (a space in a Windows path, an `&` in a macOS home directory) |
| 4 | Authenticated REST endpoints under `/api/v1/desktop/` return accurate status and handle actions cleanly | **PASS** | Six routes, all gated on `request.user`. Live §6.3–6.6 against the **packaged binary under `NODE_ENV=production`**: 401 anonymous ×6, a paired 200 whose every field matches this run (platform, headless, dataDir, port), validation 400s, and a headless notify that is a 200 skip. Standing caveat about non-production hosts in §8.1 |
| 5 | `DesktopDaemonService.test.ts` passes with comprehensive cross-platform assertions | **PASS** | **207/207**, exit 0. 206 `check`/`equal` call sites; real temp home and temp data dir, cleaned; the REST section runs through a real Fastify instance |
| 6 | Monorepo CI gates pass with 0 errors (42 test suites) | **PASS** | §1. The suite count is 43 at `8e89347` because P10-02 added the tenth web suite after this criterion was written |

**Scope note.** The brief named the EventBus events as `agent:approval_required`, `delegation.completed`
and `verification.failed`. Only the middle one exists under that name. The implementation subscribes
to the events this Core actually publishes — `agent.approval_request`, `delegation.completed` and
`delegation.batch_completed` — and derives the `PIPELINE_FAILED` notification from the
`verificationReport` carried on a completed delegation (`DesktopNotificationService.ts:421`) rather
than from a `verification.failed` event that does not exist. **Same coverage, correct event names.
Audited and accepted** (§8.1).

**Scope note.** The brief listed five routes; six were built. `POST /api/v1/desktop/open-log` was
added so the `View Server Log` tray row has an endpoint. **Audited and accepted.**

### 3.2 P10-02 — Workstation Desktop Daemon Dashboard UI & System Controls (`58de58f`)

| # | Criterion | Verdict | Evidence |
| :-: | :--- | :---: | :--- |
| 1 | `useDesktopStore.ts` handles status fetching, auto-start toggling and quick-action dispatch with authenticated REST headers and error handling | **PASS** | Matrix rows 15–16. All five actions plus `clearError`/`clearNotice`; `getAuthHeaders()` on every request, `{json:true}` only where a body is sent; `readBody` cannot throw on a non-JSON error page |
| 2 | `DesktopDaemonCard.tsx` renders live daemon metrics and provides working controls | **PASS** | Six metrics (platform + mechanism label, active threads, supervised MCP, vault badge, RSS, uptime), the toggle, three quick actions, the resolved data directory. Matrix rows 17–19 |
| 3 | Auto-start toggle accurately reflects server state and sends `POST /api/v1/desktop/autostart` | **PASS** | `role="switch"` with `aria-checked={status.autoStartEnabled}`; the store adopts the Core's `enabled` even when it contradicts the request; the container re-fetches **only on success**, because a refresh clears `error` and would erase the reason a refused toggle just wrote there (`DesktopDaemonCard.tsx:576`). The mechanism label names Registry / LaunchAgent / XDG and disables the control where there is none |
| 4 | Quick actions trigger their endpoints and display clear visual feedback | **PASS** | `pendingAction` names *which* action is in flight so only that button shows `Opening…`/`Sending…`; a 200 with `success:false` becomes a legible error; a headless skip becomes a notice explaining that nothing appearing on screen is correct — the failure mode this card would otherwise read as broken |
| 5 | `DesktopDaemonUI.test.ts` passes with comprehensive assertions covering helpers, store actions and component rendering | **PASS** | **207/207**, exit 0. 208 `check`/`equal` call sites, including markup assertions over `ONLINE`/`PAUSED`/`OFFLINE`/headless/loading/error and a check that the rendered card carries no token and no vault envelope |
| 6 | Monorepo CI gates pass with 0 errors (43 test suites) | **PASS** | §1, §4 — 43 suites, 5,297 assertions |

**Constraint compliance.** No third-party UI dependency was added (`git diff HEAD~4 HEAD --
apps/*/package.json` shows only the two `test` script extensions). No server file was touched by
P10-02. No existing suite was broken.

---

## 4. Full Test Suite Census

`pnpm --filter "*" run test` — **43 suites, 5,297 assertions, 0 failures.** Counts are the summary
line each suite prints, read off this session's run.

### 4.1 `asterim` (server) — 24 suites, 2,995 assertions

| # | Suite | Assertions |
| :-: | :--- | ---: |
| 1 | `services/memory/MemoryRelevanceEngine` | 63 |
| 2 | `services/memory/DecisionExtractor` | 60 |
| 3 | `routes/memory` | 140 |
| 4 | `routes/memory-candidates` | 52 |
| 5 | `routes/internal` | 51 |
| 6 | `services/git/GitDriftDetector` | 64 |
| 7 | `services/git/RemoteManager` | 89 |
| 8 | `services/git/GitWorktreeService` | 111 |
| 9 | `services/SovereignMode` | 21 |
| 10 | `services/ProjectMemoryService` | 231 |
| 11 | `services/PairingService` | 52 |
| 12 | `services/BillingService` | 102 |
| 13 | `services/mcp/McpProcessSupervisor` | 115 |
| 14 | `services/mcp/McpCapabilityDiscovery` | 89 |
| 15 | `services/mcp/McpToolInvocation` | 43 |
| 16 | `services/mcp/McpAgentBridge` | 67 |
| 17 | `services/mcp/AgentMcpIntegration` | 160 |
| 18 | `services/skills/SkillService` | 169 |
| 19 | `services/ai/ProfileService` | 138 |
| 20 | `services/ai/AgentDelegationService` | 461 |
| 21 | `services/verification/VerificationPipelineService` | 196 |
| 22 | `services/security/SecretVaultService` | 133 |
| 23 | `services/security/EnvironmentSecretService` | 181 |
| 24 | **`services/desktop/DesktopDaemonService`** *(P10-01)* | **207** |

### 4.2 `@asterim/web` — 10 suites, 1,854 assertions

| # | Suite | Assertions |
| :-: | :--- | ---: |
| 1 | `components/memory/DecisionExplorer` | 151 |
| 2 | `components/memory/CandidateReview` | 37 |
| 3 | `components/memory/MemoryTimeline` | 134 |
| 4 | `stores/useMemoryStore` | 113 |
| 5 | `components/mcp/McpServerExplorer` | 104 |
| 6 | `components/skills/SkillsExplorer` | 85 |
| 7 | `components/profiles/ProfileSelector` | 134 |
| 8 | `components/delegation/DelegationUI` | 686 |
| 9 | `components/environment/EnvironmentSecretsUI` | 203 |
| 10 | **`components/desktop/DesktopDaemonUI`** *(P10-02)* | **207** |

### 4.3 `@asterim/mcp-memory-server` — 7 suites, 348 assertions

| # | Suite | Assertions |
| :-: | :--- | ---: |
| 1 | `resolver` | 42 |
| 2 | `record_decision` | 82 |
| 3 | `retrieval_tools` | 87 |
| 4 | `dogfood_scenario` | 62 |
| 5 | `stdio_scaffold` | 28 |
| 6 | `relay-client` | 23 |
| 7 | `relay_e2e` | 24 |

### 4.4 `@asterim/relay` — 1 suite, 71 assertions · `@asterim/adapters` — 1 suite, 29 assertions

| Package | Suite | Assertions |
| :--- | :--- | ---: |
| `@asterim/relay` | `relay` | 71 |
| `@asterim/adapters` | `sdk/ProcessManager` | 29 |

**Totals:** 24 + 10 + 7 + 1 + 1 = **43 suites**; 2,995 + 1,854 + 348 + 71 + 29 = **5,297 assertions**.
`@asterim/shared`, `@asterim/marketing` and `@asterim/eslint-config` declare no `test` script.

---

## 5. Desktop Invariants & Security Boundary Verifications

| # | Invariant | How it holds | Verified |
| :-: | :--- | :--- | :--- |
| 1 | A notification body is data, never code | Argv arrays into `execFile`; per-language escaping only where the platform CLI takes a script; control characters stripped and whitespace folded before either | Suite + live §6.2 on a real process |
| 2 | A headless host is a supported host | `isHeadless` checked before anything is spawned; `skipped:'HEADLESS'` is a 200 with `success:true` | Live §6.5 |
| 3 | The Core is never taken down by the desktop layer | No throw path in either service; bus handlers `void`-dispatch; a failed status assembly degrades to `OFFLINE` | Suite + live §6.7 |
| 4 | No route opens a path the client chose | No launcher takes an argument; all three targets are Core-computed | Live §6.6 (`/etc/shadow` ignored) |
| 5 | The desktop surface is authenticated | `request.user` required on all six routes | Live §6.3 (6×401 under `NODE_ENV=production`); caveat §8.1 |
| 6 | The desktop surface carries no credential | Status is counts, enums and two paths | Live §6.4 (raw body free of token, envelope and PIN) |
| 7 | `PAUSED` ≠ `OFFLINE` | Distinct in the shared type, in the Core's verdict and in the card's wording and colour | Suite; matrix rows 8, 18 |
| 8 | Auto-start reports what is true, not what was asked | `setAutoStart` returns the achieved state; failures re-read from the OS | Suite; matrix row 10 |
| 9 | One definition of every desktop concept | `packages/shared/src/types/desktop.ts`, imported by Core, routes and dashboard | Matrix row 14 |
| 10 | No new dependency, no native addon | `git diff HEAD~4 HEAD -- apps/*/package.json packages/*/package.json` touches only two `test` scripts | §3.2 |
| 11 | The packaged binary is the thing that ships | `dist/index.js` + `dist/web`, booted and driven live | §6.1, §6.3 |

---

## 6. Live Pass Over the Packaged Distribution

**67/67 checks passed.** Driver: `scratch/p10-live-gate.ts` (git-ignored, part of no build).

Two Cores were booted as child processes of the audit, each against a throwaway
`ASTERIM_DATA_DIR`, on an ephemeral port, with `ASTERIM_HEADLESS=true` so no check could put a real
toast on the operator's screen.

| § | Group | Checks | Result |
| :-: | :--- | :-: | :---: |
| 6.1 | The packaged distribution exists on disk — `dist/index.js`, `bin.asterim`, `files:["dist"]`, `dist/web/index.html`, hashed asset bundle, service worker | 7 | **PASS** |
| 6.2 | The launch boundary is argv, not a shell — a real `execFile` on this host with `"; touch …; echo "` as an argument | 2 | **PASS** |
| 6.3 | The built binary boots under `NODE_ENV=production`; `/` and a deep client route both serve `index.html`; the hashed bundle is served as JavaScript; an unknown `/api` route is a JSON 404, not the SPA shell; all six desktop routes 401 anonymously | 14 | **PASS** |
| 6.4 | A paired operator reads a live status: PIN published, pairing succeeded, `GET /desktop/status` 200, platform/headless/dataDir/webUrl match this run, tray `ONLINE`, numeric counts, RSS > 0, uptime ≥ 0, vault `ENCRYPTED`, five menu rows in the declared order, and the raw body free of token / `vault:v1:` / PIN | 22 | **PASS** |
| 6.5 | `POST /notify` validation and the headless skip — missing / blank title and non-string body all 400; a valid call is a 200 with `dispatched:false, skipped:'HEADLESS', success:true`; an unknown `type` is coerced to `SYSTEM` | 8 | **PASS** |
| 6.6 | `POST /autostart` validation (missing and non-boolean `enabled` both 400); no route reads a path off the body; `{path:'/etc', target:'/etc/shadow'}` accepted, ignored, not echoed | 5 | **PASS** |
| 6.7 | The desktop layer never took the Core down — `/health` still 200, the child still alive, `desktopRoutes` registered at boot, no `[DesktopRoute]` failure logged | 4 | **PASS** |
| 6.8 | The development posture, recorded rather than assumed — a second Core under `NODE_ENV=development` serves `/desktop/status` **and** `/security/vault-status` without a token, via the shared `authMiddleware` fallback and not any desktop-route exemption | 4 | **PASS** |

Reproduce:

```bash
pnpm --filter asterim run build
pnpm --filter asterim exec tsx ../../scratch/p10-live-gate.ts
```

---

## 7. Reproduction Commands & Audit Trail

```bash
# Phase 10 specialised suites
pnpm --filter asterim exec tsx src/services/desktop/__tests__/DesktopDaemonService.test.ts   # 207/207
pnpm --filter @asterim/web exec tsx src/components/desktop/__tests__/DesktopDaemonUI.test.ts # 207/207

# Full monorepo gates, per workspace so the Turbo cache cannot replay a prior run
pnpm --filter "*" run typecheck   # 7/7 packages, 0 errors
pnpm --filter "*" run lint        # 7/7 packages, 0 errors, 682 warnings
pnpm --filter "*" run test        # 43 suites, 5,297 assertions, 0 failures
pnpm --filter "*" run build       # 7/7 packages

# Turbo aggregate form
pnpm typecheck   # 11/11 tasks
pnpm lint        #  7/7  tasks
pnpm test        #  9/9  tasks
pnpm build       #  7/7  tasks

# Live pass over the packaged binary
pnpm --filter asterim exec tsx ../../scratch/p10-live-gate.ts   # 67/67
```

Briefs recovered for §3 with `git show ff079cb:tasks/current.md` (P10-01) and
`git show c00c1a7:tasks/current.md` (P10-02).

---

## 8. Observations & Architectural Notes

None blocks the phase. §8.1 and §8.2 warrant an explicit decision before a public release.

**8.1 — The desktop surface is only authenticated under `NODE_ENV=production`.**
`authMiddleware.ts:76` hands every `/api/v1/*` caller a fully-entitled `defaultDevUser` whenever
`NODE_ENV !== 'production'`, and nothing in `apps/server/package.json`'s `dev` or `build` scripts
sets `NODE_ENV`. This is a **pre-existing, repo-wide** posture rather than anything Phase 10
introduced — §6.8 confirms `/api/v1/security/vault-status` behaves identically — and the Core binds
`::` by default (`index.ts:246`), which is every interface. What Phase 10 changes is the *character*
of what an unauthenticated LAN caller can reach: until now that was data, and it now includes
launching processes on the operator's physical desktop and writing an entry to their OS login items.
The pairing PIN in the Socket.IO middleware does not cover REST. **Recommendation:** decide whether
the packaged binary should default to `NODE_ENV=production`, or whether the dev fallback should be
narrowed to loopback sources.

**8.2 — One hardcoded colour was introduced in `EnvironmentSettingsView.tsx`.**
The `Workstation Daemon` tab's description uses `color: '#94a3b8'` (`:943`). The card itself is
clean — `DesktopDaemonCard.tsx` and `useDesktopStore.ts` contain zero hex and zero `rgba` literals —
and the host file already carries 22 instances of that same literal, so the new line is consistent
with its surroundings and inconsistent with `blueprint/DESIGN_SYSTEM.md`. Not fixed here because a
single tokenised line among 22 hex literals is a worse state than either alternative, and a
file-wide migration is outside this gate's scope. **Recommendation:** a dedicated task migrating
`EnvironmentSettingsView.tsx` to `tokens.css` in one pass.

**8.3 — `DeveloperSettings.tsx` is still orphaned.**
Nothing imports it — the only occurrence of the name in `apps/web/src` is its own declaration. The
P9-04 gate recorded the same thing. P10-02 mounted `DesktopDaemonCard` there as the brief asked
*and* added a reachable `Workstation Daemon` tab, which is the right call, but it means every brief
that names `DeveloperSettings.tsx` as an integration point is naming dead code. **Recommendation:**
delete it, or route to it, before a third phase mounts something in it.

**8.4 — The brief's event names did not match the Core's.**
`agent:approval_required` and `verification.failed` do not exist; the real events are
`agent.approval_request` and `delegation.completed` (with the verification outcome carried on the
completion payload). P10-01 implemented against the code rather than the brief, which is correct,
but the divergence survived unremarked into the P10-03 brief's §2. Worth a pass over the phase plan
so downstream briefs quote real event names.

**8.5 — `initLogger` ignores `ASTERIM_DATA_DIR`.**
`utils/logger.ts:48` writes to `path.join(os.homedir(), '.asterim')` unconditionally and truncates
`server.log` on every start, regardless of the configured data directory. `DesktopDaemonService`
already handles this correctly — `logFilePath:347` checks the data directory first and falls back to
`~/.asterim` — so `View Server Log` opens the right file either way, and there is no Phase 10 defect
here. But it does mean two Cores run concurrently with different data directories share and truncate
one log, which is how this audit's live boots overwrote the workstation's `~/.asterim/server.log`.

**8.6 — Tray status is pull-only.**
`GET /api/v1/desktop/status` is polled by the card on mount and on an explicit Refresh; nothing
publishes a desktop status change onto the EventBus, so a card left open goes stale and a future
native tray shell would have to poll. The tray state, thread count and MCP count are all already
derived from things the bus knows about. **Recommendation:** a `desktop.status_changed` event when a
native shell is built, rather than shortening a poll interval.

**8.7 — `paused` has no writer.**
`DesktopDaemonService.setPaused:374` exists and nothing calls it, so `PAUSED` is currently
unreachable in production. This is deliberate and documented at `:288` — the surface exists so a tray
shell has a state to drive rather than inventing one client-side — and both the Core and the card
handle it correctly. Recorded so it is not mistaken for dead code and removed.

**8.8 — The `test` scripts remain `&&`-chained.**
A failing suite suppresses every later suite in that workspace's chain. This run is clean and all 43
summary lines were observed, so nothing was hidden, but a red run would report partial results. Same
point raised in the P10-02 execution report and the P10-02 test gate; a repo-wide pattern, not Phase
10's to fix.

---

## 9. Sign-Off

| Item | Verdict |
| :--- | :---: |
| P10-01 — Native desktop daemon, system tray state & OS notifications | **VERIFIED** |
| P10-02 — Workstation daemon dashboard UI & system controls | **VERIFIED** |
| Desktop invariants & security boundaries (§5) | **VERIFIED** |
| Packaged standalone distribution & SPA catch-all (§6) | **VERIFIED** |
| Typecheck — 7/7 packages, 0 errors | **PASS** |
| Lint — 7/7 packages, 0 errors | **PASS** |
| Tests — 43 suites, 5,297 assertions, 0 failures | **PASS** |
| Build — 7/7 packages | **PASS** |
| Live pass over the packaged binary — 67/67 checks | **PASS** |

**Phase 10 gate: PASS — READY FOR NEXT PHASE.**

Signed: Claude Code (Execution Engineer), 2026-08-17, at commit `8e89347`.
