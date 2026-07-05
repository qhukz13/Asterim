import * as pty from 'node-pty';
import { IAgentAdapter, AgentConfig, AgentDeckEvent } from '@agentdeck/shared';
import { randomUUID } from 'crypto';
import path from 'path';
import { Terminal } from '@xterm/headless';
import { takeSnapshot, TerminalSnapshot } from './terminal/ScreenSnapshot';
import { diffScreens } from './terminal/ScreenDiff';
import { AntigravityFSM, AgentState } from './terminal/TerminalFSM';

export class AntigravityAdapter implements IAgentAdapter {
  private ptyProcess: pty.IPty | null = null;
  private term: Terminal | null = null;
  private eventCallback?: (event: AgentDeckEvent) => void;
  private requestApprovalCallback?: (desc: string, cmd: string) => Promise<boolean>;
  private requestQuestionCallback?: (question: string, options: string[]) => Promise<number | string>;
  private config?: AgentConfig;
  
  private fsm!: AntigravityFSM;
  private previousSnapshot: TerminalSnapshot | null = null;
  
  private commandQueue: string[] = [];
  private lastCommandSent: string = '';
  private isStartingUp: boolean = true;

  private getRealAgyBinaryPath(): string | null {
    try {
      const { execSync } = require('child_process');
      const cmd = process.platform === 'win32' ? 'where agy' : 'which agy';
      const output = execSync(cmd, { stdio: 'pipe' }).toString().trim();
      if (output) {
        return output.split('\n')[0].trim();
      }
    } catch (err) {
      // Ignore
    }
    
    try {
      const userProfile = process.env.USERPROFILE || process.env.HOME;
      if (userProfile) {
        const defaultPath = path.join(userProfile, 'AppData', 'Local', 'agy', 'bin', 'agy.exe');
        const fs = require('fs');
        if (fs.existsSync(defaultPath)) {
          return defaultPath;
        }
      }
    } catch (err) {
      // Ignore
    }
    
    return null;
  }

  public onEvent(callback: (event: AgentDeckEvent) => void) {
    this.eventCallback = callback;
  }

  public async start(config: AgentConfig): Promise<void> {
    this.config = config;
    this.requestApprovalCallback = config.requestApproval;
    this.requestQuestionCallback = config.requestQuestion;
    const isMock = process.env.MOCK_AGENT === 'true';

    let spawnCmd = isMock ? 'node' : 'agy';
    let spawnArgs = isMock ? [path.join(__dirname, '..', 'mock-antigravity.js')] : ['-c'];

    if (!isMock) {
      const realPath = this.getRealAgyBinaryPath();
      if (realPath) {
        spawnCmd = realPath;
      }
    }

    console.log('[AntigravityAdapter] Calling spawnAndWatch with:', { spawnCmd, spawnArgs, workspace: config.workspace });

    await this.spawnAndWatch(spawnCmd, spawnArgs, config.workspace, config.onExit);
  }

  private async spawnAndWatch(cmd: string, args: string[], workspace: string, onExit?: (code: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.term = new Terminal({
          allowProposedApi: true,
          cols: 80,
          rows: 24,
          scrollback: 10000 // Large scrollback to prevent truncation issues
        });

        this.fsm = new AntigravityFSM(
          (message) => this.handleMessageComplete(message),
          (state, reason) => this.handleStateChange(state, reason),
          (desc, command) => this.handleApprovalRequired(desc, command),
          () => this.handleTrustRequired(),
          (q, opts) => this.handleQuestionRequired(q, opts)
        );

        this.ptyProcess = pty.spawn(cmd, args, {
          name: 'xterm-color',
          cols: 80,
          rows: 24,
          cwd: workspace,
          env: {
            ...process.env,
            FORCE_COLOR: '1'
          },
          useConpty: process.platform === 'win32'
        });

        this.ptyProcess.onData((data) => {
          if (!this.term) return;
          this.term.write(data, () => {
            this.processScreenTick();
          });
        });

        this.ptyProcess.onExit(({ exitCode }) => {
          console.log(`[AntigravityAdapter] PTY process exited with code ${exitCode}`);
          if (onExit) onExit(exitCode);
        });

        this.emitStatus('working', 'Agent started successfully.');
        resolve();
      } catch (err) {
        console.error('[AntigravityAdapter] Failed to spawn PTY:', err);
        reject(err);
      }
    });
  }

  private processScreenTick() {
    if (!this.term) return;
    
    const currentSnapshot = takeSnapshot(this.term);
    
    let diff: import('./terminal/ScreenDiff').DiffResult = { newLines: [], modifiedLines: [], appendedText: '' };
    
    if (this.previousSnapshot) {
      diff = diffScreens(this.previousSnapshot, currentSnapshot);
    }
    
    this.previousSnapshot = currentSnapshot;

    // Pass the diff to our State Machine
    this.fsm.process(diff, currentSnapshot);
    
    try {
      const fs = require('fs');
      const cursorLineIndex = currentSnapshot.baseY + currentSnapshot.cursorY;
      const cursorLine = currentSnapshot.lines[cursorLineIndex] || '';
      const log = `\n--- TICK ---\nSTATE: ${this.fsm.getState()}\nDIFF APPENDED: ${JSON.stringify(diff.appendedText)}\nCURSOR Y: ${currentSnapshot.cursorY}\nCURSOR LINE: ${JSON.stringify(cursorLine)}\nLINES: ${JSON.stringify(currentSnapshot.lines.slice(-3))}\n`;
      fs.appendFileSync('C:\\Projects\\AgentDeck\\fsm_debug.log', log);
    } catch (e) {}
  }

  private handleStateChange(state: AgentState, reason: string) {
    let internalState: 'idle' | 'working' | 'waiting_approval' | 'error' = 'working';
    
    if (state === AgentState.Idle) internalState = 'idle';
    if (state === AgentState.WaitingApproval) internalState = 'waiting_approval';
    if (state === AgentState.Working) internalState = 'working';
    
    this.emitStatus(internalState, reason);

    if (state === AgentState.Idle && this.isStartingUp) {
      this.isStartingUp = false;
      console.log('[AntigravityAdapter] Startup complete. Ready for commands.');
      
      // Flush queued commands
      while (this.commandQueue.length > 0) {
        const queuedCmd = this.commandQueue.shift();
        if (queuedCmd && this.ptyProcess) {
          console.log(`[AntigravityAdapter] Flushing queued command: ${queuedCmd}`);
          this.sendCommand(queuedCmd);
          return; // Wait for next idle state
        }
      }
    }
  }

  private handleMessageComplete(message: string) {
    if (message === 'y' || message === 'n' || message === this.lastCommandSent) {
      return;
    }
    if (message.length > 0) {
      this.emitLog('agent', message);
    }
  }

  private handleApprovalRequired(desc: string, command: string) {
    if (!this.requestApprovalCallback) return;

    this.requestApprovalCallback(desc, command).then(approved => {
      if (!this.ptyProcess) return;

      const fullText = this.previousSnapshot?.lines.join('\n') || '';
      const isMenu = fullText.includes('Do you want to proceed?');

      if (approved) {
        const input = isMenu ? '1' : 'y';
        this.lastCommandSent = input;
        this.ptyProcess.write(input + '\r');
      } else {
        const input = isMenu ? '4' : 'n';
        this.lastCommandSent = input;
        this.ptyProcess.write(input + '\r');
      }
    }).catch(err => {
      console.error('[AntigravityAdapter] Approval failed:', err);
      if (this.ptyProcess) {
        this.ptyProcess.write('n\r');
      }
    });
  }

  private handleTrustRequired() {
    if (this.ptyProcess) {
      console.log('[AntigravityAdapter] Auto-approving workspace trust prompt.');
      this.ptyProcess.write('\r');
    }
  }

  private handleQuestionRequired(question: string, options: string[]) {
    if (!this.requestQuestionCallback) return;

    this.requestQuestionCallback(question, options).then((response: number | string) => {
      if (!this.ptyProcess) return;
      this.lastCommandSent = response.toString();
      this.ptyProcess.write(response + '\r');
    }).catch((err: any) => {
      console.error('[AntigravityAdapter] Question failed:', err);
      if (this.ptyProcess) {
        this.ptyProcess.write('\x1b'); // Escape to skip if supported
      }
    });
  }

  public async stop(): Promise<void> {
    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = null;
    }
    this.term = null;
  }

  public async sendCommand(command: string): Promise<void> {
    if (this.isStartingUp) {
      console.log(`[AntigravityAdapter] Queued command during startup: ${command}`);
      this.commandQueue.push(command);
      return;
    }

    if (this.ptyProcess) {
      this.lastCommandSent = command.trim();
      this.emitStatus('working', 'Running command...');
      this.ptyProcess.write(command + '\r\n');
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

  private emitLog(role: 'agent' | 'user', content: string) {
    if (this.eventCallback) {
      this.eventCallback({
        id: randomUUID(),
        timestamp: Date.now(),
        type: 'chat.message',
        source: 'agent',
        payload: { role, content }
      });
    }
  }

  private emitStatus(status: 'idle' | 'working' | 'waiting_approval' | 'error', message: string) {
    if (this.eventCallback) {
      this.eventCallback({
        id: randomUUID(),
        timestamp: Date.now(),
        type: 'agent.status',
        source: 'agent',
        payload: { status, message }
      });
    }
  }
}
