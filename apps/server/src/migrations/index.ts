import { baselineMigration } from './001_baseline';
import { teamAgentsMigration } from './002_team_agents';
import { teamApprovalGovernanceMigration } from './003_team_approval_governance';
import { pipelinesMigration } from './004_pipelines';
import { pipelineFleetMigration } from './005_pipeline_fleet';
import type { MigrationDefinition } from './types';

export type { MigrationDefinition, ColumnAddition } from './types';

/**
 * Every migration this build knows about, in the order it applies them (DEC-030).
 *
 * TypeScript modules rather than loose `.sql` files on disk: the Core ships as a
 * single bundled `dist/index.js` produced by `tsup`, and a runtime `readdir` of
 * a migrations directory would either have to survive bundling as an asset or
 * be resolved relative to a path that differs between `tsx watch` and the
 * packaged binary. A migration that cannot be found is a database that cannot
 * be opened, so the SQL is compiled in.
 *
 * Adding a migration means appending a module here with the next version number.
 * Never edit an applied one: its checksum is recorded in `schema_migrations`,
 * and the engine refuses to run against a database whose history no longer
 * matches the code.
 */
export const migrations: MigrationDefinition[] = [
  baselineMigration,
  teamAgentsMigration,
  teamApprovalGovernanceMigration,
  pipelinesMigration,
  pipelineFleetMigration
];

/** The version a database is expected to be on after this build has migrated it. */
export const LATEST_SCHEMA_VERSION = migrations.reduce(
  (highest, migration) => Math.max(highest, migration.version),
  0
);
