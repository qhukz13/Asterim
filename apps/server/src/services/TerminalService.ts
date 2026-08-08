import { eventBus } from './EventBus';
import os from 'os';
import { dbService } from './DatabaseService';
import crypto from 'crypto';

class TerminalService {
  private ptys: Map<string, any> = new Map();
  private outputBuffers: Map<string, string> = new Map();
  private maxBufferLength = 100000; // Keep last 100k characters per terminal for instant view re-attachment

  constructor() {
    // Listen for terminal spawn or re-attach requests
    eventBus.subscribe<any>('client.terminal_spawn', event => {
      const { projectId, cols, rows } = event.payload;
      if (!projectId) return;

      this.spawnTerminal(projectId, cols || 80, rows || 24);
    });

    // Listen for terminal input
    eventBus.subscribe<any>('client.terminal_input', event => {
      const { projectId, data } = event.payload;
      if (!projectId || !data) return;

      const ptyProcess = this.ptys.get(projectId);
      if (ptyProcess) {
        ptyProcess.write(data);
      }
    });

    // Listen for terminal resize
    eventBus.subscribe<any>('client.terminal_resize', event => {
      const { projectId, cols, rows } = event.payload;
      if (!projectId || !cols || !rows) return;

      const ptyProcess = this.ptys.get(projectId);
      if (ptyProcess) {
        ptyProcess.resize(cols, rows);
      }
    });
  }

  /**
   * Determine the best interactive shell for the user's platform.
   */
  private resolveShell(): string {
    const platform = os.platform();
    const envShell = process.env.SHELL;

    if (platform === 'win32') {
      if (process.env.COMSPEC && process.env.COMSPEC.toLowerCase().includes('powershell')) {
        return process.env.COMSPEC;
      }
      return 'powershell.exe';
    }

    if (envShell && envShell.trim()) {
      return envShell.trim();
    }

    const fs = require('fs');
    if (fs.existsSync('/bin/zsh')) return '/bin/zsh';
    if (fs.existsSync('/bin/bash')) return '/bin/bash';
    return 'sh';
  }

  private async spawnTerminal(projectId: string, cols: number, rows: number) {
    // If PTY is already running, re-publish cached scrollback buffer for view re-attachment
    if (this.ptys.has(projectId)) {
      const cached = this.outputBuffers.get(projectId);
      if (cached) {
        eventBus.publish({
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          source: 'terminal',
          type: 'terminal.data',
          payload: { projectId, data: cached }
        });
      }
      return;
    }

    const db = dbService.getDb();
    const project = db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId) as
      { path: string } | undefined;

    if (!project) return;

    let pty: any;
    try {
      pty = await import('node-pty');
    } catch (err) {
      console.error('[TerminalService] Failed to load node-pty:', err);
      return;
    }

    const shell = this.resolveShell();

    const fs = require('fs');
    if (!fs.existsSync(project.path)) {
      eventBus.publish({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: 'terminal',
        type: 'terminal.data',
        payload: {
          projectId,
          data: `\x1b[31mError: Workspace directory does not exist:\x1b[0m ${project.path}\r\n`
        }
      });
      return;
    }

    try {
      const isWindows = os.platform() === 'win32';
      const hasSpaces = project.path.includes(' ');
      
      // winpty struggles with spaces in cwd, use a safe default and cd later
      const safeCwd = (isWindows && hasSpaces) ? (process.env.USERPROFILE || 'C:\\') : project.path;

      // Sanitize environment variables
      const env = { ...process.env } as any;
      if (isWindows) {
        // winpty crashes if PATH contains quotes
        if (env.PATH) env.PATH = env.PATH.replace(/"/g, '');
        if (env.Path) env.Path = env.Path.replace(/"/g, '');
      }

      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: cols,
        rows: rows,
        cwd: safeCwd,
        env: env,
        useConpty: false // Force winpty to avoid AttachConsole errors in tsx
      });

      if (isWindows && hasSpaces) {
        ptyProcess.write(`cd "${project.path}"\r`);
        ptyProcess.write(`clear\r`);
      }

      this.outputBuffers.set(projectId, '');

      ptyProcess.onData((data: string) => {
        // Retain scrollback history buffer for view re-attachment
        const currentBuf = this.outputBuffers.get(projectId) || '';
        const nextBuf = (currentBuf + data).slice(-this.maxBufferLength);
        this.outputBuffers.set(projectId, nextBuf);

        eventBus.publish({
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          source: 'terminal',
          type: 'terminal.data',
          payload: { projectId, data }
        });
      });

      ptyProcess.onExit(() => {
        this.ptys.delete(projectId);
        this.outputBuffers.delete(projectId);
        eventBus.publish({
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          source: 'terminal',
          type: 'terminal.exit',
          payload: { projectId }
        });
      });

      this.ptys.set(projectId, ptyProcess);
    } catch (err) {
      console.error('[TerminalService] Failed to spawn terminal:', err);
    }
  }
}

export const terminalService = new TerminalService();
