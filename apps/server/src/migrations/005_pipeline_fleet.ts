import type { MigrationDefinition } from './types';

/**
 * Worktree fleet, retries and synthesis (P9-02).
 *
 * Columns only: P9-01's three tables already say what was declared, what one
 * execution did, and what each step did. What they could not say is *where* a
 * step's work ended up — which branch it settled on, at which commit — and how
 * many attempts it took to get there.
 *
 * All five are needed after the run is over, which is why they are on the rows
 * rather than in the engine's memory:
 *
 *   - `attempts` is how a reader tells "passed" from "passed on the third try",
 *     which is the difference between a step that works and a flaky one.
 *   - `worktree_branch` and `commit_sha` are what a conflict analysis merges and
 *     what a synthesis consolidates, hours or days after the process that ran
 *     the step has exited.
 *   - `base_commit` is where the run's first step branched from, so a synthesis
 *     builds its branch on the same commit the run was planned against rather
 *     than on whatever HEAD has become since.
 *   - `synthesis_branch` / `synthesis_commit` record the consolidated branch, so
 *     a second synthesis of the same run replaces a known branch instead of
 *     discovering one it does not recognize.
 *
 * Additive, so a database written by a P9-01 build opens on this one unchanged
 * and every existing row reads as "one attempt, no fleet", which is what those
 * runs were.
 */
export const pipelineFleetMigration: MigrationDefinition = {
  version: 5,
  name: '005_pipeline_fleet',
  sql: '',
  columns: [
    { table: 'pipeline_step_runs', column: 'attempts', definition: 'INTEGER NOT NULL DEFAULT 0' },
    { table: 'pipeline_step_runs', column: 'worktree_branch', definition: 'TEXT' },
    { table: 'pipeline_step_runs', column: 'commit_sha', definition: 'TEXT' },
    { table: 'pipeline_runs', column: 'base_commit', definition: 'TEXT' },
    { table: 'pipeline_runs', column: 'synthesis_branch', definition: 'TEXT' },
    { table: 'pipeline_runs', column: 'synthesis_commit', definition: 'TEXT' }
  ]
};
