Task-ID: P7-03
Phase: 7

# [P7-03] — Database Migration & Snapshot CLI Tooling and Cross-Channel Data Promotion (DEC-029, DEC-030)

**Task ID:** P7-03  
**Phase:** Phase 7 — Release Channels, Database Migration Engine & Runtime Isolation  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-18  

---

## 1. Objective

Implement the command-line interface (CLI) utilities for database migration inspection (`asterim db:status`), explicit forward migration execution (`asterim db:migrate`), manual snapshot creation and retention pruning (`asterim db:snapshot`), and cross-channel data cloning, backup, and restoration (`asterim data:clone`, `asterim data:backup`, `asterim data:restore`), providing full developer control over database lifecycle across Stable and Development channels governed by `DEC-029` and `DEC-030`.

---

## 2. Why This Task Exists

With Task P7-01 establishing dual-channel runtime isolation (`~/.asterim` vs `~/.asterim-dev`) and Task P7-02 delivering the transactional SQL `MigrationEngine`, developers now require user-facing CLI utilities to:
1. Inspect migration status and checksum integrity from the command line (`db:status`).
2. Run migrations explicitly during deployment or CI without booting the full HTTP server (`db:migrate`).
3. Take on-demand snapshots before risky maintenance and automatically enforce snapshot retention limits (`db:snapshot`).
4. Safely seed the Development channel (`~/.asterim-dev`) from a Stable channel snapshot without risking production data (`data:clone --from stable --to dev`).
5. Perform instantaneous disaster recovery backups and restorations (`data:backup`, `data:restore`).

---

## 3. Context & Architecture (DEC-029, DEC-030)

- **CLI Command Invocation Structure**:
  - The `asterim` binary (`apps/server/src/index.ts` / entrypoint) must detect when it is invoked with CLI subcommands (e.g. `process.argv.slice(2)` containing `db:*` or `data:*` or `--help`).
  - When a CLI subcommand is provided, the CLI dispatcher executes the requested operation, prints formatted stdout output, and exits cleanly (`process.exit(0)` on success or `process.exit(1)` on error) without initializing the Fastify HTTP listener, socket manager, or background services.
  - When no subcommand is provided (e.g. `asterim` or `pnpm dev`), the standard server boot sequence runs unchanged.
- **Channel Resolution**:
  - All CLI subcommands respect the active channel (`--channel <stable|dev>` flag or `ASTERIM_CHANNEL` env var) via `resolveDataDir(channel)`.
- **CLI Commands Specification**:
  1. **`db:status`**:
     - Queries `MigrationEngine.getStatus()`.
     - Displays formatted summary: active release channel, database file path, current schema version, latest defined version, status of each migration (version, name, checksum prefix, applied timestamp, or `[PENDING]`), and existing snapshots list.
  2. **`db:migrate [--dry-run]`**:
     - Executes pending migrations on the target channel database.
     - Supports `--dry-run` to report pending migrations without applying changes or creating snapshots.
     - On execution, creates pre-migration snapshot (owner-only `0600`), executes migrations in atomic transactions, and logs results.
  3. **`db:snapshot [--keep <count>]`**:
     - Manually checkpoints WAL and creates `asterim.db.bak.<timestamp>` with `0600` permissions.
     - Enforces snapshot retention policy: prunes oldest `.bak` files exceeding `--keep <count>` (default keep: 10).
  4. **`data:clone --from <source> --to <target> [--force]`**:
     - Clones database from source channel (e.g. `stable`) to destination channel (e.g. `dev`).
     - Refuses if source and target channels are identical.
     - Refuses if source database does not exist.
     - Checkpoints WAL on source, copies database safely to destination `asterim.db` with `0600` permissions and directory `0700`.
     - If destination database already exists and has data, creates a safety backup at destination before overwriting (or requires `--force` if specified).
  5. **`data:backup [--out <path>]`**:
     - Creates a standalone backup of active channel database to specified path or default timestamped backup location with `0600` permissions.
  6. **`data:restore --file <path> [--force]`**:
     - Restores target database from specified backup file with `0600` permissions.
     - Takes a safety backup of existing database before restoring.
- **Snapshot Retention Pruner**:
  - `pruneSnapshots(dataDir: string, maxKeep: number = 10): string[]` helper that scans `asterim.db.bak.*`, sorts by timestamp, deletes older backups exceeding `maxKeep`, and returns list of pruned file names.

---

## 4. Repository Evidence & Key Files

- `apps/server/src/index.ts` — Server entrypoint and CLI argument dispatch point.
- `apps/server/src/services/MigrationEngine.ts` — Engine methods `getStatus()`, `runMigrations()`, `createSnapshot()`.
- `apps/server/src/services/DatabaseService.ts` — Database connection owner and migration status bridge.
- `apps/server/src/utils/channel.ts` — `resolveDataDir()`, `getAsterimChannel()`, `describeChannel()`.
- `apps/server/src/utils/permissions.ts` — `enforceOwnerOnly()` helper.
- `blueprint/ROADMAP.md` (Section 4 Initiative A & Section 5 Phase 7 Deliverable 3).
- `decisions.md` (`DEC-029`, `DEC-030`).

---

## 5. Implementation Scope

1. **CLI Engine & Command Handlers (`apps/server/src/cli/`)**:
   - Create `apps/server/src/cli/index.ts` (or modular command handlers `apps/server/src/cli/db.ts`, `apps/server/src/cli/data.ts`, `apps/server/src/cli/snapshots.ts`).
   - Implement command parsers and formatted console formatters for:
     - `asterim db:status`
     - `asterim db:migrate [--dry-run]`
     - `asterim db:snapshot [--keep <count>]`
     - `asterim data:clone --from <channel> --to <channel> [--force]`
     - `asterim data:backup [--out <path>]`
     - `asterim data:restore --file <path> [--force]`
     - `asterim --help` / `asterim help`
   - Implement `pruneSnapshots(dataDir, keepCount)` in `apps/server/src/cli/snapshots.ts` (or `MigrationEngine.ts`).

2. **Hook CLI Dispatcher into `apps/server/src/index.ts`**:
   - Add early CLI argument check before starting Fastify HTTP server.
   - If CLI command is provided, run CLI handler and exit immediately; otherwise continue server startup.

3. **Automated Unit & Integration Test Suite (`apps/server/src/services/__tests__/CliDatabaseTooling.test.ts`)**:
   - Test `db:status` formatting and output across clean, migrated, and pending states.
   - Test `db:migrate` with normal execution and `--dry-run`.
   - Test `db:snapshot` and snapshot retention pruning (e.g. keeping N latest, pruning older).
   - Test `data:clone --from stable --to dev` verifying file copy, permissions (`0600`), and source preservation.
   - Test `data:backup` and `data:restore` with integrity checks.
   - Test error handling (invalid channels, non-existent files, identical source/dest clone).
   - Wire into `apps/server/package.json` `"test"` script.

---

## 6. Constraints & Explicitly Forbidden Changes

- Do NOT break or slow down the standard server boot path when no CLI command is given.
- Do NOT modify production database files without taking a safety snapshot first.
- Do NOT write backup or cloned files outside the target channel directory unless an explicit `--out` path was passed to `data:backup`.
- Enforce strict owner-only permissions (`0600` files, `0700` directories) on all snapshot, clone, and backup targets.
- Do NOT add heavy external CLI frameworks (use lightweight argument parsing / node built-ins).
- Maintain 100% test pass rate across all 46 existing monorepo test suites.

---

## 7. Acceptance Criteria

1. `asterim db:status` displays human-readable diagnostic status including current version, latest version, applied migrations with SHA-256 checksums, pending migrations, and existing snapshot list.
2. `asterim db:migrate` applies pending migrations transactionally with automatic pre-migration snapshotting, and `--dry-run` reports pending migrations without modifying disk.
3. `asterim db:snapshot` creates an owner-only (`0600`) timestamped snapshot `asterim.db.bak.<timestamp>` and prunes older snapshots beyond the retention threshold (`--keep <count>`, default 10).
4. `asterim data:clone --from <source> --to <target>` safely clones source database to destination channel directory with `0600` permissions without modifying source data.
5. `asterim data:backup` and `asterim data:restore` enable full database export and safe restoration with automatic pre-restore safety snapshots.
6. Invoking CLI commands exits cleanly without starting the HTTP server or listening on network ports.
7. `CliDatabaseTooling.test.ts` passes with 100% assertions covering status, migrate, snapshot, retention pruning, clone, backup, restore, and error guards.
8. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`.

---

## 8. Definition of Done

- [ ] CLI dispatcher and command handlers implemented (`apps/server/src/cli/`)
- [ ] `db:status`, `db:migrate`, `db:snapshot` implemented and verified
- [ ] `data:clone`, `data:backup`, `data:restore` implemented and verified
- [ ] Snapshot retention pruning implemented (`pruneSnapshots`)
- [ ] `apps/server/src/index.ts` wired to dispatch CLI subcommands before server boot
- [ ] `CliDatabaseTooling.test.ts` authored and passing
- [ ] All 46+ monorepo test suites passing cleanly
- [ ] Monorepo typecheck, lint, and build pass across all 7 workspace packages

---

## 9. Verification Commands

```bash
# Run new CLI Database Tooling test suite
pnpm --filter asterim exec tsx src/services/__tests__/CliDatabaseTooling.test.ts

# Run Migration Engine and Channel Isolation test suites
pnpm --filter asterim exec tsx src/services/__tests__/MigrationEngine.test.ts
pnpm --filter asterim exec tsx src/services/__tests__/ChannelIsolation.test.ts

# Run full monorepo test battery
pnpm run test

# Run monorepo typecheck, lint, and build
pnpm run typecheck
pnpm run lint
pnpm run build
```

---

## 10. Self-Review Requirements

Before submitting `reports/current.md`, Claude Code must execute the full self-review protocol:
1. Run `pnpm --filter asterim exec tsx src/services/__tests__/CliDatabaseTooling.test.ts`.
2. Inspect `git diff` to verify clean changes, proper permission enforcement (`0600`), and zero regressions to standard server startup.
3. Test direct CLI invocations (`db:status`, `db:snapshot`, `data:clone`) to confirm clean process exit without starting the HTTP listener.
4. Verify that all monorepo test suites pass with 0 failures.
5. Check every numbered acceptance criterion in Section 7.

---

## 11. Required Report

Write the execution report to `reports/current.md` matching the standard schema defined in `AGENTS.md` and `CLAUDE.md`.
