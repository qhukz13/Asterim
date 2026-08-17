Task-ID: P10-02
Status: COMPLETE

# Execution Report: P10-02 — Workstation Desktop Daemon Dashboard UI & System Controls

**Task ID:** P10-02
**Phase:** Phase 10 — Desktop Distribution, Native Shell & Release Readiness
**Status:** VERIFIED
**Date:** 2026-08-17
**Author:** Claude Code

---

## 1. Summary

The P10-01 desktop subsystem now has a dashboard. `useDesktopStore` speaks to the five
`/api/v1/desktop/*` endpoints with authenticated headers, and `DesktopDaemonCard` renders the
Core's own `DesktopTrayStatus` — the same verdict the tray icon shows — plus the auto-start switch
and the three quick actions. It is mounted in `DeveloperSettings` and, because that component is
currently not rendered anywhere in the app, also as a new **Workstation Daemon** tab in
`EnvironmentSettingsView`, which is the settings surface `App.tsx` actually mounts.

A 207-assertion suite covers the pure helpers, every store action against a recording `fetch`, and
static rendering across ONLINE / PAUSED / OFFLINE / headless / auto-start on and off / loading /
pending / error. It is wired into `apps/web` `test`, raising web suites from 9 to 10 and the
monorepo from 42 to 43. All seven workspaces typecheck, lint (0 errors), test and build clean.

No server file was touched and no dependency was added.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `apps/web/src/stores/useDesktopStore.ts` | Created | Desktop daemon state + the five authenticated REST calls |
| `apps/web/src/components/desktop/DesktopDaemonCard.tsx` | Created | Pure view + connected container, and the pure state-mapping helpers |
| `apps/web/src/components/desktop/__tests__/DesktopDaemonUI.test.ts` | Created | 207-assertion suite over helpers, store and rendering |
| `apps/web/src/components/DeveloperSettings.tsx` | Modified | Mounts the card above the remote-workstation controls |
| `apps/web/src/components/environment/EnvironmentSettingsView.tsx` | Modified | New `daemon` sub-tab ("Workstation Daemon") so the card is reachable |
| `apps/web/package.json` | Modified | New suite appended to the `test` script (9 → 10 web suites) |

## 3. Implementation Details

**Store (`useDesktopStore`).** State is exactly the shape the task specified — `status`, `menu`,
`isLoading`, `isTogglingAutoStart`, `error`, `actionNotice` — plus one addition, `pendingAction:
'open-data-dir' | 'open-log' | 'notify' | null`, without which "disabled states during pending
actions" could not name *which* button is running and all three would spin at once. Actions:
`fetchStatus`, `toggleAutoStart`, `openDataDirectory`, `openLogFile`, `sendTestNotification`,
`clearError`, `clearNotice`.

Authentication goes through the existing `getAuthHeaders()` (`apps/web/src/utils/auth.ts`) rather
than a direct `localStorage.getItem('asterim_token')`: it resolves the per-backend key first and
falls back to the plain `asterim_token`, so the card works against a LAN workstation as well as
localhost. The reads carry no `Content-Type`; the two JSON POSTs declare one.

Three behaviours are deliberate rather than incidental:

- **The Core's `enabled` is authoritative.** `POST /autostart` answers `{success:false,
  enabled:false}` to a request for `true` on a platform with no mechanism. The switch settles on
  what the machine actually is and the reason goes to `error` — it never stays on a state that was
  refused.
- **A headless skip is a notice, not an error.** `POST /notify` answers 200 / `success:true` /
  `dispatched:false` / `skipped:'HEADLESS'` by design. Because nothing appears on screen in that
  case, `describeNotifyOutcome` says why in words; treating it as a failure would make the button
  read as broken on exactly the hosts where it is correct.
- **A 200 with `success:false`** from `open-data-dir` / `open-log` (no launcher on this platform)
  is reported on `error` with the Core's own reason — the request worked, the thing did not happen.

A failed `fetchStatus` leaves the previously loaded status in place rather than blanking a card the
operator is reading.

**Card (`DesktopDaemonCard`).** Pure view + connected container, following `SecurityStatusCard`.
The view computes no health of its own: `trayVerdictOf` maps the Core's `DesktopTrayState` to
wording and a token colour, keeping `PAUSED` (running, deliberately not acting — amber) distinct
from `OFFLINE` (cannot read its own database — red), which is the distinction the shared type
exists to preserve. Other pure helpers: `formatUptime` (two units at most: `3d 4h`, `4h 12m`,
`1m 30s`, `45s`; `unknown` for absent/NaN/negative), `formatMemory`, `vaultBadgeOf`,
`autoStartMechanismOf` (Registry HKCU Run key / LaunchAgent / XDG autostart entry, and
`available:false` for `unsupported`).

Rendered: state banner, Headless / CI badge, a six-cell metric grid (Platform, Active threads,
Supervised MCP, Workstation vault, Memory RSS, Uptime), the auto-start row as a
`role="switch"` + `aria-checked` button with the platform mechanism named beside it, the three
action buttons with per-action pending labels and `aria-busy`, `role="alert"` for errors,
`role="status"` for notices (an error suppresses a stale notice so the card never says a thing
worked and failed at once), and the resolved `dataDir`. Every colour is a `tokens.css` custom
property — the suite asserts no hex or `rgb()` literal survives into the markup. Transitions are
150 ms.

The container re-reads the status after a *successful* toggle only: `fetchStatus` clears `error`,
so an unconditional refresh would erase the reason a refused toggle had just written.

**Integration.** `DeveloperSettings.tsx` mounts the card as the task specified. That component is
not currently imported anywhere (verified by grep across `apps/`), so the card is also mounted as a
`daemon` sub-tab in `EnvironmentSettingsView`, which `App.tsx` renders for the `workspace` and
`environment` tabs. The tab copy states that the daemon is a workstation property rather than an
Environment one.

## 4. Verification

Run per workspace (`pnpm --filter <pkg> run <script>`); the root turbo scripts are equivalent
fan-outs over the same seven workspaces.

| Gate | Result |
| :--- | :--- |
| `pnpm --filter @asterim/web exec tsx src/components/desktop/__tests__/DesktopDaemonUI.test.ts` | **207/207 assertions passed** |
| `typecheck` — shared, adapters, web, asterim, marketing, relay, mcp-memory-server | 7/7 clean, 0 errors |
| `lint` — all seven | 0 errors (warnings only, all pre-existing categories; the new card contributes 5 `react-refresh/only-export-components` warnings, identical in kind to `SecurityStatusCard.tsx` and `EnvironmentSecretsPanel.tsx`, which export pure helpers beside components) |
| `build` — all seven, in dependency order incl. `asterim` copying `apps/web/dist` | clean |
| `test` — 43 suites | all passing, 0 `FAIL` lines |

Test totals per workspace: **web 10** (151, 37, 134, 113, 104, 85, 134, 686, 203, **207**),
**server 24** (0 FAIL lines; DesktopDaemonService suite 207/207), **mcp-memory-server 7** (7
"assertions passed" lines), **adapters 1** (29/29), **relay 1** (71/71) — **43 suites total**, up
from 42.

Not run: browser/puppeteer capture. The task did not request one, and the card's rendering is
covered by `react-dom/server` across all nine states.

## 5. Acceptance Criteria Review

- [x] **1. `useDesktopStore.ts` handles status fetching, auto-start toggling and quick action
  dispatch with authenticated REST headers and error handling** — all five endpoints exercised
  against the recording `fetch`; every request asserted to carry `Bearer test-token`, the two JSON
  POSTs to declare `application/json`. Error handling covered for 400, 401, 500, `success:false`
  and a rejecting `fetch`; each case asserts the flag is released rather than left spinning.
- [x] **2. `DesktopDaemonCard.tsx` renders live daemon metrics and provides working controls** —
  `DesktopDaemonCardView renders a healthy daemon` asserts platform, thread count, `3 running` MCP,
  `ENCRYPTED`, `182 MB`, `4h 12m`, dataDir and the Core's tooltip; `renders the unhappy states`
  covers PAUSED, OFFLINE, PLAINTEXT, null status and loading; `renders the headless case` asserts
  the badge and that the notification button — and only it — is disabled.
- [x] **3. Auto-start toggle accurately reflects server state and sends `POST /autostart`** —
  `useDesktopStore — toggling auto-start` asserts URL, method, JSON header and `{enabled:true}` /
  `{enabled:false}` bodies; `a platform that cannot register a login item` asserts the switch
  settles on the Core's `enabled:false` after asking for `true` and surfaces the reason. Rendering
  asserts `role="switch"`, `aria-checked` in both states, the per-platform mechanism label
  (Registry / LaunchAgent / XDG) and a disabled switch on `unsupported`.
- [x] **4. Quick actions trigger their endpoints and display clear feedback** — `the launch actions
  address their own endpoints` asserts `/open-data-dir` and `/open-log` are hit with POST, the
  token and **no body**; `the test notification` asserts `/notify` with a title, body and
  `type:'SYSTEM'` (and a caller-supplied type passed through). Feedback: distinct notices per
  action, `Opening…` / `Sending…` pending labels with `aria-busy`, the other buttons disabled
  during a pending action, and the headless skip explained instead of read as failure.
- [x] **5. `DesktopDaemonUI.test.ts` passes with comprehensive assertions** — 207/207 across pure
  helpers, all five store actions, nine render states, a "no request carries a path or a command"
  guard, a design-token guard, and a section replaying the literal JSON bodies
  `apps/server/src/routes/desktop.ts` returns.
- [x] **6. Monorepo CI gates pass with 0 errors** — typecheck 7/7 clean; lint 0 errors; 43 test
  suites all passing; build clean across all seven workspaces including the `asterim` web-dist copy
  step. See §4.

Definition of Done: store ✅, card ✅, integrated into `DeveloperSettings.tsx` **and**
`EnvironmentSettingsView.tsx` ✅, suite created and wired into `apps/web/package.json` ✅, CI gates
clean ✅.

## 6. Git Diff Review

`git status` / `git diff` reviewed line by line. Three files modified — `apps/web/package.json`
(one line: the suite appended to `test`), `DeveloperSettings.tsx` (+8: one import, one mounted
card) and `EnvironmentSettingsView.tsx` (+14: one import, one union member, one tab entry, one
render block) — plus two new paths under `apps/web/src`. No server, shared, adapters, relay or
marketing file is touched; no backend contract is altered; no dependency was added to any
`package.json`; no colour literal was introduced; nothing was written to `docs/`.

`tests/report.md` was already modified in the working tree when this session started (it is in the
pre-session `git status`). It is not mine, I did not touch it, and it is **not** included in the
commit for this task.

## 7. Problems Discovered

1. **`DeveloperSettings.tsx` is dead code.** Grep across `apps/` finds no importer — it is defined
   and never rendered. Mounting the card only there would have satisfied the letter of scope item 3
   while leaving the feature unreachable, so the `EnvironmentSettingsView` tab was added as well
   (the task's "and/or … so developers can easily monitor daemon status").
2. **`fetchStatus` clears `error`.** The first version of the container refreshed unconditionally
   after a toggle, which wiped the "auto-start is not available on this platform" message a
   fraction of a second after it appeared. It now refreshes on success only.
3. **Three distinct "it did not happen" shapes** come back from these routes — non-2xx, 200 with
   `success:false`, and 200 with `success:true, dispatched:false`. Collapsing them would have made
   a correctly-skipped headless toast look like a bug. They are handled separately and each is
   asserted.
4. **The root `pnpm run <script>` commands were not runnable in this session** (blocked at the
   shell layer). Every gate was instead run directly per workspace with
   `pnpm --filter <pkg> run <script>`, which is exactly what those turbo tasks fan out to — all
   seven workspaces covered, nothing skipped.

## 8. Architectural Concerns

1. **`DeveloperSettings.tsx` is orphaned.** Worth either mounting it or deleting it; as it stands
   it is a maintenance surface nobody sees. Not actioned here — outside this task's scope.
2. **The status is a one-shot read.** The card fetches on mount and on the explicit Refresh press.
   Thread and MCP counts move underneath it. The Core already publishes agent lifecycle on the
   EventBus, so a `desktop.status_changed` broadcast (or a poll on an interval) would keep the card
   live — but that is a Core-side contract addition and belongs in a task, not in this one.
3. **`DesktopTrayMenuItem[]` is fetched and stored but not rendered.** The task specified consuming
   the type and storing `menu`, and the store does; the card renders the same actions as first-class
   buttons rather than replicating the tray menu. The data is there for a future surface that wants
   the Core's own enable/disable verdicts per row.
4. **`web` now has 10 chained `tsx` invocations in one `test` script.** A failure in suite 3 stops
   suites 4–10 from running at all. A trivial runner script would give full-sweep results per run;
   flagging rather than acting, since the pattern is repo-wide.

## 9. Recommended Next Step

The desktop vertical is closed end to end (Core P10-01, dashboard P10-02). The natural successor is
the packaging/distribution half of Phase 10 — a single-binary or installer artefact that makes the
auto-start entry this card toggles point at something a user actually installed — or, if the daemon
surface is to be finished first, a live status channel per §8.2.
