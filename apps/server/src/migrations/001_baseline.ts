import type { DatabaseSync } from 'node:sqlite';
import type { MigrationDefinition } from './types';

/**
 * The consolidated schema Asterim reached at the end of Phase 6 (DEC-030).
 *
 * This is a transcription, not a redesign. Every table, column, index, default
 * and foreign key here is the one the old `DatabaseService.init()` produced —
 * including the columns it added afterwards with `ALTER TABLE ... try/catch`,
 * which are folded into the `CREATE TABLE` statements so a fresh database gets
 * the final shape in one step. Changing any of it would silently migrate every
 * existing user database on the next boot, which is precisely what a versioned
 * engine exists to prevent.
 *
 * Two audiences run this migration:
 *
 *   - A fresh install, where every statement creates something.
 *   - A database built by the pre-DEC-030 `init()`, which already has all of
 *     these objects. `IF NOT EXISTS` makes the statements no-ops there, and the
 *     `columns` list below repairs the one thing a legacy database can be
 *     missing: a column that was added by an `ALTER` the old code ran, on a
 *     table that was created before it.
 *
 * That convergence is what lets `MigrationEngine` adopt an existing database as
 * version 1 rather than refusing to touch it.
 */

const BASELINE_SQL = `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    workspace_id TEXT,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'private',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    profile_id TEXT,
    parent_thread_id TEXT,
    delegation_context_json TEXT,
    worktree_path TEXT,
    worktree_branch TEXT,
    verification_report_json TEXT,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    thread_id TEXT,
    timestamp INTEGER NOT NULL,
    source TEXT NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  -- Staged decision candidates (DEC-027). Extraction writes here; only a
  -- human's approval promotes a row into project_decisions.
  CREATE TABLE IF NOT EXISTS candidate_decisions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    session_id TEXT,
    thread_id TEXT,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    rationale TEXT NOT NULL,
    constraints_json TEXT NOT NULL DEFAULT '[]',
    related_files_json TEXT NOT NULL DEFAULT '[]',
    code_refs_json TEXT NOT NULL DEFAULT '[]',
    confidence REAL NOT NULL DEFAULT 0.5,
    status TEXT NOT NULL DEFAULT 'PENDING',
    extracted_at INTEGER NOT NULL,
    reviewed_at INTEGER,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    keys_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    thread_id TEXT,
    agent_type TEXT NOT NULL,
    status TEXT NOT NULL,
    pid INTEGER,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    thread_id TEXT,
    action_id TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    command TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Context aggregate: one context per thread.
  CREATE TABLE IF NOT EXISTS contexts (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS context_entries (
    id TEXT PRIMARY KEY,
    context_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    path TEXT,
    label TEXT,
    content TEXT,
    status TEXT NOT NULL DEFAULT 'pinned',
    created_by TEXT NOT NULL DEFAULT 'user',
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY(context_id) REFERENCES contexts(id) ON DELETE CASCADE
  );

  -- Phase 2 Authentication & Account Platform tables.
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    is_email_verified INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL,
    account_name TEXT NOT NULL,
    current_plan_id TEXT NOT NULL DEFAULT 'free',
    subscription_status TEXT NOT NULL DEFAULT 'active',
    billing_status TEXT NOT NULL DEFAULT 'ok',
    stripe_customer_id TEXT,
    plan_expires_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(owner_user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS feature_entitlements (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    feature_key TEXT NOT NULL,
    is_enabled INTEGER DEFAULT 1,
    usage_limit INTEGER DEFAULT -1,
    current_usage INTEGER DEFAULT 0,
    expires_at INTEGER,
    UNIQUE(account_id, feature_key),
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    refresh_token_hash TEXT UNIQUE NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    client_type TEXT NOT NULL DEFAULT 'browser',
    is_revoked INTEGER DEFAULT 0,
    last_active_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS trusted_devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_name TEXT NOT NULL,
    os_type TEXT NOT NULL,
    os_version TEXT,
    client_version TEXT NOT NULL,
    hardware_fingerprint TEXT,
    is_trusted INTEGER DEFAULT 1,
    last_active_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    key_name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT UNIQUE NOT NULL,
    scopes_json TEXT NOT NULL DEFAULT '[]',
    last_used_at INTEGER,
    expires_at INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    preset TEXT NOT NULL DEFAULT 'personal',
    execution_profile_id TEXT NOT NULL DEFAULT 'exec_default',
    avatar_url TEXT,
    is_personal INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS environments (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    preset TEXT NOT NULL DEFAULT 'personal',
    execution_profile_id TEXT NOT NULL DEFAULT 'exec_default',
    avatar_url TEXT,
    is_personal INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS environment_project_attachments (
    id TEXT PRIMARY KEY,
    environment_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    attached_at INTEGER NOT NULL,
    UNIQUE(environment_id, project_id),
    FOREIGN KEY(environment_id) REFERENCES environments(id) ON DELETE CASCADE,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS environment_knowledge_items (
    id TEXT PRIMARY KEY,
    environment_id TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(environment_id) REFERENCES environments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS environment_secrets (
    id TEXT PRIMARY KEY,
    environment_id TEXT NOT NULL,
    secret_key TEXT NOT NULL,
    secret_value TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(environment_id, secret_key),
    FOREIGN KEY(environment_id) REFERENCES environments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS environment_audit_logs (
    id TEXT PRIMARY KEY,
    environment_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    action TEXT NOT NULL,
    target_resource TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    FOREIGN KEY(environment_id) REFERENCES environments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workspace_memberships (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at INTEGER NOT NULL,
    UNIQUE(workspace_id, user_id),
    FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workspace_invitations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    token TEXT UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_email TEXT NOT NULL,
    action TEXT NOT NULL,
    target_resource TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS team_memberships (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at INTEGER NOT NULL,
    UNIQUE(team_id, user_id),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- Phase 5.0 Project Memory core tables.
  CREATE TABLE IF NOT EXISTS project_decisions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    rationale TEXT NOT NULL,
    constraints_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    superseded_by TEXT,
    provenance TEXT NOT NULL DEFAULT 'HUMAN_CONFIRMED',
    confidence REAL NOT NULL DEFAULT 1.0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(superseded_by) REFERENCES project_decisions(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS decision_code_refs (
    id TEXT PRIMARY KEY,
    decision_id TEXT NOT NULL,
    file_path TEXT,
    symbol_name TEXT,
    commit_hash TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY(decision_id) REFERENCES project_decisions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS project_intents (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    goal TEXT NOT NULL,
    constraints_json TEXT NOT NULL DEFAULT '[]',
    non_goals_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS architectural_rules (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    statement TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning',
    scope_pattern TEXT NOT NULL DEFAULT '*',
    created_at INTEGER NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  -- MCP Server Manager (Phase 6). Only configuration is stored: process state,
  -- pids and logs are runtime facts held by McpProcessSupervisor and are
  -- deliberately not persisted.
  CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    workspace_id TEXT,
    name TEXT NOT NULL,
    transport TEXT NOT NULL DEFAULT 'stdio',
    command TEXT NOT NULL,
    args_json TEXT NOT NULL DEFAULT '[]',
    env_json TEXT NOT NULL DEFAULT '{}',
    is_enabled INTEGER NOT NULL DEFAULT 1,
    is_global INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Agent Profiles (P6-07). The personas a session can run under: the system
  -- prompt it opens with, and which MCP servers and skills it may reach.
  CREATE TABLE IF NOT EXISTS agent_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    description TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    model TEXT,
    temperature REAL,
    enabled_mcp_servers TEXT,
    enabled_skills TEXT,
    auto_approval_rules TEXT,
    is_builtin INTEGER NOT NULL DEFAULT 0,
    workspace_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_candidate_decisions_project
    ON candidate_decisions(project_id, status);
  CREATE INDEX IF NOT EXISTS idx_candidate_decisions_status
    ON candidate_decisions(status);
  CREATE INDEX IF NOT EXISTS idx_events_project_timestamp
    ON events(project_id, timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_context_entries_context
    ON context_entries(context_id);
  CREATE INDEX IF NOT EXISTS idx_context_entries_thread
    ON context_entries(thread_id);
  CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON trusted_devices(user_id);
  CREATE INDEX IF NOT EXISTS idx_api_keys_account ON api_keys(account_id);
  CREATE INDEX IF NOT EXISTS idx_workspaces_account ON workspaces(account_id);
  CREATE INDEX IF NOT EXISTS idx_workspace_memberships_workspace ON workspace_memberships(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_workspace_invitations_token ON workspace_invitations(token);
  CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace ON audit_logs(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_environments_account ON environments(account_id);
  CREATE INDEX IF NOT EXISTS idx_env_knowledge_env ON environment_knowledge_items(environment_id);
  CREATE INDEX IF NOT EXISTS idx_env_attachments_env ON environment_project_attachments(environment_id);
  CREATE INDEX IF NOT EXISTS idx_decisions_project_status ON project_decisions(project_id, status);
  CREATE INDEX IF NOT EXISTS idx_decision_refs_decision ON decision_code_refs(decision_id);
  CREATE INDEX IF NOT EXISTS idx_decision_refs_file ON decision_code_refs(file_path);
  CREATE INDEX IF NOT EXISTS idx_intents_project_status ON project_intents(project_id, status);
  CREATE INDEX IF NOT EXISTS idx_rules_project ON architectural_rules(project_id);
  -- Briefing lookups scan sessions/approvals by project; neither table was indexed.
  CREATE INDEX IF NOT EXISTS idx_sessions_project_started ON sessions(project_id, started_at);
  CREATE INDEX IF NOT EXISTS idx_approvals_project_created ON approvals(project_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_mcp_servers_workspace ON mcp_servers(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_agent_profiles_workspace ON agent_profiles(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_agent_profiles_builtin ON agent_profiles(is_builtin);
`;

/**
 * The columns the pre-DEC-030 `init()` bolted on after the fact.
 *
 * On a fresh database every one of these is already present from the
 * `CREATE TABLE` above and nothing happens. On a database created by an older
 * Asterim they are the difference between the shape the code expects and the
 * shape on disk, so they are applied where missing — the same set the old
 * `ALTER TABLE ... try/catch` block covered, in the same order.
 */
const BASELINE_COLUMNS = [
  { table: 'projects', column: 'workspace_id', definition: 'TEXT' },
  { table: 'projects', column: 'visibility', definition: "TEXT NOT NULL DEFAULT 'private'" },
  { table: 'workspaces', column: 'preset', definition: "TEXT NOT NULL DEFAULT 'personal'" },
  {
    table: 'workspaces',
    column: 'execution_profile_id',
    definition: "TEXT NOT NULL DEFAULT 'exec_default'"
  },
  { table: 'workspaces', column: 'avatar_url', definition: 'TEXT' },
  { table: 'workspaces', column: 'is_personal', definition: 'INTEGER DEFAULT 0' },
  { table: 'environments', column: 'preset', definition: "TEXT NOT NULL DEFAULT 'personal'" },
  {
    table: 'environments',
    column: 'execution_profile_id',
    definition: "TEXT NOT NULL DEFAULT 'exec_default'"
  },
  { table: 'environments', column: 'avatar_url', definition: 'TEXT' },
  { table: 'environments', column: 'is_personal', definition: 'INTEGER DEFAULT 0' },
  { table: 'events', column: 'thread_id', definition: 'TEXT' },
  { table: 'sessions', column: 'thread_id', definition: 'TEXT' },
  { table: 'approvals', column: 'thread_id', definition: 'TEXT' },
  // Which profile a thread's sessions start under (P6-07). A column rather than
  // a table: a thread has exactly one, and nothing here needs history.
  { table: 'threads', column: 'profile_id', definition: 'TEXT' },
  // Thread hierarchy (P7-01). A delegated thread hangs from the one that asked
  // for it and carries its own brief, so a child found later explains itself
  // without a join back through the event log.
  { table: 'threads', column: 'parent_thread_id', definition: 'TEXT' },
  { table: 'threads', column: 'delegation_context_json', definition: 'TEXT' },
  // Git worktree sandboxing (P8-01). Where a thread's session actually runs,
  // when it runs somewhere other than the project directory, and the ephemeral
  // branch that checkout sits on.
  { table: 'threads', column: 'worktree_path', definition: 'TEXT' },
  { table: 'threads', column: 'worktree_branch', definition: 'TEXT' },
  // Automated verification pipelines (P8-02). The last thing the project's own
  // typechecker, linter, tests and build said about the work in this thread's
  // directory — only the latest answer is evidence.
  { table: 'threads', column: 'verification_report_json', definition: 'TEXT' }
];

/** Indexes over columns this migration may have just added. */
const BASELINE_POST_SQL = `
  CREATE INDEX IF NOT EXISTS idx_threads_parent ON threads(parent_thread_id);
`;

/**
 * Clears the way for the P6-07 `agent_profiles` table.
 *
 * An earlier draft of the environment manifest declared a table of the same
 * name with a different shape — `environment_id`, `default_model`,
 * `prompt_template` — and no code ever wrote to it. `CREATE TABLE IF NOT
 * EXISTS` would find that table, do nothing, and leave every insert failing on
 * columns that are not there, so the old shape has to go first.
 *
 * Empty is the only case that occurs in practice, and it is dropped. A table
 * with rows in it is renamed instead of destroyed: nothing in Asterim can have
 * put them there, so whatever did is something this migration does not
 * understand and has no business deleting.
 */
function reconcileLegacyAgentProfiles(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(agent_profiles)').all() as Array<{
    name?: string;
  }>;
  if (columns.length === 0) return; // No table yet: the CREATE below owns it.

  const names = new Set(columns.map(column => column.name));
  if (names.has('system_prompt')) return; // Already the P6-07 shape.
  if (!names.has('environment_id')) return; // Not the shape this knows how to retire.

  const count = db.prepare('SELECT COUNT(*) AS count FROM agent_profiles').get() as {
    count: number;
  };

  if (count.count === 0) {
    db.exec('DROP TABLE agent_profiles;');
    console.log('[Migration] Replaced the unused legacy agent_profiles table.');
    return;
  }

  db.exec('ALTER TABLE agent_profiles RENAME TO agent_profiles_legacy_env;');
  console.warn(
    `[Migration] Kept ${count.count} row(s) from the legacy agent_profiles table as agent_profiles_legacy_env.`
  );
}

export const baselineMigration: MigrationDefinition = {
  version: 1,
  name: '001_baseline',
  sql: BASELINE_SQL,
  columns: BASELINE_COLUMNS,
  postSql: BASELINE_POST_SQL,
  prepare: reconcileLegacyAgentProfiles
};
