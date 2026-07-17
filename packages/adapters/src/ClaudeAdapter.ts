import * as pty from 'node-pty';
import { IAgentAdapter, AgentConfig, AgentDeckEvent, ClientApprovalResponsePayload } from '@agentdeck/shared';
import crypto from 'crypto';
import os from 'os';

export class ClaudeAdapter implements IAgentAdapter {
  private ptyProcess: pty.IPty | null = null;
  private eventCallback?: (event: AgentDeckEvent) => void;
  private currentActionId: string | null = null;
  private dataBuffer: string = '';
  private pendingApproval: boolean = false;
  private requestApprovalCallback?: (desc: string, cmd: string) => Promise<boolean>;

  public async start(config: AgentConfig): Promise<void> {
    if (this.ptyProcess) {
      throw new Error('Claude Code is already running');
    }

    this.requestApprovalCallback = config.requestApproval;
    const binPath = config.binaryPath || 'claude';
    const args: string[] = [];

    const shell = process.platform === 'win32' ? 'cmd.exe' : binPath;
    const ptyArgs = process.platform === 'win32' ? ['/c', binPath, ...args] : args;

    this.ptyProcess = pty.spawn(shell, ptyArgs, {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: config.workspace,
      env: { ...process.env, FORCE_COLOR: '1' } as any
    });

    this.ptyProcess.onData((data) => {
      this.emitLog('info', data);
      this.parseOutputForApprovals(data);
    });

    const onExitCallback = config.onExit;
    this.ptyProcess.onExit(({ exitCode }) => {
      this.emitStatus('idle', `Claude Code exited with code ${exitCode}`);
      this.ptyProcess = null;
      if (onExitCallback) {
        onExitCallback(exitCode);
      }
    });

    this.emitStatus('working', 'Claude Code started');
  }

  public async stop(): Promise<void> {
    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = null;
      this.emitStatus('idle', 'Claude Code stopped');
    }
  }

  public async sendCommand(command: string): Promise<void> {
    if (this.ptyProcess) {
      this.ptyProcess.write(`${command}\r`);
    } else {
      throw new Error('Claude Code process is not running');
    }
  }

  public writeStdin(data: string): void {
    if (this.ptyProcess) {
      this.ptyProcess.write(data);
    }
  }

  public getPid(): number | undefined {
    return this.ptyProcess?.pid ?? undefined;
  }

  public getLastOutput(): string {
    const lines = this.dataBuffer.split('\n').map(l => l.trimEnd()).filter(l => l.length > 0);
    return lines.slice(-10).join('\n');
  }

  public onEvent(callback: (event: AgentDeckEvent) => void): void {
    this.eventCallback = callback;
  }

  private async parseOutputForApprovals(data: string) {
    this.dataBuffer += data;
    
    if (this.dataBuffer.length > 1000) {
      this.dataBuffer = this.dataBuffer.slice(-1000);
    }

    // Claude Code often asks questions like "? Do you want to execute this command? (Y/n)"
    const approvalRegex = /\?\s*(.*?)\s*\([yY]\/[nN]\)/i;
    const match = this.dataBuffer.match(approvalRegex);

    if (match && !this.pendingApproval && this.requestApprovalCallback) {
      this.pendingApproval = true;
      this.emitStatus('waiting_approval', 'Claude Code needs approval');
      
      const desc = match[1].trim() || 'Action requires approval';
      const cmd = match[0].trim();
      this.dataBuffer = ''; // Clear buffer after match

      try {
        const approved = await this.requestApprovalCallback(desc, cmd);
        if (!this.ptyProcess) return;

        if (approved) {
          this.ptyProcess.write('y\r');
          this.emitStatus('working', 'Action approved, continuing...');
        } else {
          this.ptyProcess.write('n\r');
          this.emitStatus('working', 'Action denied.');
        }
      } catch (err) {
        console.error('[ClaudeAdapter] Approval failed:', err);
        if (this.ptyProcess) this.ptyProcess.write('n\r');
        this.emitStatus('working', 'Approval error, defaulted to denied.');
      } finally {
        this.pendingApproval = false;
      }
    }
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

  private emitStatus(status: 'idle' | 'working' | 'waiting_approval' | 'waiting_question' | 'error' | 'startup', message: string) {
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
