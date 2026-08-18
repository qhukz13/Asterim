import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import {
  AGENT_STARTED_EVENT,
  AGENT_STOPPED_EVENT,
  AUDIT_LOG_FILENAME,
  AUDIT_SUBJECT_MAX_CHARS,
  POLICY_VIOLATION_EVENT,
  meetsAuditSeverity,
  type AgentLifecyclePayload,
  type AuditEvent,
  type AuditEventInput,
  type AuditEventQuery,
  type AuditExportOptions,
  type AuditSeverity,
  type FleetRiskLevel,
  type PolicyViolationPayload
} from '@asterim/shared';
import { dbService, resolveDataDir } from '../DatabaseService';
import { eventBus } from '../EventBus';
import { secretVault } from '../security/SecretVaultService';
import { enforceOwnerOnly } from '../../utils/permissions';

/**
 * The structured audit stream (P10-01).
 *
 * What an enterprise deployment has to be able to answer months later is not
 * "what did the agent say" — that is the event log — but "who cleared what, and
 * what did policy stop". This records that, in a shape a SIEM collector reads
 * without a translator.
 *
 * Three decisions are load-bearing.
 *
 * **Two sinks, not one.** Every event goes to the `audit_events` table *and* to
 * an append-only `audit.log` beside the database. The table is what the API
 * queries and what an export renders from; the file is what a log shipper tails
 * and what survives a database that was deleted, rotated, or replaced. Either
 * one alone leaves a hole an auditor would have to take on trust.
 *
 * **Redaction happens here, not at the edges.** Every string that reaches this
 * service — the action, the metadata, the subject of a violation — is passed
 * through the vault's redactor before it is written anywhere. An audit trail is
 * the one stream that is deliberately copied off the machine, so a credential
 * that leaks into it leaks the furthest. Doing it at the sink rather than at
 * each caller means a new call site cannot forget.
 *
 * **Nothing here is allowed to throw at a caller.** Logging is instrumentation
 * on paths that are themselves security decisions — a banned command being
 * refused, an approval being granted — and a full disk must not be able to turn
 * "the command was refused" into an unhandled rejection somewhere up the stack.
 * Failures are reported to the console and swallowed.
 */

/** Syslog facility 13, `log audit`, which is what this stream is. */
const SYSLOG_FACILITY = 13;

/**
 * RFC 5424 severity codes for the four levels this service uses. Values below
 * `warning` are not produced: an audit event that was worth recording is at
 * least informational, and one that names a refused action is at least an error.
 */
const SYSLOG_SEVERITY: Record<AuditSeverity, number> = {
  INFO: 6, // informational
  WARN: 4, // warning
  HIGH: 3, // error
  CRITICAL: 2 // critical
};

/** RFC 5424 APP-NAME. */
const SYSLOG_APP_NAME = 'asterim';
/** RFC 5424 SD-ID for the structured data block, with the required private enterprise suffix. */
const SYSLOG_SD_ID = 'asterim@52773';
/**
 * The BOM RFC 5424 § 6.4 requires in front of a UTF-8 MSG — U+FEFF, which is
 * why this line looks like it holds an empty string. A collector reads its
 * absence as "this MSG is not UTF-8", so it is not decoration.
 */
const SYSLOG_BOM = '﻿';

/** A ceiling on export size, so one request cannot be a way to exhaust memory. */
const DEFAULT_EXPORT_LIMIT = 50_000;
/** A ceiling on a query page. */
const MAX_QUERY_LIMIT = 1_000;

interface AuditRow {
  id: string;
  timestamp: number;
  event_type: string;
  severity: string;
  user_id: string | null;
  user_name: string | null;
  thread_id: string | null;
  action: string;
  risk_level: string | null;
  metadata_json: string;
  ip_address: string | null;
}

export interface AuditLoggerServiceOptions {
  /** Where `audit.log` is written. Defaults to the Asterim data directory. */
  dataDir?: string;
  /** Database accessor, called lazily so constructing the service opens nothing. */
  getDb?: () => DatabaseSync;
  /** Redactor override. Defaults to the process vault, which is what strips real secrets. */
  redact?: (text: string) => string;
  /** Hostname reported in Syslog frames. Defaults to this machine's. */
  hostname?: string;
}

export class AuditLoggerService {
  private readonly dataDirOverride?: string;
  private readonly dbAccessor: () => DatabaseSync;
  private readonly redactor: (text: string) => string;
  private readonly hostnameOverride?: string;

  /** Set once `subscribe()` has wired the bus, so a second call is a no-op. */
  private subscribed = false;

  constructor(options: AuditLoggerServiceOptions = {}) {
    this.dataDirOverride = options.dataDir;
    this.dbAccessor = options.getDb ?? (() => dbService.getDb());
    this.redactor = options.redact ?? (text => secretVault.redactSecrets(text));
    this.hostnameOverride = options.hostname;
  }

  private dataDir(): string {
    return this.dataDirOverride ?? resolveDataDir();
  }

  /** Absolute path of the append-only stream. */
  public getAuditLogPath(): string {
    return path.join(this.dataDir(), AUDIT_LOG_FILENAME);
  }

  // --- Writing -------------------------------------------------------------

  /**
   * Records one event.
   *
   * Returns the event as it was stored — redacted, identified and timestamped —
   * so a caller that wants to publish or assert on it sees exactly what an
   * export will show rather than what it handed in.
   */
  public logEvent(input: AuditEventInput): AuditEvent {
    const event: AuditEvent = {
      id: `evt_${crypto.randomUUID()}`,
      timestamp: input.timestamp ?? Date.now(),
      eventType: this.scrub(input.eventType) || 'unknown',
      severity: input.severity ?? 'INFO',
      userId: this.scrubNullable(input.userId),
      userName: this.scrubNullable(input.userName),
      threadId: this.scrubNullable(input.threadId),
      action: this.scrub(input.action),
      riskLevel: input.riskLevel ?? null,
      metadata: this.scrubMetadata(input.metadata ?? {}),
      ipAddress: this.scrubNullable(input.ipAddress)
    };

    this.persist(event);
    this.append(event);
    return event;
  }

  private persist(event: AuditEvent): void {
    try {
      this.dbAccessor()
        .prepare(
          `INSERT INTO audit_events
             (id, timestamp, event_type, severity, user_id, user_name, thread_id, action,
              risk_level, metadata_json, ip_address)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          event.id,
          event.timestamp,
          event.eventType,
          event.severity,
          event.userId ?? null,
          event.userName ?? null,
          event.threadId ?? null,
          event.action,
          event.riskLevel ?? null,
          safeStringify(event.metadata),
          event.ipAddress ?? null
        );
    } catch (err) {
      console.error(`[AuditLogger] Could not persist audit event: ${(err as Error).message}`);
    }
  }

  /**
   * Appends one JSON line to `audit.log`.
   *
   * Opened, written and closed per event rather than held on a stream: an audit
   * file that loses its tail because the process was killed before a buffer was
   * flushed is an audit file with a hole exactly where the interesting event
   * would have been.
   */
  private append(event: AuditEvent): void {
    const file = this.getAuditLogPath();
    try {
      const dir = path.dirname(file);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.appendFileSync(file, `${safeStringify(this.toJsonRecord(event))}\n`, { mode: 0o600 });
      // The stream holds the same facts the owner-only database holds (DEC-028).
      enforceOwnerOnly(file, 0o600, 'AuditLogger');
    } catch (err) {
      console.error(`[AuditLogger] Could not append to ${file}: ${(err as Error).message}`);
    }
  }

  // --- Redaction -----------------------------------------------------------

  private scrub(text: string): string {
    if (typeof text !== 'string') return '';
    try {
      return this.redactor(text);
    } catch {
      // A redactor that threw has told us nothing about the string, so the
      // string does not get written.
      return '[REDACTION_FAILED]';
    }
  }

  private scrubNullable(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    return this.scrub(value);
  }

  /**
   * Redacts a metadata object, keys included.
   *
   * Keys are scrubbed as well as values because a caller is free to key by
   * something it read from the environment, and a secret used as a property
   * name is exported exactly as legibly as one used as a value.
   */
  private scrubMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    return this.scrubValue(metadata, 0) as Record<string, unknown>;
  }

  private scrubValue(value: unknown, depth: number): unknown {
    if (depth > 8) return '[TRUNCATED]';
    if (typeof value === 'string') return this.scrub(value);
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
    if (value === undefined) return null;
    if (Array.isArray(value)) return value.map(entry => this.scrubValue(entry, depth + 1));
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        out[this.scrub(key)] = this.scrubValue(entry, depth + 1);
      }
      return out;
    }
    // Functions, symbols and bigints have no place in an exported record.
    return this.scrub(String(value));
  }

  // --- Reading -------------------------------------------------------------

  /** The recorded stream, newest first, narrowed by whatever the caller supplied. */
  public query(options: AuditEventQuery = {}): AuditEvent[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (typeof options.startTime === 'number') {
      clauses.push('timestamp >= ?');
      params.push(options.startTime);
    }
    if (typeof options.endTime === 'number') {
      clauses.push('timestamp <= ?');
      params.push(options.endTime);
    }
    if (options.eventType) {
      clauses.push('event_type = ?');
      params.push(options.eventType);
    }
    if (options.threadId) {
      clauses.push('thread_id = ?');
      params.push(options.threadId);
    }
    if (options.userId) {
      clauses.push('user_id = ?');
      params.push(options.userId);
    }

    const limit = clampLimit(options.limit, 100, MAX_QUERY_LIMIT);
    const offset = Math.max(0, Math.floor(options.offset ?? 0));

    let rows: AuditRow[];
    try {
      rows = this.dbAccessor()
        .prepare(
          `SELECT id, timestamp, event_type, severity, user_id, user_name, thread_id, action,
                  risk_level, metadata_json, ip_address
             FROM audit_events
             ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
         ORDER BY timestamp DESC, rowid DESC
            LIMIT ? OFFSET ?`
        )
        .all(...params, limit, offset) as unknown as AuditRow[];
    } catch (err) {
      console.error(`[AuditLogger] Could not read audit events: ${(err as Error).message}`);
      return [];
    }

    const events = rows.map(toAuditEvent);
    // Severity is filtered here rather than in SQL: it is an ordered scale
    // stored as text, and `severity >= 'HIGH'` in SQLite is a string comparison
    // that would silently admit and exclude the wrong rows.
    return options.minSeverity
      ? events.filter(event => meetsAuditSeverity(event.severity, options.minSeverity as AuditSeverity))
      : events;
  }

  /** How many events match a window, for a caller that pages through them. */
  public count(
    options: Partial<Pick<AuditEventQuery, 'startTime' | 'endTime' | 'eventType'>> = {}
  ): number {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (typeof options.startTime === 'number') {
      clauses.push('timestamp >= ?');
      params.push(options.startTime);
    }
    if (typeof options.endTime === 'number') {
      clauses.push('timestamp <= ?');
      params.push(options.endTime);
    }
    if (options.eventType) {
      clauses.push('event_type = ?');
      params.push(options.eventType);
    }

    try {
      const row = this.dbAccessor()
        .prepare(
          `SELECT COUNT(*) AS count FROM audit_events ${
            clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
          }`
        )
        .get(...params) as { count: number };
      return row?.count ?? 0;
    } catch (err) {
      console.error(`[AuditLogger] Could not count audit events: ${(err as Error).message}`);
      return 0;
    }
  }

  // --- Export --------------------------------------------------------------

  /**
   * Renders the matching events in one of the collector formats.
   *
   * Ascending by time, unlike `query()`: an export is replayed into a pipeline,
   * and a log shipped newest-first arrives out of order in every tool that
   * reads it.
   */
  public exportLogs(options: AuditExportOptions): string {
    const events = this.query({
      startTime: options.startTime,
      endTime: options.endTime,
      minSeverity: options.minSeverity,
      limit: clampLimit(options.limit, DEFAULT_EXPORT_LIMIT, DEFAULT_EXPORT_LIMIT)
    }).reverse();

    switch (options.format) {
      case 'SYSLOG_RFC5424':
        return events.map(event => this.toSyslogFrame(event)).join('\n');
      case 'CSV':
        return toCsv(events);
      case 'JSONL':
      default:
        return events.map(event => safeStringify(this.toJsonRecord(event))).join('\n');
    }
  }

  /** The MIME type a given export should be served as. */
  public contentTypeFor(format: AuditExportOptions['format']): string {
    if (format === 'CSV') return 'text/csv; charset=utf-8';
    if (format === 'SYSLOG_RFC5424') return 'text/plain; charset=utf-8';
    return 'application/x-ndjson; charset=utf-8';
  }

  /** The flat record written to `audit.log` and to a JSONL export. */
  private toJsonRecord(event: AuditEvent): Record<string, unknown> {
    return {
      id: event.id,
      timestamp: new Date(event.timestamp).toISOString(),
      timestampMs: event.timestamp,
      eventType: event.eventType,
      severity: event.severity,
      userId: event.userId ?? null,
      userName: event.userName ?? null,
      threadId: event.threadId ?? null,
      action: event.action,
      riskLevel: event.riskLevel ?? null,
      ipAddress: event.ipAddress ?? null,
      metadata: event.metadata
    };
  }

  /**
   * One RFC 5424 frame.
   *
   * `<PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID STRUCTURED-DATA BOM MSG`
   *
   * The identity fields go in STRUCTURED-DATA rather than into the message text,
   * because that is the half of the frame a collector indexes; a user id inside
   * the free-text MSG is a user id nobody can filter on. Every NILVALUE is a
   * literal `-`, and every field that could be empty is given one — a frame with
   * a blank in a required position is not a frame, and a collector will drop it
   * rather than complain.
   */
  private toSyslogFrame(event: AuditEvent): string {
    const priority = SYSLOG_FACILITY * 8 + SYSLOG_SEVERITY[event.severity];
    const timestamp = new Date(event.timestamp).toISOString();
    const hostname = syslogToken(this.hostnameOverride ?? os.hostname(), 255);
    const procId = syslogToken(String(process.pid), 128);
    const msgId = syslogToken(event.eventType, 32);

    const params: Array<[string, string]> = [
      ['eventId', event.id],
      ['eventType', event.eventType],
      ['severity', event.severity]
    ];
    if (event.userId) params.push(['userId', event.userId]);
    if (event.userName) params.push(['userName', event.userName]);
    if (event.threadId) params.push(['threadId', event.threadId]);
    if (event.riskLevel) params.push(['riskLevel', event.riskLevel]);
    if (event.ipAddress) params.push(['ipAddress', event.ipAddress]);
    for (const [key, value] of Object.entries(event.metadata)) {
      const name = syslogParamName(key);
      if (!name) continue;
      params.push([name, typeof value === 'string' ? value : safeStringify(value)]);
    }

    const structuredData = `[${SYSLOG_SD_ID} ${params
      .map(([key, value]) => `${key}="${escapeSyslogParamValue(value)}"`)
      .join(' ')}]`;

    // The MSG carries newlines only as escapes: RFC 5424 frames are delimited by
    // them, so a raw newline in the message would split one event into two.
    const message = event.action.replace(/\r?\n/g, '\\n');

    return `<${priority}>1 ${timestamp} ${hostname} ${SYSLOG_APP_NAME} ${procId} ${msgId} ${structuredData} ${SYSLOG_BOM}${message}`;
  }

  // --- EventBus wiring -----------------------------------------------------

  /**
   * Subscribes to the events worth an audit record.
   *
   * The names are the Core's actual event types in the bus's dotted spelling,
   * not the `agent:approval_required` colon form P10-01 writes them in: a
   * subscription to a type nothing publishes is a silent, empty audit trail.
   *
   * `agent.started` and `agent.stopped` are published by `AgentService` for this
   * (see `AGENT_STARTED_EVENT`); the pre-existing `agent.status` stream is not
   * used, because it reports working/idle continuously and an audit record per
   * status change would bury the security events under telemetry.
   */
  public subscribe(): void {
    if (this.subscribed) return;
    this.subscribed = true;

    eventBus.subscribe<Record<string, unknown>>('agent.approval_request', event => {
      const payload = event.payload ?? {};
      const analysis = payload.securityAnalysis as { riskLevel?: FleetRiskLevel } | undefined;
      this.safely(() =>
        this.logEvent({
          eventType: 'approval.requested',
          severity: 'WARN',
          threadId: asString(payload.threadId),
          action: `Approval requested: ${asString(payload.description) ?? 'unspecified action'}`,
          riskLevel: analysis?.riskLevel ?? null,
          metadata: {
            actionId: asString(payload.actionId),
            projectId: asString(payload.projectId),
            command: truncate(asString(payload.command) ?? '', AUDIT_SUBJECT_MAX_CHARS)
          }
        })
      );
    });

    eventBus.subscribe<Record<string, unknown>>('client.approval_response', event => {
      const payload = event.payload ?? {};
      const approved = payload.approved === true;
      this.safely(() =>
        this.logEvent({
          eventType: approved ? 'approval.granted' : 'approval.denied',
          // A granted clearance is the one an auditor looks for; a denial is a
          // rule working as intended.
          severity: approved ? 'HIGH' : 'INFO',
          threadId: asString(payload.threadId),
          action: approved
            ? `Human approved action ${asString(payload.actionId) ?? 'unknown'}`
            : `Human denied action ${asString(payload.actionId) ?? 'unknown'}`,
          metadata: { actionId: asString(payload.actionId), projectId: asString(payload.projectId) }
        })
      );
    });

    eventBus.subscribe<AgentLifecyclePayload>(AGENT_STARTED_EVENT, event => {
      const payload = (event.payload ?? {}) as AgentLifecyclePayload;
      this.safely(() =>
        this.logEvent({
          eventType: 'agent.started',
          severity: 'INFO',
          threadId: payload.threadId ?? null,
          action: `Agent session started on thread ${payload.threadId ?? 'unknown'} under '${
            payload.agentType ?? 'unknown'
          }'`,
          metadata: { projectId: payload.projectId ?? null, agentType: payload.agentType ?? null }
        })
      );
    });

    eventBus.subscribe<AgentLifecyclePayload>(AGENT_STOPPED_EVENT, event => {
      const payload = (event.payload ?? {}) as AgentLifecyclePayload;
      this.safely(() =>
        this.logEvent({
          eventType: 'agent.stopped',
          severity: 'INFO',
          threadId: payload.threadId ?? null,
          action: `Agent session stopped on thread ${payload.threadId ?? 'unknown'}${
            payload.reason ? `: ${payload.reason}` : ''
          }`,
          metadata: { projectId: payload.projectId ?? null, agentType: payload.agentType ?? null }
        })
      );
    });

    eventBus.subscribe<PolicyViolationPayload>(POLICY_VIOLATION_EVENT, event => {
      const payload = (event.payload ?? {}) as PolicyViolationPayload;
      this.safely(() =>
        this.logEvent({
          eventType: 'policy.violation',
          severity: 'CRITICAL',
          threadId: payload.threadId ?? null,
          action: payload.reason ?? 'A fleet policy rule refused an action.',
          riskLevel: 'critical',
          metadata: {
            kind: payload.kind,
            subject: truncate(payload.subject ?? '', AUDIT_SUBJECT_MAX_CHARS),
            matchedPattern: payload.matchedPattern ?? null,
            policyId: payload.policyId ?? null,
            policySource: payload.policySource ?? null,
            projectId: payload.projectId ?? null
          }
        })
      );
    });
  }

  /** Instrumentation must not be able to break the path it instruments. */
  private safely(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error(`[AuditLogger] Could not record an event: ${(err as Error).message}`);
    }
  }
}

// --- Helpers ---------------------------------------------------------------

function toAuditEvent(row: AuditRow): AuditEvent {
  let metadata: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.metadata_json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      metadata = parsed as Record<string, unknown>;
    }
  } catch {
    metadata = { parseError: 'stored metadata was not valid JSON' };
  }

  return {
    id: row.id,
    timestamp: row.timestamp,
    eventType: row.event_type,
    severity: normalizeSeverity(row.severity),
    userId: row.user_id,
    userName: row.user_name,
    threadId: row.thread_id,
    action: row.action,
    riskLevel: (row.risk_level as FleetRiskLevel | null) ?? null,
    metadata,
    ipAddress: row.ip_address
  };
}

/** An unrecognised stored severity reads as `INFO` rather than crashing an export. */
function normalizeSeverity(value: string): AuditSeverity {
  const upper = (value ?? '').toUpperCase();
  return upper === 'WARN' || upper === 'HIGH' || upper === 'CRITICAL'
    ? (upper as AuditSeverity)
    : 'INFO';
}

/** `JSON.stringify` that cannot throw on a cycle, because an audit write must not. */
function safeStringify(value: unknown): string {
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_key, entry) => {
      if (entry && typeof entry === 'object') {
        if (seen.has(entry as object)) return '[Circular]';
        seen.add(entry as object);
      }
      return entry;
    });
  } catch {
    return '{}';
  }
}

function clampLimit(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(1, Math.floor(value)), max);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * RFC 5424 header fields are PRINTUSASCII with no spaces and a per-field length
 * ceiling. A hostname or a message id that breaks either would shift every
 * field after it, so anything unusable is replaced with the NILVALUE.
 */
function syslogToken(value: string, maxLength: number): string {
  const cleaned = (value ?? '').replace(/[^\x21-\x7e]/g, '');
  if (!cleaned) return '-';
  return cleaned.slice(0, maxLength);
}

/** SD-PARAM names share the header's character rules and are capped at 32 octets. */
function syslogParamName(key: string): string | null {
  const cleaned = (key ?? '').replace(/[^A-Za-z0-9_.-]/g, '');
  return cleaned ? cleaned.slice(0, 32) : null;
}

/** RFC 5424 § 6.3.3: `"`, `\` and `]` are the three characters a PARAM-VALUE must escape. */
function escapeSyslogParamValue(value: string): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/]/g, '\\]')
    .replace(/\r?\n/g, ' ');
}

function toCsv(events: AuditEvent[]): string {
  const header = [
    'id',
    'timestamp',
    'event_type',
    'severity',
    'user_id',
    'user_name',
    'thread_id',
    'action',
    'risk_level',
    'ip_address',
    'metadata'
  ];
  const lines = [header.join(',')];
  for (const event of events) {
    lines.push(
      [
        event.id,
        new Date(event.timestamp).toISOString(),
        event.eventType,
        event.severity,
        event.userId ?? '',
        event.userName ?? '',
        event.threadId ?? '',
        event.action,
        event.riskLevel ?? '',
        event.ipAddress ?? '',
        safeStringify(event.metadata)
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return lines.join('\n');
}

/**
 * A CSV cell, quoted whenever it could otherwise be misread.
 *
 * The leading apostrophe on `=`, `+`, `-` and `@` is deliberate: this export is
 * opened in a spreadsheet, and a cell beginning with one of those is executed as
 * a formula by Excel and Sheets. An audit record is attacker-influenced text by
 * definition, so it does not get to be a formula.
 */
function csvCell(value: string): string {
  const text = String(value ?? '');
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** The process-wide logger. Constructing it opens nothing; the first event does. */
export const auditLogger = new AuditLoggerService();
