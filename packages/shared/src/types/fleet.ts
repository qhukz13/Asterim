/**
 * Enterprise fleet governance contract (Phase 10, P10-01).
 *
 * Two things are described here and both cross the process boundary: what an
 * organization has forbidden, and what happened anyway.
 *
 * A fleet policy is deliberately a small, closed set of rules rather than a
 * scripting surface. Everything it can say — which models may run, which
 * command shapes may not, whether the air gap is optional, and how much risk
 * may pass without a human — is a fact an IT department can state once and an
 * auditor can read back. A policy that could express arbitrary logic could not
 * be reviewed, and a governance rule nobody can review governs nothing.
 *
 * An audit event is the other half: the record that a rule was applied. It is
 * flat on purpose. Every field is a column, `metadata` is the only free-form
 * corner, and the whole shape maps onto one Syslog frame or one JSON line
 * without a transform — because the consumer is a SIEM collector, not a
 * dashboard, and a log format that needs an adapter is a log format that gets
 * one written badly.
 */

/**
 * How much a recorded event matters.
 *
 * Four levels, not the eight Syslog defines: the distinction that has to
 * survive is "routine / notable / a rule fired / a rule fired on something
 * destructive", and levels nobody can consistently assign are levels that get
 * assigned at random.
 */
export type AuditSeverity = 'INFO' | 'WARN' | 'HIGH' | 'CRITICAL';

/** Ascending order, so severities can be compared rather than matched. */
export const AUDIT_SEVERITY_ORDER: Record<AuditSeverity, number> = {
  INFO: 0,
  WARN: 1,
  HIGH: 2,
  CRITICAL: 3
};

/** `true` when `severity` is at least `minimum`. */
export function meetsAuditSeverity(severity: AuditSeverity, minimum: AuditSeverity): boolean {
  return AUDIT_SEVERITY_ORDER[severity] >= AUDIT_SEVERITY_ORDER[minimum];
}

/**
 * The wire formats an export can be asked for.
 *
 * JSONL is what an ingest pipeline parses without configuration; Syslog
 * RFC 5424 is what a collector already listening on a socket understands; CSV
 * is what a compliance reviewer opens in a spreadsheet. All three are of the
 * same events — the format is a rendering decision, never a filtering one.
 */
export type AuditExportFormat = 'JSONL' | 'SYSLOG_RFC5424' | 'CSV';

/** How risky an action was judged to be, in the vocabulary `ApprovalManager` uses. */
export type FleetRiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * The rules themselves, without the identity of the row that stored them.
 *
 * Split out from `FleetPolicy` because this is exactly what `asterim.policy.json`
 * contains: a file dropped on a workstation by configuration management has no
 * database id and no timestamps, and requiring it to invent them would make the
 * file format an implementation detail of the table.
 */
export interface FleetPolicyConfig {
  /**
   * Model or provider identifiers a session may run under. `['*']` allows
   * everything and is the default; an entry may end in `*` to allow a family
   * (`claude-*`). An empty list allows nothing, which is a lockdown rather than
   * an oversight — see `allowedModels` handling in `FleetPolicyService`.
   */
  allowedModels: string[];
  /**
   * Regular expressions, as source strings, that a command must not match.
   * Sources rather than compiled patterns because this list is JSON on disk and
   * JSON over HTTP; the service compiles them case-insensitively and treats one
   * that does not compile as a policy error rather than as permission.
   */
  bannedCommandPatterns: string[];
  /** When true, the Core must behave as if Sovereign Mode were switched on. */
  enforceSovereignMode: boolean;
  /**
   * The lowest risk level that may not proceed without a human. `'critical'`
   * gates only the worst; `'low'` gates everything.
   */
  requireApprovalRiskLevel: FleetRiskLevel;
}

/** A stored, identified policy. */
export interface FleetPolicy extends FleetPolicyConfig {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  /**
   * Where these rules came from. A file-sourced policy is not editable through
   * the API: the file is the authority, and an endpoint that silently wrote to
   * a database nobody was reading would report success for a change that never
   * took effect.
   */
  source: FleetPolicySource;
}

/** `FILE` is `asterim.policy.json`; `DATABASE` is the `fleet_policies` row; `DEFAULT` is neither. */
export type FleetPolicySource = 'FILE' | 'DATABASE' | 'DEFAULT';

/** The answer to "may this session run under this model". */
export interface ModelValidationResult {
  allowed: boolean;
  reason?: string;
}

/** The answer to "may this command be written to a PTY". */
export interface CommandValidationResult {
  allowed: boolean;
  violationReason?: string;
  /** The policy pattern that matched, so the audit record names the rule and not just the verdict. */
  matchedPattern?: string;
}

/** One recorded thing that happened. */
export interface AuditEvent {
  id: string;
  /** Epoch milliseconds. The column is an integer for the same reason every other timestamp here is. */
  timestamp: number;
  /** A dotted identifier — `policy.violation`, `agent.started`, `approval.granted`. */
  eventType: string;
  severity: AuditSeverity;
  userId?: string | null;
  userName?: string | null;
  threadId?: string | null;
  /** What was done, in one line, as a human reads it. */
  action: string;
  riskLevel?: FleetRiskLevel | null;
  metadata: Record<string, unknown>;
  ipAddress?: string | null;
}

/** What `logEvent` is handed: everything but the fields the logger owns. */
export type AuditEventInput = Omit<AuditEvent, 'id' | 'timestamp'> &
  Partial<Pick<AuditEvent, 'timestamp'>>;

/** Filters over the recorded stream. Every field is optional and they intersect. */
export interface AuditEventQuery {
  startTime?: number;
  endTime?: number;
  eventType?: string;
  minSeverity?: AuditSeverity;
  threadId?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}

/** What an export is asked for. `format` is the only required field. */
export interface AuditExportOptions {
  startTime?: number;
  endTime?: number;
  format: AuditExportFormat;
  minSeverity?: AuditSeverity;
  /** Hard ceiling on rows rendered, so an export cannot be a way to exhaust memory. */
  limit?: number;
}

/** The event type published on the EventBus when a fleet rule refuses something. */
export const POLICY_VIOLATION_EVENT = 'policy.violation';

/**
 * Agent lifecycle, as the audit trail needs it.
 *
 * `agent.status` already carries `idle`/`working`/`error`, but it carries them
 * continuously and for reasons that have nothing to do with a session's
 * existence — an idle status is published when a chat is cleared. An audit
 * record of "a session was started against this checkout, and ended" needs the
 * two transitions and nothing else, so they are published as their own events
 * rather than inferred from a stream that means something else.
 */
export const AGENT_STARTED_EVENT = 'agent.started';
export const AGENT_STOPPED_EVENT = 'agent.stopped';

/** What rides on `agent.started` and `agent.stopped`. */
export interface AgentLifecyclePayload {
  projectId: string;
  threadId: string;
  /** The provider the session runs under, which is what the model allowlist is checked against. */
  agentType: string;
  /** Present on `agent.stopped`: why the session ended. */
  reason?: string;
}

/** What rode on `policy.violation`. */
export interface PolicyViolationPayload {
  projectId?: string;
  threadId?: string;
  /** `command` or `model` — which rule refused. */
  kind: 'command' | 'model';
  /** The subject, already truncated for logging. */
  subject: string;
  reason: string;
  matchedPattern?: string;
  policyId?: string;
  policySource?: FleetPolicySource;
}

/**
 * The ceiling on how much of a refused command is quoted back.
 *
 * A violation record has to identify what was refused without becoming a
 * convenient place to store whatever an agent happened to type, secrets
 * included.
 */
export const AUDIT_SUBJECT_MAX_CHARS = 512;

/** The policy in force when nothing has been configured: permissive, and honest about it. */
export const DEFAULT_FLEET_POLICY_CONFIG: FleetPolicyConfig = {
  allowedModels: ['*'],
  bannedCommandPatterns: [],
  enforceSovereignMode: false,
  requireApprovalRiskLevel: 'high'
};

/** The file an IT department drops in the data directory to take control. */
export const FLEET_POLICY_FILENAME = 'asterim.policy.json';

/** The append-only stream written beside the database. */
export const AUDIT_LOG_FILENAME = 'audit.log';
