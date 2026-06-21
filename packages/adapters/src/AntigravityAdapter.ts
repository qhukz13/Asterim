import * as pty from 'node-pty';
import { IAgentAdapter, AgentConfig, AgentDeckEvent } from '@agentdeck/shared';
import crypto from 'crypto';
import path from 'path';

export class AntigravityAdapter implements IAgentAdapter {
  private ptyProcess: pty.IPty | null = null;
  private eventCallback?: (event: AgentDeckEvent) => void;
  private dataBuffer: string = '';
  private chatBuffer: string = '';
  private pendingApproval: boolean = false;
  private requestApprovalCallback?: (desc: string, cmd: string) => Promise<boolean>;
  private isStartingUp: boolean = true;
  private startupTimeout: NodeJS.Timeout | null = null;
  private commandQueue: string[] = [];

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
    this.ptyProcess = pty.spawn(spawnCmd, spawnArgs, {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: config.workspace,
      env: { ...process.env, FORCE_COLOR: '1' } as any
    });

    this.ptyProcess.onData((data) => {
      this.emitLog('info', data);
      this.parseOutputForApprovals(data);
      this.parseOutputForChat(data);
    });

    const onExitCallback = config.onExit;
    this.ptyProcess.onExit(({ exitCode }) => {
      console.log(`[AntigravityAdapter] Process exited with code ${exitCode}. isFallback: ${isFallback}, args: ${spawnArgs}`);
      this.ptyProcess = null;

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
      this.ptyProcess.write(`${command}\r`);
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

    if (this.dataBuffer.length > 1000) {
      this.dataBuffer = this.dataBuffer.slice(-1000);
    }

    const approvalRegex = /([^\n\r]*?)\s*[\(\[][yY]\/[nN][\)\]]/i;
    const match = this.dataBuffer.match(approvalRegex);

    if (match && !this.pendingApproval && this.requestApprovalCallback) {
      this.pendingApproval = true;
      this.emitStatus('waiting_approval', 'Antigravity needs approval');

      const desc = match[1].trim() || 'Action requires approval';
      const cmd = match[0].trim();
      this.dataBuffer = '';

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
        console.error('[AntigravityAdapter] Approval failed:', err);
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
      source: 'adapter:antigravity',
      type: 'agent.log',
      payload: { level, message }
    });
  }

  private parseOutputForChat(data: string) {
    // Note: The isStartingUp check is now performed after buffering and text formatting
    // so we can reliably detect the first prompt.

    // Add raw data to buffer FIRST to handle ANSI codes split across chunks
    this.chatBuffer += data;

    // Translate cursor movement and erase sequences into simple control characters
    // Cursor Left (e.g. \x1b[D or \x1b[1D) -> Backspace (\x08)
    this.chatBuffer = this.chatBuffer.replace(/\x1b\[\d*D/g, '\x08');
    // Erase Line (e.g. \x1b[2K or \x1b[K) -> Carriage Return (\r)
    this.chatBuffer = this.chatBuffer.replace(/\x1b\[2?K/g, '\r');

    // Robust ANSI stripping (includes OSC sequences and all CSI terminators)
    const ansiRegex = new RegExp([
      '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
      '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[A-Za-z=><~]))'
    ].join('|'), 'g');
    
    this.chatBuffer = this.chatBuffer.replace(ansiRegex, '');
    
    // Strip Braille spinner characters and other terminal UI artifacts
    const spinnerRegex = /[⣷⣯⣟⡿⢿⣻⣽⣾⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g;
    this.chatBuffer = this.chatBuffer.replace(spinnerRegex, '');

    // Remove any backspace characters and the character preceding it (simple backspace handling)
    while (this.chatBuffer.includes('\x08')) {
      this.chatBuffer = this.chatBuffer.replace(/[^\x08]\x08/, '');
      // If backspace is at the start, just remove it
      this.chatBuffer = this.chatBuffer.replace(/^\x08+/, '');
    }

    // Resolve carriage returns (\r) which mean "overwrite this line"
    // First normalize Windows newlines to Unix to prevent \r at the end of lines from deleting the line
    this.chatBuffer = this.chatBuffer.replace(/\r\n/g, '\n');
    // We only keep the last part of each line after \r
    let lines = this.chatBuffer.split('\n');
    lines = lines.map(line => {
      const parts = line.split('\r');
      return parts[parts.length - 1];
    });
    this.chatBuffer = lines.join('\n');

    // We strictly match the interactive command prompt to ensure we don't accidentally
    // trigger on welcome messages (like "Type ? for shortcuts").
    const promptRegex = /(?:>|aider>)\s*$/i;

    if (promptRegex.test(this.chatBuffer)) {
      if (this.isStartingUp) {
        // The first prompt indicates the agent has finished dumping history and is ready
        this.isStartingUp = false;
        this.chatBuffer = '';
        console.log('[AntigravityAdapter] Startup complete, history ignored. Ready for commands.');
        
        // Flush any queued commands
        while (this.commandQueue.length > 0) {
          const cmd = this.commandQueue.shift();
          if (cmd && this.ptyProcess) {
            console.log(`[AntigravityAdapter] Flushing queued command: ${cmd}`);
            this.ptyProcess.write(cmd + '\r\n');
          }
        }
        return;
      }

      // Clean up the message before emitting
      let message = this.chatBuffer
        .replace(promptRegex, '')
        // Strip CLI UI artifacts
        .replace(/Generating(\s*\.*)+/gi, '')
        .replace(/Gemini 3\.5 Flash \(Medium\)/gi, '')
        .replace(/esc to cancel/gi, '')
        .replace(/─{10,}/g, '') // Strip long separator lines
        // Remove trailing or isolated 'X' and 'W' artifacts from bad PTY sequences
        .replace(/(\r\n|\n|\r)[XW](\r\n|\n|\r)/g, '\n')
        .replace(/[XW]$/g, '')
        .trim();
        
      // Simple heuristic to strip the echoed user prompt if it appears as the first line and is followed by an empty line
      const msgLines = message.split('\n');
      if (msgLines.length >= 3 && msgLines[1].trim() === '') {
        message = msgLines.slice(2).join('\n').trim();
      } else if (msgLines.length > 0 && msgLines[0].startsWith('> ')) {
        message = msgLines.slice(1).join('\n').trim();
      }

      // Don't emit purely system/auth messages as chat
      const isSystemMessage = message.includes('Welcome to the Antigravity CLI') || 
                              message.includes('Signing in...') ||
                              message.includes('You are currently not signed in');

      if (message && !isSystemMessage) {
        this.emitChatMessage('agent', message);
      }
      
      // Clear buffer
      this.chatBuffer = '';
    }
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
