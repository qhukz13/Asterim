Task-ID: P7-01
Status: COMPLETE

# Execution Report: P7-01 — Release Channels (Stable vs Development) & Runtime Data Isolation

**Task ID:** P7-01
**Phase:** Phase 7 — Release Channels, Database Migration Engine & Runtime Isolation
**Status:** IMPLEMENTED & VERIFIED
**Date:** 2026-08-18
**Author:** Claude Code

---

## 1. Summary

Channel Runtime Isolation is implemented per `DEC-029`. A single resolver
(`apps/server/src/utils/channel.ts`) decides the channel, the data directory and
the default port, and every runtime path that lands on disk now goes through it:
`asterim.db`, `server.json`, `server.log`, `crash.log`, the vault salt and the
workstation skills directory. `ASTERIM_CHANNEL=dev` (or `NODE_ENV=development`)
moves all of them to `~/.asterim-dev` and port 3001; stable keeps `~/.asterim`
and 3000. `ASTERIM_DATA_DIR` still outranks both, so every existing temp-directory
test suite is unaffected.

`GET /api/v1/system/channel` publishes the resolved `ChannelInfo`, and the
dashboard header renders an amber `[DEV-CHANNEL]` pill when the Core it is talking
to answers `dev`.

Two isolation gaps found during self-review were closed beyond the literal file
list in the task:

* **`initLogger` and the crash handler** wrote to `~/.asterim` unconditionally. A
  development run therefore truncated the stable Core's `server.log` on every
  start and filed its crashes among the stable ones — a direct violation of the
  task's "do NOT modify user files in `~/.asterim` under `ASTERIM_CHANNEL=dev`"
  constraint. Both now resolve through the channel.
* **`sanitizeAgentEnv`** allow-listed only `ASTERIM_DATA_DIR` for child
  processes. A dev-channel Core with no `ASTERIM_DATA_DIR` set would therefore
  spawn MCP memory servers that resolved `~/.asterim` and wrote to the operator's
  stable database. `ASTERIM_CHANNEL` was added to the allow-list.

---

## 2. Files Changed

### Created

| File | Purpose |
| :--- | :--- |
| `packages/shared/src/types/channels.ts` | `AsterimChannel`, `ChannelInfo` — the contract the dashboard renders |
| `packages/shared/src/constants/channels.ts` | Ports, directory names, `parseAsterimChannel`, `dataDirNameForChannel`, `defaultPortForChannel` |
| `apps/server/src/utils/channel.ts` | `getAsterimChannel`, `isDevChannel`, `resolveDataDir`, `resolvePort`, `resolveServerVersion`, `describeChannel` |
| `apps/server/src/services/__tests__/ChannelIsolation.test.ts` | 90 assertions across resolution, precedence, the real consumers, and the REST route |
| `apps/web/src/components/ChannelBadge.tsx` | The `[DEV-CHANNEL]` pill plus `shouldShowChannelBadge` / `channelBadgeTitle` |
| `apps/web/src/hooks/useChannel.ts` | One same-origin read of `/api/v1/system/channel` |
| `apps/web/src/components/__tests__/ChannelBadge.test.ts` | 19 assertions, including a real `TopBar` render |

### Modified

| File | Change |
| :--- | :--- |
| `packages/shared/src/index.ts` | Exports the new types and constants |
| `apps/server/src/services/DatabaseService.ts` | `resolveDataDir` re-exported from `utils/channel`; startup log names the channel |
| `apps/server/src/services/skills/SkillService.ts` | Dropped its duplicate resolver; imports the shared one |
| `apps/server/src/services/desktop/DesktopDaemonService.ts` | `logFilePath()` fallback and `webUrl()` follow the channel |
| `apps/server/src/utils/logger.ts` | `server.log` goes to the channel's directory, created `0700` |
| `apps/server/src/index.ts` | `crash.log` follows the channel; port from `resolvePort()`; startup logs channel/dir/port |
| `apps/server/src/routes/system.ts` | `GET /api/v1/system/channel` |
| `apps/web/src/components/TopBar.tsx` | Renders `<ChannelBadge />` in the header |
| `apps/web/src/App.tsx` | Feeds the badge from `useChannel()` |
| `apps/web/vite.config.ts` | Dev-server proxy targets the channel's port |
| `packages/adapters/src/sdk/ProcessManager.ts` | `ASTERIM_CHANNEL` added to `INHERITABLE_ASTERIM_ENV` |
| `packages/adapters/src/sdk/__tests__/ProcessManager.test.ts` | Updated allow-list assertion + new channel-inheritance assertion |
| `apps/server/src/services/mcp/__tests__/McpProcessSupervisor.test.ts` | Asserts `ASTERIM_CHANNEL` survives `sanitizeMcpEnv` |
| `apps/server/package.json`, `apps/web/package.json` | New suites wired into `test` |

`ServerRegistry.ts` and `SecretVaultService.ts` needed no edit: both already
consume `resolveDataDir` from `DatabaseService`, so they became channel-aware
when that function did. This is asserted rather than assumed — the suite checks
`serverRegistry.filePath` for both channels.

---

## 3. Implementation Details

**Channel determination.** An explicit `ASTERIM_CHANNEL` wins; otherwise
`NODE_ENV === 'development'` means `dev`, and everything else means `stable`.
`parseAsterimChannel` accepts `dev`/`development` and `stable`/`production`/`prod`,
case- and whitespace-insensitive. A value it does not recognise returns `null`
and the caller falls through to the `NODE_ENV` rule — guessing what a typo meant
is precisely how a development run ends up pointed at `~/.asterim`.

**Precedence.** `ASTERIM_DATA_DIR` > channel default, and `PORT` > channel
default. Both resolvers read `process.env` on every call rather than capturing at
import, because the service singletons are module-level and every test suite in
the repository sets `ASTERIM_DATA_DIR` before requiring them. A non-numeric or
empty `PORT` falls back to the channel default rather than producing `NaN`.

**Version.** `resolveServerVersion()` walks up from `__dirname` for a
`package.json`, so it works both under `tsx watch` (`src/utils/`) and in the
packaged `dist/` build, and falls back to `0.0.0` rather than throwing.

**Permissions.** Directories created by the logger and the crash handler now use
`mode: 0o700`, matching what `DatabaseService` already enforced under `DEC-028`.

**Vite proxy.** The dev-server proxy follows `ASTERIM_CHANNEL`/`PORT` only, and
deliberately does *not* read `NODE_ENV`: Vite sets `NODE_ENV=development` for its
own dev server, so reading it would retarget the proxy to 3001 for every existing
`pnpm dev` while the Core — which is not started with `NODE_ENV` set — is still
on 3000.

**`useChannel` is same-origin.** It does not use `resolveBackendUrl()`, which
hardcodes port 3000. Asking that URL which channel it is would answer about the
stable Core rather than the process serving the page, and a development
dashboard would never badge itself.

---

## 4. Verification

Everything below was run in this session. The root scripts (`pnpm run test` etc.)
were blocked by the sandbox, so each workspace was invoked directly via
`pnpm --filter` — the same commands turbo would run.

**New suites**

```
pnpm --filter asterim exec tsx src/services/__tests__/ChannelIsolation.test.ts
  → 90/90 assertions passed

pnpm --filter @asterim/web exec tsx src/components/__tests__/ChannelBadge.test.ts
  → 19/19 assertions passed
```

**Full test gate — 0 failed assertions in every workspace**

| Workspace | Suites | Result |
| :--- | :--- | :--- |
| `asterim` | 25 | 0 FAIL |
| `@asterim/web` | 11 | 0 FAIL |
| `@asterim/adapters` | 1 | 0 FAIL (30/30) |
| `@asterim/mcp-memory-server` | 7 | 0 FAIL |

**Typecheck — clean in all 7 workspaces**

`@asterim/shared`, `@asterim/adapters`, `asterim`, `@asterim/web`,
`@asterim/mcp-memory-server`, `@asterim/relay`, `@asterim/marketing` — all
`tsc --noEmit` (or `tsc -b`) with no output.

**Lint — 0 errors everywhere**

| Workspace | Result |
| :--- | :--- |
| `asterim` | 312 problems (0 errors) |
| `@asterim/web` | 311 problems (0 errors) |
| `@asterim/shared` | 3 problems (0 errors) |
| `@asterim/adapters` | 28 problems (0 errors) |
| `@asterim/mcp-memory-server` | 12 problems (0 errors) |
| `@asterim/marketing` | 18 problems (0 errors) |
| `@asterim/relay` | clean |

The two `react-refresh/only-export-components` warnings on `ChannelBadge.tsx`
join 82 pre-existing instances of the same warning in the dashboard.

**Build — every workspace built**

`@asterim/shared`, `@asterim/adapters`, `@asterim/web` (vite + PWA precache),
`asterim` (tsup, 990 KB, web copied into `dist/web`), `@asterim/relay`,
`@asterim/marketing`, `@asterim/mcp-memory-server`. The built server bundle
contains both the `.asterim-dev` path and the `system/channel` route.

**Not run:** a live browser/puppeteer capture of the badge against a running
dev-channel Core. The sandbox denied launching `node dist/index.js`, so the Core
could not be started on 3001 in this session. `scratch/p7-01-channel-smoke.sh`
was left in place to perform exactly that check (start the built Core on the dev
channel against a throwaway `HOME`, curl the endpoint, confirm `~/.asterim` was
never created) when it can be executed. In its place, the same three properties
are asserted in-process by `ChannelIsolation.test.ts`, which constructs real
`DatabaseService` instances against a fake `HOME`.

---

## 5. Acceptance Criteria Review

- [x] **1. `getAsterimChannel()` correctly identifies `stable` vs `dev` from the environment** — 11 assertions in `ChannelIsolation.test.ts` § *"getAsterimChannel: an explicit channel wins, NODE_ENV decides otherwise"*: explicit `stable`/`dev`, explicit beating `NODE_ENV` in both directions, `NODE_ENV=development` → dev, `NODE_ENV=production` → stable, nothing set → stable, and two misspelling cases that must fall through rather than be guessed at.
- [x] **2. `resolveDataDir()` resolves `~/.asterim` for Stable and `~/.asterim-dev` for Development by default** — 6 assertions against a fake `HOME` (`stable resolves to ~/.asterim`, `dev resolves to ~/.asterim-dev`, the two never coincide, dev is not nested inside stable, explicit channel argument, `NODE_ENV` alone moves it), plus 4 more proving `ASTERIM_DATA_DIR` still outranks the channel.
- [x] **3. `GET /api/v1/system/channel` returns accurate channel and data directory metadata** — 13 assertions through `fastify.inject()` against the real `systemRoutes`: 200 on both channels, `channel`/`isDev`/`dataDir`/`port`/`version` correct for each, the `ASTERIM_DATA_DIR` override reflected, and a request carrying attacker-supplied `channel`/`dataDir` query and header values proving nothing the caller sends changes the answer.
- [x] **4. Web UI displays the `[DEV-CHANNEL]` badge when connected to a development backend** — `ChannelBadge.test.ts`: the predicate (dev badged, stable not, null not), the tooltip naming the data directory/port/version, real `react-dom/server` markup containing `[DEV-CHANNEL]` and using `var(--color-state-paused)` rather than a hardcoded hex, and — layer 3 — the real `TopBar` rendered with a dev `ChannelInfo`, asserting the badge appears *inside* the `<header>` and is absent for stable and for a Core that has not answered.
- [x] **5. `ChannelIsolation.test.ts` passes with comprehensive assertions** — 90/90. Beyond resolution and precedence it covers the real consumers (`ServerRegistry.filePath`, `globalSkillsDir`, `DesktopDaemonService.webUrl`/`logFilePath` on both channels) and physical isolation: a dev-channel `DatabaseService` creates `~/.asterim-dev` at `0700` with the database at `0600`, and `~/.asterim` is asserted **not to exist** afterwards.
- [x] **6. Monorepo CI gates pass with 0 errors** — typecheck clean in all 7 workspaces; lint 0 errors in all 7; 0 failed assertions across all 44 test suites; every workspace builds. Command-by-command results in § 4. (Root `pnpm run …` wrappers were sandbox-blocked; each workspace was run directly with the identical underlying command.)

### Definition of Done

- [x] Shared channel types and constants added to `@asterim/shared`
- [x] `getAsterimChannel()` and channel-aware `resolveDataDir()` implemented
- [x] Core services updated — `DatabaseService` (direct), `ServerRegistry` / `SecretVaultService` / `DesktopDaemonService` (via the shared resolver, asserted), `SkillService` (duplicate resolver removed), plus `logger` and the crash handler
- [x] `GET /api/v1/system/channel` endpoint registered
- [x] Web UI `[DEV-CHANNEL]` badge rendered
- [x] `ChannelIsolation.test.ts` created and passing, wired into `apps/server` `test`
- [x] Monorepo CI gates pass cleanly

---

## 6. Git Diff Review

`git diff` was read in full against every criterion. Three issues were found by
that review and fixed before this report:

1. **`useChannel` asked the wrong Core.** It initially routed through
   `resolveBackendUrl()`, which hardcodes port 3000. A dashboard served by a
   development Core on 3001 would have queried the *stable* Core and never
   badged itself — silently failing criterion 4 in exactly the situation it
   exists for. Now same-origin unless an explicit workstation URL is given.
2. **Child processes lost the channel.** `sanitizeAgentEnv`'s allow-list held
   only `ASTERIM_DATA_DIR`, so a dev-channel Core would spawn MCP memory servers
   that opened `~/.asterim`. Fixed in `ProcessManager.ts`, with assertions added
   in both the adapters and MCP supervisor suites.
3. **A reworded log line broke another package.** Changing the
   `[Database] Using database at:` prefix broke four assertions in
   `@asterim/mcp-memory-server`, which depend on that exact string to prove the
   stdio guard routes it to stderr. The prefix is restored verbatim and the
   channel appended as a suffix. Worth recording: those suites run the *built*
   `dist/index.js`, so a stale build masked the breakage on the first run — the
   package must be rebuilt before its tests are trusted.

No forbidden changes: `ASTERIM_DATA_DIR` precedence is preserved and directly
asserted (5 assertions); nothing under `~/.asterim` is written on the dev
channel, asserted by absence; no migration framework, no schema change, no
credential handling touched; no new dependencies. `.env.example` was left alone
(it is documented as stale and was out of scope).

---

## 7. Problems Discovered

* **`CLAUDE.md` § Commands is wrong about testing.** It states there is "no test
  runner or test script anywhere in the repo" and that CI runs only lint and
  build. In fact `asterim`, `@asterim/web`, `@asterim/adapters` and
  `@asterim/mcp-memory-server` all have substantial `test` scripts (44 suites,
  several thousand assertions) driven by `tsx`, and `turbo.json` defines a `test`
  task. Worth correcting so future tasks do not skip the gate.
* **Stale build artefacts are load-bearing.** `@asterim/mcp-memory-server`'s
  suites spawn `dist/index.js`, so they silently test old code until the package
  is rebuilt. This produced a false pass and then a confusing false failure
  during this task.
* **The dashboard's `resolveBackendUrl()` hardcodes port 3000.** It is correct
  today only because the stable Core is the only one that has ever existed. Any
  future store or hook that uses it against a non-3000 Core will address the
  wrong process. Left as-is here — changing it is outside this task's scope.

---

## 8. Architectural Concerns

1. **`ASTERIM_CHANNEL` should probably be set by `pnpm dev`.** `DEC-029` says the
   development channel is "activated via `ASTERIM_CHANNEL=dev` **or `pnpm dev`**".
   Today `pnpm dev` sets neither `ASTERIM_CHANNEL` nor `NODE_ENV`, so it still
   resolves to `stable` — the fallback rule is in place, but the trigger the
   decision names is not wired. Adding `ASTERIM_CHANNEL=dev` to the `dev` scripts
   in `apps/server` and `apps/web` would complete it, and would move every
   developer's daily `pnpm dev` onto `~/.asterim-dev` and port 3001. That is a
   deliberate behaviour change for every contributor and it contradicts the ports
   documented in `CLAUDE.md`, so it is left for Antigravity to approve rather than
   done silently here.
2. **`resolveDataDir` is now re-exported from `DatabaseService`** for backward
   compatibility with ~6 importers. A follow-up could repoint those imports at
   `utils/channel` and drop the re-export, so the database module is not the
   apparent owner of a path decision it no longer makes.
3. **`DEC-030` (migration engine) will interact with this.** Pre-migration
   snapshots (`asterim.db.bak.<timestamp>`) must be written to the *channel's*
   data directory. Since they will be joined onto `resolveDataDir()`, that comes
   for free — worth stating explicitly in the P7-02 task so it is not
   re-derived.

---

## 9. Recommended Next Step

Proceed to the Phase 7 migration-engine task (`DEC-030`): the versioned forward
migration engine with `schema_migrations`, SHA-256 checksums, transactional
rollback and pre-migration snapshots, replacing the ad-hoc
`ALTER TABLE … try/catch` blocks in `DatabaseService.init()`. Channel isolation
is a prerequisite that is now in place — migrations can be exercised on
`~/.asterim-dev` without any risk to the operator's stable database.

Separately, a decision is requested on § 8.1 (whether `pnpm dev` should export
`ASTERIM_CHANNEL=dev`).
