import { spawn, ChildProcess } from 'child_process';
import { IAgentAdapter, AgentConfig, AgentDeckEvent } from '@agentdeck/shared';
import crypto from 'crypto';

export class ClaudeAdapter implements IAgentAdapter {
  private process: ChildProcess | null = null;
  private eventCallback?: (event: AgentDeckEvent) => void;

  public async start(config: AgentConfig): Promise<void> {
    if (this.process) {
      throw new Error('Claude Code is already running');
    }

    const binPath = config.binaryPath || 'claude';
    const args: string[] = [];

    this.process = spawn(binPath, args, {
      cwd: config.workspace,
      env: { ...process.env, FORCE_COLOR: '1' }
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.emitLog('info', data.toString());
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      this.emitLog('error', data.toString());
    });

    this.process.on('close', (code: number | null) => {
      this.emitStatus('idle', `Claude Code exited with code ${code}`);
      this.process = null;
    });

    this.emitStatus('working', 'Claude Code started');
  }

  public async stop(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGINT');
      this.process = null;
      this.emitStatus('idle', 'Claude Code stopped');
    }
  }

  public async sendCommand(command: string): Promise<void> {
    if (this.process && this.process.stdin) {
      this.process.stdin.write(`${command}\n`);
    } else {
      throw new Error('Claude Code process is not running');
    }
  }

  public onEvent(callback: (event: AgentDeckEvent) => void): void {
    this.eventCallback = callback;
  }

  private emitLog(level: 'info' | 'warn' | 'error' | 'debug', message: string) {
    if (!this.eventCallback) return;
    this.eventCallback({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'adapter:claude',
      type: 'agent.log',
      payload: { level, message }
    });
  }

  private emitStatus(status: 'idle' | 'working' | 'waiting_approval' | 'error', message: string) {
    if (!this.eventCallback) return;
    this.eventCallback({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'adapter:claude',
      type: 'agent.status',
      payload: { status, message }
    });
  }
}
