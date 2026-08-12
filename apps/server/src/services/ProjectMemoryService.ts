import crypto from 'crypto';
import { dbService } from './DatabaseService';
import type {
  ProjectDecision,
  DecisionCodeRef,
  ProjectIntent,
  ArchitecturalRule,
  DecisionStatus,
  DecisionProvenance,
  ArchitecturalRuleSeverity
} from '@asterim/shared';

/** Row shape returned from the project_decisions table. */
interface ProjectDecisionRow {
  id: string;
  project_id: string;
  title: string;
  summary: string;
  rationale: string;
  constraints_json: string;
  status: string;
  superseded_by: string | null;
  provenance: string;
  confidence: number;
  created_at: number;
  updated_at: number;
}

/** Row shape returned from the decision_code_refs table. */
interface DecisionCodeRefRow {
  id: string;
  decision_id: string;
  file_path: string | null;
  symbol_name: string | null;
  commit_hash: string | null;
  created_at: number;
}

/** Row shape returned from the project_intents table. */
interface ProjectIntentRow {
  id: string;
  project_id: string;
  goal: string;
  constraints_json: string;
  non_goals_json: string;
  status: string;
  created_at: number;
  updated_at: number;
}

/** Row shape returned from the architectural_rules table. */
interface ArchitecturalRuleRow {
  id: string;
  project_id: string;
  title: string;
  statement: string;
  severity: string;
  scope_pattern: string;
  created_at: number;
}

/** A code anchor supplied when recording a decision. */
export interface CreateCodeRefInput {
  filePath?: string;
  symbolName?: string;
  commitHash?: string;
}

/** Input for recording a new project decision. */
export interface CreateDecisionInput {
  projectId: string;
  title: string;
  summary: string;
  rationale: string;
  constraints?: string[];
  status?: DecisionStatus;
  provenance?: DecisionProvenance;
  /** Clamped to 0–1. Defaults to 1.0. */
  confidence?: number;
  /**
   * Files the decision governs. Persisted as file-only rows in decision_code_refs —
   * the table has no related_files column. See docs/p5.0-04-report.md § 5.
   */
  relatedFiles?: string[];
  codeRefs?: CreateCodeRefInput[];
}

/** Input for setting a project's current intent. */
export interface CreateIntentInput {
  projectId: string;
  goal: string;
  constraints?: string[];
  nonGoals?: string[];
}

/** Input for adding an architectural rule. */
export interface CreateRuleInput {
  projectId: string;
  title: string;
  statement: string;
  severity?: ArchitecturalRuleSeverity;
  scopePattern?: string;
}

const DECISION_STATUSES: readonly DecisionStatus[] = ['ACTIVE', 'STALE', 'SUPERSEDED', 'ARCHIVED'];
const DECISION_PROVENANCES: readonly DecisionProvenance[] = [
  'HUMAN_CONFIRMED',
  'REPOSITORY_EVIDENCE',
  'AGENT_STATEMENT',
  'INFERRED'
];
const RULE_SEVERITIES: readonly ArchitecturalRuleSeverity[] = ['error', 'warning', 'info'];

/**
 * Persistence layer for the Project Memory Core: decisions, their code anchors,
 * project intent, and architectural rules.
 *
 * Every query is a prepared statement scoped by project_id — no method returns
 * rows belonging to a project other than the one asked for.
 *
 * The schema declares no CHECK constraints on the enum-like columns
 * (see docs/p5.0-03-report.md § 5), so this service validates them before writing.
 */
export class ProjectMemoryService {
  // --- Decisions ---

  /**
   * Records a decision and its code references.
   *
   * Runs in a transaction: a decision is never persisted with a partial set of
   * code refs. Throws if projectId does not reference an existing project
   * (enforced by the foreign key) or if an enum value is not recognised.
   */
  public createDecision(params: CreateDecisionInput): ProjectDecision {
    const db = dbService.getDb();

    const projectId = requireText(params.projectId, 'projectId');
    const title = requireText(params.title, 'title');
    const summary = requireText(params.summary, 'summary');
    const rationale = requireText(params.rationale, 'rationale');
    const status = validateEnum(params.status, DECISION_STATUSES, 'ACTIVE', 'status');
    const provenance = validateEnum(
      params.provenance,
      DECISION_PROVENANCES,
      'HUMAN_CONFIRMED',
      'provenance'
    );
    const confidence = clampConfidence(params.confidence);
    const constraints = normalizeStringArray(params.constraints);

    const id = crypto.randomUUID();
    const now = Date.now();

    const codeRefInputs = this.mergeCodeRefInputs(params.codeRefs, params.relatedFiles);

    this.transaction(() => {
      db.prepare(
        `INSERT INTO project_decisions
           (id, project_id, title, summary, rationale, constraints_json, status,
            superseded_by, provenance, confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`
      ).run(
        id,
        projectId,
        title,
        summary,
        rationale,
        JSON.stringify(constraints),
        status,
        provenance,
        confidence,
        now,
        now
      );

      if (codeRefInputs.length > 0) {
        const insertRef = db.prepare(
          `INSERT INTO decision_code_refs (id, decision_id, file_path, symbol_name, commit_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        );
        for (const ref of codeRefInputs) {
          insertRef.run(
            crypto.randomUUID(),
            id,
            ref.filePath ?? null,
            ref.symbolName ?? null,
            ref.commitHash ?? null,
            now
          );
        }
      }
    });

    const created = this.getDecision(id);
    if (!created) {
      throw new Error(`[ProjectMemoryService] Decision ${id} could not be read back after insert`);
    }
    return created;
  }

  /** Returns a decision with its code references attached, or null if it does not exist. */
  public getDecision(id: string): ProjectDecision | null {
    const db = dbService.getDb();
    const row = db.prepare('SELECT * FROM project_decisions WHERE id = ?').get(id) as
      | ProjectDecisionRow
      | undefined;

    if (!row) return null;
    return this.mapDecision(row, this.getCodeRefs(row.id));
  }

  /** Returns a project's decisions, newest first, optionally filtered by status. */
  public listDecisions(projectId: string, filter?: { status?: DecisionStatus }): ProjectDecision[] {
    const db = dbService.getDb();

    const rows = filter?.status
      ? (db
          .prepare(
            'SELECT * FROM project_decisions WHERE project_id = ? AND status = ? ORDER BY created_at DESC'
          )
          .all(projectId, filter.status) as unknown as ProjectDecisionRow[])
      : (db
          .prepare('SELECT * FROM project_decisions WHERE project_id = ? ORDER BY created_at DESC')
          .all(projectId) as unknown as ProjectDecisionRow[]);

    return this.attachCodeRefs(rows);
  }

  /**
   * Returns the ACTIVE decisions in a project that are anchored to a given file.
   * This is the lookup an agent performs before touching a file.
   */
  public findRelevantDecisions(projectId: string, filePath: string): ProjectDecision[] {
    const db = dbService.getDb();
    const rows = db
      .prepare(
        `SELECT DISTINCT d.*
           FROM project_decisions d
           JOIN decision_code_refs r ON r.decision_id = d.id
          WHERE d.project_id = ?
            AND r.file_path = ?
            AND d.status = 'ACTIVE'
          ORDER BY d.created_at DESC`
      )
      .all(projectId, filePath) as unknown as ProjectDecisionRow[];

    return this.attachCodeRefs(rows);
  }

  /** Returns the code references anchored to a decision, oldest first. */
  public getCodeRefs(decisionId: string): DecisionCodeRef[] {
    const db = dbService.getDb();
    const rows = db
      .prepare('SELECT * FROM decision_code_refs WHERE decision_id = ? ORDER BY created_at ASC, id ASC')
      .all(decisionId) as unknown as DecisionCodeRefRow[];

    return rows.map(mapCodeRef);
  }

  // --- Intent ---

  /**
   * Sets a project's current intent, archiving whichever intent was active.
   *
   * The archive and the insert share one transaction, so a project can never be
   * left with two ACTIVE intents or none at all.
   */
  public createIntent(params: CreateIntentInput): ProjectIntent {
    const db = dbService.getDb();

    const projectId = requireText(params.projectId, 'projectId');
    const goal = requireText(params.goal, 'goal');
    const constraints = normalizeStringArray(params.constraints);
    const nonGoals = normalizeStringArray(params.nonGoals);

    const id = crypto.randomUUID();
    const now = Date.now();

    this.transaction(() => {
      db.prepare(
        "UPDATE project_intents SET status = 'ARCHIVED', updated_at = ? WHERE project_id = ? AND status = 'ACTIVE'"
      ).run(now, projectId);

      db.prepare(
        `INSERT INTO project_intents
           (id, project_id, goal, constraints_json, non_goals_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
      ).run(id, projectId, goal, JSON.stringify(constraints), JSON.stringify(nonGoals), now, now);
    });

    const created = this.getIntent(id);
    if (!created) {
      throw new Error(`[ProjectMemoryService] Intent ${id} could not be read back after insert`);
    }
    return created;
  }

  /** Returns an intent by id, or null if it does not exist. */
  public getIntent(id: string): ProjectIntent | null {
    const db = dbService.getDb();
    const row = db.prepare('SELECT * FROM project_intents WHERE id = ?').get(id) as
      | ProjectIntentRow
      | undefined;

    return row ? mapIntent(row) : null;
  }

  /** Returns a project's active intent, or null if none has been set. */
  public getActiveIntent(projectId: string): ProjectIntent | null {
    const db = dbService.getDb();
    const row = db
      .prepare(
        "SELECT * FROM project_intents WHERE project_id = ? AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1"
      )
      .get(projectId) as ProjectIntentRow | undefined;

    return row ? mapIntent(row) : null;
  }

  // --- Architectural rules ---

  /** Adds a standing rule agents must observe when working in the project. */
  public createRule(params: CreateRuleInput): ArchitecturalRule {
    const db = dbService.getDb();

    const projectId = requireText(params.projectId, 'projectId');
    const title = requireText(params.title, 'title');
    const statement = requireText(params.statement, 'statement');
    const severity = validateEnum(params.severity, RULE_SEVERITIES, 'warning', 'severity');
    // Matches the schema default; see docs/p5.0-04-report.md § 5 on '*' vs '**'.
    const scopePattern = params.scopePattern?.trim() || '*';

    const id = crypto.randomUUID();
    const now = Date.now();

    db.prepare(
      `INSERT INTO architectural_rules (id, project_id, title, statement, severity, scope_pattern, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, projectId, title, statement, severity, scopePattern, now);

    const created = this.getRule(id);
    if (!created) {
      throw new Error(`[ProjectMemoryService] Rule ${id} could not be read back after insert`);
    }
    return created;
  }

  /** Returns a rule by id, or null if it does not exist. */
  public getRule(id: string): ArchitecturalRule | null {
    const db = dbService.getDb();
    const row = db.prepare('SELECT * FROM architectural_rules WHERE id = ?').get(id) as
      | ArchitecturalRuleRow
      | undefined;

    return row ? mapRule(row) : null;
  }

  /** Returns a project's architectural rules, newest first. */
  public listRules(projectId: string): ArchitecturalRule[] {
    const db = dbService.getDb();
    const rows = db
      .prepare('SELECT * FROM architectural_rules WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as unknown as ArchitecturalRuleRow[];

    return rows.map(mapRule);
  }

  // --- Private helpers ---

  /**
   * Runs fn inside a transaction, rolling back on any error.
   * Nested calls are not supported — SQLite has no nested BEGIN.
   */
  private transaction(fn: () => void): void {
    const db = dbService.getDb();
    db.exec('BEGIN');
    try {
      fn();
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* the transaction was already unwound */
      }
      throw err;
    }
  }

  /**
   * Folds relatedFiles into the code-ref list. A related file that an explicit
   * code ref already anchors is dropped, so the same path is not stored twice.
   */
  private mergeCodeRefInputs(
    codeRefs: CreateCodeRefInput[] | undefined,
    relatedFiles: string[] | undefined
  ): CreateCodeRefInput[] {
    const merged: CreateCodeRefInput[] = [];
    const seenPaths = new Set<string>();

    for (const ref of codeRefs ?? []) {
      if (!ref.filePath && !ref.symbolName && !ref.commitHash) continue;
      const filePath = ref.filePath?.trim() || undefined;
      merged.push({
        filePath,
        symbolName: ref.symbolName?.trim() || undefined,
        commitHash: ref.commitHash?.trim() || undefined
      });
      if (filePath) seenPaths.add(filePath);
    }

    for (const file of normalizeStringArray(relatedFiles)) {
      if (seenPaths.has(file)) continue;
      seenPaths.add(file);
      merged.push({ filePath: file });
    }

    return merged;
  }

  /** Attaches code refs to a batch of decision rows in a single query. */
  private attachCodeRefs(rows: ProjectDecisionRow[]): ProjectDecision[] {
    if (rows.length === 0) return [];

    const db = dbService.getDb();
    const placeholders = rows.map(() => '?').join(', ');
    const refRows = db
      .prepare(
        `SELECT * FROM decision_code_refs WHERE decision_id IN (${placeholders}) ORDER BY created_at ASC, id ASC`
      )
      .all(...rows.map(r => r.id)) as unknown as DecisionCodeRefRow[];

    const byDecision = new Map<string, DecisionCodeRef[]>();
    for (const refRow of refRows) {
      const list = byDecision.get(refRow.decision_id) ?? [];
      list.push(mapCodeRef(refRow));
      byDecision.set(refRow.decision_id, list);
    }

    return rows.map(row => this.mapDecision(row, byDecision.get(row.id) ?? []));
  }

  private mapDecision(row: ProjectDecisionRow, codeRefs: DecisionCodeRef[]): ProjectDecision {
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      summary: row.summary,
      rationale: row.rationale,
      constraints: parseStringArray(row.constraints_json),
      status: row.status as DecisionStatus,
      supersededBy: row.superseded_by,
      provenance: row.provenance as DecisionProvenance,
      confidence: row.confidence,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      // Derived: the table has no related_files column, so the governed files are
      // the distinct paths of the decision's code refs.
      relatedFiles: distinct(codeRefs.map(ref => ref.filePath).filter(isDefined)),
      codeRefs
    };
  }
}

// --- Module-level helpers ---

function mapCodeRef(row: DecisionCodeRefRow): DecisionCodeRef {
  return {
    id: row.id,
    decisionId: row.decision_id,
    filePath: row.file_path ?? undefined,
    symbolName: row.symbol_name ?? undefined,
    commitHash: row.commit_hash ?? undefined,
    createdAt: row.created_at
  };
}

function mapIntent(row: ProjectIntentRow): ProjectIntent {
  return {
    id: row.id,
    projectId: row.project_id,
    goal: row.goal,
    constraints: parseStringArray(row.constraints_json),
    nonGoals: parseStringArray(row.non_goals_json),
    status: row.status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRule(row: ArchitecturalRuleRow): ArchitecturalRule {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    statement: row.statement,
    severity: row.severity as ArchitecturalRuleSeverity,
    scopePattern: row.scope_pattern,
    createdAt: row.created_at
  };
}

/** Parses a JSON string array column, tolerating corrupt or unexpected content. */
function parseStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

function normalizeStringArray(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return distinct(values.filter(v => typeof v === 'string').map(v => v.trim()).filter(v => v.length > 0));
}

function distinct(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

/** Clamps confidence into 0–1, falling back to 1.0 for missing or non-finite input. */
function clampConfidence(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1.0;
  return Math.min(1, Math.max(0, value));
}

function requireText(value: string | undefined, field: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    throw new Error(`[ProjectMemoryService] ${field} is required`);
  }
  return trimmed;
}

/**
 * Returns value when it is a member of allowed, the fallback when it is absent.
 * Throws otherwise — the columns have no CHECK constraint, so an unrecognised
 * literal would otherwise be written and silently mis-partition the indexes.
 */
function validateEnum<T extends string>(
  value: T | undefined,
  allowed: readonly T[],
  fallback: T,
  field: string
): T {
  if (value === undefined || value === null) return fallback;
  if (!allowed.includes(value)) {
    throw new Error(
      `[ProjectMemoryService] Invalid ${field} '${value}'. Expected one of: ${allowed.join(', ')}`
    );
  }
  return value;
}

export const projectMemoryService = new ProjectMemoryService();
