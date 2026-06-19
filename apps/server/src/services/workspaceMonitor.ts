import chokidar, { FSWatcher } from 'chokidar';
import simpleGit, { SimpleGit } from 'simple-git';
import { AgentDeckEvent, FileChangedPayload } from '@agentdeck/shared';
import crypto from 'crypto';

export class WorkspaceMonitor {
  private watcher: FSWatcher | null = null;
  private git: SimpleGit;
  private eventCallback?: (event: AgentDeckEvent) => void;

  constructor(private workspacePath: string) {
    this.git = simpleGit(workspacePath);
  }

  public async start(): Promise<void> {
    if (this.watcher) return;

    // Check if workspace is a git repo
    const isRepo = await this.git.checkIsRepo();
    if (!isRepo) {
      console.warn(`[WorkspaceMonitor] Workspace ${this.workspacePath} is not a git repository. Diff tracking will be disabled.`);
    }

    this.watcher = chokidar.watch(this.workspacePath, {
      ignored: [
        /(^|[\/\\])\../, // ignore dotfiles
        /node_modules/,
        /dist/,
        /build/
      ],
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    });

    this.watcher
      .on('add', (path: string) => this.handleFileEvent(path, 'added'))
      .on('change', (path: string) => this.handleFileEvent(path, 'modified'))
      .on('unlink', (path: string) => this.handleFileEvent(path, 'deleted'));

    console.log(`[WorkspaceMonitor] Started watching ${this.workspacePath}`);
  }

  public async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      console.log(`[WorkspaceMonitor] Stopped watching ${this.workspacePath}`);
    }
  }

  public onEvent(callback: (event: AgentDeckEvent) => void): void {
    this.eventCallback = callback;
  }

  private async handleFileEvent(filePath: string, changeType: 'added' | 'modified' | 'deleted') {
    if (!this.eventCallback) return;

    let diff = undefined;
    try {
      const isRepo = await this.git.checkIsRepo();
      if (isRepo) {
        // Get the diff for this specific file
        diff = await this.git.diff([filePath]);
        if (!diff && changeType === 'added') {
          // If it's a new untracked file, git diff won't show it unless we use --intent-to-add or something.
          // For now, we can just say diff is empty.
          diff = 'New untracked file';
        }
      }
    } catch (err) {
      console.error(`[WorkspaceMonitor] Failed to get diff for ${filePath}:`, err);
    }

    const payload: FileChangedPayload = {
      filePath,
      changeType,
      diff
    };

    this.eventCallback({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'server:workspace_monitor',
      type: 'file.changed',
      payload
    });
  }
}
