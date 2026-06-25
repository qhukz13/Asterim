import * as pty from 'node-pty';
import { IAgentAdapter, AgentConfig, AgentDeckEvent } from '@agentdeck/shared';
import crypto from 'crypto';
import path from 'path';
import { Terminal } from '@xterm/headless';

export class AntigravityAdapter implements IAgentAdapter {
  private ptyProcess: pty.IPty | null = null;
  private xterm: Terminal | null = null;
  private eventCallback?: (event: AgentDeckEvent) => void;
  private dataBuffer: string = '';
  private chatBuffer: string = '';
  private lastScreenText: string = '';
  private pendingApproval: boolean = false;
  private requestApprovalCallback?: (desc: string, cmd: string) => Promise<boolean>;
  private isStartingUp: boolean = true;
  private startupTimeout: NodeJS.Timeout | null = null;
  private commandQueue: string[] = [];
  private parseTimeout: NodeJS.Timeout | null = null;

  private getRealAgyBinaryPath(): string | null {
    try {
      const { execSync } = require('child_process');
      const cmd = process.platform === 'win32' ? 'where agy' : 'which agy';
      const output = execSync(cmd, { stdio: 'pipe' }).toString().trim();
      if (output) {
        return output.split('\n')[0].trim();
      }
    } catch (e) {}

    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || path.join(require('os').homedir(), 'AppData', 'Local');
      const winPath = path.join(localAppData, 'agy', 'bin', 'agy.exe');
      if (require('fs').existsSync(winPath)) {
        return winPath;
      }
    } else {
      const unixPath = path.join(require('os').homedir(), '.agy', 'bin', 'agy');
      if (require('fs').existsSync(unixPath)) {
        return unixPath;
      }
    }
    return null;
  }

  public async start(config: AgentConfig): Promise<void> {
    if (this.ptyProcess) {
      throw new Error('Antigravity is already running');
    }

    this.isStartingUp = true;
    this.requestApprovalCallback = config.requestApproval;
    const binPath = config.binaryPath || 'antigravity';
    const args: string[] = [];

    let spawnCmd: string;
    let spawnArgs: string[];

    if (binPath === 'antigravity') {
      const realAgyPath = this.getRealAgyBinaryPath();
      if (realAgyPath) {
        spawnCmd = realAgyPath;
        spawnArgs = ['-c'];
      } else {
        const possiblePaths = [
          path.resolve(__dirname, '../mock-antigravity.js'),
          path.resolve(__dirname, '../../packages/adapters/mock-antigravity.js'),
          path.resolve(process.cwd(), 'packages/adapters/mock-antigravity.js'),
        ];
        
        let mockScriptPath = '';
        for (const p of possiblePaths) {
          if (require('fs').existsSync(p)) {
            mockScriptPath = p;
            break;
          }
        }
        
        if (!mockScriptPath) {
          throw new Error(`Could not find mock-antigravity.js in any of the resolved locations: ${possiblePaths.join(', ')}`);
        }

        spawnCmd = 'node';
        spawnArgs = [mockScriptPath, ...args];
      }
    } else {
      spawnCmd = binPath;
      spawnArgs = args;
    }

    console.log('[AntigravityAdapter] Calling spawnAndWatch with:', { spawnCmd, spawnArgs, workspace: config.workspace });
    this.spawnAndWatch(spawnCmd, spawnArgs, config);
  }

  private spawnAndWatch(spawnCmd: string, spawnArgs: string[], config: AgentConfig, isFallback: boolean = false) {
    const startTime = Date.now();
    this.xterm = new Terminal({
      cols: 80,
      rows: 9999,
      scrollback: 10000,
      allowProposedApi: true
    });

    this.ptyProcess = pty.spawn(spawnCmd, spawnArgs, {
      name: 'xterm-color',
      cols: 80,
      rows: 9999,
      cwd: config.workspace,
      env: { ...process.env, FORCE_COLOR: '1' } as any
    });

    this.ptyProcess.onData((data) => {
      this.emitLog('info', data);
      this.parseOutputForApprovals(data);
      
      if (this.xterm) {
        this.xterm.write(data, () => {
          if (this.parseTimeout) {
            clearTimeout(this.parseTimeout);
          }
          this.parseTimeout = setTimeout(() => {
            this.parseTerminalScreen();
          }, 400);
        });
      }
    });

    const onExitCallback = config.onExit;
    this.ptyProcess.onExit(({ exitCode }) => {
      console.log(`[AntigravityAdapter] Process exited with code ${exitCode}. isFallback: ${isFallback}, args: ${spawnArgs}`);
      this.ptyProcess = null;
      if (this.xterm) {
        this.xterm.dispose();
        this.xterm = null;
      }

      // Fallback: If 'agy -c' failed (likely due to no previous conversation),
      // retry once without the '-c' argument to start a brand new session.
      const duration = Date.now() - startTime;
      if ((exitCode !== 0 || duration < 5000) && !isFallback && spawnArgs.includes('-c')) {
        this.emitLog('warn', 'Antigravity continue exited quickly. Retrying without "-c" to start a new session...');
        this.spawnAndWatch(spawnCmd, [], config, true);
        return;
      }

      this.emitStatus('idle', `Antigravity exited with code ${exitCode}`);
      if (onExitCallback) {
        onExitCallback(exitCode);
      }
    });

    this.emitStatus('working', isFallback ? 'Antigravity started (new session)' : 'Antigravity started');
  }

  public async stop(): Promise<void> {
    if (this.ptyProcess) {
      this.ptyProcess.kill();
      this.ptyProcess = null;
      this.emitStatus('idle', 'Antigravity stopped');
    }
  }

  public async sendCommand(command: string): Promise<void> {
    if (this.isStartingUp) {
      this.commandQueue.push(command);
      console.log(`[AntigravityAdapter] Queued command during startup: ${command}`);
      return;
    }
    if (this.ptyProcess) {
      if (this.xterm) {
        this.xterm.clear();
      }
      this.emitStatus('working', 'Running command...');
      this.ptyProcess.write(`${command}\r\n`);
    } else {
      throw new Error('Antigravity process is not running');
    }
  }

  public writeStdin(data: string): void {
    if (this.ptyProcess) {
      this.ptyProcess.write(data);
    }
  }

  public getPid(): number | undefined {
    return this.ptyProcess?.pid;
  }

  public onEvent(callback: (event: AgentDeckEvent) => void): void {
    this.eventCallback = callback;
  }

  private async parseOutputForApprovals(data: string) {
    this.dataBuffer += data;

    if (this.dataBuffer.length > 2000) {
      this.dataBuffer = this.dataBuffer.slice(-2000);
    }

    const claudeRegex = /([^\n\r]*?)\s*[\(\[][yY]\/[nN][\)\]]/i;
    const antigravityRegex = /Requesting permission for:\s*([\s\S]*?)\s*Do you want to proceed\?/i;

    let desc = '';
    let cmd = '';
    let promptType: 'claude' | 'antigravity' | null = null;

    const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

    let match = this.dataBuffer.match(claudeRegex);
    if (match) {
      desc = match[1].replace(ansiRegex, '').trim() || 'Action requires approval';
      cmd = match[0].replace(ansiRegex, '').trim();
      promptType = 'claude';
    } else {
      match = this.dataBuffer.match(antigravityRegex);
      if (match) {
        desc = 'Agent wants to run a command:';
        cmd = match[1].replace(ansiRegex, '').trim();
        promptType = 'antigravity';
      }
    }

    if (promptType && !this.pendingApproval && this.requestApprovalCallback) {
      this.pendingApproval = true;
      this.emitStatus('waiting_approval', 'Antigravity needs approval');

      this.dataBuffer = '';

      try {
        const approved = await this.requestApprovalCallback(desc, cmd);
        if (!this.ptyProcess) return;

        if (approved) {
          if (promptType === 'antigravity') {
            this.ptyProcess.write('\r');
          } else {
            this.ptyProcess.write('y\r');
          }
          this.emitStatus('working', 'Action approved, continuing...');
        } else {
          if (promptType === 'antigravity') {
            this.ptyProcess.write('4\r');
          } else {
            this.ptyProcess.write('n\r');
          }
          this.emitStatus('working', 'Action denied.');
        }
      } catch (err) {
        console.error('[AntigravityAdapter] Approval failed:', err);
        if (this.ptyProcess) {
          this.ptyProcess.write(promptType === 'antigravity' ? '4\r' : 'n\r');
        }
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
      source: 'adapter:antigravity',
      type: 'agent.log',
      payload: { level, message }
    });
  }

  private parseTerminalScreen() {
    if (!this.xterm) return;

    let screenText = '';
    const buffer = this.xterm.buffer.active;
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) {
        screenText += line.translateToString(true) + '\n';
      }
    }

    // Clean up empty lines at the end to reliably find the prompt
    const trimmedScreen = screenText.trimEnd();

    // Look for the standard prompt indicator at the end of the text.
    // It's usually > or ❯ on a line by itself, optionally followed by status bars.
    // We use matchAll to find the LAST occurrence of the prompt.
    const matches = [...trimmedScreen.matchAll(/(?:^|\n)[❯>](?:\s*\n|$)/g)];
    const match = matches.length > 0 ? matches[matches.length - 1] : null;

    if (match) {
      let skipEmit = false;
      let message = trimmedScreen.substring(0, match.index);
      message = this.cleanMessage(message);

      if (this.isStartingUp) {
        this.isStartingUp = false;
        skipEmit = true;
        this.lastScreenText = message;
        console.log('[AntigravityAdapter] Startup complete, history ignored. Ready for commands.');
        
        while (this.commandQueue.length > 0) {
          const cmd = this.commandQueue.shift();
          if (cmd && this.ptyProcess) {
            console.log(`[AntigravityAdapter] Flushing queued command: ${cmd}`);
            if (this.xterm) {
              this.xterm.clear();
            }
            this.emitStatus('working', 'Running queued command...');
            this.ptyProcess.write(cmd + '\r\n');
            // We return here so we don't emit idle status, as we just sent a command
            return;
          }
        }
        this.emitStatus('idle', 'Ready');
        return;
      }

      let newText = message;
      if (this.lastScreenText) {
        const oldLines = this.lastScreenText.split('\n');
        const newLines = message.split('\n');
        
        let matchEndIndexInNew = -1;
        let bestK = 0;

        for (let k = oldLines.length; k > 0; k--) {
          const searchBlock = oldLines.slice(oldLines.length - k);
          const blockText = searchBlock.join('').trim();
          
          if (k < oldLines.length && blockText.length < 15) {
            continue;
          }

          // Search backwards to find the last occurrence in the scrollback
          for (let i = newLines.length - k; i >= 0; i--) {
            let match = true;
            for (let j = 0; j < k; j++) {
              if (newLines[i + j].trimEnd() !== searchBlock[j].trimEnd()) {
                match = false;
                break;
              }
            }
            if (match) {
              bestK = k;
              matchEndIndexInNew = i + k;
              break;
            }
          }
          if (bestK > 0) break;
        }

        if (bestK > 0) {
          newText = newLines.slice(matchEndIndexInNew).join('\n').trim();
        }
      }
      this.lastScreenText = message;

      const msgLines = newText.split('\n');
      if (msgLines.length >= 3 && msgLines[1].trim() === '') {
        newText = msgLines.slice(2).join('\n').trim();
      } else if (msgLines.length > 0 && msgLines[0].startsWith('> ')) {
        newText = msgLines.slice(1).join('\n').trim();
      }

      const isSystemMessage = newText.includes('Welcome to the Antigravity CLI') || 
                              newText.includes('Signing in...') ||
                              newText.includes('You are currently not signed in');

      if (newText && !isSystemMessage && !skipEmit) {
        this.emitChatMessage('agent', newText);
      }
      
      this.emitStatus('idle', 'Ready');
    }
  }

  private cleanMessage(message: string): string {
    return message
      .replace(/Generating(\s*\.*)+/gi, '')
      .replace(/Gemini 3\.5 Flash \(Medium\)/gi, '')
      .replace(/\(Google AI Pro\)/gi, '')
      .replace(/esc to cancel/gi, '')
      .replace(/\? for shortcuts[\r\n]+[^\r\n]+/gi, '')
      .replace(/^.*Antigravity CLI.*$/gim, '')
      .replace(/^.*[█▀▄]+.*$/gim, '')
      .replace(/─{10,}/g, '')
      .replace(/^\s*[○●]\s+[A-Za-z0-9_-]+\(.*?\).*$/gim, '')
      .replace(/(\r\n|\n|\r)[XW](\r\n|\n|\r)/g, '\n')
      .replace(/[XW]$/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private emitChatMessage(role: 'agent' | 'user', content: string) {
    if (!this.eventCallback) return;
    this.eventCallback({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'adapter:antigravity',
      type: 'chat.message',
      payload: { role, content }
    });
  }

  private emitStatus(status: 'idle' | 'working' | 'waiting_approval' | 'error', message: string) {
    if (!this.eventCallback) return;
    this.eventCallback({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'adapter:antigravity',
      type: 'agent.status',
      payload: { status, message }
    });
  }
}
