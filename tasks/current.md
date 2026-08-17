Task-ID: P7-02
Phase: 7

# [P7-02] — Versioned SQL Migration Engine (DEC-030) & Database Snapshotting

**Task ID:** P7-02  
**Phase:** Phase 7 — Release Channels, Database Migration Engine & Runtime Isolation  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-18  

---

## 1. Objective

Implement the Versioned SQL Migration Engine (`MigrationEngine.ts`) governed by `DEC-030`: replace the legacy ad-hoc `ALTER TABLE ... try/catch` blocks in `DatabaseService.ts` with a transactional, checksummed migration engine, create the baseline schema migration (`001_baseline`), enforce SHA-256 checksum verification and transactional rollback on failure, implement automated pre-migration database snapshotting (`asterim.db.bak.<timestamp>`), ensure seamless backward-compatibility with existing user databases, and author a comprehensive automated test suite.

---

## 2. Why This Task Exists

As specified in `DEC-030` and Section 4 of `blueprint/ROADMAP.md`, Asterim's database schema evolution previously relied on a 650-line `init()` method executing raw `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... try/catch` blocks on every server boot. This approach:
1. Lacks version tracking — the system cannot determine which migration version a database file is currently on.
2. Lacks checksum validation — manual or accidental edits to historical schema definitions go undetected.
3. Lacks transactional safety — a failed column addition or syntax error leaves the database in a partially-migrated, corrupt state.
4. Lacks snapshot/recovery — destructive schema changes cannot be cleanly rolled back.

Task P7-02 establishes an industrial-grade, versioned migration subsystem that operates safely across both Stable and Development channels.

---

## 3. Context & Architecture (DEC-030)

- **Migration Tracking (`schema_migrations` table)**:
  ```sql
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  );
  ```
- **Migration Definition Structure**:
  - Each migration has an integer `version` (e.g. `1`), a descriptive `name` (e.g. `'001_baseline'`), and SQL statements (or `up` function/SQL string).
  - Migrations can be structured as TypeScript definitions with embedded SQL strings (or loaded SQL files) in `apps/server/src/migrations/` so that packaging with `tsup` bundles cleanly without runtime asset path fragility.
- **Transactional Execution & Rollback**:
  - Every migration must execute inside an explicit SQLite transaction (`BEGIN IMMEDIATE` / `COMMIT`).
  - If any statement in a migration fails, the transaction is rolled back (`ROLLBACK`) and `MigrationEngine` throws an error, halting server startup before corrupting state.
- **SHA-256 Checksum Validation**:
  - `MigrationEngine` computes the SHA-256 hash of the migration content.
  - On startup, checksums of already-applied migrations recorded in `schema_migrations` are verified against the current codebase definitions.
  - If a checksum mismatch is detected on an already-applied migration, migration is halted with a clear error indicating schema tampering.
- **Pre-Migration Snapshotting**:
  - Before applying any pending migrations, `MigrationEngine` checks if the database file exists and has data. If pending migrations exist, it creates a backup copy:
    `path.join(dataDir, `asterim.db.bak.${Date.now()}`)`
  - The snapshot file is restricted to owner-only permissions (`0600` via `enforceOwnerOnly`).
- **Existing / Legacy Database Compatibility**:
  - If `MigrationEngine` runs against an existing database where core tables (e.g. `projects`, `users`, `events`) already exist but `schema_migrations` does not, it must detect the existing schema and baseline it cleanly (e.g. marking `001_baseline` as applied) without failing or attempting duplicate object creation.
- **Channel Awareness**:
  - Snapshots and migrations operate strictly within the resolved data directory (`resolveDataDir()`), preserving the runtime isolation delivered in `P7-01`.

---

## 4. Repository Evidence & Key Files

- `apps/server/src/services/DatabaseService.ts` — Current monolithic `init()` method and `DBSync` connection owner.
- `apps/server/src/utils/channel.ts` — Channel and data directory resolver (`resolveDataDir()`, `getAsterimChannel()`).
- `blueprint/ROADMAP.md` (Section 4 Initiative A & Section 5 Phase 7) — Authoritative specification.
- `decisions.md` (`DEC-030`) — Migration Engine decision register entry.

---

## 5. Implementation Scope

1. **Migration Definitions (`apps/server/src/migrations/`)**:
   - Create `apps/server/src/migrations/index.ts` exporting the ordered list of migrations.
   - Create `apps/server/src/migrations/001_baseline.ts` (or `.sql`) containing the consolidated, complete schema established through Phases 1–6 (all tables: `projects`, `threads`, `events`, `candidate_decisions`, `settings`, `push_subscriptions`, `sessions`, `approvals`, `contexts`, `context_entries`, `users`, `accounts`, `feature_entitlements`, `user_sessions`, `trusted_devices`, `api_keys`, `workspaces`, `environments`, `environment_project_attachments`, `environment_knowledge_items`, `environment_secrets`, `environment_audit_logs`, `workspace_memberships`, `workspace_invitations`, `audit_logs`, `team_memberships`, `project_decisions`, `decision_code_refs`, `project_intents`, `architectural_rules`, `mcp_servers`, `agent_profiles`, and all related indexes and columns).

2. **Migration Engine Service (`apps/server/src/services/MigrationEngine.ts`)**:
   - `MigrationEngine` class accepting a `DatabaseSync` instance.
   - Methods:
     - `initMigrationsTable()`: Ensures `schema_migrations` exists.
     - `getAppliedMigrations()`: Returns list of applied migrations from `schema_migrations`.
     - `computeChecksum(content: string): string`: Computes SHA-256 hash.
     - `createSnapshot(dbPath: string): string | null`: Creates timestamped snapshot before applying pending migrations.
     - `verifyChecksums(applied: MigrationRecord[], available: MigrationDefinition[]): void`: Detects tampering.
     - `runMigrations()`: Orchestrates snapshot, validation, baseline detection, and transactional application of pending migrations.
     - `getStatus()`: Returns diagnostic status of applied and pending migrations.

3. **Refactor `DatabaseService.ts`**:
   - Retain PRAGMA settings (`WAL`, `busy_timeout = 5000`).
   - Replace the legacy `init()` body with delegation to `MigrationEngine.runMigrations()`.
   - Maintain `DatabaseService` public APIs (`getDb()`, `compact()`, `close()`, `dbPath`).

4. **Automated Unit & Integration Test Suite (`apps/server/src/services/__tests__/MigrationEngine.test.ts`)**:
   - Test fresh database initialization (all migrations applied, `schema_migrations` populated with checksums).
   - Test idempotency (subsequent runs do not re-execute applied migrations).
   - Test transactional rollback on migration failure (syntax error or constraint violation rolls back cleanly).
   - Test checksum mismatch rejection (throws on altered migration content).
   - Test pre-migration snapshot creation (creates `asterim.db.bak.<timestamp>` with proper permissions).
   - Test legacy/existing database baselining (existing tables detected and baselined without errors).
   - Wire into `apps/server/package.json` `"test"` script.

---

## 6. Constraints & Explicitly Forbidden Changes

- Do NOT break existing data or queries in `asterim.db`.
- Do NOT alter table names, column names, foreign keys, or indexes from the current consolidated schema.
- Do NOT write snapshots or temporary files outside the active channel's data directory.
- Do NOT introduce heavyweight external ORM dependencies (use native `node:sqlite` `DatabaseSync`).
- Maintain 100% test pass rate across all 45 existing monorepo test suites.

---

## 7. Acceptance Criteria

1. `MigrationEngine` creates and manages the `schema_migrations` table tracking version, name, SHA-256 checksum, and applied timestamp.
2. All consolidated database tables and indexes from Phases 1–6 are cleanly captured in the baseline migration.
3. Pending migrations execute within an atomic SQLite transaction and roll back completely upon any statement error.
4. Checksum verification detects modified historical migrations and throws an informative error before executing any forward migrations.
5. Pre-migration snapshotting creates an owner-only (`0600`) timestamped backup (`asterim.db.bak.<timestamp>`) prior to applying pending migrations.
6. Existing databases with pre-existing tables baseline seamlessly without error.
7. `MigrationEngine.test.ts` passes with 100% assertions covering fresh install, idempotency, rollback, checksum mismatch, snapshots, and legacy database migration.
8. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`.

---

## 8. Definition of Done

- [ ] `schema_migrations` tracking table implemented with SHA-256 checksums
- [ ] Baseline schema migration `001_baseline` created
- [ ] `MigrationEngine` service implemented with transactional execution and rollback
- [ ] Pre-migration snapshotting implemented and permission-guarded (`0600`)
- [ ] `DatabaseService` refactored to delegate schema lifecycle to `MigrationEngine`
- [ ] `MigrationEngine.test.ts` authored and passing
- [ ] All 45+ monorepo test suites passing cleanly
- [ ] Production build and typecheck pass across all 7 workspace packages

---

## 9. Verification Commands

```bash
# Run new Migration Engine test suite
pnpm --filter asterim exec tsx src/services/__tests__/MigrationEngine.test.ts

# Run Channel Isolation suite
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
1. Run `pnpm --filter asterim exec tsx src/services/__tests__/MigrationEngine.test.ts`.
2. Inspect `git diff` to ensure no unintended schema modifications or leftover debug artifacts.
3. Verify that `DatabaseService` still initializes correctly in dev and production modes.
4. Verify that all 45+ existing monorepo test suites pass with 0 failures.
5. Check every numbered acceptance criterion in Section 7.

---

## 11. Required Report

Write the execution report to `reports/current.md` matching the standard schema defined in `AGENTS.md` and `CLAUDE.md`.
