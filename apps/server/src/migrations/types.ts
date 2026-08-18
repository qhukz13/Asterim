import type { DatabaseSync } from 'node:sqlite';

/**
 * The shape of a single versioned schema migration (DEC-030).
 *
 * A migration is data, not code: `sql`, `columns` and `postSql` are the whole
 * of what it changes, which is what makes a SHA-256 checksum over them a
 * meaningful statement about whether a historical migration has been edited
 * since it was applied.
 */
export interface MigrationDefinition {
  /** Monotonic, unique, and never reused. The value stored in `schema_migrations.version`. */
  version: number;
  /** Human-readable identity, e.g. `001_baseline`. */
  name: string;
  /**
   * Statements applied first, in order. Everything here must be safe to run
   * against a database that already contains the objects it declares —
   * `CREATE TABLE IF NOT EXISTS` and friends — because a migration also runs
   * against pre-DEC-030 databases that were built by the old ad-hoc `init()`.
   */
  sql: string;
  /**
   * Additive columns, applied only where absent. `ALTER TABLE ... ADD COLUMN`
   * has no `IF NOT EXISTS` form, and the try/catch that used to stand in for
   * one is exactly what DEC-030 removes: inside a transaction a swallowed
   * error is indistinguishable from a real failure. Presence is checked with
   * `PRAGMA table_info` instead.
   */
  columns?: ColumnAddition[];
  /**
   * Statements applied after `columns`, for objects that depend on a column
   * this migration may have just added — an index over `threads.parent_thread_id`
   * cannot be created before that column exists on a legacy database.
   */
  postSql?: string;
  /**
   * Imperative reconciliation that runs before `sql`, for the cases no
   * declarative form covers (retiring a table whose shape predates the one
   * this migration declares). Deliberately outside the checksum: it is a
   * function, and a bundler is free to rewrite its text without changing its
   * meaning, so hashing it would report tampering on every release build.
   */
  prepare?: (db: DatabaseSync) => void;
}

/** One additive column, in the form `ALTER TABLE <table> ADD COLUMN <column> <definition>`. */
export interface ColumnAddition {
  table: string;
  column: string;
  /** The type and constraints only, e.g. `TEXT NOT NULL DEFAULT 'private'`. */
  definition: string;
}
