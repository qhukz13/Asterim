import type { MigrationDefinition } from './types';

/**
 * Fleet governance and the structured audit stream (P10-01).
 *
 * Two tables, and they are separate on purpose: one holds the rules an
 * organization has stated, the other holds the record of those rules being
 * applied. A policy is edited; an audit event never is. Folding the second into
 * the workspace-scoped `audit_logs` table would have tied the enterprise stream
 * to a workspace it does not belong to — a banned command refused before a PTY
 * exists has a thread but no workspace membership behind it — and would have
 * given rows that must be append-only the same shape as rows that are updated.
 *
 * `audit_events` carries its own timestamp rather than reusing `created_at`
 * because it is exported: the value is the event's own time, which a collector
 * reads as the frame's timestamp, and not the moment a row happened to be
 * written.
 *
 * Both indexes exist for the export path specifically. Every query the
 * enterprise surface makes is a window in time, optionally narrowed to a type
 * and a severity, and a SIEM pull over a year of events is the one read here
 * that cannot afford a table scan.
 */
export const fleetPoliciesMigration: MigrationDefinition = {
  version: 6,
  name: '006_fleet_policies',
  sql: `
    CREATE TABLE IF NOT EXISTS fleet_policies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      allowed_models_json TEXT NOT NULL DEFAULT '["*"]',
      banned_commands_json TEXT NOT NULL DEFAULT '[]',
      enforce_sovereign_mode INTEGER NOT NULL DEFAULT 0,
      require_approval_risk_level TEXT NOT NULL DEFAULT 'HIGH',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'INFO',
      user_id TEXT,
      user_name TEXT,
      thread_id TEXT,
      action TEXT NOT NULL,
      risk_level TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      ip_address TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp ON audit_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_events_type_severity ON audit_events(event_type, severity);
  `
};
