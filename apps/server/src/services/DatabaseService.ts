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
function resolveDataDir(): string {
  const envDir = process.env.ASTERIM_DATA_DIR;
  if (envDir) {
    return path.resolve(envDir);
  }
  return path.join(os.homedir(), '.asterim');
}

export class DatabaseService {
  private db: DatabaseSync;
  public readonly dbPath: string;

  constructor() {
    const dataDir = resolveDataDir();

    // Ensure the data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.dbPath = path.join(dataDir, 'asterim.db');
    console.log(`[Database] Using database at: ${this.dbPath}`);

    this.db = new DBSync(this.dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

    // Add thread_id to existing tables if they were created before this update
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
    `);
  }

  public getDb(): DatabaseSync {
    return this.db;
  }
}

export const dbService = new DatabaseService();
