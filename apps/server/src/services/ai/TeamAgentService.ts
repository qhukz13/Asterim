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
  CreateTeamAgentInput,
  TeamAgent,
  TeamAgentMessage,
  TeamAgentMessageRole,
  TeamThread,
  TeamThreadTurnState,
  TeamTurnQueueItem,
  TeamTurnQueueState,
  TeamTurnRequest,
  TeamTurnResult,
  TeamTurnStatus,
  UpdateTeamAgentInput
} from '@asterim/shared';
import { dbService } from '../DatabaseService';
import { EventBus, eventBus } from '../EventBus';
import { AgentTurnLock, TurnLockThreadContext, agentTurnLock } from './AgentTurnLock';

/** How a team agent failure reads to a caller that has to answer over HTTP. */
export type TeamAgentErrorCode =
  | 'INVALID_INPUT'
  | 'AGENT_NOT_FOUND'
  | 'THREAD_NOT_FOUND'
  | 'TURN_NOT_FOUND'
  | 'TURN_NOT_CANCELLABLE'
  | 'NO_PROJECT_BOUND';

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
    errorMessage: row.error_message ?? undefined
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

// --- Turn execution ---

/** What a turn is handed to, once it holds the lock. */
export interface TeamTurnExecutor {
  run(params: {
    agent: TeamAgent;
    thread: TeamThread;
    turn: TeamTurnQueueItem;
    timeoutMs: number;
  }): Promise<{ output: string; toolCalls?: unknown }>;
  /** Forgets whatever session state it holds for a thread that is going away. */
  reset?(threadId: string): void;
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

  constructor(private readonly bus: EventBus = eventBus) {}

  public async run(params: {
    agent: TeamAgent;
    thread: TeamThread;
    turn: TeamTurnQueueItem;
    timeoutMs: number;
  }): Promise<{ output: string; toolCalls?: unknown }> {
    const { agent, thread, turn, timeoutMs } = params;
    const projectId = thread.projectId;
    if (!projectId) {
      throw new TeamAgentError(
        'NO_PROJECT_BOUND',
        `Team thread ${thread.id} is not bound to a project, so there is no checkout to run against.`
      );
    }

    // Armed before the session is asked for anything, so output that arrives
    // between the send and the subscribe cannot be missed.
    const watching = this.watch(thread.id, timeoutMs);

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

  /** Resolves when the session has answered, failed, or run out of time. */
  private watch(
    threadId: string,
    timeoutMs: number
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

      // Deliberately not unref'd: this timer is the only thing that will ever
      // release the lock if the agent goes quiet, and a lock nobody releases is
      // a shared thread that never moves again.
      const timer = setTimeout(
        () => finish(`The shared agent did not answer within ${Math.round(timeoutMs / 1000)}s.`),
        timeoutMs
      );

      this.bus.subscribe('chat.message', onChat);
      this.bus.subscribe('agent.status', onStatus);
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

  constructor(options?: {
    lock?: AgentTurnLock;
    executor?: TeamTurnExecutor;
    turnTimeoutMs?: number;
  }) {
    this.lock = options?.lock ?? agentTurnLock;
    this.executor = options?.executor ?? new EventBusTeamTurnExecutor();
    this.turnTimeoutMs = options?.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS;
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
      createdBy,
      createdAt: now,
      updatedAt: now
    };

    this.db()
      .prepare(
        `INSERT INTO team_agents (
           id, team_id, name, role, description, system_prompt, model, temperature,
           enabled_mcp_servers, enabled_skills, created_by, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
      updatedAt: Date.now()
    };

    this.db()
      .prepare(
        `UPDATE team_agents SET
           name = ?, role = ?, description = ?, system_prompt = ?, model = ?, temperature = ?,
           enabled_mcp_servers = ?, enabled_skills = ?, updated_at = ?
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
  }): TeamThread {
    const agent = this.requireTeamAgent(
      requireText(input?.teamAgentId, 'teamAgentId', MAX_TEAM_NAME_CHARS)
    );
    const title = optionalText(input?.title, 'title', MAX_TEAM_NAME_CHARS) ?? `${agent.name} thread`;
    const projectId = optionalText(input?.projectId, 'projectId', MAX_TEAM_NAME_CHARS);

    const now = Date.now();
    const thread: TeamThread = {
      id: `tthread_${crypto.randomUUID()}`,
      teamAgentId: agent.id,
      projectId,
      title,
      status: 'IDLE',
      createdAt: now,
      updatedAt: now
    };

    this.db()
      .prepare(
        `INSERT INTO team_threads (
           id, team_agent_id, project_id, title, status, active_turn_user_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
      )
      .run(
        thread.id,
        thread.teamAgentId,
        thread.projectId ?? null,
        thread.title,
        thread.status,
        thread.createdAt,
        thread.updatedAt
      );

    return thread;
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

      const result = await this.executor.run({
        agent,
        // Re-read, so a turn that was queued before the thread was bound to a
        // project runs against the binding it has when its turn comes.
        thread: this.getTeamThread(thread.id) ?? thread,
        turn,
        timeoutMs: this.turnTimeoutMs
      });
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
      status = 'FAILED';
      errorMessage = (err as Error).message || 'The shared agent turn failed.';
      // The failure belongs in the shared transcript too: the next member to
      // open the thread has to be able to see why their colleague's request
      // produced nothing, without reading the server log.
      this.swallow(() =>
        this.appendMessage({
          teamThreadId: thread.id,
          role: 'system',
          content: `Turn failed: ${errorMessage}`
        })
      );
    } finally {
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

    const existing = this.getTurn(turnId);
    if (!existing || existing.teamThreadId !== teamThreadId) {
      throw new TeamAgentError('TURN_NOT_FOUND', `Turn ${turnId} was not found on this thread.`);
    }

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
