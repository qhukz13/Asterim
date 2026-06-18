import { spawn, ChildProcess } from 'child_process';
import { IAgentAdapter, AgentConfig, AgentDeckEvent } from '@agentdeck/shared';
import crypto from 'crypto';

export class AiderAdapter implements IAgentAdapter {
  private process: ChildProcess | null = null;
  private eventCallback?: (event: AgentDeckEvent) => void;

  public async start(config: AgentConfig): Promise<void> {
    if (this.process) {
      throw new Error('Aider is already running');
    }

    const binPath = config.binaryPath || 'aider';
    const args = ['--no-auto-commits']; // Prevent auto commits for safer testing

    this.process = spawn(binPath, args, {
      cwd: config.workspace,
      env: { ...process.env, FORCE_COLOR: '1' } // Force color output for the dashboard
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      this.emitLog('info', data.toString());
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      this.emitLog('error', data.toString());
    });

    this.process.on('close', (code: number | null) => {
      this.emitStatus('idle', `Aider exited with code ${code}`);
      this.process = null;
    });

    this.emitStatus('working', 'Aider started');
  }

  public async stop(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGINT');
      this.process = null;
      this.emitStatus('idle', 'Aider stopped');
    }
  }

  public async sendCommand(command: string): Promise<void> {
    if (this.process && this.process.stdin) {
      this.process.stdin.write(`${command}\n`);
    } else {
      throw new Error('Aider process is not running');
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
      source: 'adapter:aider',
      type: 'agent.log',
      payload: { level, message }
    });
  }

  private emitStatus(status: 'idle' | 'working' | 'waiting_approval' | 'error', message: string) {
    if (!this.eventCallback) return;
    this.eventCallback({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'adapter:aider',
      type: 'agent.status',
      payload: { status, message }
    });
  }
}
