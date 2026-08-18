import type { MigrationDefinition } from './types';

/**
 * Role-based approval governance for shared team agents (P8-03, DEC-031 § 3).
 *
 * Purely additive over migration 002, and deliberately so: databases created by
 * P8-01 already hold shared roles, threads and transcripts that must keep
 * opening. Nothing here rewrites a row.
 *
 * Two things are recorded.
 *
 * **The policy**, on `team_agents` and on `team_threads`. The agent's column
 * carries a default because every existing shared role acquires the permissive
 * policy it has been operating under; the thread's is nullable on purpose —
 * NULL means "whatever the agent says", which is not the same answer as
 * `ANY_MEMBER` and must not decay into it, or a team that set `ADMIN_ONLY` on a
 * role would lose it the moment somebody opened a new thread.
 *
 * **The answer**, on `team_turn_queue`. Who decided, under which policy, when,
 * and why. The transcript gets a line too, but a line is prose; "who let the
 * agent run that" is a governance question asked months later, and it deserves
 * columns rather than a substring search.
 */

export const teamApprovalGovernanceMigration: MigrationDefinition = {
  version: 3,
  name: '003_team_approval_governance',
  sql: '',
  columns: [
    {
      table: 'team_agents',
      column: 'approval_policy',
      definition: "TEXT NOT NULL DEFAULT 'ANY_MEMBER'"
    },
    // Nullable: absent means the agent's policy governs.
    { table: 'team_threads', column: 'approval_policy', definition: 'TEXT' },
    { table: 'team_turn_queue', column: 'approval_decision', definition: 'TEXT' },
    { table: 'team_turn_queue', column: 'approval_policy', definition: 'TEXT' },
    { table: 'team_turn_queue', column: 'approval_resolved_by', definition: 'TEXT' },
    { table: 'team_turn_queue', column: 'approval_resolved_by_name', definition: 'TEXT' },
    { table: 'team_turn_queue', column: 'approval_comment', definition: 'TEXT' },
    { table: 'team_turn_queue', column: 'approval_resolved_at', definition: 'INTEGER' }
  ]
};
