# Database

## WHAT

One SQLite file per channel, opened with Node's built-in `node:sqlite`: `~/.asterim/asterim.db` (stable) or `~/.asterim-dev/asterim.db` (dev), WAL mode, 5-second busy timeout, file mode 0600 inside a 0700 directory.

## WHY

Local-first with zero setup. Everything the user owns (projects, threads, events, approvals, decisions, settings, encrypted secrets) is in one file they can copy, back up or delete.

## WHERE

| Piece | Path |
| --- | --- |
| Open, pragmas, permissions, compaction | `apps/server/src/services/DatabaseService.ts` |
| Migration engine (`schema_migrations`, checksums, transactional, pre-migration snapshot) | `apps/server/src/services/MigrationEngine.ts` |
| Migrations | `apps/server/src/migrations/001_baseline.ts` … `006_fleet_policies.ts`, registered in `migrations/index.ts` (`LATEST_SCHEMA_VERSION`) |
| CLI | `apps/server/src/cli/*` (`db:status`, `db:migrate`, `db:snapshot`, `data:clone`, `data:backup`, `data:restore`) |
| Pruning of old events | `apps/server/src/services/PruningService.ts` |
| Tests | `services/__tests__/MigrationEngine.test.ts`, `CliDatabaseTooling.test.ts` |

## Tables that matter for the core loop

| Table | Purpose | Written by |
| --- | --- | --- |
| `projects` | Registered folders (`id`, `workspace_id`, `name`, `path`, `visibility`) | `ProjectManager` |
| `threads` | Conversations per project (`worktree_path`, `parent_thread_id` used by frozen delegation) | `ProjectManager` |
| `events` | Every non-transient event (`id`, `project_id`, `thread_id`, `timestamp`, `type`, `payload_json`) | `socketManager` |
| `approvals` | Gate history (`action_id`, `status`: pending, approved, denied, expired, cancelled) | `ApprovalManager` |
| `sessions` | Agent process records (`agent_type`, `status`, `pid`) | `AgentService` |
| `settings` | Key/value: first-run flag, AI settings, VAPID keys, vault envelopes, `provider_session:<threadId>` | several |
| `schema_migrations` | Applied versions and checksums | `MigrationEngine` |

Everything else (`users`, `accounts`, `workspaces`, `environments`, `environment_secrets`, `project_decisions`, `mcp_servers`, `agent_profiles`, `team_*`, `pipeline_*`, `fleet_policies`, `audit_events`) belongs to hidden or frozen features and is documented in the migrations themselves.

## HOW

- `dbService.getDb()` opens lazily on first use, applies pending migrations, enforces file permissions. Import of the module does not open the database (the CLI entrypoint depends on that).
- `events` is pruned hourly (`PruningService`); `agent.stream` and `agent.log` are never written (buffered in memory, 500 per project).
- The MCP memory server opens the same file from its own process and notifies the Core through `POST /api/v1/internal/memory-events`.

## CONTRACT

- A database created by any earlier version must open; migrations are additive and idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN` guarded).
- Migrations are immutable once applied; a changed checksum aborts start-up with a clear message.
- Two writers (Core, MCP memory server) rely on WAL and the busy timeout; keep transactions short.
- A force-killed Core can leave `-wal`/`-shm` sidecars that a later start reports as `disk I/O error` on some Windows setups; `db:status` explains it and `db:snapshot` copies safely. Task: detect and advise on boot (P1).

## MODIFYING

- New table/column: `007_<name>.ts` with `up` using guarded DDL, register it, bump `LATEST_SCHEMA_VERSION`, add assertions to `MigrationEngine.test.ts`.
- Reading in a hot path: prepare statements once per call site; do not cache prepared statements across `getDb()` calls.

## DO NOT

- Do not run tests against `~/.asterim`; set `ASTERIM_DATA_DIR` to a temp directory.
- Do not `DROP` or rename tables in a migration.
- Do not store plaintext credentials; use `SecretVaultService`.
