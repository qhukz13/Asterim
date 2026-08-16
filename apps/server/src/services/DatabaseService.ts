import type { DatabaseSync } from 'node:sqlite';
// Hack to prevent esbuild from stripping the node: prefix
const req = typeof require !== 'undefined' ? require : (module as any).require;
const { DatabaseSync: DBSync } = req('node:sqlite');
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Resolves the Asterim data directory.
 * Priority: ASTERIM_DATA_DIR env var → ~/.asterim
 */
/** The directory holding asterim.db and the loopback descriptor. */
export function resolveDataDir(): string {
  const envDir = process.env.ASTERIM_DATA_DIR;
  if (envDir) {
    return path.resolve(envDir);
  }
  return path.join(os.homedir(), '.asterim');
}

/**
 * Restricts a path to its owner. POSIX only — Windows ACLs do not map onto
 * these bits and `chmod` there is a no-op at best, so it is skipped. Never
 * throws: a data directory on a filesystem that cannot express the mode (a
 * mounted share, for instance) must not stop the Core from starting.
 */
function enforceOwnerOnly(target: string, mode: number): void {
  if (process.platform === 'win32') return;
  try {
    if (!fs.existsSync(target)) return;
    if ((fs.statSync(target).mode & 0o777) === mode) return;
    fs.chmodSync(target, mode);
  } catch (err) {
    console.warn(
      `[Database] Could not restrict ${target} to ${mode.toString(8)}: ${(err as Error).message}`
    );
  }
}

export class DatabaseService {
  private db: DatabaseSync;
  public readonly dbPath: string;

  constructor() {
    const dataDir = resolveDataDir();

    // Ensure the data directory exists. DEC-028 (Local-First Data Sovereignty):
    // project memory never leaves the machine, so the files holding it are
    // owner-only — 0700 on the directory, 0600 on the database below.
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    }
    enforceOwnerOnly(dataDir, 0o700);

    this.dbPath = path.join(dataDir, 'asterim.db');
    console.log(`[Database] Using database at: ${this.dbPath}`);

    this.db = new DBSync(this.dbPath);

    // After open, so the file exists on a first run. WAL leaves two sidecar
    // files next to it holding the same data, so they are restricted too.
    enforceOwnerOnly(this.dbPath, 0o600);

    this.init();

    enforceOwnerOnly(`${this.dbPath}-wal`, 0o600);
    enforceOwnerOnly(`${this.dbPath}-shm`, 0o600);
  }

  private init() {
    // Write-Ahead Logging: concurrent readers during writes, and fewer fsyncs.
    // Persisted in the database header, so this applies once per database file.
    try {
      this.db.exec('PRAGMA journal_mode = WAL;');
    } catch {
      console.warn('[Database] Could not enable WAL journal mode; continuing with the default journal.');
    }

    // Wait for a competing writer instead of failing on contact. WAL keeps readers
    // out of the way, but writers still serialize, and SQLite's default timeout is
    // zero — a second writer gets SQLITE_BUSY within a millisecond. That matters
    // because the Core is not the only process writing this file: each MCP memory
    // server (packages/mcp-memory-server) opens it too, and a decision an agent
    // recorded while the Core happened to be mid-write would simply be lost.
    // Unlike journal_mode, this is a per-connection setting, so it is re-applied
    // by every process that constructs a DatabaseService.
    try {
      this.db.exec('PRAGMA busy_timeout = 5000;');
    } catch {
      console.warn('[Database] Could not set busy_timeout; concurrent writes may fail immediately.');
    }

    this.db.exec(`
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
      CREATE INDEX IF NOT EXISTS idx_candidate_decisions_project
        ON candidate_decisions(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_candidate_decisions_status
        ON candidate_decisions(status);
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
    `);

    // Add columns to existing tables if created before updates
    try {
      this.db.exec('ALTER TABLE projects ADD COLUMN workspace_id TEXT;');
    } catch (e) {
      /* ignore if exists */
    }
    try {
      this.db.exec("ALTER TABLE projects ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private';");
    } catch (e) {
      /* ignore if exists */
    }
    try {
      this.db.exec("ALTER TABLE workspaces ADD COLUMN preset TEXT NOT NULL DEFAULT 'personal';");
    } catch (e) {
      /* ignore if exists */
    }
    try {
      this.db.exec("ALTER TABLE workspaces ADD COLUMN execution_profile_id TEXT NOT NULL DEFAULT 'exec_default';");
    } catch (e) {
      /* ignore if exists */
    }
    try {
      this.db.exec('ALTER TABLE workspaces ADD COLUMN avatar_url TEXT;');
    } catch (e) {
      /* ignore if exists */
    }
    try {
      this.db.exec('ALTER TABLE workspaces ADD COLUMN is_personal INTEGER DEFAULT 0;');
    } catch (e) {
      /* ignore if exists */
    }
    try {
      this.db.exec("ALTER TABLE environments ADD COLUMN preset TEXT NOT NULL DEFAULT 'personal';");
    } catch (e) {
      /* ignore if exists */
    }
    try {
      this.db.exec("ALTER TABLE environments ADD COLUMN execution_profile_id TEXT NOT NULL DEFAULT 'exec_default';");
    } catch (e) {
      /* ignore if exists */
    }
    try {
      this.db.exec('ALTER TABLE environments ADD COLUMN avatar_url TEXT;');
    } catch (e) {
      /* ignore if exists */
    }
    try {
      this.db.exec('ALTER TABLE environments ADD COLUMN is_personal INTEGER DEFAULT 0;');
    } catch (e) {
      /* ignore if exists */
    }
    try {
      this.db.exec('ALTER TABLE events ADD COLUMN thread_id TEXT;');
    } catch (e) {
      /* ignore if exists */
    }
    try {
      this.db.exec('ALTER TABLE sessions ADD COLUMN thread_id TEXT;');
    } catch (e) {
      /* ignore if exists */
    }
    try {
      this.db.exec('ALTER TABLE approvals ADD COLUMN thread_id TEXT;');
    } catch (e) {
      /* ignore if exists */
    }

    // Index for quick history retrieval
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_project_timestamp 
      ON events(project_id, timestamp DESC);
    `);

    // Context aggregate: one context per thread
    this.db.exec(`
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
      CREATE INDEX IF NOT EXISTS idx_context_entries_context
        ON context_entries(context_id);
      CREATE INDEX IF NOT EXISTS idx_context_entries_thread
        ON context_entries(thread_id);

      -- Phase 2 Authentication & Account Platform Tables
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

    `);

    // Phase 5.0 Project Memory Core Tables
    this.db.exec(`
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

      CREATE INDEX IF NOT EXISTS idx_decisions_project_status ON project_decisions(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_decision_refs_decision ON decision_code_refs(decision_id);
      CREATE INDEX IF NOT EXISTS idx_decision_refs_file ON decision_code_refs(file_path);
      CREATE INDEX IF NOT EXISTS idx_intents_project_status ON project_intents(project_id, status);
      CREATE INDEX IF NOT EXISTS idx_rules_project ON architectural_rules(project_id);

      -- Briefing lookups scan sessions/approvals by project; neither table was indexed.
      CREATE INDEX IF NOT EXISTS idx_sessions_project_started ON sessions(project_id, started_at);
      CREATE INDEX IF NOT EXISTS idx_approvals_project_created ON approvals(project_id, created_at);

      -- MCP Server Manager (Phase 6). Only configuration is stored: process
      -- state, pids and logs are runtime facts held by McpProcessSupervisor and
      -- are deliberately not persisted.
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

      CREATE INDEX IF NOT EXISTS idx_mcp_servers_workspace ON mcp_servers(workspace_id);
    `);

    // Agent Profiles (P6-07). The personas a session can run under: the system
    // prompt it opens with, and which MCP servers and skills it may reach.
    this.reconcileLegacyAgentProfiles();

    this.db.exec(`
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

      CREATE INDEX IF NOT EXISTS idx_agent_profiles_workspace ON agent_profiles(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_agent_profiles_builtin ON agent_profiles(is_builtin);
    `);

    // Which profile a thread's sessions start under. A column rather than a
    // table: a thread has exactly one, and nothing here needs history.
    try {
      this.db.exec('ALTER TABLE threads ADD COLUMN profile_id TEXT;');
    } catch (e) {
      /* ignore if exists */
    }

    // Thread hierarchy (P7-01). A delegated thread hangs from the one that
    // asked for it and carries its own brief, so a child found later explains
    // itself without a join back through the event log.
    try {
      this.db.exec('ALTER TABLE threads ADD COLUMN parent_thread_id TEXT;');
    } catch (e) {
      /* ignore if exists */
    }
    try {
      this.db.exec('ALTER TABLE threads ADD COLUMN delegation_context_json TEXT;');
    } catch (e) {
      /* ignore if exists */
    }
    // Created after the columns: listing a thread's children and walking the
    // chain to a root are both parent_thread_id lookups.
    try {
      this.db.exec(
        'CREATE INDEX IF NOT EXISTS idx_threads_parent ON threads(parent_thread_id);'
      );
    } catch (e) {
      /* ignore if the column is somehow still absent */
    }
  }

  /**
   * Clears the way for the P6-07 `agent_profiles` table.
   *
   * An earlier draft of the environment manifest declared a table of the same
   * name with a different shape — `environment_id`, `default_model`,
   * `prompt_template` — and no code ever wrote to it. `CREATE TABLE IF NOT
   * EXISTS` would find that table, do nothing, and leave every insert failing
   * on columns that are not there, so the old shape has to go first.
   *
   * Empty is the only case that occurs in practice, and it is dropped. A table
   * with rows in it is renamed instead of destroyed: nothing in Asterim can
   * have put them there, so whatever did is something this migration does not
   * understand and has no business deleting.
   */
  private reconcileLegacyAgentProfiles(): void {
    try {
      const columns = this.db.prepare('PRAGMA table_info(agent_profiles)').all() as Array<{
        name?: string;
      }>;
      if (columns.length === 0) return; // No table yet: the CREATE below owns it.

      const names = new Set(columns.map(column => column.name));
      if (names.has('system_prompt')) return; // Already the P6-07 shape.
      if (!names.has('environment_id')) return; // Not the shape this knows how to retire.

      const count = this.db.prepare('SELECT COUNT(*) AS count FROM agent_profiles').get() as {
        count: number;
      };

      if (count.count === 0) {
        this.db.exec('DROP TABLE agent_profiles;');
        console.log('[Database] Replaced the unused legacy agent_profiles table.');
        return;
      }

      this.db.exec('ALTER TABLE agent_profiles RENAME TO agent_profiles_legacy_env;');
      console.warn(
        `[Database] Kept ${count.count} row(s) from the legacy agent_profiles table as agent_profiles_legacy_env.`
      );
    } catch (err) {
      console.error(
        `[Database] Could not reconcile the legacy agent_profiles table: ${(err as Error).message}`
      );
    }
  }

  public getDb(): DatabaseSync {
    return this.db;
  }

  /**
   * Closes the connection so WAL is checkpointed rather than abandoned.
   * Idempotent: shutdown may reach this more than once.
   */
  public close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db.close();
    } catch (err) {
      console.warn('[Database] Could not close cleanly:', (err as Error).message);
    }
  }

  private closed = false;
}

export const dbService = new DatabaseService();
