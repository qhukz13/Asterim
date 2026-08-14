import crypto from 'crypto';
import { dbService } from './DatabaseService';
import { eventBus } from './EventBus';
import type {
  ProjectDecision,
  DecisionCodeRef,
  ProjectIntent,
  ArchitecturalRule,
  DecisionStatus,
  DecisionProvenance,
  ArchitecturalRuleSeverity,
  ProjectBriefing,
  AgentWorkSummary,
  AgentWorkStatus,
  ApprovalSummary,
  ApprovalOutcome,
  MemoryDecisionCreatedPayload,
  MemoryDecisionSupersededPayload,
  MemoryDecisionUpdatedPayload,
  MemoryIntentUpdatedPayload,
  MemoryRuleCreatedPayload,
  DecisionDriftInfo,
  CandidateDecision,
  CandidateStatus,
  CreateCandidateInput,
  CreateCodeRefRequest
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

/** Aliased row shape returned by the briefing's sessions query. */
interface AgentWorkRow {
  sessionId: string;
  threadId: string | null;
  agentType: string;
  status: string;
  startedAt: number;
  updatedAt: number;
}

/** Aliased row shape returned by the briefing's approvals query. */
interface ApprovalRow {
  actionId: string;
  description: string;
  command: string;
  status: string;
  createdAt: number;
}

/** Row shape returned from the candidate_decisions table. */
interface CandidateRow {
  id: string;
  project_id: string;
  session_id: string | null;
  thread_id: string | null;
  title: string;
  summary: string;
  rationale: string;
  constraints_json: string;
  related_files_json: string;
  code_refs_json: string;
  confidence: number;
  status: string;
  extracted_at: number;
  reviewed_at: number | null;
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

/** Runtime companions to the shared string unions, which erase at compile time. */
export const DECISION_STATUSES: readonly DecisionStatus[] = ['ACTIVE', 'STALE', 'SUPERSEDED', 'ARCHIVED'];
export const DECISION_PROVENANCES: readonly DecisionProvenance[] = [
  'HUMAN_CONFIRMED',
  'REPOSITORY_EVIDENCE',
  'AGENT_STATEMENT',
  'INFERRED'
];
export const RULE_SEVERITIES: readonly ArchitecturalRuleSeverity[] = ['error', 'warning', 'info'];

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
  /** Set once initEventBusListeners() has run, so repeat calls do not stack listeners. */
  private listenersInitialised = false;

  /** Nesting level of publishMemoryEvent, used to break re-entrant publish cycles. */
  private publishDepth = 0;

  /** Publishes nested deeper than this are dropped rather than allowed to recurse. */
  private static readonly MAX_PUBLISH_DEPTH = 4;

  // --- EventBus wiring ---

  /**
   * Registers this service's EventBus subscriptions. Idempotent — calling it
   * twice registers nothing the second time, which matters because EventBus is a
   * process-wide singleton and duplicate listeners would double every reaction.
   *
   * No subscription is registered yet: no existing system event requires a memory
   * write, and inventing one would be inventing product behaviour. This is the
   * single seam where P5.0-08+ should add them.
   *
   * Two rules for anything added here:
   *   1. Never subscribe to the literal '*' channel. EventBus re-emits every event
   *      there (ADR-008), including this service's own memory.* events, so a
   *      handler that writes would feed itself.
   *   2. A handler that writes memory must not react to a memory.* type. The
   *      publish-depth guard in publishMemoryEvent bounds such a cycle, but it
   *      bounds a bug rather than licensing one.
   *
   * Returns true when it registered, false when it was already initialised.
   */
  public initEventBusListeners(): boolean {
    if (this.listenersInitialised) return false;
    this.listenersInitialised = true;
    return true;
  }

  // --- Decisions ---

  /**
   * Records a decision and its code references.
   *
   * Runs in a transaction: a decision is never persisted with a partial set of
   * code refs. Throws if projectId does not reference an existing project
   * (enforced by the foreign key) or if an enum value is not recognised.
   */
  public createDecision(params: CreateDecisionInput): ProjectDecision {
    let id = '';
    this.transaction(() => {
      id = this.insertDecision(params);
    });

    const created = this.getDecision(id);
    if (!created) {
      throw new Error(`[ProjectMemoryService] Decision ${id} could not be read back after insert`);
    }

    this.publishMemoryEvent<MemoryDecisionCreatedPayload>('memory.decision_created', {
      projectId: created.projectId,
      decision: created
    });

    return created;
  }

  /**
   * Replaces a decision with a new one, linking the two.
   *
   * The whole exchange is one transaction, so the old decision is never left
   * SUPERSEDED without a replacement and the replacement is never orphaned.
   * Throws if the old decision does not exist or belongs to another project.
   */
  public supersedeDecision(oldDecisionId: string, newParams: CreateDecisionInput): ProjectDecision {
    const db = dbService.getDb();

    const oldDecision = this.getDecision(oldDecisionId);
    if (!oldDecision) {
      throw new Error(`[ProjectMemoryService] Decision ${oldDecisionId} not found`);
    }

    const projectId = requireText(newParams.projectId, 'projectId');
    if (oldDecision.projectId !== projectId) {
      throw new Error(
        `[ProjectMemoryService] Cannot supersede a decision across projects: ` +
          `${oldDecisionId} belongs to ${oldDecision.projectId}, not ${projectId}`
      );
    }

    let newId = '';
    this.transaction(() => {
      // The replacement always enters as ACTIVE, whatever the caller passed.
      newId = this.insertDecision({ ...newParams, status: 'ACTIVE' });
      const now = Date.now();

      db.prepare(
        "UPDATE project_decisions SET status = 'SUPERSEDED', superseded_by = ?, updated_at = ? WHERE id = ?"
      ).run(newId, now, oldDecisionId);

      // Bidirectional link: the replacement records what it replaced.
      // See docs/p5.0-05-report.md § 5 on the semantics of this column.
      db.prepare('UPDATE project_decisions SET superseded_by = ?, updated_at = ? WHERE id = ?').run(
        oldDecisionId,
        now,
        newId
      );
    });

    const created = this.getDecision(newId);
    if (!created) {
      throw new Error(`[ProjectMemoryService] Decision ${newId} could not be read back after insert`);
    }

    this.publishMemoryEvent<MemoryDecisionSupersededPayload>('memory.decision_superseded', {
      projectId: created.projectId,
      decisionId: oldDecisionId,
      supersededBy: created.id,
      decision: created
    });

    return created;
  }

  /** Retires a decision without a replacement. Throws if it does not exist. */
  public archiveDecision(id: string): ProjectDecision {
    return this.updateDecisionStatus(id, 'ARCHIVED');
  }

  /**
   * Moves a decision to another lifecycle state and stamps updated_at.
   * Throws if the decision does not exist or the status is not recognised.
   */
  public updateDecisionStatus(id: string, status: DecisionStatus): ProjectDecision {
    const db = dbService.getDb();

    const validated = validateEnum(status, DECISION_STATUSES, 'ACTIVE', 'status');
    const existing = this.getDecision(id);
    if (!existing) {
      throw new Error(`[ProjectMemoryService] Decision ${id} not found`);
    }

    db.prepare('UPDATE project_decisions SET status = ?, updated_at = ? WHERE id = ?').run(
      validated,
      Date.now(),
      id
    );

    const updated = this.getDecision(id);
    if (!updated) {
      throw new Error(`[ProjectMemoryService] Decision ${id} could not be read back after update`);
    }

    // Published after the write commits, like every other memory event. Carries the
    // previous status so a subscriber can tell what moved without holding the old
    // copy — the difference between "archived" and "un-staled" is not recoverable
    // from the new state alone.
    this.publishMemoryEvent<MemoryDecisionUpdatedPayload>('memory.decision_updated', {
      projectId: updated.projectId,
      decision: updated,
      previousStatus: existing.status
    });

    return updated;
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
            'SELECT * FROM project_decisions WHERE project_id = ? AND status = ? ORDER BY created_at DESC, id DESC'
          )
          .all(projectId, filter.status) as unknown as ProjectDecisionRow[])
      : (db
          .prepare(
            'SELECT * FROM project_decisions WHERE project_id = ? ORDER BY created_at DESC, id DESC'
          )
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
          ORDER BY d.created_at DESC, d.id DESC`
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

    // Captured before the transaction so the event can name what was replaced.
    const previousIntentId = this.getActiveIntent(projectId)?.id;

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

    const intentPayload: MemoryIntentUpdatedPayload = {
      projectId: created.projectId,
      intent: created
    };
    if (previousIntentId) {
      intentPayload.previousIntentId = previousIntentId;
    }
    this.publishMemoryEvent<MemoryIntentUpdatedPayload>('memory.intent_updated', intentPayload);

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
        "SELECT * FROM project_intents WHERE project_id = ? AND status = 'ACTIVE' ORDER BY created_at DESC, id DESC LIMIT 1"
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

    this.publishMemoryEvent<MemoryRuleCreatedPayload>('memory.rule_created', {
      projectId: created.projectId,
      rule: created
    });

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
      .prepare('SELECT * FROM architectural_rules WHERE project_id = ? ORDER BY created_at DESC, id DESC')
      .all(projectId) as unknown as ArchitecturalRuleRow[];

    return rows.map(mapRule);
  }

  /**
   * Computes drift for a project's ACTIVE decisions.
   *
   * Async and delegating, unlike everything else here: drift is not persisted and
   * cannot be — it is a comparison against the working tree at the moment it is
   * asked for. The git work itself stays in `GitDriftDetector`; this method only
   * resolves the project's path and hands over the decisions. Per DEC-027 nothing
   * is written as a result.
   */
  public async getProjectDrift(projectId: string): Promise<Record<string, DecisionDriftInfo>> {
    const db = dbService.getDb();
    const project = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as
      | { path: string }
      | undefined;

    if (!project?.path) return {};

    const { gitDriftDetector } = await import('./git/GitDriftDetector');
    return gitDriftDetector.detectAll(project.path, this.listDecisions(projectId, { status: 'ACTIVE' }));
  }

  // --- Candidate decisions (DEC-027) ---

  /** Row shape returned from candidate_decisions. */
  private mapCandidate(row: CandidateRow): CandidateDecision {
    return {
      id: row.id,
      projectId: row.project_id,
      sessionId: row.session_id ?? undefined,
      threadId: row.thread_id ?? undefined,
      title: row.title,
      summary: row.summary,
      rationale: row.rationale,
      constraints: parseJsonArray<string>(row.constraints_json),
      relatedFiles: parseJsonArray<string>(row.related_files_json),
      codeRefs: parseJsonArray<CreateCodeRefRequest>(row.code_refs_json),
      confidence: row.confidence,
      status: row.status as CandidateStatus,
      extractedAt: row.extracted_at,
      reviewedAt: row.reviewed_at ?? undefined
    };
  }

  /** Stages a candidate for human review. Never touches project_decisions. */
  public createCandidate(input: CreateCandidateInput): CandidateDecision {
    const db = dbService.getDb();

    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO candidate_decisions
         (id, project_id, session_id, thread_id, title, summary, rationale,
          constraints_json, related_files_json, code_refs_json, confidence, status, extracted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`
    ).run(
      id,
      requireText(input.projectId, 'projectId'),
      input.sessionId ?? null,
      input.threadId ?? null,
      requireText(input.title, 'title'),
      requireText(input.summary, 'summary'),
      requireText(input.rationale, 'rationale'),
      JSON.stringify(normalizeStringArray(input.constraints)),
      JSON.stringify(normalizeStringArray(input.relatedFiles)),
      JSON.stringify(input.codeRefs ?? []),
      clampConfidence(input.confidence),
      Date.now()
    );

    const created = this.getCandidate(id);
    if (!created) {
      throw new Error(`[ProjectMemoryService] Candidate ${id} could not be read back after insert`);
    }
    return created;
  }

  public getCandidate(id: string): CandidateDecision | null {
    const db = dbService.getDb();
    const row = db.prepare('SELECT * FROM candidate_decisions WHERE id = ?').get(id) as
      | CandidateRow
      | undefined;
    return row ? this.mapCandidate(row) : null;
  }

  /** A project's candidates, newest first, optionally filtered by status. */
  public listCandidates(projectId: string, status?: CandidateStatus): CandidateDecision[] {
    const db = dbService.getDb();
    const rows = status
      ? (db
          .prepare(
            'SELECT * FROM candidate_decisions WHERE project_id = ? AND status = ? ORDER BY extracted_at DESC, id DESC'
          )
          .all(projectId, status) as unknown as CandidateRow[])
      : (db
          .prepare(
            'SELECT * FROM candidate_decisions WHERE project_id = ? ORDER BY extracted_at DESC, id DESC'
          )
          .all(projectId) as unknown as CandidateRow[]);
    return rows.map(row => this.mapCandidate(row));
  }

  /**
   * Promotes a candidate into project memory.
   *
   * This is the only path from `candidate_decisions` to `project_decisions`, and
   * it exists solely to be called by a human's approval (DEC-027). The result is
   * recorded HUMAN_CONFIRMED at confidence 1.0 regardless of what the extractor
   * guessed: a person read it and said yes, and that is a stronger claim than any
   * heuristic score it arrived with.
   *
   * Throws if the candidate belongs to another project or is not PENDING.
   */
  public approveCandidate(
    projectId: string,
    candidateId: string,
    overrides?: Partial<CreateDecisionInput>
  ): ProjectDecision {
    const candidate = this.getCandidate(candidateId);
    if (!candidate) {
      throw new Error(`[ProjectMemoryService] Candidate ${candidateId} not found`);
    }
    if (candidate.projectId !== projectId) {
      throw new Error(
        `[ProjectMemoryService] Candidate ${candidateId} does not belong to project ${projectId}`
      );
    }
    if (candidate.status !== 'PENDING') {
      throw new Error(
        `[ProjectMemoryService] Candidate ${candidateId} has already been reviewed (${candidate.status})`
      );
    }

    const decision = this.createDecision({
      projectId,
      title: overrides?.title ?? candidate.title,
      summary: overrides?.summary ?? candidate.summary,
      rationale: overrides?.rationale ?? candidate.rationale,
      constraints: overrides?.constraints ?? candidate.constraints,
      relatedFiles: overrides?.relatedFiles ?? candidate.relatedFiles,
      codeRefs: overrides?.codeRefs ?? candidate.codeRefs,
      status: 'ACTIVE',
      provenance: 'HUMAN_CONFIRMED',
      confidence: 1.0
    });

    dbService
      .getDb()
      .prepare("UPDATE candidate_decisions SET status = 'APPROVED', reviewed_at = ? WHERE id = ?")
      .run(Date.now(), candidateId);

    return decision;
  }

  /** Marks a candidate rejected. Writes nothing to project_decisions. */
  public rejectCandidate(projectId: string, candidateId: string): CandidateDecision {
    const candidate = this.getCandidate(candidateId);
    if (!candidate) {
      throw new Error(`[ProjectMemoryService] Candidate ${candidateId} not found`);
    }
    if (candidate.projectId !== projectId) {
      throw new Error(
        `[ProjectMemoryService] Candidate ${candidateId} does not belong to project ${projectId}`
      );
    }

    dbService
      .getDb()
      .prepare("UPDATE candidate_decisions SET status = 'REJECTED', reviewed_at = ? WHERE id = ?")
      .run(Date.now(), candidateId);

    const updated = this.getCandidate(candidateId);
    if (!updated) {
      throw new Error(`[ProjectMemoryService] Candidate ${candidateId} could not be read back`);
    }
    return updated;
  }

  // --- Briefing ---

  /**
   * Assembles the memory snapshot handed to an agent starting work on a project.
   *
   * Fully deterministic: no model calls, no sampling, no clock-dependent content.
   * Every query carries an explicit total order (`id` breaks timestamp ties), so
   * two calls against an unchanged database return byte-identical JSON.
   *
   * Recent agent work and approvals are read from the existing `sessions` and
   * `approvals` tables — there is no separate agent-work log (see
   * docs/p5.0-01-verification-report.md § 2).
   */
  public getProjectBriefing(
    projectId: string,
    drift?: Record<string, DecisionDriftInfo>
  ): ProjectBriefing {
    const db = dbService.getDb();

    // Drift is passed in rather than computed here: this method is synchronous and
    // deterministic, and both properties are relied on (the MCP briefing tool, the
    // byte-identical assertion in its tests). The caller does the async git work.
    const activeDecisions = this.listDecisions(projectId, { status: 'ACTIVE' }).map(decision => {
      const decisionDrift = drift?.[decision.id];
      return decisionDrift?.drifted ? { ...decision, drift: decisionDrift } : decision;
    });
    const architecturalRules = this.listRules(projectId);
    const currentIntent = this.getActiveIntent(projectId);

    const sessionRows = db
      .prepare(
        `SELECT id AS sessionId, thread_id AS threadId, agent_type AS agentType, status,
                started_at AS startedAt, updated_at AS updatedAt
           FROM sessions
          WHERE project_id = ?
          ORDER BY started_at DESC, id DESC
          LIMIT 5`
      )
      .all(projectId) as unknown as AgentWorkRow[];

    const approvalRows = db
      .prepare(
        `SELECT action_id AS actionId, description, command, status, created_at AS createdAt
           FROM approvals
          WHERE project_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT 5`
      )
      .all(projectId) as unknown as ApprovalRow[];

    return {
      projectId,
      activeDecisions,
      architecturalRules,
      currentIntent,
      recentAgentWork: sessionRows.map(mapAgentWork),
      recentApprovals: approvalRows.map(mapApproval)
    };
  }

  // --- Private helpers ---

  /**
   * Publishes a memory event after the write that produced it has committed.
   *
   * EventBus dispatch is synchronous (Node EventEmitter), which has two
   * consequences this method absorbs:
   *
   *   - A subscriber that throws would otherwise propagate out of createDecision
   *     and friends, making a committed write look like a failure to the caller.
   *     Subscriber errors are logged and swallowed instead.
   *   - A subscriber that writes memory would re-enter this method on the same
   *     stack. The depth guard drops the publish past MAX_PUBLISH_DEPTH, so a
   *     cycle terminates with a logged error rather than a stack overflow.
   *
   * Adapter and subscriber failures must never take down the Core.
   */
  private publishMemoryEvent<T extends object>(type: string, payload: T): void {
    if (this.publishDepth >= ProjectMemoryService.MAX_PUBLISH_DEPTH) {
      console.error(
        `[ProjectMemoryService] Dropping '${type}': publish depth ${this.publishDepth} ` +
          `reached the limit. A subscriber is writing memory in reaction to a memory event.`
      );
      return;
    }

    this.publishDepth++;
    try {
      eventBus.publish<T>({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: 'system:memory',
        type,
        payload
      });
    } catch (err) {
      console.error(`[ProjectMemoryService] Subscriber threw while handling '${type}':`, err);
    } finally {
      this.publishDepth--;
    }
  }

  /**
   * Validates input and writes a decision plus its code refs. Returns the new id.
   *
   * Caller-supplied transaction: this method issues no BEGIN of its own, so it can
   * be composed into a larger unit of work (createDecision, supersedeDecision).
   */
  private insertDecision(params: CreateDecisionInput): string {
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
    const codeRefInputs = this.mergeCodeRefInputs(params.codeRefs, params.relatedFiles);

    const id = crypto.randomUUID();
    const now = Date.now();

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

    return id;
  }

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

/**
 * Projects a sessions row into a briefing entry.
 * thread_id is nullable — the column was added by ALTER TABLE and is NULL on
 * rows written before it existed — and the domain type uses an optional instead.
 */
function mapAgentWork(row: AgentWorkRow): AgentWorkSummary {
  const summary: AgentWorkSummary = {
    sessionId: row.sessionId,
    agentType: row.agentType,
    status: row.status as AgentWorkStatus,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt
  };
  if (row.threadId !== null && row.threadId !== undefined) {
    summary.threadId = row.threadId;
  }
  return summary;
}

/** Projects an approvals row into a briefing entry. */
function mapApproval(row: ApprovalRow): ApprovalSummary {
  return {
    actionId: row.actionId,
    description: row.description,
    command: row.command,
    status: row.status as ApprovalOutcome,
    createdAt: row.createdAt
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
/**
 * Parses a JSON array column, returning [] for anything unusable.
 *
 * A malformed column should read as "no entries" rather than take down the query
 * that touched it — the alternative is one bad row making a project unreadable.
 */
function parseJsonArray<T>(json: string): T[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

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
