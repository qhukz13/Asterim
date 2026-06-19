import type { DatabaseSync } from 'node:sqlite';
// Hack to prevent esbuild from stripping the node: prefix
const req = typeof require !== 'undefined' ? require : (module as any).require;
const { DatabaseSync: DBSync } = req('node:sqlite');
import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Resolves the AgentDeck data directory.
 * Priority: AGENTDECK_DATA_DIR env var → ~/.agentdeck
 */
function resolveDataDir(): string {
  const envDir = process.env.AGENTDECK_DATA_DIR;
  if (envDir) {
    return path.resolve(envDir);
  }
  return path.join(os.homedir(), '.agentdeck');
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

    this.dbPath = path.join(dataDir, 'agentdeck.db');
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
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
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
        agent_type TEXT NOT NULL,
        status TEXT NOT NULL,
        pid INTEGER,
        started_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        action_id TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL,
        command TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);

    // Index for quick history retrieval
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_project_timestamp 
      ON events(project_id, timestamp DESC);
    `);
  }

  public getDb(): DatabaseSync {
    return this.db;
  }
}

export const dbService = new DatabaseService();
