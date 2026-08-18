Task-ID: P7-02
Status: COMPLETE

# Execution Report: P7-02 — Versioned SQL Migration Engine (DEC-030) & Database Snapshotting

**Task ID:** P7-02
**Phase:** Phase 7 — Release Channels, Database Migration Engine & Runtime Isolation
**Status:** VERIFIED
**Date:** 2026-08-18
**Author:** Claude Code

---

## 1. Summary

The ad-hoc schema bootstrap in `DatabaseService.init()` — ~600 lines of
`CREATE TABLE IF NOT EXISTS` followed by 20 `ALTER TABLE ... try/catch (ignore
if exists)` blocks — has been replaced by a versioned, checksummed,
transactional migration engine as specified by `DEC-030`.

The consolidated Phase 1–6 schema is now migration `001_baseline`
(`apps/server/src/migrations/001_baseline.ts`). `MigrationEngine` tracks applied
versions and their SHA-256 checksums in `schema_migrations`, applies each
pending migration inside `BEGIN IMMEDIATE` / `COMMIT` with a full `ROLLBACK` on
any failure, takes an owner-only `asterim.db.bak.<timestamp>` snapshot before
the first pending migration touches a database that holds data, and adopts
pre-DEC-030 databases onto the versioned history rather than refusing or
rebuilding them.

The single most important property was verified directly rather than argued:
the schema produced by the baseline migration on a fresh database is
**byte-identical** to the schema the old `init()` produced (all 58 tables and
indexes, every column type, nullability, default, primary key, foreign key and
`ON DELETE` action). Evidence in §4.

---

## 2. Files Changed

| File | Status | Purpose |
| :--- | :--- | :--- |
| `apps/server/src/migrations/types.ts` | Created | `MigrationDefinition` / `ColumnAddition` — a migration as data (`sql`, `columns`, `postSql`) so a checksum over it is meaningful. |
| `apps/server/src/migrations/001_baseline.ts` | Created | The consolidated Phase 1–6 schema: 32 tables, 26 indexes, the 20 additive columns the old `ALTER` wall applied, and the legacy `agent_profiles` reconciliation. |
| `apps/server/src/migrations/index.ts` | Created | Ordered migration list + `LATEST_SCHEMA_VERSION`. |
| `apps/server/src/services/MigrationEngine.ts` | Created | The engine: `initMigrationsTable`, `getAppliedMigrations`, `computeChecksum`, `canonicalContent`, `verifyChecksums`, `createSnapshot`, `runMigrations`, `getStatus`. |
| `apps/server/src/utils/permissions.ts` | Created | `enforceOwnerOnly`, extracted verbatim from `DatabaseService` so the engine can apply `0600` to the snapshots it writes without a circular import. |
| `apps/server/src/services/__tests__/MigrationEngine.test.ts` | Created | 55 assertions over fresh install, idempotency, rollback, checksum rejection, snapshots, legacy adoption, engine invariants. |
| `apps/server/src/services/DatabaseService.ts` | Modified | −645 lines. `init()` now sets the two PRAGMAs and delegates to `MigrationEngine.runMigrations()`. Adds `getMigrationStatus()`. `getDb()` / `compact()` / `close()` / `dbPath` / the `resolveDataDir` re-export are unchanged. |
| `apps/server/package.json` | Modified | `MigrationEngine.test.ts` wired into the `test` script, after `ChannelIsolation.test.ts`. |

Nothing was deleted outright: everything removed from `DatabaseService` moved —
the DDL into `001_baseline`, `reconcileLegacyAgentProfiles` into that
migration's `prepare` hook, `enforceOwnerOnly` into `utils/permissions.ts`.
Verified by filtering the removal side of the diff (§6).

---

## 3. Implementation Details

**Migration shape.** A migration is `{ version, name, sql, columns?, postSql?,
prepare? }`. `sql` and `postSql` are executed verbatim; `columns` are
`ALTER TABLE ... ADD COLUMN` applied only where `PRAGMA table_info` shows the
column absent. That presence check is the point: SQLite has no
`ADD COLUMN IF NOT EXISTS`, and the try/catch that used to stand in for one is
exactly what DEC-030 removes — inside a transaction, a swallowed error is
indistinguishable from a real failure. `postSql` exists because
`idx_threads_parent` indexes `threads.parent_thread_id`, a column the same
migration may have just added on a legacy database.

**Migrations are TypeScript modules, not loose `.sql` files.** DEC-030 and the
roadmap both phrase them as sequential `.sql` files. The Core ships as a single
bundled `dist/index.js` from `tsup`, so a runtime `readdir` of a migrations
directory would need the files to survive bundling as assets and to resolve
against a path that differs between `tsx watch` and the packaged binary. A
migration that cannot be found is a database that cannot be opened. The task's
own §3 anticipates this and authorises it ("TypeScript definitions with embedded
SQL strings ... so that packaging with `tsup` bundles cleanly without runtime
asset path fragility"), so no Change Proposal was raised. Verified: the built
bundle contains `schema_migrations` (7 occurrences) and `001_baseline` (3), and
the packaged binary applies the migration at boot (§4).

**Checksums.** `canonicalContent()` joins `sql`, the rendered `ALTER` statements
and `postSql`, collapses runs of whitespace, and SHA-256s the result. Whitespace
is normalised deliberately: the checksum exists to catch a changed *schema*, and
re-indenting a SQL template literal — which Prettier does unasked — changes no
schema. Hashing raw text would turn every reformat into a false tampering report
that bricks every existing database on the next boot. `prepare` is excluded from
the checksum because it is a function whose source text a bundler may legally
rewrite; this is documented at the definition site.

**Ordering inside `runMigrations()`.** History is read and verified *first*, so
a tampered or newer-than-this-build database is rejected before a snapshot is
taken or a statement runs. The snapshot is taken second, so it captures the
state the first migration is about to change. Migrations apply last, one
transaction each, with the `schema_migrations` row inserted inside the same
transaction as the statements it describes — recording it outside would let a
database claim a version it does not have.

**Rejecting unknown versions.** An applied version this build has no definition
for throws ("written by a newer version — upgrade Asterim rather than
downgrading the database"), satisfying the roadmap's "rejects forward migrations
against an unrecognized or higher-versioned database file".

**Snapshots.** `createSnapshot()` checkpoints the WAL (`wal_checkpoint(TRUNCATE)`)
before copying, because in WAL mode recent commits live in the `-wal` sidecar
and a plain copy would be a copy of an earlier moment. The target is
`path.join(path.dirname(dbPath), \`${basename}.bak.${Date.now()}\`)` — derived
from the database path, therefore always inside the channel's resolved data
directory (DEC-029), never elsewhere. `enforceOwnerOnly(target, 0o600)` follows.
A same-millisecond collision appends a counter rather than overwriting an
existing backup. Nothing is snapshotted when the file is `:memory:`, absent,
zero-length, or contains no user tables — the last check keeps a first boot from
littering the data directory with a backup of an empty database.

**Legacy adoption.** `001_baseline` is written to *converge*: every statement is
`IF NOT EXISTS` or presence-checked, so it reaches the same schema from an empty
file or from a pre-DEC-030 database. When no migrations are recorded but
`projects` / `events` / `users` exist, the engine logs that it is adopting the
existing database and runs the baseline, which creates nothing that exists and
adds only the columns an older Asterim never got around to adding. That is
strictly safer than marking version 1 applied without executing it, which would
leave a genuinely old file permanently missing columns the code expects.

**One deliberate behaviour change.** `reconcileLegacyAgentProfiles` used to
swallow its own exceptions and log. It now runs inside the migration transaction,
so a failure rolls back and halts startup instead of being logged past. That is
the DEC-030 semantics ("no silent failures"), and is flagged here rather than
buried. Its log prefix changed from `[Database]` to `[Migration]`; the
`[Database] Using database at:` line the MCP stdio-guard suites assert on is
untouched.

---

## 4. Verification

Everything below was run in this session. `pnpm run <script>` at the repo root
was unavailable in this sandbox (permission-denied), so each workspace's own
script/binary was invoked directly via `pnpm --filter <pkg> ...` — the same
commands `turbo` would run, minus the scheduler.

**New suite (task §9):**

```
pnpm --filter asterim exec tsx src/services/__tests__/MigrationEngine.test.ts
  → 55/55 assertions passed
```

**Channel isolation suite (task §9):** passes inside the full server battery
below (`90/90`).

**Full test battery — 46 suites, 0 failures:**

| Workspace | Suites | Result |
| :--- | ---: | :--- |
| `asterim` | 26 | all pass (`63,60,140,52,51,64,89,111,90,55,21,231,52,102,116,89,43,67,160,169,138,461,196,133,181,208`) |
| `@asterim/web` | 11 | all pass |
| `@asterim/mcp-memory-server` | 7 | all pass (42, 82, 87, 62, 28, 23, 24) |
| `@asterim/relay` | 1 | 71/71 |
| `@asterim/adapters` | 1 | 30/30 |

The 45 pre-existing suites all pass; `MigrationEngine.test.ts` is the 46th.
`grep "FAIL |Failed assertions|ELIFECYCLE"` over every captured run returns
nothing.

**Typecheck — 7 workspaces, 0 errors:** `tsc --noEmit` for `asterim`,
`@asterim/web`, `@asterim/shared`, `@asterim/adapters`, `@asterim/relay`,
`@asterim/mcp-memory-server`; `tsc -b` for `@asterim/marketing` (its own
`typecheck` script).

**Lint — 0 errors across all workspaces.** One error was introduced and fixed
during the cycle: `preserve-caught-error` on the post-rollback rethrow in
`MigrationEngine.ts`, resolved by attaching `{ cause: err }`. Pre-existing
`no-explicit-any` / `no-unused-vars` **warnings** are unchanged in count and
location; `eslint .` exits 0.

**Build — all 7 workspaces:** `@asterim/shared`, `@asterim/adapters`,
`@asterim/web`, `asterim` (tsup + web copy), `@asterim/relay`,
`@asterim/marketing`, `@asterim/mcp-memory-server`. All succeed.

**Schema-equivalence proof (the load-bearing check).** A database was built with
the pre-P7-02 `DatabaseService` and its schema dumped in normalised form
(`sqlite_master` object list + `PRAGMA table_info` + `PRAGMA foreign_key_list` +
`PRAGMA index_list` per table). The same dump was taken from a fresh database
built by the migration engine. `cmp` reports the two files identical — 58
objects, every column type/notnull/default/pk, every FK and `ON DELETE` action,
every index and its uniqueness/origin.

**Real legacy-upgrade rehearsal.** The pre-P7-02 database from that first dump
was then opened with the new code:

```
[MigrationEngine] Existing pre-migration database detected; adopting it onto the versioned schema history.
[MigrationEngine] Pre-migration snapshot written to <dataDir>/asterim.db.bak.1787012195002
[MigrationEngine] Applied 1 (001_baseline).
getMigrationStatus() → { currentVersion: 1, latestVersion: 1, applied: [001_baseline, sha256 e280e64e…], pending: [] }
snapshots: [ 'asterim.db.bak.1787012195002' ]
SCHEMA_MATCHES_PRE_P7_02: true
```

**Packaged-binary boot (production mode).** `node apps/server/dist/index.js`
against a clean data directory on port 3999:

```
[Database] Using database at: /tmp/ast-boot/asterim.db (channel: stable)
[MigrationEngine] Applied 1 (001_baseline).
[MigrationEngine] Applied 1 migration(s); schema is at version 1.
... WELCOME TO ASTERIM v0.1 / Local URL: http://localhost:3999
```

Data dir afterwards: `asterim.db` at `0600`, `vault.salt` at `0600`, directory
at `0700`, and **no** stray `.bak` file — a fresh install does not snapshot.
The process was killed by `timeout`; exit 124 is expected.

**Dev-mode `DatabaseService`.** Exercised throughout — the 26-suite server
battery and the 7-suite MCP battery each construct `DatabaseService` under
`tsx`, and the MCP suites run the *bundled* `dist/index.js` of
`@asterim/mcp-memory-server`, which logs `[MigrationEngine] Applied 1
(001_baseline)` before every handshake. Its `dogfood_scenario` suite additionally
opens the operator's real `~/.asterim/asterim.db` read-only and asserts its size
and SHA-256 are unchanged after the probe.

---

## 5. Acceptance Criteria Review

- [x] **1 — `schema_migrations` tracks version, name, SHA-256 checksum, applied timestamp.** Table created by `initMigrationsTable()` with exactly the DEC-030 columns. Test: *"schema_migrations exists"*, *"one row per applied migration"*, *"the baseline is version 1"*, *"named 001_baseline"*, *"with a 64-character SHA-256 checksum"*, *"and an applied_at timestamp"*, *"the checksum is the hash of the migration content"*. Live confirmation in the adoption rehearsal (§4): checksum `e280e64e…`.
- [x] **2 — All consolidated Phase 1–6 tables and indexes captured in the baseline.** All 32 tables and 26 indexes named in the task's §5.1 are asserted present (*"every consolidated Phase 1–6 table is present"* → `[]` missing; *"and every declared index"* → `[]` missing). Stronger evidence: the normalised schema dump of a migration-built database is `cmp`-identical to one built by the old `init()` (§4).
- [x] **3 — Atomic transaction, complete rollback on any statement error.** `applyMigration()` wraps `prepare` → `sql` → `columns` → `postSql` → the `schema_migrations` insert in `BEGIN IMMEDIATE`/`COMMIT`, with `ROLLBACK` and a rethrow carrying `{ cause }` on failure. Tests: a syntax error in the third statement leaves neither of the two tables the first two statements created and records no version; a **constraint violation** (duplicate PK insert) rolls back identically; the connection is left usable, not stuck mid-transaction; and when migration 2 fails, migration 1 stays committed and only version 1 is recorded.
- [x] **4 — Checksum verification detects modified historical migrations and throws before any forward migration executes.** `verifyChecksums()` runs before pending migrations are selected. Tests: *"the engine reports a checksum mismatch"* and *"and refuses before running the pending migration behind it"* (the version-2 table is absent afterwards). Also covered: a database carrying a version this build does not define is refused (*"a database from a newer Asterim is refused rather than downgraded"*), and re-indenting an applied migration is correctly **not** a mismatch.
- [x] **5 — Owner-only (`0600`) `asterim.db.bak.<timestamp>` before applying pending migrations.** Tests: *"a pending migration produces exactly one snapshot"*, *"named asterim.db.bak.<timestamp>"* (regex `^asterim\.db\.bak\.\d+$`), *"the snapshot is inside the channel data directory"*, *"and is owner-only (0600)"* (POSIX), *"the snapshot holds the rows the database held"* (reopened and queried), *"and predates the migration it was taken for"*. Confirmed live in the legacy rehearsal.
- [x] **6 — Existing databases with pre-existing tables baseline seamlessly without error.** Two independent proofs. Synthetic: a narrow pre-`ALTER`-era database with rows is adopted — rows survive, `projects` gains `workspace_id`/`visibility`, `threads` gains all six later columns, `events` gains `thread_id`, the 28 missing tables are created, `idx_threads_parent` exists, a snapshot was taken first, and a second boot changes nothing. Real: the actual pre-P7-02 `DatabaseService` output adopts to version 1 with `SCHEMA_MATCHES_PRE_P7_02: true`.
- [x] **7 — `MigrationEngine.test.ts` passes, covering fresh install, idempotency, rollback, checksum mismatch, snapshots, legacy migration.** 55/55, all six areas plus engine invariants (duplicate versions rejected at construction; out-of-order definitions applied lowest-version-first). Wired into `apps/server` `test`.
- [x] **8 — Monorepo CI gates pass with 0 errors.** Typecheck 7/7 clean, lint 0 errors, 46/46 test suites pass, all 7 builds succeed. See §4 for the per-workspace invocation note.

### Definition of Done

- [x] `schema_migrations` tracking table with SHA-256 checksums
- [x] Baseline schema migration `001_baseline` created
- [x] `MigrationEngine` with transactional execution and rollback
- [x] Pre-migration snapshotting, permission-guarded (`0600`)
- [x] `DatabaseService` refactored to delegate schema lifecycle
- [x] `MigrationEngine.test.ts` authored and passing
- [x] All 45+ monorepo test suites passing (46 now)
- [x] Production build and typecheck pass across all 7 workspace packages

---

## 6. Git Diff Review

`git diff` reviewed against every criterion before writing this report.

- `DatabaseService.ts`: −645/+23. The addition side is only the two imports, the
  `migrations` field, its construction, the delegating call with its comment,
  and `getMigrationStatus()`. Confirmed no accidental loss by filtering the
  removal side down to non-SQL, non-comment lines: what remains is exactly
  `enforceOwnerOnly` (moved to `utils/permissions.ts`) and
  `reconcileLegacyAgentProfiles` (moved to the baseline's `prepare` hook).
  `getDb()`, `compact()`, `close()`, `dbPath`, `closed` and the `resolveDataDir`
  re-export are byte-identical to before.
- `package.json`: one line, the new suite inserted in phase order.
- No table, column, foreign key or index was renamed, retyped, reordered or
  dropped — proven by `cmp` on the normalised schema dumps, not by inspection.
- No writes outside the resolved data directory: the snapshot path is derived
  from `dbPath` via `path.dirname`, asserted by the test.
- No new dependencies; `node:sqlite` `DatabaseSync` only. `package.json`
  `dependencies` untouched.
- No debug scripts or artifacts added to the repo. Scratch scripts used for the
  schema-equivalence proof were written to `/tmp`, outside the working tree.
- `tests/report.md` was already modified in the working tree before this task
  began (last committed in `38887b3`). It is unrelated to P7-02 and was
  deliberately **left out of the commit** for the orchestrator to handle.

---

## 7. Problems Discovered

1. **`ALTER TABLE ADD COLUMN` cannot live inside a plain SQL migration.** SQLite
   has no `IF NOT EXISTS` form, and the old try/catch is unusable inside a
   transaction — the whole point is that failures must not be swallowed. Solved
   with a declarative `columns` list checked against `PRAGMA table_info`.
2. **Index/column ordering on legacy databases.** `idx_threads_parent` indexes a
   column the same migration adds, so a legacy database would fail if all SQL
   ran in one block. Hence the `postSql` stage.
3. **Snapshot-on-fresh-install.** The first implementation snapshotted every
   first boot: `new DatabaseSync(path)` plus `PRAGMA journal_mode = WAL` writes a
   4 KB header, so the "file is non-empty" test passed on an empty database.
   Tightened to "has at least one user table besides `schema_migrations`", and
   pinned by a test.
4. **WAL and file copies.** A naive `copyFileSync` in WAL mode can miss recent
   commits still in the `-wal` sidecar. The snapshot checkpoints first.
5. **Checksum fragility vs. formatters.** Hashing raw SQL text would let a
   Prettier pass brick every deployed database. Whitespace is normalised before
   hashing, and a test asserts re-indenting an applied migration is not treated
   as tampering.
6. **Environment note:** root-level `pnpm run typecheck|lint|test|build` were
   permission-denied in this sandbox. Every gate was run per-workspace instead
   (§4); no gate was skipped.

---

## 8. Architectural Concerns

1. **`CLAUDE.md` is stale on testing.** It states "There is **no test runner or
   test script anywhere in the repo**" and that CI runs only `lint` and `build`.
   Both are now false: there are 46 suites across 5 workspaces behind
   `turbo run test`, and `.github/workflows/ci.yml` runs `typecheck`, `lint`,
   `test` and `build` (verified). The gate is real; only the guidance file is
   wrong, and it is the file a fresh agent reads first.
2. **DEC-030 and the roadmap say `.sql` files in `packages/server/src/migrations/`.**
   Two mismatches with reality: the path is `apps/server/`, not `packages/`, and
   `.sql` assets do not survive `tsup` bundling without extra machinery. The task
   brief already authorised TypeScript modules; DEC-030's wording may be worth
   amending so the next reader is not sent looking for `.sql` files.
3. **Phase 7 deliverables not in this task's scope, still open:** the CLI
   utilities `asterim db:migrate` / `db:status` / `db:snapshot`,
   `asterim data:clone|backup|restore`, and the worktree boot-time orphan
   sweeper. `getMigrationStatus()` on `DatabaseService` is the read side
   `db:status` will need; nothing else exists yet.
4. **Snapshot retention is unbounded.** Every future migration leaves another
   `asterim.db.bak.*` beside the database, and each is a full copy. A retention
   policy (keep N most recent) belongs with the `db:snapshot` CLI work.
5. **Migration 1 is a large baseline.** Unavoidable for the first cut, but the
   next schema change must be `002_*` — editing `001_baseline` now trips the
   checksum guard on every existing installation. This is stated in the header
   comment of `migrations/index.ts`.

---

## 9. Recommended Next Step

**P7-03 — Migration & Snapshot CLI (`asterim db:migrate`, `db:status`,
`db:snapshot`) plus data promotion (`data:clone --from stable --to dev`,
`data:backup`, `data:restore`).** The engine now exposes exactly the primitives
these commands need (`runMigrations`, `getStatus`, `createSnapshot`), and
`data:clone` is the piece that makes the P7-01 dev channel genuinely usable —
seeding `~/.asterim-dev` from a stable snapshot without touching production.
Snapshot retention (concern 4) folds naturally into the same task.
