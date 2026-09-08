# Testing

## What exists today

43 suites, about 5,300 assertions, written as plain `tsx` scripts with a hand-rolled `check()` helper and an exit code. There is no runner, no coverage and no browser test. `pnpm run test` runs every workspace's `test` script through turbo; each workspace's `package.json` lists its suites in a `&&` chain. The style is deliberate and consistent; follow it until the vitest migration (post-launch).

Run one suite:

```bash
pnpm --filter asterim exec tsx src/services/__tests__/PairingService.test.ts
```

Run everything:

```bash
pnpm run test
```

Suites that hit HTTP routes use `fastify.inject()` and set `ASTERIM_DEV_AUTH_BYPASS=true` at the top of the file so the local developer user is granted on loopback (`docs/audit/security-audit.md`, S1). Suites that touch the database set `ASTERIM_DATA_DIR` to a temp directory first; never run a suite against `~/.asterim`.

Windows notes (fixed 2026-09-08, keep in mind for new suites): a child ended by `TerminateProcess()` reports exit code `null`, not `0` (guarded in the MCP memory server live probe); git's `core.autocrlf=true` rewrites line endings inside temporary repositories, so suites that compare file bytes must run `git config core.autocrlf false` after `git init` (done in `GitWorktreeService.test.ts`). Before these guards, turbo aborted the server test chain at the first failure, so later suites had never actually run on Windows. Two more were found once they did: a suite that faked the home directory by setting `HOME` alone pointed at the real `~/.asterim` on Windows (`os.homedir()` reads `USERPROFILE` there) and migrated the operator's database, leaving a `.bak` snapshot beside it; and a suite that spawned `node_modules/.bin/tsx`, a POSIX shell script. Both are fixed in `CliDatabaseTooling.test.ts`. Rule: a test that touches the home directory must set `HOME` **and** `USERPROFILE`; a test that spawns a CLI must spawn `process.execPath` with the tool's JS entry. A third guard: `kill()` on Windows is `TerminateProcess()`, so SIGTERM-then-SIGKILL grace periods do not exist there (`McpProcessSupervisor.test.ts` checks the escalation timing only off Windows).

**Still open (P1-06):** `AgentMcpIntegration.test.ts` drives a real PTY through node-pty's ConPTY backend, whose helper calls `AttachConsole()` and fails with `Error: AttachConsole failed` when the test process has no console (observed in 1 of 4 full runs on 2026-09-08, and reliably from a console-less shell). Forcing `useConpty: false` in `ProcessManager` avoids the error but changes winpty's output semantics enough to fail 21 other assertions, so it was not kept. The adapter itself is unaffected when the Core is started from a terminal. Run that suite from an interactive terminal until the harness is fixed.

## What must be tested before launch

### Unit (exists, keep green)

Pairing, secret vault, migration engine, approval heuristics, billing signature verification, git managers, Claude Code adapter protocol (`packages/adapters/src/providers/claude/__tests__/ClaudeAdapter.test.ts`).

### Integration (exists for most; add the last row)

| Area | Suite | Status |
| --- | --- | --- |
| Auth middleware, 401 on anonymous | `FleetGovernance.test.ts`, `internal.test.ts` | exists |
| Database open, migrate, snapshot | `MigrationEngine.test.ts`, `CliDatabaseTooling.test.ts` | exists |
| Stripe webhook verification | `BillingService.test.ts` | exists |
| MCP supervisor | `McpProcessSupervisor.test.ts` | exists |
| Native permission round trip (AgentService → ApprovalManager → adapter response) | `AgentService.nativePermission.test.ts` | **to add** (task P0-07) |

### End to end (to add, blocking)

One puppeteer script in `tools/e2e/core-loop.mjs` against the packaged binary with `MOCK_AGENT=true` for CI and against real Claude Code when run by hand:

```text
start Core → open /?pin=<pin> → wizard → add project (temp dir with git init)
→ send "create FILE.txt" → approval card visible → Approve → FILE.txt exists
→ Changes tab lists FILE.txt → restart Core → thread history intact
```

Screenshots land in `docs/screenshots/e2e/` and double as landing-page assets.

### Manual release checklist

`docs/release-gate.md`. Run it in full on Windows and on one Unix.

## Conventions for new tests

- One file per unit, next to the code in `__tests__/`, added to the workspace `test` script.
- Print `N passed, M failed` and exit non-zero on failure.
- No network. Replace Stripe, the relay and agent binaries with in-memory fakes (see `BillingService.test.ts` for the gateway pattern and `ProcessManager.test.ts` for the `Module._load` pattern).
- Assert behaviour a user would notice, not implementation details.
