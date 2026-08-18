import fs from 'fs';
import path from 'path';
import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_FLEET_POLICY_CONFIG,
  FLEET_POLICY_FILENAME,
  type CommandValidationResult,
  type FleetPolicy,
  type FleetPolicyConfig,
  type FleetPolicySource,
  type FleetRiskLevel,
  type ModelValidationResult
} from '@asterim/shared';
import { dbService, resolveDataDir } from '../DatabaseService';

/**
 * The Enterprise Fleet Policy Engine (P10-01).
 *
 * One question, asked at three seams: is this allowed here? A model about to be
 * started under, a command about to be written to a PTY, and a risk level about
 * to be waved through without a human.
 *
 * Two things decide the answer, and their order is the whole design.
 * `asterim.policy.json` in the data directory wins over the `fleet_policies`
 * table, unconditionally. That is what makes the file useful: configuration
 * management drops it on a fleet of workstations, and no API call, no admin UI
 * and no row anybody inserts can talk the Core out of it. A policy an endpoint
 * could overwrite is not a fleet policy, it is a preference.
 *
 * Three properties follow from that and are deliberate:
 *
 *   - **Rules are re-read, not cached for the process's life.** The file is
 *     stat-ed on each resolution and re-parsed only when its mtime or size
 *     moved, so a policy pushed to a running workstation takes effect on the
 *     next command rather than on the next restart, without paying a read per
 *     keystroke.
 *   - **A malformed file is a lockdown, not a fallback.** A file that will not
 *     parse, or a pattern that will not compile, means the operator's stated
 *     intent is unknown — and "unknown" resolving to "permit everything" is how
 *     a governance engine becomes theatre. The engine reports the failure and
 *     refuses what it cannot vouch for.
 *   - **The engine never spawns, kills or writes anything.** It answers
 *     questions. `AgentService` and `ApprovalManager` act on the answers, which
 *     keeps the thing that decides separable from the things that enforce, and
 *     testable without a PTY.
 */

/** How a policy failure reads to a caller that has to branch on it. */
export type FleetPolicyErrorCode =
  | 'INVALID_POLICY'
  | 'POLICY_FILE_ENFORCED'
  | 'POLICY_FILE_UNREADABLE';

export class FleetPolicyError extends Error {
  public readonly code: FleetPolicyErrorCode;

  constructor(code: FleetPolicyErrorCode, message: string) {
    super(message);
    this.name = 'FleetPolicyError';
    this.code = code;
  }
}

/** Ascending, so a risk level can be compared against the configured threshold. */
const RISK_ORDER: Record<FleetRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
};

const RISK_LEVELS = Object.keys(RISK_ORDER) as FleetRiskLevel[];

/**
 * The stored threshold is upper-case (`'HIGH'`) because that is the column's
 * default and how an operator writes it; the risk vocabulary everywhere else in
 * the Core is lower-case. Normalised on the way in rather than at every
 * comparison, so only one place has to know both spellings exist.
 */
function normalizeRiskLevel(value: unknown, fallback: FleetRiskLevel): FleetRiskLevel {
  if (typeof value !== 'string') return fallback;
  const lowered = value.trim().toLowerCase();
  return (RISK_LEVELS as string[]).includes(lowered) ? (lowered as FleetRiskLevel) : fallback;
}

interface PolicyRow {
  id: string;
  name: string;
  description: string | null;
  is_active: number;
  allowed_models_json: string;
  banned_commands_json: string;
  enforce_sovereign_mode: number;
  require_approval_risk_level: string;
  created_at: number;
  updated_at: number;
}

/** A parsed policy plus the compiled patterns it implies. */
interface ResolvedPolicy {
  policy: FleetPolicy;
  patterns: Array<{ source: string; regex: RegExp }>;
  /** Set when the source could not be trusted; every gated question then fails closed. */
  failure: string | null;
}

/** What the file's mtime and size were when it was last parsed. */
interface FileStamp {
  mtimeMs: number;
  size: number;
}

export interface FleetPolicyServiceOptions {
  /** Where `asterim.policy.json` is looked for. Defaults to the Asterim data directory. */
  dataDir?: string;
  /** Database accessor, called lazily so constructing the service opens nothing. */
  getDb?: () => DatabaseSync;
}

/** The row id a database-backed policy is stored under. Single active policy per installation. */
export const ACTIVE_FLEET_POLICY_ID = 'fleet_policy_active';

export class FleetPolicyService {
  private readonly dataDirOverride?: string;
  private readonly dbAccessor: () => DatabaseSync;

  private cached: ResolvedPolicy | null = null;
  private cachedFileStamp: FileStamp | null = null;
  private cachedFromFile = false;

  constructor(options: FleetPolicyServiceOptions = {}) {
    this.dataDirOverride = options.dataDir;
    this.dbAccessor = options.getDb ?? (() => dbService.getDb());
  }

  private dataDir(): string {
    return this.dataDirOverride ?? resolveDataDir();
  }

  /** Absolute path of the file-based policy, whether or not it exists. */
  public getPolicyFilePath(): string {
    return path.join(this.dataDir(), FLEET_POLICY_FILENAME);
  }

  /** `true` when an `asterim.policy.json` is present and therefore in charge. */
  public isFileEnforced(): boolean {
    try {
      return fs.existsSync(this.getPolicyFilePath());
    } catch {
      return false;
    }
  }

  /** Forgets the resolved policy, so the next question re-reads file and table. */
  public invalidate(): void {
    this.cached = null;
    this.cachedFileStamp = null;
    this.cachedFromFile = false;
  }

  // --- Resolution ----------------------------------------------------------

  /**
   * The rules in force, from the file if there is one and the table otherwise.
   *
   * The cache is only reused when the file has not moved underneath it. A
   * database-sourced policy is re-read whenever a write invalidates it, which is
   * every path that can change it, since the table is only writable through this
   * service.
   */
  private resolve(): ResolvedPolicy {
    const filePath = this.getPolicyFilePath();
    let stamp: FileStamp | null;
    try {
      const stat = fs.statSync(filePath);
      stamp = { mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
      stamp = null;
    }

    if (this.cached) {
      const stampUnchanged =
        (stamp === null && this.cachedFileStamp === null) ||
        (stamp !== null &&
          this.cachedFileStamp !== null &&
          stamp.mtimeMs === this.cachedFileStamp.mtimeMs &&
          stamp.size === this.cachedFileStamp.size);
      // A file that has appeared where there was none also invalidates a cached
      // database policy — it has just taken precedence over it.
      if (stampUnchanged && this.cachedFromFile === (stamp !== null)) {
        return this.cached;
      }
    }

    const resolved = stamp !== null ? this.loadFromFile(filePath) : this.loadFromDatabase();
    this.cached = resolved;
    this.cachedFileStamp = stamp;
    this.cachedFromFile = stamp !== null;
    return resolved;
  }

  private loadFromFile(filePath: string): ResolvedPolicy {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      return this.lockedDown(
        'FILE',
        `${FLEET_POLICY_FILENAME} exists but could not be read: ${(err as Error).message}`
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return this.lockedDown(
        'FILE',
        `${FLEET_POLICY_FILENAME} is not valid JSON: ${(err as Error).message}`
      );
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return this.lockedDown('FILE', `${FLEET_POLICY_FILENAME} must contain a JSON object.`);
    }

    const record = parsed as Record<string, unknown>;
    let config: FleetPolicyConfig;
    try {
      config = normalizePolicyConfig(record);
    } catch (err) {
      return this.lockedDown('FILE', `${FLEET_POLICY_FILENAME} is invalid: ${(err as Error).message}`);
    }

    const now = Date.now();
    const policy: FleetPolicy = {
      id: typeof record.id === 'string' && record.id ? record.id : 'fleet_policy_file',
      name: typeof record.name === 'string' && record.name ? record.name : 'Fleet policy (file)',
      description: typeof record.description === 'string' ? record.description : null,
      // A file that exists is in force. `isActive: false` in it would mean "the
      // authority says there is no authority", which is the DEFAULT policy, and
      // is expressed by deleting the file.
      isActive: true,
      createdAt: now,
      updatedAt: now,
      source: 'FILE',
      ...config
    };

    return this.compile(policy);
  }

  private loadFromDatabase(): ResolvedPolicy {
    let row: PolicyRow | undefined;
    try {
      row = this.dbAccessor()
        .prepare(
          `SELECT id, name, description, is_active, allowed_models_json, banned_commands_json,
                  enforce_sovereign_mode, require_approval_risk_level, created_at, updated_at
             FROM fleet_policies
            WHERE is_active = 1
         ORDER BY updated_at DESC
            LIMIT 1`
        )
        .get() as PolicyRow | undefined;
    } catch (err) {
      // The table is missing or unreadable. That is a broken installation, not
      // a policy, so it does not get to be a lockdown — the default applies and
      // the failure is loud.
      console.error(`[FleetPolicy] Could not read fleet_policies: ${(err as Error).message}`);
      return this.compile(this.defaultPolicy());
    }

    if (!row) return this.compile(this.defaultPolicy());

    let config: FleetPolicyConfig;
    try {
      config = normalizePolicyConfig({
        allowedModels: JSON.parse(row.allowed_models_json),
        bannedCommandPatterns: JSON.parse(row.banned_commands_json),
        enforceSovereignMode: row.enforce_sovereign_mode === 1,
        requireApprovalRiskLevel: row.require_approval_risk_level
      });
    } catch (err) {
      return this.lockedDown(
        'DATABASE',
        `Stored fleet policy ${row.id} is malformed: ${(err as Error).message}`
      );
    }

    return this.compile({
      id: row.id,
      name: row.name,
      description: row.description,
      isActive: true,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      source: 'DATABASE',
      ...config
    });
  }

  private defaultPolicy(): FleetPolicy {
    return {
      id: 'fleet_policy_default',
      name: 'Unmanaged',
      description: 'No fleet policy is configured on this installation.',
      isActive: false,
      createdAt: 0,
      updatedAt: 0,
      source: 'DEFAULT',
      ...DEFAULT_FLEET_POLICY_CONFIG
    };
  }

  /** Compiles the banned patterns; a pattern that will not compile locks the policy down. */
  private compile(policy: FleetPolicy): ResolvedPolicy {
    const patterns: Array<{ source: string; regex: RegExp }> = [];
    for (const source of policy.bannedCommandPatterns) {
      try {
        patterns.push({ source, regex: new RegExp(source, 'i') });
      } catch (err) {
        return {
          policy,
          patterns: [],
          failure: `Banned command pattern ${JSON.stringify(source)} is not a valid regular expression: ${
            (err as Error).message
          }`
        };
      }
    }
    return { policy, patterns, failure: null };
  }

  /**
   * The state a policy source that cannot be trusted leaves behind: the rules
   * are unknown, so every gated question is answered "no".
   */
  private lockedDown(source: FleetPolicySource, failure: string): ResolvedPolicy {
    console.error(`[FleetPolicy] ${failure}`);
    return {
      policy: { ...this.defaultPolicy(), source, isActive: true, name: 'Unreadable policy' },
      patterns: [],
      failure
    };
  }

  // --- Questions -----------------------------------------------------------

  /** The rules currently in force, as the API renders them. */
  public getActivePolicy(): FleetPolicy {
    return this.resolve().policy;
  }

  /** The reason the policy could not be trusted, or `null` when it could. */
  public getPolicyFailure(): string | null {
    return this.resolve().failure;
  }

  /**
   * `true` when this installation is actually governed — a file or a stored row.
   *
   * The distinction matters at the approval seam. The default threshold has to
   * be *some* value, and the gates read it unconditionally; without this, a
   * single-developer workstation that has never seen a policy would inherit the
   * default threshold as though an administrator had chosen it, and start
   * demanding approvals nobody configured (DEC-028).
   */
  public isManaged(): boolean {
    return this.resolve().policy.source !== 'DEFAULT';
  }

  /**
   * Whether a session may run under `model`.
   *
   * `['*']` allows everything and is the default. A trailing `*` allows a family
   * (`claude-*` admits `claude-opus-5`). An empty allowlist admits nothing —
   * stating an empty list is a decision, and reading it as "no restriction"
   * would invert it.
   */
  public validateModel(model: string): ModelValidationResult {
    const resolved = this.resolve();
    if (resolved.failure) {
      return { allowed: false, reason: `Fleet policy could not be applied: ${resolved.failure}` };
    }

    const candidate = (model ?? '').trim();
    if (!candidate) {
      return { allowed: false, reason: 'No model was named, so it cannot be checked against the fleet allowlist.' };
    }

    const allowed = resolved.policy.allowedModels;
    for (const entry of allowed) {
      if (matchesAllowEntry(candidate, entry)) return { allowed: true };
    }

    return {
      allowed: false,
      reason:
        `Model '${candidate}' is not on the fleet allowlist (${allowed.length > 0 ? allowed.join(', ') : 'empty'}) ` +
        `defined by policy '${resolved.policy.name}'.`
    };
  }

  /**
   * Whether `command` may be written to a PTY.
   *
   * Fails closed on every path that is not an outright match against a known
   * rule set: an unreadable policy refuses, and a pattern that does not compile
   * refuses. The matched pattern is returned alongside the verdict so the audit
   * record names the rule rather than only the outcome — "blocked by policy" is
   * not something an operator can act on.
   */
  public validateCommand(command: string): CommandValidationResult {
    const resolved = this.resolve();
    if (resolved.failure) {
      return {
        allowed: false,
        violationReason: `Fleet policy could not be applied: ${resolved.failure}`
      };
    }

    const candidate = command ?? '';
    if (!candidate.trim()) return { allowed: true };

    for (const { source, regex } of resolved.patterns) {
      // `lastIndex` is irrelevant here: the patterns are compiled without /g,
      // so `test` does not carry state between calls.
      if (regex.test(candidate)) {
        return {
          allowed: false,
          violationReason: `Command is forbidden by fleet policy '${resolved.policy.name}' (pattern ${source}).`,
          matchedPattern: source
        };
      }
    }

    return { allowed: true };
  }

  /** Whether the policy requires the Core to behave as if the air gap were on. */
  public isSovereignModeForced(): boolean {
    const resolved = this.resolve();
    // An unreadable policy is not evidence that the air gap was demanded; it is
    // evidence that nothing is known. Sovereign Mode stays as configured, while
    // the gates that *can* fail closed already have.
    if (resolved.failure) return false;
    return resolved.policy.enforceSovereignMode;
  }

  /** The threshold at or above which a human must approve. */
  public getApprovalRiskThreshold(): FleetRiskLevel {
    const resolved = this.resolve();
    if (resolved.failure) return 'low';
    return resolved.policy.requireApprovalRiskLevel;
  }

  /** Whether an action judged `riskLevel` may proceed without a human. */
  public requiresApproval(riskLevel: FleetRiskLevel): boolean {
    return RISK_ORDER[riskLevel] >= RISK_ORDER[this.getApprovalRiskThreshold()];
  }

  // --- Administration ------------------------------------------------------

  /**
   * Replaces the stored policy.
   *
   * Refuses while a policy file is present. Writing the row would succeed and
   * change nothing, and an endpoint that answers 200 for a change that does not
   * take effect is worse than one that refuses.
   */
  public updatePolicy(
    input: Partial<FleetPolicyConfig> & { name?: string; description?: string | null }
  ): FleetPolicy {
    if (this.isFileEnforced()) {
      throw new FleetPolicyError(
        'POLICY_FILE_ENFORCED',
        `This installation is governed by ${this.getPolicyFilePath()}; the stored policy cannot be edited while that file is present.`
      );
    }

    const current = this.loadFromDatabase().policy;
    let config: FleetPolicyConfig;
    try {
      config = normalizePolicyConfig({
        allowedModels: input.allowedModels ?? current.allowedModels,
        bannedCommandPatterns: input.bannedCommandPatterns ?? current.bannedCommandPatterns,
        enforceSovereignMode: input.enforceSovereignMode ?? current.enforceSovereignMode,
        requireApprovalRiskLevel: input.requireApprovalRiskLevel ?? current.requireApprovalRiskLevel
      });
    } catch (err) {
      throw new FleetPolicyError('INVALID_POLICY', (err as Error).message);
    }

    // Compiled before it is stored. A pattern that does not compile would lock
    // the whole fleet out of every command the moment it was saved, and the
    // request that saved it is the last moment anyone can be told why.
    for (const source of config.bannedCommandPatterns) {
      try {
        new RegExp(source, 'i');
      } catch (err) {
        throw new FleetPolicyError(
          'INVALID_POLICY',
          `Banned command pattern ${JSON.stringify(source)} is not a valid regular expression: ${(err as Error).message}`
        );
      }
    }

    const now = Date.now();
    const id = current.source === 'DATABASE' ? current.id : ACTIVE_FLEET_POLICY_ID;
    const name = input.name ?? (current.source === 'DATABASE' ? current.name : 'Fleet policy');
    const description =
      input.description !== undefined
        ? input.description
        : current.source === 'DATABASE'
          ? current.description
          : null;
    const createdAt = current.source === 'DATABASE' ? current.createdAt : now;

    const db = this.dbAccessor();
    db.prepare(
      `INSERT INTO fleet_policies
         (id, name, description, is_active, allowed_models_json, banned_commands_json,
          enforce_sovereign_mode, require_approval_risk_level, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         is_active = 1,
         allowed_models_json = excluded.allowed_models_json,
         banned_commands_json = excluded.banned_commands_json,
         enforce_sovereign_mode = excluded.enforce_sovereign_mode,
         require_approval_risk_level = excluded.require_approval_risk_level,
         updated_at = excluded.updated_at`
    ).run(
      id,
      name,
      description,
      JSON.stringify(config.allowedModels),
      JSON.stringify(config.bannedCommandPatterns),
      config.enforceSovereignMode ? 1 : 0,
      config.requireApprovalRiskLevel.toUpperCase(),
      createdAt,
      now
    );

    this.invalidate();
    return this.getActivePolicy();
  }
}

/**
 * Validates and narrows an untrusted object into policy rules.
 *
 * Throws rather than repairing. A policy is a security statement, and a
 * malformed one repaired into something plausible is a rule nobody wrote being
 * enforced on a fleet.
 */
export function normalizePolicyConfig(input: Record<string, unknown>): FleetPolicyConfig {
  const allowedModels = normalizeStringArray(
    input.allowedModels,
    'allowedModels',
    DEFAULT_FLEET_POLICY_CONFIG.allowedModels
  );
  const bannedCommandPatterns = normalizeStringArray(
    input.bannedCommandPatterns,
    'bannedCommandPatterns',
    DEFAULT_FLEET_POLICY_CONFIG.bannedCommandPatterns
  );

  const rawSovereign = input.enforceSovereignMode;
  if (rawSovereign !== undefined && typeof rawSovereign !== 'boolean') {
    throw new Error('enforceSovereignMode must be a boolean.');
  }

  const rawRisk = input.requireApprovalRiskLevel;
  if (rawRisk !== undefined && typeof rawRisk !== 'string') {
    throw new Error('requireApprovalRiskLevel must be a string.');
  }
  if (typeof rawRisk === 'string') {
    const lowered = rawRisk.trim().toLowerCase();
    if (!(RISK_LEVELS as string[]).includes(lowered)) {
      throw new Error(
        `requireApprovalRiskLevel must be one of ${RISK_LEVELS.join(', ')} (got ${JSON.stringify(rawRisk)}).`
      );
    }
  }

  return {
    allowedModels,
    bannedCommandPatterns,
    enforceSovereignMode: rawSovereign ?? DEFAULT_FLEET_POLICY_CONFIG.enforceSovereignMode,
    requireApprovalRiskLevel: normalizeRiskLevel(
      rawRisk,
      DEFAULT_FLEET_POLICY_CONFIG.requireApprovalRiskLevel
    )
  };
}

function normalizeStringArray(value: unknown, field: string, fallback: string[]): string[] {
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array of strings.`);
  return value.map(entry => {
    if (typeof entry !== 'string') throw new Error(`${field} must contain only strings.`);
    return entry;
  });
}

/** `*` admits everything, a trailing `*` admits a family, anything else is exact (case-insensitive). */
function matchesAllowEntry(candidate: string, entry: string): boolean {
  const rule = entry.trim();
  if (rule === '*') return true;
  if (rule.endsWith('*')) {
    return candidate.toLowerCase().startsWith(rule.slice(0, -1).toLowerCase());
  }
  return candidate.toLowerCase() === rule.toLowerCase();
}

/** The process-wide engine. Constructing it reads nothing; the first question does. */
export const fleetPolicyService = new FleetPolicyService();
