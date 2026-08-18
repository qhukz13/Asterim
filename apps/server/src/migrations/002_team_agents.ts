import type { MigrationDefinition } from './types';

/**
 * The Shared Team Agent schema (P8-01, DEC-031).
 *
 * Four tables, and the relationship between them is the design:
 *
 *   team_agents          the persistent shared role
 *     └─ team_threads    one shared conversation with it
 *          ├─ team_turn_queue      what people have asked, in order
 *          └─ team_agent_messages  what was actually said, in order
 *
 * The queue is a table rather than only an in-memory structure because the
 * Core is allowed to be restarted. `AgentTurnLock` holds the live queue and is
 * the authority while the process is up; this table is what a queue inspector
 * reads, what a restart recovers from, and what makes "who asked for this, and
 * when" answerable after the fact. Both are written by `TeamAgentService`, in
 * that order, so the durable record never claims a turn ran that the lock never
 * granted.
 *
 * Everything here stays on the host workstation (DEC-028, DEC-032 § 1): the
 * transcript of a shared agent is source-adjacent material, and the relay is a
 * blind pipe that never sees a row of it.
 *
 * The file is `.ts` rather than `.sql` for the reason `migrations/index.ts`
 * gives: the Core ships as one bundled `dist/index.js`, and a migration that a
 * runtime `readdir` cannot find is a database that cannot be opened.
 */

const TEAM_AGENTS_SQL = `
  -- The shared role itself. Owned by a team, not by whoever created it, which
  -- is what distinguishes it from an agent_profiles row.
  CREATE TABLE IF NOT EXISTS team_agents (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    system_prompt TEXT NOT NULL,
    model TEXT,
    temperature REAL,
    enabled_mcp_servers TEXT,
    enabled_skills TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- One shared conversation. status is the thread's turn state and is a
  -- projection of its active turn: IDLE exactly when nothing holds the lock.
  -- project_id binds it to the checkout a turn executes against; a thread
  -- without one can be read and queued into but not served.
  CREATE TABLE IF NOT EXISTS team_threads (
    id TEXT PRIMARY KEY,
    team_agent_id TEXT NOT NULL,
    project_id TEXT,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'IDLE',
    active_turn_user_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(team_agent_id) REFERENCES team_agents(id) ON DELETE CASCADE
  );

  -- The durable side of the FIFO queue. Order of service is (queued_at, rowid):
  -- two requests that land in the same millisecond are still strictly ordered,
  -- because SQLite's insertion order breaks the tie and the lock's in-memory
  -- queue is built the same way.
  CREATE TABLE IF NOT EXISTS team_turn_queue (
    id TEXT PRIMARY KEY,
    team_thread_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    instruction TEXT NOT NULL,
    context_json TEXT,
    status TEXT NOT NULL DEFAULT 'QUEUED',
    queued_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    error_message TEXT,
    FOREIGN KEY(team_thread_id) REFERENCES team_threads(id) ON DELETE CASCADE
  );

  -- The shared transcript. user_id is null on the agent's own lines: they
  -- belong to the thread rather than to any one member.
  CREATE TABLE IF NOT EXISTS team_agent_messages (
    id TEXT PRIMARY KEY,
    team_thread_id TEXT NOT NULL,
    user_id TEXT,
    user_name TEXT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    tool_calls_json TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(team_thread_id) REFERENCES team_threads(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_team_agents_team ON team_agents(team_id);
  CREATE INDEX IF NOT EXISTS idx_team_threads_agent ON team_threads(team_agent_id);
  -- The queue is always read as "what is outstanding on this thread", never as
  -- "every turn ever", so the status is part of the index rather than a filter
  -- applied after it.
  CREATE INDEX IF NOT EXISTS idx_team_queue_thread_status
    ON team_turn_queue(team_thread_id, status);
  CREATE INDEX IF NOT EXISTS idx_team_messages_thread
    ON team_agent_messages(team_thread_id, created_at);
`;

export const teamAgentsMigration: MigrationDefinition = {
  version: 2,
  name: '002_team_agents',
  sql: TEAM_AGENTS_SQL
};
