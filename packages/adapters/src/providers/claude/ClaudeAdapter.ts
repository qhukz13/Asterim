import { spawn, execSync, ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import { BaseAdapter } from '../../sdk/BaseAdapter';
import { AdapterCapabilities, LaunchConfig, IParser, NativePermissionAsk } from '../../sdk/types';
import { sanitizeAgentEnv } from '../../sdk/ProcessManager';
import { AsterimEvent } from '@asterim/shared';

/**
 * Claude Code adapter.
 *
 * Runs `claude` in its headless, long-lived mode:
 *
 *     claude -p --input-format stream-json --output-format stream-json --verbose
 *
 * Every user message is one JSON line on stdin; every model message, tool call,
 * tool result and turn result is one JSON line on stdout. Nothing is scraped
 * from a terminal, so there is no screen state to guess at.
 *
 * Permissions are not guessed either. With stream-json on stdin the CLI treats
 * the process on the other end as its host and, whenever a tool call needs a
 * decision that its own rules do not already make, writes a control request
 * (`subtype: "can_use_tool"`) to stdout and waits. This adapter hands that
 * request to the Core through `LaunchConfig.permissionResolver`, the Core shows
 * the approval card it has always shown, and the answer goes back on stdin as
 * a control response. That is the same protocol the Claude Agent SDK speaks;
 * the shapes are documented in `@anthropic-ai/claude-agent-sdk`'s `sdk.d.ts`
 * (`SDKControlPermissionRequest`, `ControlResponse`, `PermissionResult`).
 *
 * What this adapter deliberately does not do:
 *  - it never passes `--dangerously-skip-permissions`;
 *  - it does not use the PTY tool-call text protocol (`ASTERIM_TOOL_CALL`),
 *    because Claude Code speaks MCP natively and can be given servers directly;
 *  - it does not implement `AskUserQuestion` (the tool is disallowed, so Claude
 *    asks in prose and the person answers in chat).
 */

/** How the CLI should be launched on this machine. */
export interface ClaudeLaunch {
  cmd: string;
  /** Arguments that must precede the CLI's own (a JS entry point, for example). */
  prefixArgs: string[];
  /** What was found, for logs and the settings screen. */
  binary: string;
}

/**
 * Finds a way to run Claude Code.
 *
 * Order: `ASTERIM_CLAUDE_BIN`, the native install location, then whatever
 * `PATH` resolves. An npm `.cmd` shim on Windows is not spawned through
 * `cmd.exe` (its quoting rules would mangle JSON arguments); the shim's JS entry
 * is run with the current Node binary instead.
 */
export function resolveClaudeLaunch(): ClaudeLaunch | null {
  const isWin = process.platform === 'win32';
  const candidates: string[] = [];

  if (process.env.ASTERIM_CLAUDE_BIN) candidates.push(process.env.ASTERIM_CLAUDE_BIN);
  candidates.push(path.join(os.homedir(), '.local', 'bin', isWin ? 'claude.exe' : 'claude'));

  try {
    const out = execSync(isWin ? 'where claude' : 'which claude', { stdio: 'pipe' })
      .toString()
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    candidates.push(...out);
  } catch {
    // Not on PATH; the fixed locations above may still hit.
  }

  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    const lower = candidate.toLowerCase();
    if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
      const entry = path.join(
        path.dirname(candidate),
        'node_modules',
        '@anthropic-ai',
        'claude-code',
        'cli.js'
      );
      if (fs.existsSync(entry)) {
        return { cmd: process.execPath, prefixArgs: [entry], binary: entry };
      }
      continue;
    }
    return { cmd: candidate, prefixArgs: [], binary: candidate };
  }
  return null;
}

/** Tool results longer than this are cut in the transcript. */
const MAX_RESULT_CHARS = 8000;

/** What one Claude Code stream line may look like. Only the fields read here. */
interface StreamLine {
  type?: string;
  subtype?: string;
  session_id?: string;
  model?: string;
  tools?: string[];
  request_id?: string;
  request?: {
    subtype?: string;
    tool_name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    description?: string;
    decision_reason?: string;
    title?: string;
  };
  response?: { subtype?: string; request_id?: string; error?: string };
  event?: {
    type?: string;
    index?: number;
    delta?: { type?: string; text?: string };
  };
  message?: {
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
      id?: string;
      name?: string;
      input?: Record<string, unknown>;
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    }>;
  };
  parent_tool_use_id?: string | null;
  is_error?: boolean;
  result?: string;
  errors?: unknown;
  duration_ms?: number;
  total_cost_usd?: number;
  num_turns?: number;
  permission_denials?: unknown[];
  error?: string;
  attempt?: number;
  max_retries?: number;
  tool_name?: string;
}

class NoopParser implements IParser {
  public processOutput(): void {
    // Output is consumed as JSON lines by the adapter itself.
  }
}

export class ClaudeAdapter extends BaseAdapter {
  public readonly id = 'claude';
  public readonly handlesApprovalsNatively = true;

  public readonly capabilities: AdapterCapabilities = {
    supportsDiff: true,
    supportsTerminal: false,
    supportsInterrupt: false,
    supportsResume: true,
    supportsVision: true,
    supportsApproval: true,
    supportsNotifications: false,
    supportsContextFiles: true,
    supportsMultiSession: true,
    supportsRemoteExecution: false,
    supportsStreaming: true
  };

  private child: ChildProcess | null = null;
  private stdoutBuffer = '';
  private stopping = false;
  private ready = false;
  private busy = false;
  private pendingMessages: string[] = [];
  private providerSessionId: string | null = null;
  private permissionResolver: LaunchConfig['permissionResolver'];
  /** Permission requests waiting on a human, by the CLI's request id. */
  private pendingAsks = new Map<string, AbortController>();

  /** Text of the assistant message currently streaming. */
  private streamingText = '';
  private streamingMessageId: string | null = null;
  /** tool_use id → tool name, so a result can be labelled. */
  private toolNames = new Map<string, string>();
  private turnStartedAt = 0;

  public getLaunchCommand(config: LaunchConfig): { cmd: string; args: string[]; env?: Record<string, string> } {
    const launch = resolveClaudeLaunch();
    if (!launch) {
      throw new Error(
        "Claude Code is not installed or not on PATH. Install it with `npm install -g @anthropic-ai/claude-code` (or `claude install`), or set ASTERIM_CLAUDE_BIN."
      );
    }

    const args = [
      ...launch.prefixArgs,
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--permission-mode',
      'default',
      // Clarifying questions arrive as a permission request the host cannot
      // answer with content, so the tool is removed and Claude asks in prose.
      '--disallowedTools',
      'AskUserQuestion'
    ];

    // This is the switch that makes the CLI ask the host instead of denying:
    // permission prompts become `can_use_tool` control requests on stdout
    // (the same thing the Agent SDK passes when it has a canUseTool handler).
    if (config.permissionResolver) {
      args.push('--permission-prompt-tool', 'stdio');
    }

    // Claude Code lets a `PreToolUse` hook or a permission rule in the user's
    // own settings decide before the host is asked, and withdraws the ask when
    // one does. That is respected by default: the person configured those
    // hooks. Setting this makes Asterim's card the only decider for sessions
    // it runs, at the cost of every other hook the user has installed.
    if (process.env.ASTERIM_CLAUDE_DISABLE_HOOKS === 'true') {
      args.push('--settings', JSON.stringify({ disableAllHooks: true }));
    }

    if (config.resumeSessionId) {
      args.push('--resume', config.resumeSessionId);
    }
    if (config.systemPromptAppendix && config.systemPromptAppendix.trim()) {
      args.push('--append-system-prompt', config.systemPromptAppendix.trim());
    }

    return { cmd: launch.cmd, args, env: {} };
  }

  public createParser(): IParser {
    return new NoopParser();
  }

  public async start(config: LaunchConfig & { onExit?: (code: number) => void }): Promise<void> {
    this.parser = this.createParser();
    this.permissionResolver = config.permissionResolver;
    const launch = this.getLaunchCommand(config);

    this.emitStatus('startup', 'Starting Claude Code…');

    const env: NodeJS.ProcessEnv = {
      ...sanitizeAgentEnv(process.env),
      ...config.env,
      ...launch.env
    };

    const child = spawn(launch.cmd, launch.args, {
      cwd: config.workspace,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    this.child = child;

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.feedStdout(chunk));

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      const text = chunk.trim();
      if (!text) return;
      this.emitLog('warn', text);
    });

    child.on('error', err => {
      this.emitStatus('error', `Could not start Claude Code: ${err.message}`);
    });

    // The CLI announces itself (`system/init`) only when the first turn
    // starts, so readiness cannot wait for that line: a spawned process with a
    // writable stdin is ready to take a message. The host introduces itself
    // first, which is what makes the CLI route permission prompts here.
    if (child.pid) {
      this.writeRaw(
        JSON.stringify({
          type: 'control_request',
          request_id: randomUUID(),
          request: { subtype: 'initialize' }
        })
      );
      this.ready = true;
      this.emitStatus('idle', 'Claude Code started');
      const queued = this.pendingMessages.splice(0);
      for (const text of queued) this.writeUserMessage(text);
    }

    child.on('exit', (code, signal) => {
      const exitCode = code ?? (signal ? 1 : 0);
      if (!this.stopping) {
        if (exitCode !== 0) {
          this.emitStatus('error', `Claude Code exited with code ${exitCode}.`);
        } else {
          this.emitStatus('idle', 'Claude Code session ended.');
        }
      }
      this.child = null;
      config.onExit?.(exitCode);
    });
  }

  public async stop(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    try {
      child.stdin?.end();
    } catch {
      // Already closed.
    }
    const killTimer = setTimeout(() => {
      try {
        child.kill(process.platform === 'win32' ? undefined : 'SIGTERM');
      } catch {
        // Gone already.
      }
    }, 1500);
    killTimer.unref?.();
  }

  /**
   * One user turn.
   *
   * Written immediately when the process is up, queued until then. Claude Code
   * processes queued stdin messages in order, so a second message during a
   * turn is a follow-up, not an interruption.
   */
  public async sendCommand(command: string): Promise<void> {
    const text = command.replace(/\r?\n$/, '');
    if (!text.trim()) return;

    // Dashboard control words the PTY adapters interpret. Not conversation.
    if (text.trim() === '/clear') return;

    if (!this.ready) {
      this.pendingMessages.push(text);
      return;
    }
    this.writeUserMessage(text);
  }

  public writeStdin(data: string): void {
    this.child?.stdin?.write(data);
  }

  public getPid(): number | undefined {
    return this.child?.pid ?? undefined;
  }

  /** One line to the CLI's stdin. Overridden in tests to capture the protocol. */
  protected writeRaw(line: string): boolean {
    if (!this.child?.stdin?.writable) return false;
    this.child.stdin.write(line + '\n');
    return true;
  }

  private writeUserMessage(text: string): void {
    const line = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text }] },
      parent_tool_use_id: null
    });
    if (!this.writeRaw(line)) {
      this.emitStatus('error', 'Claude Code is not running. Start the agent again.');
      return;
    }
    this.busy = true;
    this.turnStartedAt = Date.now();
    this.streamingText = '';
    this.streamingMessageId = null;
    this.emitStatus('working', 'Working…');
  }

  /**
   * Consumes raw stdout. Public so the stream protocol can be exercised in a
   * test without a Claude Code process: feed the same JSON lines the CLI
   * writes and assert the events that come out.
   */
  public feedStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newline: number;
    while ((newline = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let parsed: StreamLine;
      try {
        parsed = JSON.parse(line);
      } catch {
        // Not JSON: a startup warning or a stray print. Keep it visible.
        this.emitLog('info', line);
        continue;
      }
      try {
        this.handleLine(parsed);
      } catch (err) {
        this.emitLog('warn', `Could not process a Claude Code event: ${(err as Error).message}`);
      }
    }
  }

  private handleLine(msg: StreamLine): void {
    switch (msg.type) {
      case 'system':
        this.handleSystem(msg);
        return;
      case 'stream_event':
        this.handleStreamEvent(msg);
        return;
      case 'assistant':
        this.handleAssistant(msg);
        return;
      case 'user':
        this.handleUser(msg);
        return;
      case 'result':
        this.handleResult(msg);
        return;
      case 'control_request':
        void this.handleControlRequest(msg);
        return;
      case 'control_cancel_request':
        this.handleControlCancel(msg);
        return;
      case 'control_response':
        // Acknowledgement of our own `initialize`; nothing to do with it.
        if (msg.response?.subtype === 'error' && msg.response.error) {
          this.emitLog('warn', `Claude Code refused a control request: ${msg.response.error}`);
        }
        return;
      default:
        return;
    }
  }

  /**
   * A request from the CLI that the host must answer.
   *
   * `can_use_tool` is the permission prompt. Anything else the CLI may ask a
   * richer host (dialogs, elicitations, hook callbacks) is refused with an
   * error response so the CLI does not wait on an answer that will never come.
   */
  private async handleControlRequest(msg: StreamLine): Promise<void> {
    const requestId = msg.request_id;
    const request = msg.request;
    if (!requestId || !request) return;

    if (request.subtype !== 'can_use_tool') {
      this.writeRaw(
        JSON.stringify({
          type: 'control_response',
          response: {
            subtype: 'error',
            request_id: requestId,
            error: `Asterim does not handle '${request.subtype ?? 'unknown'}' requests.`
          }
        })
      );
      return;
    }

    const controller = new AbortController();
    this.pendingAsks.set(requestId, controller);
    const ask: NativePermissionAsk = {
      toolName: request.tool_name ?? 'tool',
      input: request.input ?? {},
      toolUseId: request.tool_use_id,
      description: request.description ?? request.title,
      reason: request.decision_reason,
      signal: controller.signal
    };

    let approved = false;
    let message = 'No one is available to approve this action.';
    try {
      if (this.permissionResolver) {
        const decision = await this.permissionResolver(ask);
        approved = decision.approved;
        if (decision.message) message = decision.message;
      }
    } catch (err) {
      this.emitLog('warn', `Permission request failed: ${(err as Error).message}`);
    } finally {
      this.pendingAsks.delete(requestId);
    }

    // The CLI withdrew the request while the human was looking at it. It no
    // longer wants an answer and would ignore one; sending it would only
    // confuse a reader of the transcript.
    if (controller.signal.aborted) return;

    // `updatedInput` echoes the input unchanged: older CLIs rejected an allow
    // that omitted it, and there is nothing to rewrite.
    const result = approved
      ? { behavior: 'allow', updatedInput: ask.input }
      : { behavior: 'deny', message };

    this.writeRaw(
      JSON.stringify({
        type: 'control_response',
        response: { subtype: 'success', request_id: requestId, response: result }
      })
    );
  }

  /**
   * The CLI no longer needs the answer to one of its requests.
   *
   * Happens when something else decided first: a `PreToolUse` hook that
   * allowed the call, a permission rule, or the turn being interrupted. The
   * person must be told, because from their side the card simply vanished
   * and the action ran without them.
   */
  private handleControlCancel(msg: StreamLine): void {
    const requestId = msg.request_id;
    if (!requestId) return;
    const controller = this.pendingAsks.get(requestId);
    if (!controller) return;
    controller.abort();
    this.emitLog(
      'warn',
      'Claude Code decided a permission request itself before you answered (a hook or a permission rule in its settings allowed it). The approval card was withdrawn.'
    );
  }

  private handleSystem(msg: StreamLine): void {
    if (msg.subtype === 'init') {
      this.providerSessionId = msg.session_id ?? null;
      this.eventBus.publish({
        id: randomUUID(),
        timestamp: Date.now(),
        source: 'adapter:claude',
        type: 'agent.session',
        payload: {
          provider: 'claude',
          providerSessionId: this.providerSessionId,
          model: msg.model ?? null,
          tools: msg.tools ?? []
        }
      });
      // A turn is in flight when init arrives (it is what triggered it), so
      // the status stays `working`; the model name goes to the log instead.
      if (msg.model) this.emitLog('info', `Model: ${msg.model}`);
      if (!this.busy) this.emitStatus('idle', 'Ready');
      return;
    }
    if (msg.subtype === 'api_retry') {
      this.emitLog('warn', `API retry ${msg.attempt ?? '?'}/${msg.max_retries ?? '?'} (${msg.error ?? 'unknown'})`);
      return;
    }
    if (msg.subtype === 'permission_denied') {
      this.emitLog('warn', `Permission denied for ${msg.tool_name ?? 'a tool'}.`);
    }
  }

  private handleStreamEvent(msg: StreamLine): void {
    const event = msg.event;
    if (!event) return;
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      if (!this.streamingMessageId) this.streamingMessageId = randomUUID();
      this.streamingText += event.delta.text ?? '';
      this.eventBus.publish({
        id: this.streamingMessageId,
        timestamp: Date.now(),
        source: 'adapter:claude',
        type: 'agent.stream',
        payload: { role: 'agent', content: this.streamingText }
      });
    }
  }

  private handleAssistant(msg: StreamLine): void {
    // Subagent traffic carries a parent id; the transcript shows the main
    // conversation and summarises the rest as tool calls.
    if (msg.parent_tool_use_id) return;
    const blocks = msg.message?.content ?? [];
    let text = '';
    for (const block of blocks) {
      if (block.type === 'text' && block.text) {
        text += (text ? '\n\n' : '') + block.text;
      } else if (block.type === 'tool_use' && block.name) {
        if (block.id) this.toolNames.set(block.id, block.name);
        this.eventBus.publish({
          id: randomUUID(),
          timestamp: Date.now(),
          source: 'adapter:claude',
          type: 'agent.tool_call',
          payload: { tool: block.name, arguments: block.input ?? {}, toolUseId: block.id ?? null }
        });
        this.emitLog('info', describeToolCall(block.name, block.input ?? {}));
      }
    }
    if (text.trim()) {
      this.eventBus.publish({
        id: this.streamingMessageId ?? randomUUID(),
        timestamp: Date.now(),
        source: 'adapter:claude',
        type: 'chat.message',
        payload: { role: 'agent', content: text }
      });
    }
    this.streamingText = '';
    this.streamingMessageId = null;
  }

  private handleUser(msg: StreamLine): void {
    if (msg.parent_tool_use_id) return;
    const blocks = msg.message?.content ?? [];
    for (const block of blocks) {
      if (block.type !== 'tool_result') continue;
      const tool = (block.tool_use_id && this.toolNames.get(block.tool_use_id)) || 'tool';
      const text = truncate(stringifyResult(block.content), MAX_RESULT_CHARS);
      this.eventBus.publish({
        id: randomUUID(),
        timestamp: Date.now(),
        source: 'adapter:claude',
        type: 'agent.tool_result',
        payload: { tool, isError: Boolean(block.is_error), text }
      });
    }
  }

  private handleResult(msg: StreamLine): void {
    this.busy = false;
    const seconds = this.turnStartedAt ? Math.round((Date.now() - this.turnStartedAt) / 1000) : null;
    const cost = typeof msg.total_cost_usd === 'number' ? `$${msg.total_cost_usd.toFixed(3)}` : null;
    const summary = [seconds !== null ? `${seconds}s` : null, cost].filter(Boolean).join(' · ');

    if (msg.is_error) {
      const detail = typeof msg.result === 'string' && msg.result ? msg.result : msg.subtype || 'unknown error';
      this.emitStatus('error', `Turn failed: ${detail}`);
      return;
    }
    if (Array.isArray(msg.permission_denials) && msg.permission_denials.length > 0) {
      this.emitLog('warn', `${msg.permission_denials.length} action(s) were denied during this turn.`);
    }
    this.emitStatus('idle', summary ? `Done · ${summary}` : 'Done');
  }

  private emitStatus(
    status: 'idle' | 'working' | 'waiting_approval' | 'waiting_question' | 'error' | 'startup',
    message: string
  ): void {
    this.eventBus.publish({
      id: randomUUID(),
      timestamp: Date.now(),
      source: 'adapter:claude',
      type: 'agent.status',
      payload: { status, message }
    });
  }

  private emitLog(level: 'info' | 'warn' | 'error', message: string): void {
    this.eventBus.publish({
      id: randomUUID(),
      timestamp: Date.now(),
      source: 'adapter:claude',
      type: 'agent.log',
      payload: { level, message }
    });
  }
}

/** One line a person can read in the log for a tool call. */
export function describeToolCall(name: string, input: Record<string, unknown>): string {
  const str = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '');
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return `${name}: ${str('command')}`.trim();
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'Read':
    case 'NotebookEdit':
      return `${name}: ${str('file_path')}`.trim();
    case 'Glob':
    case 'Grep':
      return `${name}: ${str('pattern')}`.trim();
    case 'WebFetch':
      return `${name}: ${str('url')}`.trim();
    default: {
      let serialised: string;
      try {
        serialised = JSON.stringify(input);
      } catch {
        serialised = '';
      }
      return `${name}${serialised ? ` ${truncate(serialised, 200)}` : ''}`;
    }
  }
}

function stringifyResult(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        try {
          return JSON.stringify(part);
        } catch {
          return '';
        }
      })
      .join('\n');
  }
  if (content === undefined || content === null) return '';
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… truncated ${text.length - max} characters.`;
}
