Task-ID: P7-03
Status: COMPLETE

# Execution Report: P7-03 — Database Migration & Snapshot CLI Tooling and Cross-Channel Data Promotion

**Task ID:** P7-03
**Phase:** Phase 7 — Release Channels, Database Migration Engine & Runtime Isolation
**Status:** VERIFIED
**Date:** 2026-08-18
**Author:** Claude Code

---

## 1. Summary

The `asterim` binary now has two jobs. Invoked with a `db:*` or `data:*` subcommand it operates on
the channel's database, prints to the terminal and exits; invoked with nothing it boots the Core
exactly as before.

Six commands are implemented — `db:status`, `db:migrate [--dry-run]`, `db:snapshot [--keep <n>]`,
`data:clone --from --to [--force]`, `data:backup [--out]`, `data:restore --file [--force]` — plus
`--help`. All of them respect the DEC-029 channel (`--channel`, `ASTERIM_CHANNEL`, `NODE_ENV`),
delegate migration work to the DEC-030 `MigrationEngine` rather than reimplementing it, and write
every file they produce owner-only (0600) inside an owner-only directory (0700).

The structural point of the change is the entrypoint split. `src/index.ts` used to import Fastify,
the socket manager, `dbService` and `initLogger()` at module scope. Because ES imports are hoisted,
a CLI check placed anywhere in that file would have run *after* the server had already been
constructed and after stdout had been redirected into `server.log`. The boot sequence therefore
moved verbatim to `src/server.ts`, and `src/index.ts` is now 29 lines that reach it through a lazy
`require` a CLI invocation never executes. "`asterim db:status` does not start a server" is a
property of the module graph, not something to remember — confirmed in the bundled output
(`init_server()` is an `__esm` lazy wrapper called only on the else-branch) and by a real subprocess
test.

**Non-obvious decision, flagged for review.** The task's §3 wording for `data:clone` — "creates a
safety backup at destination before overwriting (or requires `--force` if specified)" — reads two
ways. I implemented the strict reading: overwriting a destination that already has a database
**requires `--force`**, and the safety backup is taken regardless. `data:restore` follows the same
rule for consistency. The plain `data:clone --from stable --to dev` of Acceptance Criterion 4 works
without `--force` for the seeding case the criterion describes (destination absent or empty), which
is the DEC-029 use case. If Antigravity intended the permissive reading (silent overwrite after a
safety backup), the change is a two-line removal of the two guards in `apps/server/src/cli/data.ts`.

---

## 2. Files Changed

| File | Status | Purpose |
| :--- | :--- | :--- |
| `apps/server/src/index.ts` | Modified | Reduced to the entrypoint: dispatch to the CLI, or lazily `require('./server')`. |
| `apps/server/src/server.ts` | Created | The former `index.ts`, byte-for-byte, plus a header comment explaining the split. |
| `apps/server/src/cli/index.ts` | Created | `isCliInvocation`, `runCli`, the command table and `--help`. |
| `apps/server/src/cli/args.ts` | Created | Dependency-free argument parser (`--k v`, `--k=v`, bare flags). |
| `apps/server/src/cli/context.ts` | Created | `CliIo`, `CliError`, channel/target resolution, byte & timestamp formatting. |
| `apps/server/src/cli/sqlite.ts` | Created | Connection opening (write vs. read mode), SQLite header check, WAL checkpoint. |
| `apps/server/src/cli/snapshots.ts` | Created | `listSnapshots`, `snapshotTargetPath`, `copyOwnerOnly`, `createSnapshot`, **`pruneSnapshots`**. |
| `apps/server/src/cli/db.ts` | Created | `db:status`, `db:migrate`, `db:snapshot`, and the non-mutating `readStatus`. |
| `apps/server/src/cli/data.ts` | Created | `data:clone`, `data:backup`, `data:restore`. |
| `apps/server/src/services/__tests__/CliDatabaseTooling.test.ts` | Created | 157-assertion suite covering all eight scope areas. |
| `apps/server/package.json` | Modified | Added the new suite to `"test"` (one line, after `MigrationEngine.test.ts`). |

No other file in the repository was touched. `tests/report.md` carries a pre-existing uncommitted
change from the previous P7-02 test gate; it was left alone and is not part of this commit.

---

## 3. Implementation Details

### 3.1 CLI dispatch (`src/index.ts` → `src/cli/index.ts`)

`isCliInvocation(argv)` returns true for the first non-empty token when it is `help`/`--help`/`-h`
or starts with `db:` / `data:`. Prefix matching rather than exact matching is deliberate: a
misspelled `db:staus` gets "Unknown command" and exit 1 instead of silently booting the Core and
binding a port. Anything else (`--inspect`, a bare invocation) falls through to the server.

`runCli(argv, io)` is synchronous and returns an exit code rather than calling `process.exit`, which
is what lets every command be exercised in-process by the test suite. `io` is a two-method interface
(`out`/`err`) so output is capturable; the default writes to real stdout/stderr. `CliError` carries
operator-facing failures (exit 1, message only); anything else prints the stack, because that is the
difference between a broken database and a bug.

### 3.2 Non-mutating reads

`MigrationEngine.getStatus()` calls `initMigrationsTable()`, which is a `CREATE TABLE` — harmless
but a write, and a write is exactly what `--dry-run` promises not to do. `readStatus(db)` in
`cli/db.ts` instead looks `schema_migrations` up in `sqlite_master` and reports a database that has
never been migrated as "everything pending". A channel whose `asterim.db` does not exist is never
opened at all, so `db:status` on a fresh machine creates nothing.

Connection opening is split for the same reason. `openDatabase` sets `journal_mode = WAL` and
`busy_timeout` and is used only by `db:migrate`, which owns the file. `openDatabaseForReading` sets
only `busy_timeout` — a per-connection setting that does not touch the file — and is used by
`db:status`, the dry run, `db:snapshot`, and the source side of `data:clone`/`data:backup`.
`journal_mode` lives in the database header, so setting it would convert a rollback-journal file;
a clone must not be able to alter its source.

### 3.3 Snapshots and retention

Naming matches `MigrationEngine.createSnapshot` exactly — `asterim.db.bak.<ms>`, with a `-N`
disambiguator when two land in the same millisecond — so engine snapshots, `db:snapshot` output,
`data:backup` defaults and every safety backup form one series under one retention policy.

`pruneSnapshots(dataDir, maxKeep = 10, base = 'asterim.db')` sorts by the timestamp *encoded in the
name*, not by mtime: mtime changes when a data directory is copied or restored, and "oldest" has to
survive that. It deletes the oldest beyond `maxKeep`, returns the names it removed, and never throws
— a failed retention pass is not a reason for the command that triggered it to fail.

Every copy is preceded by `PRAGMA wal_checkpoint(TRUNCATE)`. In WAL mode recent commits live in the
`-wal` sidecar, so a copy taken without the checkpoint is a copy of an earlier, unknowable moment.
A checkpoint that is blocked by another reader prints a note and continues; a slightly stale backup
beats no backup.

### 3.4 Guards on the destructive paths

- Every path that replaces a database first removes the destination's `-wal`/`-shm` sidecars.
  Leaving them beside a *different* database makes SQLite either replay another file's changes or
  refuse to open the result — this is the step whose absence corrupts.
- `data:clone` refuses: identical `--from`/`--to`; two channels that `ASTERIM_DATA_DIR` has
  collapsed onto one directory (the resolver lets it override the channel, so the "clone" would be
  a file copied over itself); a source with no database; and an existing destination without
  `--force`.
- `data:restore` refuses a missing `--file`, a non-existent file, a file whose first 16 bytes are
  not `SQLite format 3\0`, `--file` pointing at the live database, and an existing target without
  `--force`.
- `data:backup` refuses `--out` pointing at the live database. `--out` naming an existing directory
  writes a timestamped snapshot inside it rather than failing.
- After every copy, the result is opened and its schema version read, so "verified:" in the output
  means the file actually opens.
- Two shell-footgun fixes surfaced while writing the tests and are covered by assertions: `--keep -2`
  is now parsed as the value `-2` and rejected (a leading-dash heuristic alone read it as a bare
  boolean flag and silently fell back to the default), and an empty `--out=` / `--keep=` — what a
  shell produces from an unset variable — reads as absent rather than as `""`/`0`, so `--keep=$UNSET`
  cannot prune every snapshot a channel has.

---

## 4. Verification

Every command below was run to completion in this session. Node v24.13.1, turbo 2.9.18.

| Command | Result |
| :--- | :--- |
| `pnpm --filter asterim exec tsx src/services/__tests__/CliDatabaseTooling.test.ts` | **157/157 assertions passed**, exit 0 |
| `pnpm --filter asterim exec tsx src/services/__tests__/MigrationEngine.test.ts` | **55/55 assertions passed** (via `pnpm test`) |
| `pnpm --filter asterim exec tsx src/services/__tests__/ChannelIsolation.test.ts` | **90/90 assertions passed** (via `pnpm test`) |
| `pnpm typecheck` | **11/11 turbo tasks successful**, 0 TS errors |
| `pnpm lint` | **7/7 turbo tasks successful**, 0 errors (warnings only, all pre-existing) |
| `pnpm test` | **9/9 turbo tasks successful — 47 suites, 5621/5621 assertions, 0 failures** |
| `pnpm build` | **7/7 turbo tasks successful** |

The assertion arithmetic confirms zero regressions: the P7-02 gate recorded 46 suites and
5464 assertions; 5464 + 157 = **5621**, and every suite reported `N/N`.

### Live invocations against the packaged bundle

Run after `pnpm build`, against the operator's real `~/.asterim` (read-only commands only):

```
$ node apps/server/dist/index.js db:status
Asterim — database status

  Channel           stable
  Data directory    /home/qhukz/.asterim
  Database          /home/qhukz/.asterim/asterim.db (14.1 MB)
  Schema version    1
  Latest version    1
  State             up to date

Migrations (1 applied, 0 pending)
  [applied] 1    001_baseline                sha256:e280e64ed8a1…  2026-08-18T00:06:16.454Z

Snapshots (1)
  asterim.db.bak.1787011576448      14.1 MB     2026-08-18T00:06:16.448Z

$ node apps/server/dist/index.js db:migrate --dry-run
Asterim — database migrate (dry run)
  ...
Nothing to do — schema is at version 1.

$ node apps/server/dist/index.js --help      # full command list, exit 0
```

All three returned to the shell immediately. No listener, no `[DEBUG] Registering …`, no
`[Server] … listening on port`.

### Bundle inspection

`apps/server/dist/index.js` ends with:

```js
var argv = process.argv.slice(2);
if (isCliInvocation(argv)) { process.exit(runCli(argv)); } else { init_server(); }
```

`init_server` is declared as `var init_server = __esm({ ... })` — esbuild's lazy ESM wrapper — and
is referenced exactly once, on the else-branch. The server module graph is therefore not evaluated
on any CLI path in the packaged binary either.

---

## 5. Acceptance Criteria Review

- [x] **1. `db:status` displays current version, latest version, applied migrations with SHA-256 checksums, pending migrations, and snapshots.**
  Live output above shows all five. Suite: `db:status now reports the latest schema version`,
  `the baseline is listed as applied`, `and a SHA-256 checksum prefix` (`/sha256:[0-9a-f]{12}…/`),
  `the applied timestamp is an ISO instant`, `every built-in migration is listed as pending`,
  `and there are no snapshots` / `Snapshots (N)` block.

- [x] **2. `db:migrate` applies pending migrations transactionally with automatic pre-migration snapshotting; `--dry-run` reports without modifying disk.**
  The real run delegates to `MigrationEngine.runMigrations()`, whose `BEGIN IMMEDIATE` boundaries,
  checksum verification and pre-migration snapshot are covered by the P7-02 suite (55/55, re-run
  green here). Suite: `the migration succeeds`, `it reports applying 1 migration(s)`,
  `the database now exists`, `re-running applies nothing`. Dry run: `the dry run succeeds`,
  `it names the migrations it would apply`, `it says it wrote nothing`, and
  `and the database still does not exist` — asserted by reading the directory, which is empty.

- [x] **3. `db:snapshot` creates an owner-only (0600) `asterim.db.bak.<timestamp>` and prunes beyond `--keep` (default 10).**
  Suite: `exactly one snapshot exists`, `named asterim.db.bak.<timestamp>`, `at mode 0600`,
  `and it holds the rows the database held`. Retention end-to-end: eight hand-made snapshots plus a
  fresh one, `db:snapshot --keep 3` → `exactly three snapshots survive`, `the new one is among them`,
  `and the oldest hand-made ones are gone`, `the command lists what it removed`. Unit-level:
  `pruning to 2 removes the three oldest`, `leaving the two newest`, `the database itself is
  untouched`, `and so is anything else in the directory`, `pruning again removes nothing`,
  `pruning to 0 removes all of them`. Default of 10 is `DEFAULT_SNAPSHOT_RETENTION`, exercised by
  `an empty --keep= falls back to the default retention`.

- [x] **4. `data:clone --from <source> --to <target>` clones to the destination channel at 0600 without modifying the source.**
  Suite, against a fake `HOME` with real `~/.asterim` / `~/.asterim-dev` paths:
  `the clone succeeds`, `the dev channel now has a database`, `holding the rows the stable database
  held`, `at mode 0600`, `inside a 0700 directory that did not exist before`,
  `the stable database still has its row`, `and the stable database is still untouched` (asserted
  again after the forced re-clone). Guards: `cloning from a channel with no database fails`,
  `cloning a channel onto itself fails`, `an unrecognised channel fails`, `a missing --to fails`,
  `a clone between channels collapsed onto one directory fails`.

- [x] **5. `data:backup` and `data:restore` enable export and safe restoration with automatic pre-restore safety snapshots.**
  Backup: `the backup succeeds`, `owner-only (0600)`, `in a directory it created 0700`,
  `and it holds the live rows`, `a backup with no --out succeeds` landing in the channel directory.
  Restore: `with --force the restore succeeds`, `a safety backup was taken first`,
  `so the stable directory has one more snapshot`, `the database is back to what the backup held`,
  `and the rows it replaced survive in the safety backup`. Guards: missing `--file`, non-existent
  file, non-SQLite file (header check), and `--file` naming the live database.

- [x] **6. CLI commands exit cleanly without starting the HTTP server or listening on a port.**
  Real subprocess (`spawnSync` of `tsx src/index.ts db:status` with `PORT=39217`):
  `the process exits 0`, `it did not time out`, `the status went to real stdout rather than into
  server.log`, `initLogger never ran, so no server.log was created`, `and db:status created no
  database`, `nothing from the server boot sequence was printed`. Also `--help exits 0 as a
  subprocess too` and `an unknown command exits 1 as a subprocess`. Corroborated by the bundle
  inspection in §4 and by the three live `dist/index.js` runs.

- [x] **7. `CliDatabaseTooling.test.ts` passes with assertions covering status, migrate, snapshot, retention pruning, clone, backup, restore, and error guards.**
  **157/157 assertions, exit 0**, across eight sections: argument parsing & dispatch detection,
  `db:status` on an absent database, `db:migrate` dry/real/idempotent, `db:snapshot` + retention
  (both end-to-end and unit-level), `data:clone` + guards, `data:backup`/`data:restore` + guards,
  help & unknown commands, and the subprocess "not a server" section. Wired into
  `apps/server/package.json` `"test"`.

- [x] **8. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all pass with 0 errors.**
  Table in §4: 11/11, 7/7 (0 errors), 9/9 (47 suites, 5621/5621), 7/7.

### Definition of Done

- [x] CLI dispatcher and command handlers implemented (`apps/server/src/cli/`)
- [x] `db:status`, `db:migrate`, `db:snapshot` implemented and verified
- [x] `data:clone`, `data:backup`, `data:restore` implemented and verified
- [x] Snapshot retention pruning implemented (`pruneSnapshots` in `cli/snapshots.ts`)
- [x] `apps/server/src/index.ts` wired to dispatch CLI subcommands before server boot
- [x] `CliDatabaseTooling.test.ts` authored and passing (157/157)
- [x] All monorepo test suites passing cleanly (47 suites, 0 failures)
- [x] Monorepo typecheck, lint, and build pass across all workspace packages

---

## 6. Git Diff Review

`git status --short` at report time: `M apps/server/package.json`, `M apps/server/src/index.ts`,
`?? apps/server/src/cli/`, `?? apps/server/src/server.ts`,
`?? apps/server/src/services/__tests__/CliDatabaseTooling.test.ts` (plus the pre-existing
`M tests/report.md`, untouched).

Reviewed in full:

- **`src/server.ts` is byte-identical to the previous `src/index.ts`.** Verified with
  `git show HEAD:apps/server/src/index.ts | diff - apps/server/src/server.ts`, whose entire output is
  the 16-line header comment added at the top. No line of the boot sequence changed, so the
  "do not break or slow down the standard server boot path" constraint is satisfied by construction.
- **`src/index.ts`** is 29 lines: one import, one argv slice, one branch. `pnpm dev`
  (`tsx watch src/index.ts`) and the `bin` entry both still resolve to it.
- **`package.json`** changes exactly one token in the `test` script.
- No route, service, socket, adapter, store, schema or migration file was modified. No new runtime
  dependency was added — the CLI uses `node:fs`, `node:path`, `node:sqlite` and existing internals
  only. No credential handling, auth or entitlement code was touched.
- Permission enforcement audited across the diff: every `fs.copyFileSync` in the new code is
  immediately followed by `enforceOwnerOnly(target, 0o600)`, and every directory creation uses
  `{ mode: 0o700 }` plus `enforceOwnerOnly(dir, 0o700)` (`cli/snapshots.ts:copyOwnerOnly`,
  `cli/db.ts:ensureChannelDir`, `cli/data.ts`).
- File placement audited: snapshots and safety backups are always `path.dirname(dbPath)`-relative,
  so nothing lands outside the target channel directory. The single exception is `data:backup --out`,
  which the task explicitly permits.
- New files are Prettier-clean (`prettier --check` on `src/cli/**`, the new test, and `src/index.ts`
  passes). `src/server.ts` was deliberately **not** reformatted so it stays identical to the file it
  replaced.

---

## 7. Problems Discovered

1. **Import hoisting made an in-file CLI guard impossible.** The original `index.ts` opened the
   database and redirected stdout at module scope, both before any statement in the file could run.
   Hence the `server.ts` split. Worth knowing for anyone who later wants to add a flag that must be
   read before boot.
2. **`initLogger()` would have swallowed the entire CLI output.** It replaces `process.stdout.write`
   with a writer into `server.log`. Had the CLI been reachable after it, `asterim db:status` would
   have printed nothing to the terminal and quietly truncated the running Core's log. The suite
   asserts `server.log` is never created on a CLI path, which is the cheapest available proof that
   `initLogger` did not run.
3. **`ASTERIM_DATA_DIR` collapses both channels onto one directory.** `resolveDataDir` lets it win
   over the channel — correct, and every test suite in the repo depends on it — but it makes
   `data:clone --from stable --to dev` a no-op file-copy-over-itself when it is set. Now an explicit
   error that names the variable. It also means the clone tests must run against a fake `HOME` with
   the variable unset, as `ChannelIsolation.test.ts` does.
4. **Stale `-wal`/`-shm` sidecars are the corruption risk in this task**, not the copy itself. They
   describe the file they sit beside; leaving them next to a replaced database is worse than the
   state the operator was trying to fix. Removed explicitly on both replace paths.
5. **Two argument-parser footguns**, both found by tests rather than by reading: `--keep -2` read as
   a bare boolean (silently falling back to the default retention instead of erroring), and an empty
   `--keep=` reading as `0` (which would prune every snapshot). Both fixed and pinned by assertions.
6. **`CLAUDE.md` is stale on one point.** It states "there is **no test runner or test script
   anywhere in the repo**". `apps/server/package.json` has had a `test` script for several phases,
   `pnpm test` runs 47 suites across 9 packages, and `tests/current.md` gates on it. Not changed
   here — outside task scope, and `CLAUDE.md` is Antigravity's to amend.

---

## 8. Architectural Concerns

1. **`data:clone`/`data:restore` `--force` semantics** — see the flag in §1. One sentence from
   Antigravity settles it; the change is two lines either way.
2. **Migration status is now read in two places.** `MigrationEngine.getStatus()` (mutating: it
   creates `schema_migrations`) and `cli/db.ts:readStatus()` (non-mutating). They must agree. The
   cleaner long-term shape is a read-only `getStatus()` on the engine with `initMigrationsTable()`
   moved into `runMigrations()` alone, at which point `readStatus` deletes itself. That is a change
   to a P7-02 deliverable, so I did not make it unilaterally.
3. **`data:clone` copies the database only, not the rest of the channel directory.** The vault salt,
   `server.json`, the skills directory and `pairing_pin.txt` stay put. That is right for DEC-029
   isolation, but it means a cloned dev channel cannot decrypt secrets that were encrypted under the
   stable channel's vault key. Whether Phase 7 wants a `--with-secrets` mode, or an explicit note in
   the docs, is a product call.
4. **No `db:rollback`.** DEC-030 is forward-only by design, and restoring a pre-migration snapshot
   via `data:restore --file` is the sanctioned way back. Worth stating in operator docs so nobody
   goes looking for a down-migration.
5. **The `asterim` binary is now the CLI too.** Any future subcommand must be added to
   `CLI_COMMANDS`, and the `db:` / `data:` prefix convention in `isCliInvocation` must hold — a
   subcommand named without a namespace prefix would fall through to the server boot path.

---

## 9. Recommended Next Step

Phase 7 Deliverable 3 is complete: channels (P7-01), the migration engine (P7-02) and the operator
tooling over both (P7-03). Recommended next task is the Phase 7 verification gate — a
`tests/current.md` assignment re-running the three Phase 7 suites plus the full battery against a
clean checkout, and exercising `db:migrate` on a genuine pre-DEC-030 database copied from a real
`~/.asterim` to confirm adoption end to end through the CLI rather than only through the engine's
own suite.

If Antigravity would rather close the surface first, the two smallest follow-ups are the `--force`
semantics decision (§8.1) and surfacing `db:status` in the dashboard's system panel, which now has a
CLI-equivalent data source behind `dbService.getMigrationStatus()`.
