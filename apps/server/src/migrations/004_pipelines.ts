import type { MigrationDefinition } from './types';

/**
 * Declarative multi-agent pipelines (P9-01).
 *
 * Three tables, and the split between them is the point: what was *declared*,
 * what one *execution* of it did, and what each *step* of that execution did.
 *
 * The declaration keeps its YAML rather than a normalized graph. The file is
 * what the operator wrote and what they will edit next; storing the parse
 * instead would mean their comments, their ordering and their formatting were
 * lost the first time Asterim read it, and a round-trip through a re-serializer
 * is a diff nobody asked for. The parse is cheap and happens on read.
 *
 * A run holds the context it started with as JSON and nothing about the graph —
 * the graph belongs to the pipeline, and a run that outlived an edit to its
 * definition still has its own `pipeline_step_runs` rows saying exactly which
 * steps it planned and what each of them did. That is what makes a months-old
 * run readable after the pipeline it came from has been rewritten.
 *
 * `ON DELETE CASCADE` on both foreign keys: a deleted pipeline takes its runs,
 * and a deleted run takes its steps. A step row whose run is gone has nothing
 * that can be said about it, and the alternative — orphans accumulating in a
 * local-first database nobody administers (DEC-028) — is worse than losing
 * history the operator asked to lose.
 *
 * The file is `.ts` rather than `.sql` for the reason `migrations/index.ts`
 * gives: the Core ships as one bundled `dist/index.js`, and a migration a
 * runtime `readdir` cannot find is a database that cannot be opened.
 */

const PIPELINES_SQL = `
  -- The declaration. workspace_id scopes it the way agent profiles and MCP
  -- servers are scoped; NULL is a workstation-wide pipeline, which is what a
  -- single-developer install has.
  CREATE TABLE IF NOT EXISTS pipelines (
    id TEXT PRIMARY KEY,
    workspace_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    yaml_content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- One execution. current_step_id is the most recently dispatched step, kept
  -- for a dashboard with one line to spare; the authoritative per-step state is
  -- pipeline_step_runs. run_context_json is the parameters the run started with
  -- plus what the engine resolved onto them.
  CREATE TABLE IF NOT EXISTS pipeline_runs (
    id TEXT PRIMARY KEY,
    pipeline_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    current_step_id TEXT,
    run_context_json TEXT NOT NULL DEFAULT '{}',
    project_id TEXT,
    root_thread_id TEXT,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    error_message TEXT,
    FOREIGN KEY(pipeline_id) REFERENCES pipelines(id) ON DELETE CASCADE
  );

  -- One step of one execution. thread_id is the delegated child the step ran
  -- in, whose transcript outlives this row; worktree_path and diff are the
  -- sandbox it ran in and what it changed there, which is the evidence a
  -- downstream step and a reviewing human both read.
  CREATE TABLE IF NOT EXISTS pipeline_step_runs (
    id TEXT PRIMARY KEY,
    pipeline_run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    step_name TEXT NOT NULL,
    role_profile_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    thread_id TEXT,
    worktree_path TEXT,
    diff TEXT,
    output TEXT,
    started_at INTEGER,
    completed_at INTEGER,
    error_message TEXT,
    FOREIGN KEY(pipeline_run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_pipelines_workspace ON pipelines(workspace_id);
  -- Runs are always read as "this pipeline's history, newest first".
  CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipeline
    ON pipeline_runs(pipeline_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_pipeline_step_runs_run
    ON pipeline_step_runs(pipeline_run_id);
`;

export const pipelinesMigration: MigrationDefinition = {
  version: 4,
  name: '004_pipelines',
  sql: PIPELINES_SQL
};
