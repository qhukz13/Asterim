/**
 * Shared Team Agents (P8-01, DEC-031).
 *
 * A team agent is a role that outlives the person who created it. Several
 * members of a team talk to the same one, into the same transcript, and the
 * agent keeps the context of everything the team has asked it — which is the
 * difference between a shared specialist and everybody separately re-explaining
 * the codebase to their own session.
 *
 * This service owns three things and delegates the fourth:
 *
 *   - **The records.** `team_agents`, `team_threads` and `team_agent_messages`
 *     are ordinary rows, created and read here, and every one of them stays on
 *     the host workstation (DEC-028, DEC-032 § 1).
 *   - **The durable queue.** Every transition of a turn is mirrored into
 *     `team_turn_queue`, so "who asked for this, when, and what happened" is
 *     answerable after a restart rather than only while the process that served
 *     it is still up.
 *   - **The transcript.** A member's instruction is written the moment it is
 *     submitted, not when it is served, so a shared thread shows the queue as
 *     it actually is; the agent's answer is appended when the turn ends.
 *
 * The fourth — deciding *when* a turn may run — belongs to `AgentTurnLock`, and
 * the separation is the point. The lock knows nothing about SQLite or agents;
 * this service never runs a turn it was not granted. `runTurn` below is the
 * only place the two meet, and it is written so that every path out of a turn,
 * including a crash in the executor, reaches `releaseTurn`.
 *
 * Execution goes through the same `client.command` / `client.chat_message`
 * events the dashboard publishes, so a team turn inherits every guarantee the
 * ordinary session path already has — the workspace check, the sanitized
 * subprocess environment, the approval interception. Nothing here spawns a
 * process. The indirection through `TeamTurnExecutor` is what lets the queueing
 * guarantees be tested against an executor that answers in milliseconds instead
 * of against an agent CLI that may not be installed.
 */

import crypto from 'crypto';
import {
  ArchitecturalRule,
  CreateTeamAgentInput,
  DEFAULT_TEAM_APPROVAL_POLICY,
  ProjectDecision,
  ProjectIntent,
  TeamAgent,
  TeamAgentMessage,
  TeamAgentMessageRole,
  TeamApprovalDecision,
  TeamApprovalPolicy,
  TeamApprovalRiskLevel,
  TeamPendingApprovalInfo,
  TeamThread,
  TeamThreadTurnState,
  TeamTurnApprovalEventPayload,
  TeamTurnApprovalRecord,
  TeamTurnApprovalResult,
  TeamTurnQueueItem,
  TeamTurnQueueState,
  TeamTurnRequest,
  TeamTurnResult,
  TeamTurnStatus,
  TEAM_TURN_APPROVAL_EVENT,
  UpdateTeamAgentInput,
  WorkspaceRole,
  isTeamApprovalPolicy
} from '@asterim/shared';
import { approvalManager } from '../ApprovalManager';
import { dbService } from '../DatabaseService';
import { EventBus, eventBus } from '../EventBus';
import { projectMemoryService } from '../ProjectMemoryService';
import { rbacService } from '../RbacService';
import {
  AgentTurnLock,
  TurnBroadcaster,
  TurnLockThreadContext,
  agentTurnLock,
  eventBusTurnBroadcaster
} from './AgentTurnLock';

/** How a team agent failure reads to a caller that has to answer over HTTP. */
export type TeamAgentErrorCode =
  | 'INVALID_INPUT'
  | 'AGENT_NOT_FOUND'
  | 'THREAD_NOT_FOUND'
  | 'TURN_NOT_FOUND'
  | 'TURN_NOT_CANCELLABLE'
  | 'NO_PROJECT_BOUND'
  // The caller is authenticated and the request is well-formed; they simply do
  // not have the standing the thread's approval policy requires (DEC-031 § 3).
  | 'FORBIDDEN'
  // An approval was answered for a turn that is not waiting on one.
  | 'TURN_NOT_AWAITING_APPROVAL';

/**
 * The signal a rejected approval sends into a turn that is still running.
 *
 * Not a `TeamAgentError`: nothing answers this over HTTP. It exists so that
 * `runTurn` can tell "the team refused this action" — which settles the turn as
 * CANCELLED — from "the agent broke", which settles it as FAILED. Reporting a
 * refusal as a failure would put a defect in the transcript where a decision
 * belongs.
 */
export class TeamTurnRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeamTurnRejectedError';
  }
}

export class TeamAgentError extends Error {
  constructor(
    public readonly code: TeamAgentErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'TeamAgentError';
  }
}

/** Longest values accepted, so one bad request cannot fill the database. */
export const MAX_TEAM_NAME_CHARS = 120;
export const MAX_TEAM_ROLE_CHARS = 120;
export const MAX_TEAM_DESCRIPTION_CHARS = 2000;
export const MAX_TEAM_SYSTEM_PROMPT_CHARS = 40000;
export const MAX_TEAM_INSTRUCTION_CHARS = 20000;
export const MAX_TEAM_CONTEXT_CHARS = 60000;
/** How much of an agent's answer is kept on one transcript line. */
export const MAX_TEAM_OUTPUT_CHARS = 40000;
/** Most entries any one capability list may hold. */
export const MAX_TEAM_LIST_ENTRIES = 200;
/** How long a single turn may hold the lock before it is failed and released. */
export const DEFAULT_TURN_TIMEOUT_MS = 10 * 60 * 1000;

// --- Row shapes ---

interface TeamAgentRow {
  id: string;
  team_id: string;
  name: string;
  role: string;
  description: string;
  system_prompt: string;
  model: string | null;
  temperature: number | null;
  enabled_mcp_servers: string | null;
  enabled_skills: string | null;
  approval_policy: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

interface TeamThreadRow {
  id: string;
  team_agent_id: string;
  project_id: string | null;
  title: string;
  status: string;
  active_turn_user_id: string | null;
  approval_policy: string | null;
  created_at: number;
  updated_at: number;
}

interface TeamTurnRow {
  id: string;
  team_thread_id: string;
  user_id: string;
  user_name: string;
  instruction: string;
  context_json: string | null;
  status: string;
  queued_at: number;
  started_at: number | null;
  completed_at: number | null;
  error_message: string | null;
  approval_decision: string | null;
  approval_policy: string | null;
  approval_resolved_by: string | null;
  approval_resolved_by_name: string | null;
  approval_comment: string | null;
  approval_resolved_at: number | null;
}

interface TeamMessageRow {
  id: string;
  team_thread_id: string;
  user_id: string | null;
  user_name: string | null;
  role: string;
  content: string;
  tool_calls_json: string | null;
  created_at: number;
}

// --- Validation and serialization ---

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TeamAgentError(
      'INVALID_INPUT',
      `${field} is required and must be a non-empty string.`
    );
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new TeamAgentError('INVALID_INPUT', `${field} must be at most ${max} characters.`);
  }
  return trimmed;
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new TeamAgentError('INVALID_INPUT', `${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new TeamAgentError('INVALID_INPUT', `${field} must be at most ${max} characters.`);
  }
  return trimmed || undefined;
}

/** Bounded at 0–2, the range every provider Asterim can drive accepts. */
function optionalTemperature(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TeamAgentError('INVALID_INPUT', 'temperature must be a number.');
  }
  if (value < 0 || value > 2) {
    throw new TeamAgentError('INVALID_INPUT', 'temperature must be between 0 and 2.');
  }
  return value;
}

/**
 * An optional capability list.
 *
 * Present-but-empty is preserved rather than dropped, exactly as in
 * `ProfileService`: unset means "whatever the workstation allows" and `[]`
 * means "deliberately nothing", and collapsing the second into the first would
 * hand an agent everything its author meant to withhold.
 */
function optionalList(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new TeamAgentError('INVALID_INPUT', `${field} must be an array of strings.`);
  }
  if (value.length > MAX_TEAM_LIST_ENTRIES) {
    throw new TeamAgentError(
      'INVALID_INPUT',
      `${field} must hold at most ${MAX_TEAM_LIST_ENTRIES} entries.`
    );
  }
  const entries: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new TeamAgentError('INVALID_INPUT', `${field} must be an array of strings.`);
    }
    const trimmed = entry.trim();
    if (trimmed) entries.push(trimmed);
  }
  return entries;
}

function parseList(raw: string | null): string[] | undefined {
  if (raw === null || raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return undefined;
  }
}

function serializeList(list: string[] | undefined): string | null {
  return list === undefined ? null : JSON.stringify(list);
}

function parseJson(raw: string | null): unknown {
  if (raw === null || raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    // A context column that is not JSON is still worth handing back verbatim:
    // it was written by something, and dropping it loses evidence.
    return raw;
  }
}

function serializeContext(context: unknown): string | null {
  if (context === undefined || context === null) return null;
  const encoded = typeof context === 'string' ? context : JSON.stringify(context);
  if (encoded.length > MAX_TEAM_CONTEXT_CHARS) {
    throw new TeamAgentError(
      'INVALID_INPUT',
      `context must serialize to at most ${MAX_TEAM_CONTEXT_CHARS} characters.`
    );
  }
  return typeof context === 'string' ? JSON.stringify(context) : encoded;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [truncated ${text.length - max} characters]`;
}

function isTurnState(value: string): value is TeamThreadTurnState {
  return value === 'IDLE' || value === 'PROCESSING_TURN' || value === 'AWAITING_APPROVAL';
}

/** Whether a value is one of the four risk levels the analyser grades with. */
function isRiskLevel(value: unknown): value is TeamApprovalRiskLevel {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'critical';
}

/** How much of a pending action is worth putting in front of the whole team. */
export const MAX_TEAM_APPROVAL_COMMAND_CHARS = 2000;
export const MAX_TEAM_APPROVAL_WARNINGS = 12;

/**
 * An `agent.approval_request` payload, as a turn carries it.
 *
 * Every field is read defensively: the payload is produced by `ApprovalManager`
 * today, but it crosses the EventBus, where anything may publish anything, and
 * a malformed prompt must degrade to "something needs approving" rather than
 * put an unrenderable object in front of the team. `null` when there is no
 * action id, because a prompt nothing can answer is not a prompt.
 */
export function toPendingApprovalInfo(
  payload: Record<string, unknown> | undefined | null
): TeamPendingApprovalInfo | null {
  const actionId = typeof payload?.actionId === 'string' ? payload.actionId.trim() : '';
  if (!actionId) return null;

  const analysis = (payload?.securityAnalysis ?? {}) as Record<string, unknown>;
  const rawWarnings = Array.isArray(analysis.warnings) ? analysis.warnings : [];
  const warnings = rawWarnings
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    .slice(0, MAX_TEAM_APPROVAL_WARNINGS);

  return {
    actionId,
    command:
      typeof payload?.command === 'string' && payload.command.trim() !== ''
        ? truncate(payload.command, MAX_TEAM_APPROVAL_COMMAND_CHARS)
        : undefined,
    description:
      typeof payload?.description === 'string' && payload.description.trim() !== ''
        ? truncate(payload.description, MAX_TEAM_APPROVAL_COMMAND_CHARS)
        : undefined,
    riskLevel: isRiskLevel(analysis.riskLevel) ? analysis.riskLevel : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    requestedAt: Date.now()
  };
}

/**
 * An approval policy from a request body.
 *
 * Refused rather than defaulted when it is not one of the three: a typo in a
 * policy name would otherwise quietly widen who may approve a destructive tool
 * call, which is the one mistake this field exists to prevent.
 */
function optionalApprovalPolicy(value: unknown, field: string): TeamApprovalPolicy | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (!isTeamApprovalPolicy(value)) {
    throw new TeamAgentError(
      'INVALID_INPUT',
      `${field} must be one of ANY_MEMBER, ADMIN_ONLY or TURN_INITIATOR.`
    );
  }
  return value;
}

/** A stored policy column, tolerating a value written before this contract. */
function parseApprovalPolicy(raw: string | null): TeamApprovalPolicy | undefined {
  return isTeamApprovalPolicy(raw) ? raw : undefined;
}

function rowToAgent(row: TeamAgentRow): TeamAgent {
  return {
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    role: row.role,
    description: row.description,
    systemPrompt: row.system_prompt,
    model: row.model ?? undefined,
    temperature: row.temperature ?? undefined,
    enabledMcpServers: parseList(row.enabled_mcp_servers),
    enabledSkills: parseList(row.enabled_skills),
    approvalPolicy: parseApprovalPolicy(row.approval_policy) ?? DEFAULT_TEAM_APPROVAL_POLICY,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToThread(row: TeamThreadRow): TeamThread {
  return {
    id: row.id,
    teamAgentId: row.team_agent_id,
    projectId: row.project_id ?? undefined,
    title: row.title,
    status: isTurnState(row.status) ? row.status : 'IDLE',
    activeTurnUserId: row.active_turn_user_id ?? undefined,
    // Left undefined when the column is NULL: the thread defers to its agent,
    // which is not the same as choosing the permissive default itself.
    approvalPolicy: parseApprovalPolicy(row.approval_policy),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToTurn(row: TeamTurnRow): TeamTurnQueueItem {
  return {
    id: row.id,
    teamThreadId: row.team_thread_id,
    userId: row.user_id,
    userName: row.user_name,
    instruction: row.instruction,
    context: parseJson(row.context_json),
    status: row.status as TeamTurnStatus,
    queuedAt: row.queued_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    errorMessage: row.error_message ?? undefined,
    approval: rowToApproval(row)
  };
}

/** The approval answer on a turn row, or undefined when it was never asked. */
function rowToApproval(row: TeamTurnRow): TeamTurnApprovalRecord | undefined {
  if (row.approval_decision !== 'APPROVED' && row.approval_decision !== 'REJECTED') {
    return undefined;
  }
  return {
    decision: row.approval_decision,
    policy: parseApprovalPolicy(row.approval_policy) ?? DEFAULT_TEAM_APPROVAL_POLICY,
    resolvedBy: row.approval_resolved_by ?? 'unknown',
    resolvedByName: row.approval_resolved_by_name ?? undefined,
    comment: row.approval_comment ?? undefined,
    resolvedAt: row.approval_resolved_at ?? 0
  };
}

function rowToMessage(row: TeamMessageRow): TeamAgentMessage {
  return {
    id: row.id,
    teamThreadId: row.team_thread_id,
    userId: row.user_id ?? undefined,
    userName: row.user_name ?? undefined,
    role: row.role as TeamAgentMessageRole,
    content: row.content,
    toolCalls: parseJson(row.tool_calls_json),
    createdAt: row.created_at
  };
}

/**
 * The persona a shared session opens with.
 *
 * The role first and the collaboration rule second, because the second only
 * makes sense once the agent knows what it is: instructions arrive from
 * different people, each is attributed, and the transcript is shared. An agent
 * that does not know that will answer the third member as though the first two
 * conversations were theirs.
 */
export function composeTeamAgentBrief(agent: TeamAgent): string {
  return [
    `You are the shared team agent "${agent.name}" (role: ${agent.role}).`,
    '',
    agent.systemPrompt.trim(),
    '',
    'You are working with a team. Instructions arrive from different members and',
    'each one is prefixed with the name of the person who sent it. The transcript',
    'is shared: everything you say is read by the whole team, so address the',
    'person who asked, and keep the context of what the team has already decided.'
  ].join('\n');
}

/** One member's instruction, attributed, as it is handed to the agent. */
export function formatTeamTurnInstruction(turn: TeamTurnQueueItem): string {
  const blocks = [`[${turn.userName}] ${turn.instruction}`];
  if (turn.context !== undefined && turn.context !== null) {
    const encoded = typeof turn.context === 'string' ? turn.context : JSON.stringify(turn.context);
    if (encoded && encoded !== '""') blocks.push('', 'Context provided with this request:', encoded);
  }
  return blocks.join('\n');
}

// --- Approval governance (DEC-031 § 3) ---

/** The standing a caller brings to an approval prompt. */
export interface TeamApprovalCaller {
  userId: string;
  userName?: string;
  /** Their role in the team, or null when they hold none. */
  role: WorkspaceRole | null;
  /**
   * True when the team has no membership rows at all.
   *
   * A workstation that predates RBAC has no memberships, and on a
   * single-developer install that is the normal case rather than an
   * unauthorized one. Refusing there would lock the only user out of their own
   * agent, which is the failure `EnvironmentSecretService` already documents.
   */
  unmanaged?: boolean;
}

/** Whether a role administers a team: it may retire roles and always approve. */
export function isTeamAdminRole(role: WorkspaceRole | null | undefined): boolean {
  if (!role) return false;
  return role === 'owner' || role === 'admin' || rbacService.hasPermission(role, 'workspace:admin');
}

/**
 * Whether this caller may answer this turn's approval prompt.
 *
 * Pure: it is given the policy, the caller's standing and whose turn it is, and
 * nothing else. The database lookup that produced the role belongs to the route,
 * so the rule itself can be asserted directly for all three policies without a
 * workspace, a membership row or an HTTP request.
 */
export function evaluateTeamApproval(params: {
  policy: TeamApprovalPolicy;
  caller: TeamApprovalCaller;
  /** The user id that submitted the turn being decided. */
  turnUserId: string;
}): { allowed: boolean; reason?: string } {
  const { policy, caller, turnUserId } = params;

  // An unmanaged team is a workstation with no membership rows at all. Its
  // single user is the owner in everything but the record.
  if (caller.unmanaged && !caller.role) return { allowed: true };

  if (!caller.role) {
    return { allowed: false, reason: 'You are not a member of this team.' };
  }

  const admin = isTeamAdminRole(caller.role);

  if (policy === 'ADMIN_ONLY') {
    return admin
      ? { allowed: true }
      : {
          allowed: false,
          reason: 'This agent requires a team admin or owner to answer its approvals.'
        };
  }

  if (policy === 'TURN_INITIATOR') {
    if (caller.userId === turnUserId || admin) return { allowed: true };
    return {
      allowed: false,
      reason: 'Only the member who submitted this turn, or a team admin, may answer it.'
    };
  }

  // ANY_MEMBER: a member of the team who may approve agent actions at all,
  // which excludes a viewer.
  return rbacService.hasPermission(caller.role, 'agent:approve')
    ? { allowed: true }
    : { allowed: false, reason: 'Your role cannot approve agent actions.' };
}

// --- Team project memory (DEC-027, DEC-031) ---

/** The standing context a bound project imposes on every turn of a thread. */
export interface TeamMemorySnapshot {
  rules: ArchitecturalRule[];
  intent: ProjectIntent | null;
  decisions: ProjectDecision[];
}

/** Where a thread's standing context comes from. Swapped in tests. */
export interface TeamMemoryProvider {
  load(projectId: string): TeamMemorySnapshot;
}

/** Most entries of each kind that are worth spending a shared session's context on. */
export const MAX_TEAM_MEMORY_RULES = 20;
export const MAX_TEAM_MEMORY_DECISIONS = 15;

/** The Project Memory Core, read for a team thread's bound project. */
export const projectMemoryTeamProvider: TeamMemoryProvider = {
  load(projectId: string): TeamMemorySnapshot {
    return {
      rules: projectMemoryService.listRules(projectId),
      intent: projectMemoryService.getActiveIntent(projectId),
      decisions: projectMemoryService.listDecisions(projectId, { status: 'ACTIVE' })
    };
  }
};

/**
 * The team's standing rules, current intent and settled decisions, as prose.
 *
 * Returns `undefined` when the project has none of the three, so a thread whose
 * project memory is empty sends nothing rather than an empty heading — an agent
 * told "the team has decided:" followed by silence will infer that the team has
 * decided nothing, which is a different claim from "nobody has written any of
 * this down yet".
 *
 * Ordering matters and is deliberate: rules first, because they are the ones an
 * agent may not break; then what the team is currently trying to do; then what
 * it has already settled, which is context rather than constraint.
 */
export function composeTeamMemoryBrief(memory: TeamMemorySnapshot): string | undefined {
  const rules = memory.rules.slice(0, MAX_TEAM_MEMORY_RULES);
  const decisions = memory.decisions.slice(0, MAX_TEAM_MEMORY_DECISIONS);
  const intent = memory.intent;
  if (rules.length === 0 && decisions.length === 0 && !intent) return undefined;

  const blocks: string[] = ['This team has standing context for the project you are working in.'];

  if (rules.length > 0) {
    blocks.push('', 'Architectural rules in force — do not violate these:');
    for (const rule of rules) {
      blocks.push(`- [${rule.severity}] ${rule.title}: ${rule.statement} (scope: ${rule.scopePattern})`);
    }
  }

  if (intent) {
    blocks.push('', `Current intent: ${intent.goal}`);
    for (const constraint of intent.constraints) blocks.push(`- constraint: ${constraint}`);
    for (const nonGoal of intent.nonGoals) blocks.push(`- explicitly not a goal: ${nonGoal}`);
  }

  if (decisions.length > 0) {
    blocks.push('', 'Decisions the team has already made:');
    for (const decision of decisions) {
      blocks.push(`- ${decision.title}: ${decision.summary}`);
      for (const constraint of decision.constraints) blocks.push(`  - constraint: ${constraint}`);
    }
  }

  blocks.push(
    '',
    'Work within all of the above. If an instruction would break one of these,',
    'say which one before doing anything else.'
  );

  return truncate(blocks.join('\n'), MAX_TEAM_SYSTEM_PROMPT_CHARS);
}

// --- Turn execution ---

/** What one turn is run with, from the moment it holds the lock. */
export interface TeamTurnRunParams {
  agent: TeamAgent;
  thread: TeamThread;
  turn: TeamTurnQueueItem;
  timeoutMs: number;
  /**
   * The team's standing rules, intent and decisions for the bound project.
   * Absent when the thread has no project, or its project has no memory.
   */
  memoryBrief?: string;
  /**
   * The agent's session has stopped on a destructive action (DEC-031 § 3).
   *
   * Reported rather than decided here: the executor knows only that something
   * is being asked for, and what happens to the queue as a result — the turn
   * parking, the rest of the team being told why — belongs to the service.
   */
  onApprovalRequest?: (pending: TeamPendingApprovalInfo) => void;
  /**
   * A raised approval went away without the team answering it — the session was
   * stopped, or it timed out. The turn must not stay parked on a prompt that no
   * longer exists, or the thread waits for an answer nobody can give.
   */
  onApprovalCancelled?: (actionId: string) => void;
}

/** What a turn is handed to, once it holds the lock. */
export interface TeamTurnExecutor {
  run(params: TeamTurnRunParams): Promise<{ output: string; toolCalls?: unknown }>;
  /** Forgets whatever session state it holds for a thread that is going away. */
  reset?(threadId: string): void;
}

/**
 * The part of `ApprovalManager` a refused turn needs.
 *
 * Narrow on purpose: the service must be able to say "nobody is going to answer
 * these" when a turn is rejected, and nothing more. Injectable so the queueing
 * behaviour can be asserted without the Core's approval singleton.
 */
export interface TeamApprovalSink {
  cancelApprovalsForThread(threadId: string, reason?: string): number;
}

/**
 * The production executor: the agent session the dashboard would have started.
 *
 * The team thread's id is used as the session's thread id, so a shared thread
 * is one long-lived session rather than a new process per turn — which is what
 * makes the agent's memory of the team's earlier questions real rather than
 * re-summarized. The project the thread is bound to supplies the working
 * directory; a thread bound to nothing cannot be served, and says so instead of
 * running somewhere arbitrary.
 *
 * Completion is observed, not reported, for the reason `AgentDelegationService`
 * documents: a CLI agent driven over a PTY has no way to say "I am finished",
 * so a turn is done when it has produced output and then gone idle. The
 * `sawOutput` guard separates that from the idle a session reports at startup.
 */
export class EventBusTeamTurnExecutor implements TeamTurnExecutor {
  /**
   * Threads whose session has already been given the persona.
   *
   * Owned here rather than by the service because this is the only thing that
   * knows whether a brief was actually published. A turn that is refused before
   * anything is sent — an unbound thread — must leave the thread unbriefed, and
   * one that fails after the brief went out must not send it a second time into
   * a session that is already running under it.
   */
  private briefed = new Set<string>();

  /**
   * The standing context each thread's session has already been given.
   *
   * Team memory changes while a shared thread is open — someone records a
   * decision, someone adds a rule — so it cannot simply ride along with the
   * one-time persona. Nor may it be resent every turn: a session that is told
   * the same twenty rules before every instruction spends its context on
   * repetition. What is sent is the difference, which is why the last text is
   * remembered rather than the fact that something was sent.
   */
  private memory = new Map<string, string>();

  constructor(private readonly bus: EventBus = eventBus) {}

  public async run(params: TeamTurnRunParams): Promise<{ output: string; toolCalls?: unknown }> {
    const { agent, thread, turn, timeoutMs, memoryBrief } = params;
    const projectId = thread.projectId;
    if (!projectId) {
      throw new TeamAgentError(
        'NO_PROJECT_BOUND',
        `Team thread ${thread.id} is not bound to a project, so there is no checkout to run against.`
      );
    }

    // Armed before the session is asked for anything, so output — or an
    // approval prompt — that arrives between the send and the subscribe cannot
    // be missed.
    const watching = this.watch(thread.id, timeoutMs, params);

    if (!this.briefed.has(thread.id)) {
      this.publish('client.command', {
        command: 'start',
        projectId,
        threadId: thread.id
      });
      // A chat message rather than raw stdin: it goes through the adapter's
      // busy queue, so a brief written before the agent has finished booting is
      // delivered rather than dropped into a terminal that is not reading yet.
      this.publish('client.chat_message', {
        projectId,
        threadId: thread.id,
        content: composeTeamAgentBrief(agent)
      });
      // Marked here, not after the turn succeeds: the brief has been published,
      // and whether this particular turn goes on to fail changes nothing about
      // what the session has already been told.
      this.briefed.add(thread.id);
    }

    // Published as its own message rather than folded into the instruction, so
    // the team's standing rules are not attributed to the member who happened
    // to be next in the queue.
    if (memoryBrief && this.memory.get(thread.id) !== memoryBrief) {
      this.publish('client.chat_message', {
        projectId,
        threadId: thread.id,
        content: memoryBrief
      });
      this.memory.set(thread.id, memoryBrief);
    }

    this.publish('client.chat_message', {
      projectId,
      threadId: thread.id,
      content: formatTeamTurnInstruction(turn)
    });

    const outcome = await watching;
    if (outcome.failure) throw new Error(outcome.failure);
    return { output: outcome.output };
  }

  /** The thread is gone; its session is not going to be briefed again. */
  public reset(threadId: string): void {
    this.briefed.delete(threadId);
    this.memory.delete(threadId);
  }

  private publish(type: string, payload: Record<string, unknown>): void {
    this.bus.publish({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'server:team-agent',
      type,
      payload
    });
  }

  /**
   * Resolves when the session has answered, failed, or run out of time.
   *
   * Also where a destructive tool call is intercepted. `ApprovalManager`
   * publishes `agent.approval_request` on this bus with the thread it belongs
   * to, and a team thread's session runs under the team thread's own id — so
   * the prompt that stopped the agent is matched to the turn that is being
   * served without either side knowing about the other. The subscription lives
   * exactly as long as the turn does, which is why nothing here has to check
   * whether the turn it is reporting for is still the active one.
   */
  private watch(
    threadId: string,
    timeoutMs: number,
    hooks: Pick<TeamTurnRunParams, 'onApprovalRequest' | 'onApprovalCancelled'> = {}
  ): Promise<{ output: string; failure?: string }> {
    return new Promise(resolve => {
      const chunks: string[] = [];
      let sawOutput = false;
      let settled = false;

      const finish = (failure?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.bus.unsubscribe('chat.message', onChat);
        this.bus.unsubscribe('agent.status', onStatus);
        this.bus.unsubscribe('agent.approval_request', onApprovalRequest);
        this.bus.unsubscribe('agent.approval_cancelled', onApprovalCancelled);
        resolve({ output: truncate(chunks.join('').trim(), MAX_TEAM_OUTPUT_CHARS), failure });
      };

      const onChat = (event: { payload?: Record<string, unknown> }) => {
        const payload = event?.payload ?? {};
        if (payload.threadId !== threadId) return;
        if (payload.role !== 'agent') return;
        const content = typeof payload.content === 'string' ? payload.content : '';
        if (!content) return;
        chunks.push(content);
        sawOutput = true;
      };

      const onStatus = (event: { payload?: Record<string, unknown> }) => {
        const payload = event?.payload ?? {};
        if (payload.threadId !== threadId) return;
        const status = payload.status;
        const message = typeof payload.message === 'string' ? payload.message : '';

        if (status === 'error') {
          finish(message || 'The shared team agent session reported an error.');
          return;
        }
        // A session that could not be started reports itself idle with the
        // reason in the message. Without this it would look like an agent that
        // simply had nothing to say, and the turn would hold the lock until the
        // timeout — with the rest of the team queued behind it.
        if (status === 'idle' && !sawOutput && /^error starting agent/i.test(message)) {
          finish(message);
          return;
        }
        if (status === 'idle' && sawOutput) finish();
      };

      /**
       * The agent stopped on something a person has to allow.
       *
       * The countdown is restarted as well as reported. The timeout exists to
       * catch an agent that has gone quiet, and a turn parked on an approval is
       * not quiet — it is waiting on the team. Letting the deliberation eat the
       * agent's answer window would fail turns for the crime of being asked
       * about.
       */
      const onApprovalRequest = (event: { payload?: Record<string, unknown> }) => {
        const payload = event?.payload ?? {};
        if (payload.threadId !== threadId) return;
        const pending = toPendingApprovalInfo(payload);
        if (!pending) return;
        arm();
        try {
          hooks.onApprovalRequest?.(pending);
        } catch (err) {
          // The turn is still running; a queue that could not be told about the
          // prompt is not a reason to abandon it.
          console.error('[TeamAgentService] Could not park a turn on its approval:', (err as Error).message);
        }
      };

      const onApprovalCancelled = (event: { payload?: Record<string, unknown> }) => {
        const payload = event?.payload ?? {};
        if (payload.threadId !== threadId) return;
        const actionId = typeof payload.actionId === 'string' ? payload.actionId : '';
        if (!actionId) return;
        try {
          hooks.onApprovalCancelled?.(actionId);
        } catch (err) {
          console.error('[TeamAgentService] Could not clear a cancelled approval:', (err as Error).message);
        }
      };

      // Deliberately not unref'd: this timer is the only thing that will ever
      // release the lock if the agent goes quiet, and a lock nobody releases is
      // a shared thread that never moves again.
      let timer: ReturnType<typeof setTimeout>;
      function arm(): void {
        clearTimeout(timer);
        timer = setTimeout(
          () => finish(`The shared agent did not answer within ${Math.round(timeoutMs / 1000)}s.`),
          timeoutMs
        );
      }
      arm();

      this.bus.subscribe('chat.message', onChat);
      this.bus.subscribe('agent.status', onStatus);
      this.bus.subscribe('agent.approval_request', onApprovalRequest);
      this.bus.subscribe('agent.approval_cancelled', onApprovalCancelled);
    });
  }
}

/** What `enqueueTurn` hands back: the place in line, and the eventual outcome. */
export interface EnqueuedTurn {
  turn: TeamTurnQueueItem;
  /** Turns that must finish before this one starts. 0 means it is running now. */
  queuePosition: number;
  /**
   * Settles when the turn is over.
   *
   * Never rejects — a turn that failed is a `TeamTurnResult` with a reason on
   * it, because the caller that ignores this promise (every REST caller does;
   * the queue is the point) must not produce an unhandled rejection.
   */
  completion: Promise<TeamTurnResult>;
}

export class TeamAgentService {
  private readonly lock: AgentTurnLock;
  private readonly executor: TeamTurnExecutor;
  private readonly turnTimeoutMs: number;
  private readonly memory: TeamMemoryProvider;
  private readonly broadcast: TurnBroadcaster;
  /** Where `client.approval_response` is published. See `signalApproval`. */
  private readonly bus: EventBus;
  private readonly approvals: TeamApprovalSink;

  /**
   * Turns whose approval was rejected while they were still in the executor.
   *
   * A rejection releases the lock immediately — the team should not wait out an
   * action nobody is going to allow — but the executor is still waiting on an
   * agent that has not been told. This is how `runTurn` learns, so a turn that
   * answers a moment later cannot overwrite the cancellation with an answer.
   */
  private rejections = new Map<string, (reason: Error) => void>();

  constructor(options?: {
    lock?: AgentTurnLock;
    executor?: TeamTurnExecutor;
    turnTimeoutMs?: number;
    memory?: TeamMemoryProvider;
    /** Where approval resolutions are announced. Defaults to the EventBus. */
    broadcast?: TurnBroadcaster;
    /** Where `client.approval_response` is published. Defaults to the EventBus. */
    bus?: EventBus;
    /** What is told that a refused turn's prompts are dead. */
    approvals?: TeamApprovalSink;
  }) {
    this.lock = options?.lock ?? agentTurnLock;
    this.executor = options?.executor ?? new EventBusTeamTurnExecutor();
    this.turnTimeoutMs = options?.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
    this.memory = options?.memory ?? projectMemoryTeamProvider;
    this.broadcast = options?.broadcast ?? eventBusTurnBroadcaster();
    this.bus = options?.bus ?? eventBus;
    this.approvals = options?.approvals ?? approvalManager;
  }

  private db() {
    return dbService.getDb();
  }

  // --- Agent CRUD ---

  public createTeamAgent(input: CreateTeamAgentInput): TeamAgent {
    const teamId = requireText(input?.teamId, 'teamId', MAX_TEAM_NAME_CHARS);
    const name = requireText(input?.name, 'name', MAX_TEAM_NAME_CHARS);
    const role = requireText(input?.role, 'role', MAX_TEAM_ROLE_CHARS);
    const systemPrompt = requireText(
      input?.systemPrompt,
      'systemPrompt',
      MAX_TEAM_SYSTEM_PROMPT_CHARS
    );
    const description = optionalText(input?.description, 'description', MAX_TEAM_DESCRIPTION_CHARS);
    const model = optionalText(input?.model, 'model', MAX_TEAM_NAME_CHARS);
    const temperature = optionalTemperature(input?.temperature);
    const enabledMcpServers = optionalList(input?.enabledMcpServers, 'enabledMcpServers');
    const enabledSkills = optionalList(input?.enabledSkills, 'enabledSkills');
    const approvalPolicy =
      optionalApprovalPolicy(input?.approvalPolicy, 'approvalPolicy') ?? DEFAULT_TEAM_APPROVAL_POLICY;
    const createdBy = optionalText(input?.createdBy, 'createdBy', MAX_TEAM_NAME_CHARS);

    const now = Date.now();
    const agent: TeamAgent = {
      id: `tagent_${crypto.randomUUID()}`,
      teamId,
      name,
      role,
      description: description ?? '',
      systemPrompt,
      model,
      temperature,
      enabledMcpServers,
      enabledSkills,
      approvalPolicy,
      createdBy,
      createdAt: now,
      updatedAt: now
    };

    this.db()
      .prepare(
        `INSERT INTO team_agents (
           id, team_id, name, role, description, system_prompt, model, temperature,
           enabled_mcp_servers, enabled_skills, approval_policy, created_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        agent.id,
        agent.teamId,
        agent.name,
        agent.role,
        agent.description,
        agent.systemPrompt,
        agent.model ?? null,
        agent.temperature ?? null,
        serializeList(agent.enabledMcpServers),
        serializeList(agent.enabledSkills),
        agent.approvalPolicy ?? DEFAULT_TEAM_APPROVAL_POLICY,
        agent.createdBy ?? null,
        agent.createdAt,
        agent.updatedAt
      );

    return agent;
  }

  public getTeamAgent(id: string): TeamAgent | null {
    const row = this.db().prepare('SELECT * FROM team_agents WHERE id = ?').get(id) as
      | TeamAgentRow
      | undefined;
    return row ? rowToAgent(row) : null;
  }

  /** The same lookup, but a missing agent is an error the REST layer can map. */
  public requireTeamAgent(id: string): TeamAgent {
    const agent = this.getTeamAgent(id);
    if (!agent) throw new TeamAgentError('AGENT_NOT_FOUND', `Team agent ${id} was not found.`);
    return agent;
  }

  public listTeamAgents(teamId: string): TeamAgent[] {
    const rows = this.db()
      .prepare('SELECT * FROM team_agents WHERE team_id = ? ORDER BY created_at ASC')
      .all(teamId) as unknown as TeamAgentRow[];
    return rows.map(rowToAgent);
  }

  public updateTeamAgent(id: string, input: UpdateTeamAgentInput): TeamAgent {
    const existing = this.requireTeamAgent(id);

    const next: TeamAgent = {
      ...existing,
      name: input?.name === undefined ? existing.name : requireText(input.name, 'name', MAX_TEAM_NAME_CHARS),
      role: input?.role === undefined ? existing.role : requireText(input.role, 'role', MAX_TEAM_ROLE_CHARS),
      description:
        input?.description === undefined
          ? existing.description
          : optionalText(input.description, 'description', MAX_TEAM_DESCRIPTION_CHARS) ?? '',
      systemPrompt:
        input?.systemPrompt === undefined
          ? existing.systemPrompt
          : requireText(input.systemPrompt, 'systemPrompt', MAX_TEAM_SYSTEM_PROMPT_CHARS),
      model:
        input?.model === undefined
          ? existing.model
          : optionalText(input.model, 'model', MAX_TEAM_NAME_CHARS),
      temperature:
        input?.temperature === undefined ? existing.temperature : optionalTemperature(input.temperature),
      enabledMcpServers:
        input?.enabledMcpServers === undefined
          ? existing.enabledMcpServers
          : optionalList(input.enabledMcpServers, 'enabledMcpServers'),
      enabledSkills:
        input?.enabledSkills === undefined
          ? existing.enabledSkills
          : optionalList(input.enabledSkills, 'enabledSkills'),
      approvalPolicy:
        input?.approvalPolicy === undefined
          ? existing.approvalPolicy
          : optionalApprovalPolicy(input.approvalPolicy, 'approvalPolicy'),
      updatedAt: Date.now()
    };

    this.db()
      .prepare(
        `UPDATE team_agents SET
           name = ?, role = ?, description = ?, system_prompt = ?, model = ?, temperature = ?,
           enabled_mcp_servers = ?, enabled_skills = ?, approval_policy = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        next.name,
        next.role,
        next.description,
        next.systemPrompt,
        next.model ?? null,
        next.temperature ?? null,
        serializeList(next.enabledMcpServers),
        serializeList(next.enabledSkills),
        next.approvalPolicy ?? DEFAULT_TEAM_APPROVAL_POLICY,
        next.updatedAt,
        next.id
      );

    return next;
  }

  /**
   * Removes a team agent and everything hanging from it.
   *
   * The threads, their queues and their transcripts go with it through the
   * schema's cascades. The in-memory lanes are cleared too, or a queue for a
   * thread that no longer exists would keep serving turns against it.
   */
  public deleteTeamAgent(id: string): void {
    this.requireTeamAgent(id);
    for (const thread of this.listTeamThreads(id)) {
      this.lock.clearThread(thread.id);
      this.executor.reset?.(thread.id);
    }
    this.db().prepare('DELETE FROM team_agents WHERE id = ?').run(id);
  }

  // --- Thread management ---

  public createTeamThread(input: {
    teamAgentId: string;
    title?: string;
    projectId?: string;
    /** Overrides the agent's policy for this conversation only. */
    approvalPolicy?: TeamApprovalPolicy;
  }): TeamThread {
    const agent = this.requireTeamAgent(
      requireText(input?.teamAgentId, 'teamAgentId', MAX_TEAM_NAME_CHARS)
    );
    const title = optionalText(input?.title, 'title', MAX_TEAM_NAME_CHARS) ?? `${agent.name} thread`;
    const projectId = optionalText(input?.projectId, 'projectId', MAX_TEAM_NAME_CHARS);
    const approvalPolicy = optionalApprovalPolicy(input?.approvalPolicy, 'approvalPolicy');

    const now = Date.now();
    const thread: TeamThread = {
      id: `tthread_${crypto.randomUUID()}`,
      teamAgentId: agent.id,
      projectId,
      title,
      status: 'IDLE',
      approvalPolicy,
      createdAt: now,
      updatedAt: now
    };

    this.db()
      .prepare(
        `INSERT INTO team_threads (
           id, team_agent_id, project_id, title, status, active_turn_user_id,
           approval_policy, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`
      )
      .run(
        thread.id,
        thread.teamAgentId,
        thread.projectId ?? null,
        thread.title,
        thread.status,
        thread.approvalPolicy ?? null,
        thread.createdAt,
        thread.updatedAt
      );

    return thread;
  }

  /**
   * The policy actually in force on a thread.
   *
   * The thread's own override wins, then the agent's, then the permissive
   * default. Resolved in one place because a UI that computed it differently
   * from the Core would offer buttons the Core refuses.
   */
  public effectiveApprovalPolicy(thread: TeamThread, agent?: TeamAgent | null): TeamApprovalPolicy {
    return (
      thread.approvalPolicy ??
      (agent ?? this.getTeamAgent(thread.teamAgentId))?.approvalPolicy ??
      DEFAULT_TEAM_APPROVAL_POLICY
    );
  }

  public getTeamThread(id: string): TeamThread | null {
    const row = this.db().prepare('SELECT * FROM team_threads WHERE id = ?').get(id) as
      | TeamThreadRow
      | undefined;
    return row ? rowToThread(row) : null;
  }

  public requireTeamThread(id: string): TeamThread {
    const thread = this.getTeamThread(id);
    if (!thread) throw new TeamAgentError('THREAD_NOT_FOUND', `Team thread ${id} was not found.`);
    return thread;
  }

  public listTeamThreads(teamAgentId: string): TeamThread[] {
    const rows = this.db()
      .prepare('SELECT * FROM team_threads WHERE team_agent_id = ? ORDER BY created_at ASC')
      .all(teamAgentId) as unknown as TeamThreadRow[];
    return rows.map(rowToThread);
  }

  // --- Transcript ---

  /** Appends one line to a shared transcript. */
  public appendMessage(input: {
    teamThreadId: string;
    role: TeamAgentMessageRole;
    content: string;
    userId?: string;
    userName?: string;
    toolCalls?: unknown;
  }): TeamAgentMessage {
    const message: TeamAgentMessage = {
      id: `tmsg_${crypto.randomUUID()}`,
      teamThreadId: input.teamThreadId,
      userId: input.userId,
      userName: input.userName,
      role: input.role,
      content: truncate(input.content ?? '', MAX_TEAM_OUTPUT_CHARS),
      toolCalls: input.toolCalls,
      createdAt: Date.now()
    };

    this.db()
      .prepare(
        `INSERT INTO team_agent_messages (
           id, team_thread_id, user_id, user_name, role, content, tool_calls_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        message.id,
        message.teamThreadId,
        message.userId ?? null,
        message.userName ?? null,
        message.role,
        message.content,
        message.toolCalls === undefined ? null : JSON.stringify(message.toolCalls),
        message.createdAt
      );

    return message;
  }

  /** The shared transcript, oldest first. */
  public listMessages(teamThreadId: string, limit = 500): TeamAgentMessage[] {
    const rows = this.db()
      .prepare(
        'SELECT * FROM team_agent_messages WHERE team_thread_id = ? ORDER BY created_at ASC, rowid ASC LIMIT ?'
      )
      .all(teamThreadId, limit) as unknown as TeamMessageRow[];
    return rows.map(rowToMessage);
  }

  // --- The queue ---

  /**
   * Submits an instruction to a shared thread.
   *
   * Everything up to and including `lock.enqueue` is synchronous, which is what
   * makes the ordering guarantee real: two members submitting in the same tick
   * are ordered by which one reached the queue, not by which promise the
   * runtime resumed first. Only after the place in line is fixed does the turn
   * start waiting for the lock.
   *
   * The instruction is written into the transcript here rather than when it is
   * served, so a member watching a busy thread sees their own message land
   * immediately and the queue behind it for what it is.
   */
  public enqueueTurn(request: TeamTurnRequest): EnqueuedTurn {
    const threadId = requireText(request?.teamThreadId, 'teamThreadId', MAX_TEAM_NAME_CHARS);
    const thread = this.requireTeamThread(threadId);
    const agent = this.requireTeamAgent(thread.teamAgentId);

    const userId = requireText(request?.userId, 'userId', MAX_TEAM_NAME_CHARS);
    const userName = optionalText(request?.userName, 'userName', MAX_TEAM_NAME_CHARS) ?? userId;
    const instruction = requireText(
      request?.instruction,
      'instruction',
      MAX_TEAM_INSTRUCTION_CHARS
    );
    const contextJson = serializeContext(request?.context);

    const turn: TeamTurnQueueItem = {
      id: `tturn_${crypto.randomUUID()}`,
      teamThreadId: thread.id,
      userId,
      userName,
      instruction,
      context: request?.context ?? undefined,
      status: 'QUEUED',
      queuedAt: Date.now()
    };

    this.db()
      .prepare(
        `INSERT INTO team_turn_queue (
           id, team_thread_id, user_id, user_name, instruction, context_json,
           status, queued_at, started_at, completed_at, error_message
         ) VALUES (?, ?, ?, ?, ?, ?, 'QUEUED', ?, NULL, NULL, NULL)`
      )
      .run(
        turn.id,
        turn.teamThreadId,
        turn.userId,
        turn.userName,
        turn.instruction,
        contextJson,
        turn.queuedAt
      );

    this.appendMessage({
      teamThreadId: thread.id,
      role: 'user',
      content: turn.instruction,
      userId: turn.userId,
      userName: turn.userName
    });

    const queuePosition = this.lock.enqueue(turn, this.contextFor(thread, agent));

    return { turn, queuePosition, completion: this.runTurn(agent, thread, turn) };
  }

  /**
   * One turn, from the lock to the transcript.
   *
   * Never rejects, and never runs anything before `acquireTurn` has answered
   * `true` — those two properties together are the collision guarantee. The
   * `finally` is what makes the first one load-bearing: an executor that throws,
   * a database write that fails, a timeout, all reach `releaseTurn`, and the
   * member behind this one in the queue starts.
   */
  private async runTurn(
    agent: TeamAgent,
    thread: TeamThread,
    turn: TeamTurnQueueItem
  ): Promise<TeamTurnResult> {
    const granted = await this.lock.acquireTurn(
      thread.id,
      turn.id,
      this.contextFor(thread, agent)
    );

    if (!granted) {
      // Cancelled while it waited. `cancelTurn` has already written the row and
      // told the room; there is nothing to run and nothing to release.
      const settled = this.getTurn(turn.id);
      return {
        turnId: turn.id,
        teamThreadId: thread.id,
        status: settled?.status ?? 'CANCELLED',
        errorMessage: settled?.errorMessage
      };
    }

    const startedAt = Date.now();
    let status: TeamTurnStatus = 'COMPLETED';
    let output: string | undefined;
    let errorMessage: string | undefined;

    try {
      // Inside the try, not before it: a database that refuses this write must
      // still reach the `finally` and release the lock, or one failed UPDATE
      // parks every member queued behind this turn indefinitely.
      this.markTurnStarted(turn.id, startedAt);
      this.setThreadState(thread.id, 'PROCESSING_TURN', turn.userId);

      // Re-read, so a turn that was queued before the thread was bound to a
      // project runs against the binding it has when its turn comes.
      const live = this.getTeamThread(thread.id) ?? thread;
      const result = await this.raceRejection(
        turn.id,
        this.executor.run({
          agent,
          thread: live,
          turn,
          timeoutMs: this.turnTimeoutMs,
          // Read here rather than when the turn was queued: a rule recorded
          // while this turn waited its place in line still governs it.
          memoryBrief: this.memoryBriefFor(live),
          // The seam that makes destructive tool interception real: the
          // executor observes the prompt, and the queue is what parks on it.
          onApprovalRequest: pending => this.parkOnApproval(thread.id, turn.id, pending),
          onApprovalCancelled: actionId => this.releaseApprovalHold(thread.id, turn.id, actionId)
        })
      );
      output = result.output;

      this.swallow(() =>
        this.appendMessage({
          teamThreadId: thread.id,
          role: 'assistant',
          content: result.output,
          toolCalls: result.toolCalls
        })
      );
    } catch (err) {
      // A turn the team refused is cancelled, not failed: nothing broke, a
      // person said no. `resolveTurnApproval` has already written that answer
      // into the transcript, so nothing is appended here.
      const refused = err instanceof TeamTurnRejectedError;
      status = refused ? 'CANCELLED' : 'FAILED';
      errorMessage = (err as Error).message || 'The shared agent turn failed.';
      // The failure belongs in the shared transcript too: the next member to
      // open the thread has to be able to see why their colleague's request
      // produced nothing, without reading the server log.
      if (!refused) {
        this.swallow(() =>
          this.appendMessage({
            teamThreadId: thread.id,
            role: 'system',
            content: `Turn failed: ${errorMessage}`
          })
        );
      }
    } finally {
      this.rejections.delete(turn.id);
      // Every write here is guarded, and the release sits between two guarded
      // blocks rather than behind one. A failed UPDATE is a lost record; a
      // skipped release is a shared thread that never moves again, with every
      // member queued behind it. Only one of those is recoverable.
      this.swallow(() => this.markTurnFinished(turn.id, status, errorMessage));
      // The outcome goes to the lock too, because the release is what the room
      // is told: a failed turn announced as completed shows the team an answer
      // that never arrived.
      this.lock.releaseTurn(thread.id, turn.id, { status, errorMessage });
      this.swallow(() => this.syncThreadState(thread.id));
    }

    return {
      turnId: turn.id,
      teamThreadId: thread.id,
      status,
      output,
      errorMessage,
      durationMs: Date.now() - startedAt
    };
  }

  /**
   * Withdraws a queued turn.
   *
   * Only a turn that has not started. A turn that is already being served is a
   * 409 rather than a silent no-op: stopping an agent mid-generation leaves a
   * partial transcript and possibly a half-executed tool call, and a caller
   * that asked for a cancellation deserves to be told it did not happen.
   * A turn that is already over answers with what it settled as, so clicking
   * Cancel on a request that finished a moment earlier is not an error.
   */
  public cancelTurn(teamThreadId: string, turnId: string): TeamTurnQueueItem {
    this.requireTeamThread(teamThreadId);

    const existing = this.requireTurnOnThread(teamThreadId, turnId);

    if (this.lock.cancelTurn(teamThreadId, turnId)) {
      const completedAt = Date.now();
      this.db()
        .prepare(
          `UPDATE team_turn_queue SET status = 'CANCELLED', completed_at = ?, error_message = ?
           WHERE id = ?`
        )
        .run(completedAt, 'Cancelled before it started.', turnId);
      return { ...existing, status: 'CANCELLED', completedAt, errorMessage: 'Cancelled before it started.' };
    }

    // The lock refused. Either it is running, or it is already over.
    if (existing.status === 'PROCESSING' || existing.status === 'AWAITING_APPROVAL') {
      throw new TeamAgentError(
        'TURN_NOT_CANCELLABLE',
        `Turn ${turnId} is already being served and cannot be withdrawn.`
      );
    }
    return existing;
  }

  // --- Approvals (DEC-031 § 3) ---

  /**
   * Parks the turn that is being served on a human decision.
   *
   * The lock is not released: an approval prompt is part of a turn, not a gap
   * between turns, and letting the next member's instruction in while the agent
   * sits on a half-executed tool call is the exact collision the queue exists
   * to prevent. What changes is only that the thread can now say *why* nothing
   * is moving.
   *
   * `pending` is what the agent asked to do. It is deliberately not written to
   * `team_turn_queue`: an outstanding prompt only exists while the process
   * holding the agent's promise is up — a restart settles the turn as failed
   * (`recoverTurns`) — so persisting it would produce a row describing an
   * action nothing is waiting on. The live queue carries it, and the live queue
   * is what every transition broadcasts.
   */
  public markTurnAwaitingApproval(
    teamThreadId: string,
    turnId: string,
    pending?: TeamPendingApprovalInfo
  ): TeamTurnQueueItem {
    this.requireTeamThread(teamThreadId);
    const turn = this.requireTurnOnThread(teamThreadId, turnId);

    if (!this.lock.markAwaitingApproval(teamThreadId, turnId, pending)) {
      throw new TeamAgentError(
        'TURN_NOT_AWAITING_APPROVAL',
        `Turn ${turnId} is not the turn being served, so it cannot be parked on an approval.`
      );
    }

    this.db()
      .prepare("UPDATE team_turn_queue SET status = 'AWAITING_APPROVAL' WHERE id = ?")
      .run(turnId);
    this.syncThreadState(teamThreadId);

    return {
      ...turn,
      status: 'AWAITING_APPROVAL',
      pendingApproval: this.lock.getQueueState(teamThreadId).activeTurn?.pendingApproval
    };
  }

  /**
   * Parks the running turn because its agent asked for something destructive.
   *
   * Called from the executor's interception rather than by a person, so it
   * cannot be allowed to end the turn: a prompt that arrives a moment after the
   * turn released the lock is an ordinary race, not a failure, and the turn it
   * names may already be over.
   */
  private parkOnApproval(
    teamThreadId: string,
    turnId: string,
    pending: TeamPendingApprovalInfo
  ): void {
    try {
      this.markTurnAwaitingApproval(teamThreadId, turnId, pending);
    } catch (err) {
      console.warn(
        `[TeamAgentService] Could not park turn ${turnId} on approval ${pending.actionId}:`,
        (err as Error).message
      );
    }
  }

  /**
   * The prompt went away without the team answering it.
   *
   * A cancelled approval — a stopped session, a timeout inside
   * `ApprovalManager` — is already denied at the agent's end, so the turn is
   * put back in flight rather than left parked on a question nobody can now
   * answer. Only the prompt it names: a cancellation for some other action must
   * not release a turn that is parked on a live one.
   */
  private releaseApprovalHold(teamThreadId: string, turnId: string, actionId: string): void {
    try {
      const live = this.lock.getQueueState(teamThreadId);
      if (live.activeTurn?.id !== turnId || live.state !== 'AWAITING_APPROVAL') return;
      if (live.activeTurn.pendingApproval?.actionId !== actionId) return;

      this.lock.resumeFromApproval(teamThreadId, turnId);
      this.db().prepare("UPDATE team_turn_queue SET status = 'PROCESSING' WHERE id = ?").run(turnId);
      this.syncThreadState(teamThreadId);
    } catch (err) {
      console.warn(
        `[TeamAgentService] Could not clear cancelled approval ${actionId}:`,
        (err as Error).message
      );
    }
  }

  /**
   * Answers the prompt a parked turn is waiting on.
   *
   * Three things happen here and the order is deliberate. The caller is checked
   * against the policy in force *first* — nothing is written for a request that
   * is going to be refused. The answer is then recorded, on the turn and in the
   * shared transcript, because a team that cannot see who let an agent run a
   * destructive action has governance in name only. Only then is the lock told,
   * and it is told through the same `resumeFromApproval` / `releaseTurn` pair
   * every other path uses: the atomicity guarantee is not weakened for
   * approvals, it is spent by them.
   *
   * A rejection cancels rather than fails. Nothing broke — a person said no —
   * and it releases the lock immediately so the rest of the team is not made to
   * wait out an action that has already been refused.
   */
  public resolveTurnApproval(
    teamThreadId: string,
    turnId: string,
    caller: TeamApprovalCaller,
    decision: TeamApprovalDecision,
    comment?: string
  ): TeamTurnApprovalResult {
    const thread = this.requireTeamThread(teamThreadId);
    const agent = this.requireTeamAgent(thread.teamAgentId);
    const turn = this.requireTurnOnThread(teamThreadId, turnId);

    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      throw new TeamAgentError('INVALID_INPUT', 'decision must be APPROVED or REJECTED.');
    }
    const userId = requireText(caller?.userId, 'userId', MAX_TEAM_NAME_CHARS);
    const userName = optionalText(caller?.userName, 'userName', MAX_TEAM_NAME_CHARS) ?? userId;
    const note = optionalText(comment, 'comment', MAX_TEAM_DESCRIPTION_CHARS);

    // The lock is the authority on what is being served, so it — not the
    // durable row — decides whether there is a prompt to answer at all. It is
    // also where the pending action lives, and it has to be read before the
    // lock is told anything: resuming the turn clears it.
    const live = this.lock.getQueueState(teamThreadId);
    const pending = live.activeTurn?.pendingApproval;
    if (live.activeTurn?.id !== turnId || live.state !== 'AWAITING_APPROVAL') {
      throw new TeamAgentError(
        'TURN_NOT_AWAITING_APPROVAL',
        `Turn ${turnId} is not waiting on an approval.`
      );
    }

    const policy = this.effectiveApprovalPolicy(thread, agent);
    const verdict = evaluateTeamApproval({ policy, caller: { ...caller, userId }, turnUserId: turn.userId });
    if (!verdict.allowed) {
      throw new TeamAgentError('FORBIDDEN', verdict.reason ?? 'You may not answer this approval.');
    }

    const approval: TeamTurnApprovalRecord = {
      decision,
      policy,
      resolvedBy: userId,
      resolvedByName: userName,
      comment: note,
      resolvedAt: Date.now()
    };

    this.recordApproval(turnId, approval);
    this.appendMessage({
      teamThreadId,
      role: 'system',
      content:
        `${userName} ${decision === 'APPROVED' ? 'approved' : 'rejected'} the pending action on ` +
        `${turn.userName}'s turn (policy: ${policy}).` + (note ? `\n${note}` : '')
    });

    const refusal = `Rejected by ${userName}.${note ? ` ${note}` : ''}`;

    if (decision === 'APPROVED') {
      this.lock.resumeFromApproval(teamThreadId, turnId);
      this.db()
        .prepare("UPDATE team_turn_queue SET status = 'PROCESSING' WHERE id = ?")
        .run(turnId);
      // Told before the queue state is announced: the agent is what the team is
      // waiting on, and it has been sitting on a half-executed tool call since
      // the prompt went out.
      this.signalApproval(thread, pending, true);
    } else {
      this.db()
        .prepare(
          `UPDATE team_turn_queue SET status = 'CANCELLED', completed_at = ?, error_message = ?
           WHERE id = ?`
        )
        .run(approval.resolvedAt, refusal, turnId);
      // The agent is told first, and told 'n': it is holding a tool call open,
      // and a refusal that only updates rows would leave it executing the very
      // action the team just refused.
      this.signalApproval(thread, pending, false);
      // Anything else this thread raised is dead with the turn. Without this a
      // second prompt from the same session would sit in `ApprovalManager`
      // until it timed out, holding a card on every member's screen for a turn
      // that no longer exists.
      this.cancelPendingApprovals(teamThreadId, refusal);
      // Released before the runner is told, so the member behind this one
      // starts immediately rather than waiting on an agent that is still
      // finishing an action nobody is going to accept.
      this.lock.releaseTurn(teamThreadId, turnId, { status: 'CANCELLED', errorMessage: refusal });
      this.rejections.get(turnId)?.(new TeamTurnRejectedError(refusal));
    }

    this.syncThreadState(teamThreadId);

    const after = this.lock.getQueueState(teamThreadId);
    const resolved = this.getTurn(turnId) ?? { ...turn, approval };

    this.announceApproval({
      teamThreadId,
      teamAgentId: agent.id,
      teamId: agent.teamId,
      workspaceId: agent.teamId,
      projectId: thread.projectId,
      turn: resolved,
      state: after.state,
      queuePosition: after.activeTurn?.id === turnId ? 0 : -1,
      queueLength: after.queuedTurns.length,
      approval
    });

    return { teamThreadId, turn: resolved, approval, state: after.state };
  }

  /** One queued turn, from the durable record. */
  public getTurn(turnId: string): TeamTurnQueueItem | null {
    const row = this.db().prepare('SELECT * FROM team_turn_queue WHERE id = ?').get(turnId) as
      | TeamTurnRow
      | undefined;
    return row ? rowToTurn(row) : null;
  }

  /** The live queue, from the lock — the authority while this process is up. */
  public getQueueState(teamThreadId: string): TeamTurnQueueState {
    return this.lock.getQueueState(teamThreadId);
  }

  /**
   * Every turn this thread has ever been asked for, newest first.
   *
   * The durable counterpart to `getQueueState`, which only knows about turns
   * that are still outstanding in this process.
   */
  public listTurnHistory(teamThreadId: string, limit = 200): TeamTurnQueueItem[] {
    const rows = this.db()
      .prepare(
        'SELECT * FROM team_turn_queue WHERE team_thread_id = ? ORDER BY queued_at DESC, rowid DESC LIMIT ?'
      )
      .all(teamThreadId, limit) as unknown as TeamTurnRow[];
    return rows.map(rowToTurn);
  }

  /**
   * Settles turns a previous run stopped on top of.
   *
   * No lock survives a restart, so a row still claiming `PROCESSING` describes a
   * turn that is definitively over — nothing is generating for it and nothing
   * ever will. Leaving it would show the whole team a thread that is busy
   * forever.
   */
  public recoverTurns(): number {
    const stale = this.db()
      .prepare("SELECT id FROM team_turn_queue WHERE status IN ('PROCESSING', 'AWAITING_APPROVAL')")
      .all() as unknown as Array<{ id: string }>;

    if (stale.length > 0) {
      this.db()
        .prepare(
          `UPDATE team_turn_queue SET status = 'FAILED', completed_at = ?, error_message = ?
           WHERE status IN ('PROCESSING', 'AWAITING_APPROVAL')`
        )
        .run(Date.now(), 'The Core restarted while this turn was being served.');
    }

    // A queued turn from a previous run has no runner either: nothing is
    // waiting on the lock for it, so it would sit at the head of a queue that
    // never advances.
    this.db()
      .prepare(
        `UPDATE team_turn_queue SET status = 'CANCELLED', completed_at = ?, error_message = ?
         WHERE status = 'QUEUED'`
      )
      .run(Date.now(), 'The Core restarted before this turn started.');

    this.db()
      .prepare("UPDATE team_threads SET status = 'IDLE', active_turn_user_id = NULL WHERE status != 'IDLE'")
      .run();

    return stale.length;
  }

  // --- Internals ---

  /**
   * Runs a bookkeeping write that must not be able to end a turn.
   *
   * Used only inside `runTurn`'s catch and finally, where the alternative to
   * swallowing is a rejected promise that skips `releaseTurn`.
   */
  private swallow(fn: () => unknown): void {
    try {
      fn();
    } catch (err) {
      console.error('[TeamAgentService] Turn bookkeeping failed:', (err as Error).message);
    }
  }

  private contextFor(thread: TeamThread, agent: TeamAgent): TurnLockThreadContext {
    return { teamAgentId: agent.id, teamId: agent.teamId, projectId: thread.projectId };
  }

  /** One turn, refused unless it belongs to the thread the caller named. */
  private requireTurnOnThread(teamThreadId: string, turnId: string): TeamTurnQueueItem {
    const turn = this.getTurn(turnId);
    if (!turn || turn.teamThreadId !== teamThreadId) {
      throw new TeamAgentError('TURN_NOT_FOUND', `Turn ${turnId} was not found on this thread.`);
    }
    return turn;
  }

  /**
   * Resolves when the turn finishes, or rejects the moment it is refused.
   *
   * `Promise.race` subscribes to both, so the executor's own rejection is never
   * unhandled even when the refusal wins.
   */
  private raceRejection<T>(turnId: string, running: Promise<T>): Promise<T> {
    const refused = new Promise<never>((_, reject) => {
      this.rejections.set(turnId, reject);
    });
    return Promise.race([running, refused]);
  }

  /** The standing team context for a thread's project, if it has either. */
  private memoryBriefFor(thread: TeamThread): string | undefined {
    if (!thread.projectId) return undefined;
    try {
      return composeTeamMemoryBrief(this.memory.load(thread.projectId));
    } catch (err) {
      // Memory is context, not a precondition. A project whose memory cannot be
      // read still gets its turn served, without it.
      console.error('[TeamAgentService] Could not read project memory:', (err as Error).message);
      return undefined;
    }
  }

  private recordApproval(turnId: string, approval: TeamTurnApprovalRecord): void {
    this.db()
      .prepare(
        `UPDATE team_turn_queue SET
           approval_decision = ?, approval_policy = ?, approval_resolved_by = ?,
           approval_resolved_by_name = ?, approval_comment = ?, approval_resolved_at = ?
         WHERE id = ?`
      )
      .run(
        approval.decision,
        approval.policy,
        approval.resolvedBy,
        approval.resolvedByName ?? null,
        approval.comment ?? null,
        approval.resolvedAt,
        turnId
      );
  }

  /**
   * Carries a team's decision back to the agent that is blocked on it.
   *
   * This is the other half of the interception, and without it the governance
   * built in P8-03 stops at the database: `ApprovalManager` is holding a promise
   * on `actionId`, `AgentService` is waiting to write `y` or `n` into the PTY,
   * and both of them listen for exactly one event. Publishing it here is what
   * turns "the row says APPROVED" into "the agent carried on".
   *
   * The thread id is the team thread's own, because a shared thread's session
   * runs under it — the same identity the prompt arrived with.
   *
   * Nothing is published for a turn parked without a known action: a manual
   * park has no pending promise, and a `client.approval_response` naming no
   * action would send a stray keystroke into whatever session was running.
   */
  private signalApproval(
    thread: TeamThread,
    pending: TeamPendingApprovalInfo | undefined,
    approved: boolean
  ): void {
    if (!pending?.actionId) return;
    try {
      this.bus.publish({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: 'server:team-agent',
        type: 'client.approval_response',
        payload: {
          actionId: pending.actionId,
          approved,
          threadId: thread.id,
          projectId: thread.projectId
        }
      });
    } catch (err) {
      console.error(
        '[TeamAgentService] Could not signal an approval decision to the agent:',
        (err as Error).message
      );
    }
  }

  /** Refuses whatever else this thread's session was waiting on. */
  private cancelPendingApprovals(teamThreadId: string, reason: string): void {
    try {
      this.approvals.cancelApprovalsForThread(teamThreadId, reason);
    } catch (err) {
      console.warn(
        '[TeamAgentService] Could not cancel the thread’s pending approvals:',
        (err as Error).message
      );
    }
  }

  /** Tells the room who decided. A dashboard that cannot be told is not fatal. */
  private announceApproval(payload: TeamTurnApprovalEventPayload): void {
    try {
      this.broadcast(TEAM_TURN_APPROVAL_EVENT, payload);
    } catch (err) {
      console.warn('[TeamAgentService] Could not announce an approval:', (err as Error).message);
    }
  }

  private markTurnStarted(turnId: string, startedAt: number): void {
    this.db()
      .prepare("UPDATE team_turn_queue SET status = 'PROCESSING', started_at = ? WHERE id = ?")
      .run(startedAt, turnId);
  }

  private markTurnFinished(turnId: string, status: TeamTurnStatus, errorMessage?: string): void {
    this.db()
      .prepare('UPDATE team_turn_queue SET status = ?, completed_at = ?, error_message = ? WHERE id = ?')
      .run(status, Date.now(), errorMessage ?? null, turnId);
  }

  private setThreadState(
    threadId: string,
    state: TeamThreadTurnState,
    activeUserId?: string
  ): void {
    this.db()
      .prepare('UPDATE team_threads SET status = ?, active_turn_user_id = ?, updated_at = ? WHERE id = ?')
      .run(state, activeUserId ?? null, Date.now(), threadId);
  }

  /** Rewrites the thread row from the lock, which is what actually knows. */
  private syncThreadState(threadId: string): void {
    this.setThreadState(
      threadId,
      this.lock.getTurnState(threadId),
      this.lock.getActiveUserId(threadId)
    );
  }
}

/** The Core's team agent service. */
export const teamAgentService = new TeamAgentService();
