import {
  AsterimEvent,
  AgentToolCallRequest,
  AgentToolDescriptor,
  formatAgentToolResponse,
  parseAgentToolCall
} from '@asterim/shared';
import { IAgentProvider, LaunchConfig, IParser, AdapterCapabilities } from './types';
import { ProcessManager } from './ProcessManager';
import { SessionEventBus } from './EventBus';

/**
 * The answer an adapter expects back from whoever runs its tools.
 *
 * Structural, not the Core's `AgentToolResult`: `packages/adapters` must not
 * depend on `apps/server`, and all the adapter needs is something to write back
 * and a flag saying whether it went wrong.
 */
export interface AdapterToolResult {
  isError: boolean;
  text: string;
  content?: unknown;
}

/** Runs one tool call on the agent's behalf. Must not throw. */
export type AgentToolExecutor = (
  toolName: string,
  args: Record<string, unknown>
) => Promise<AdapterToolResult>;

/**
 * How much of a tool's output is fed back into the agent's stream.
 *
 * A tool that returns a megabyte of JSON would otherwise be written one
 * character at a time into a PTY, where it is both useless to the model and
 * slow enough to look like a hang.
 */
export const MAX_TOOL_RESULT_CHARS = 8000;

/** Ceiling on the scan buffer, so a stream without newlines cannot grow forever. */
const MAX_SCAN_BUFFER_CHARS = 65536;

/** What is kept when the scan buffer is trimmed — enough to hold one call line. */
const SCAN_BUFFER_KEEP_CHARS = 8192;

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\x1b\[[0-9;?]*[\x20-\x2f]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|[\x00-\x08\x0b\x0c\x0e-\x1f]/g;

/** Removes the escape sequences a PTY interleaves with the text. */
function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

export abstract class BaseAdapter implements IAgentProvider {
  public abstract readonly id: string;
  public abstract readonly capabilities: AdapterCapabilities;

  protected processManager: ProcessManager;
  protected eventBus: SessionEventBus;
  protected parser!: IParser;

  private sessionId: string;
  private commandQueue: string[] = [];
  private isBusy: boolean = true; // start as busy until initialized

  /** Set by the Core when a session begins; absent means tools are off. */
  private toolExecutor: AgentToolExecutor | null = null;
  private availableTools: AgentToolDescriptor[] = [];
  /** Partial line left over from the last chunk of output. */
  private toolScanBuffer = '';
  /** Calls currently running, keyed by tool+arguments, to survive PTY echo. */
  private inFlightToolCalls = new Set<string>();

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.processManager = new ProcessManager();
    this.eventBus = new SessionEventBus(sessionId);
  }

  public getSessionId(): string {
    return this.sessionId;
  }

  public getEventBus(): SessionEventBus {
    return this.eventBus;
  }

  public abstract getLaunchCommand(config: LaunchConfig): { cmd: string; args: string[]; env?: Record<string, string> };
  public abstract createParser(onEvent: (event: AsterimEvent) => void): IParser;

  /**
   * Hands the adapter something that can run tools.
   *
   * Until this is called the adapter ignores tool-call lines entirely, which is
   * what should happen: an agent asking for a tool that nothing can run is
   * better left with no answer than with a promise Asterim cannot keep.
   */
  public registerToolExecutor(executor: AgentToolExecutor | null): void {
    this.toolExecutor = executor;
  }

  public hasToolExecutor(): boolean {
    return this.toolExecutor !== null;
  }

  /** The tools this session was told about, for prompts and startup payloads. */
  public setAvailableTools(tools: AgentToolDescriptor[]): void {
    this.availableTools = tools;
  }

  public getAvailableTools(): AgentToolDescriptor[] {
    return this.availableTools;
  }

  public async start(config: LaunchConfig & { onExit?: (code: number) => void }): Promise<void> {
    this.parser = this.createParser((event: AsterimEvent) => {
      // Intercept state changes to manage internal queue
      if (event.type === 'agent.status' && event.payload) {
        if (event.payload.status === 'idle' || event.payload.status === 'waiting_approval' || event.payload.status === 'waiting_question') {
          this.isBusy = false;
          this.flushQueue();
        } else if (event.payload.status === 'working') {
          this.isBusy = true;
        }
      }
      this.eventBus.publish(event);
    });

    const launchParams = this.getLaunchCommand(config);

    await this.processManager.start({
      cmd: launchParams.cmd,
      args: launchParams.args,
      cwd: config.workspace,
      env: launchParams.env,
      onData: (data) => {
        // Scanned before parsing, and independently of it: a provider parser is
        // free to be a stub, and tool calls must still be answered.
        this.scanForToolCalls(data);
        this.parser.processOutput(data);
      },
      onExit: (exitCode) => {
        if (config.onExit) {
          config.onExit(exitCode);
        }
      }
    });

    // An agent driven over a PTY has no tool API to register with, so the
    // catalogue reaches it as text, like everything else. Queued rather than
    // written: the queue only drains once the parser reports the agent idle,
    // which is the first moment it is able to read, and FIFO puts this ahead of
    // the user's first prompt. Skipped when nothing can run a tool, so an agent
    // is never taught a convention Asterim would not answer.
    const instructions = config.mcpToolInstructions?.trim();
    if (instructions && this.toolExecutor) {
      await this.sendCommand(instructions);
    }
  }

  public async stop(): Promise<void> {
    this.processManager.kill();
  }

  public async sendCommand(command: string): Promise<void> {
    const isApprovalOrInput = command === 'y' || command === 'n' || command.trim() === 'y' || command.trim() === 'n';
    if (this.isBusy && !isApprovalOrInput) {
      this.commandQueue.push(command);
    } else {
      this.isBusy = true;
      this.processManager.write(command + '\r\n');
    }
  }

  public writeStdin(data: string): void {
    this.processManager.write(data);
  }

  public getPid(): number | undefined {
    return this.processManager.getPid();
  }

  private flushQueue() {
    if (this.commandQueue.length > 0) {
      const nextCmd = this.commandQueue.shift();
      if (nextCmd) {
        this.isBusy = true;
        this.processManager.write(nextCmd + '\r\n');
      }
    }
  }

  /**
   * Watches the output stream for tool-call lines.
   *
   * The stream arrives in arbitrary chunks, so lines are reassembled here; a
   * partial line waits for the rest rather than being parsed as a broken call.
   */
  private scanForToolCalls(chunk: string): void {
    if (!this.toolExecutor || !chunk) return;

    this.toolScanBuffer += chunk;

    if (this.toolScanBuffer.length > MAX_SCAN_BUFFER_CHARS) {
      // Output without a newline in 64 KB is not a tool call. Keep the tail so
      // a call arriving immediately after it is still seen whole.
      this.toolScanBuffer = this.toolScanBuffer.slice(-SCAN_BUFFER_KEEP_CHARS);
    }

    let newlineIndex: number;
    while ((newlineIndex = this.toolScanBuffer.indexOf('\n')) !== -1) {
      const line = this.toolScanBuffer.slice(0, newlineIndex);
      this.toolScanBuffer = this.toolScanBuffer.slice(newlineIndex + 1);

      const call = parseAgentToolCall(stripAnsi(line).replace(/\r$/, ''));
      if (call) {
        void this.runToolCall(call);
      }
    }
  }

  /**
   * Runs one intercepted call and writes the answer back to the agent.
   *
   * Every failure path ends in a result line: an executor that rejects, a tool
   * that errors, a server that has gone away. The agent is mid-turn waiting for
   * an answer, and leaving it without one strands the session (P6-05 §6).
   */
  private async runToolCall(call: AgentToolCallRequest): Promise<void> {
    const key = `${call.tool}:${JSON.stringify(call.arguments)}`;
    if (this.inFlightToolCalls.has(key)) {
      // A PTY echoes what it is given; the same call seen twice while the first
      // is still running is that echo, not a second request.
      return;
    }
    this.inFlightToolCalls.add(key);

    this.eventBus.publish({
      id: `tool-call-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      source: `adapter:${this.id}`,
      type: 'agent.tool_call',
      payload: { tool: call.tool, arguments: call.arguments }
    });

    let result: AdapterToolResult;
    try {
      result = await this.toolExecutor!(call.tool, call.arguments);
    } catch (err) {
      result = {
        isError: true,
        text: `The tool '${call.tool}' could not be run: ${(err as Error)?.message || String(err)}`
      };
    } finally {
      this.inFlightToolCalls.delete(key);
    }

    const text = truncateResult(result?.text ?? '');

    this.eventBus.publish({
      id: `tool-result-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      source: `adapter:${this.id}`,
      type: 'agent.tool_result',
      payload: { tool: call.tool, isError: result?.isError ?? true, text }
    });

    try {
      this.processManager.write(
        formatAgentToolResponse({
          tool: call.tool,
          isError: result?.isError ?? true,
          text
        }) + '\r\n'
      );
    } catch (err) {
      // The process has gone. Nothing left to answer, and nothing worth
      // throwing into a fire-and-forget path.
      console.warn(
        `[Adapter] Could not deliver the result of '${call.tool}': ${(err as Error).message}`
      );
    }
  }
}

/** Keeps a result small enough to be worth writing into a terminal. */
function truncateResult(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}\n… truncated: ${text.length - MAX_TOOL_RESULT_CHARS} more characters.`;
}
