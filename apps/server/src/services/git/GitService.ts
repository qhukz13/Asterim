import crypto from 'crypto';
import { eventBus } from '../EventBus';
import { GitProvider } from './GitProvider';
import { RepositoryManager } from './RepositoryManager';
import { StatusManager, RepoStatus } from './StatusManager';
import { DiffManager } from './DiffManager';
import { CommitManager } from './CommitManager';
import { BranchManager } from './BranchManager';
import { RemoteManager } from './RemoteManager';
import { HistoryManager } from './HistoryManager';

export class GitService {
  public provider: GitProvider;
  public repository: RepositoryManager;
  public status: StatusManager;
  public diff: DiffManager;
  public commit: CommitManager;
  public branch: BranchManager;
  public remote: RemoteManager;
  public history: HistoryManager;

  private activeProjectId: string | null = null;
  private activeProjectPath: string | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;
  private lastStatusHash: string = '';

  constructor() {
    this.provider = new GitProvider();
    this.repository = new RepositoryManager(this.provider);
    this.status = new StatusManager(this.provider);
    this.diff = new DiffManager(this.provider);
    this.commit = new CommitManager(this.provider);
    this.branch = new BranchManager(this.provider);
    this.remote = new RemoteManager(this.provider);
    this.history = new HistoryManager(this.provider);

    // Listen for client git actions
    eventBus.subscribe('git.action', async (event: any) => {
      const { action, payload } = event.payload;
      const { projectId } = event.payload;
      
      // Need project path to execute action
      const { projectManager } = await import('../ProjectManager');
      const project = projectManager.getProject(projectId);
      if (!project) return;
      const path = project.path;

      try {
        switch (action) {
          case 'init':
            await this.repository.initRepository(path);
            break;
          case 'get_diff':
            const diff = await this.diff.getDiff(path, payload.file, payload.staged);
            eventBus.publish({
              id: crypto.randomUUID(),
              timestamp: Date.now(),
              source: 'system:git',
              type: 'git.diff',
              payload: {
                projectId: this.activeProjectId!,
                file: payload.file,
                diff
              }
            });
            break;
          case 'stage':
            await this.commit.stageFile(path, payload.file);
            break;
          case 'stage_all':
            await this.commit.stageAll(path);
            break;
          case 'unstage':
            await this.commit.unstageFile(path, payload.file);
            break;
          case 'commit':
            await this.commit.commit(path, payload.message);
            break;
          case 'push':
            await this.remote.push(path);
            break;
          case 'pull':
            await this.remote.pull(path);
            break;
          case 'checkout':
            await this.branch.switchBranch(path, payload.branch);
            break;
          case 'create_branch':
            await this.branch.createBranch(path, payload.branch);
            break;
          case 'get_status':
            this.lastStatusHash = ''; // Force next poll to emit
            break;
        }
        // Force an immediate poll to update UI
        await this.poll();
      } catch (err: any) {
        eventBus.publish({
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          source: 'system:git',
          type: 'git.error',
          payload: { projectId, error: err.message }
        });
      }
    });
  }

  public startWatching(projectId: string, projectPath: string) {
    this.stopWatching();
    this.activeProjectId = projectId;
    this.activeProjectPath = projectPath;
    
    // Poll for changes
    this.pollingInterval = setInterval(() => this.poll(), 3000);
    this.poll();
  }

  public stopWatching() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.activeProjectId = null;
    this.activeProjectPath = null;
  }

  public async poll() {
    if (!this.activeProjectPath || !this.activeProjectId) return;

    try {
      const isRepo = await this.repository.isRepository(this.activeProjectPath);
      if (!isRepo) {
        // Emit special non-repo status so frontend can offer initialization
        const statusHash = 'not-a-repo';
        if (statusHash !== this.lastStatusHash) {
          this.lastStatusHash = statusHash;
          eventBus.publish({
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            source: 'system:git',
            type: 'git.status',
            payload: {
              projectId: this.activeProjectId,
              isRepo: false,
              status: null
            }
          });
        }
        return;
      }

      const status = await this.status.getStatus(this.activeProjectPath);
      const statusHash = JSON.stringify(status);

      if (statusHash !== this.lastStatusHash) {
        this.lastStatusHash = statusHash;

        eventBus.publish({
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          source: 'system:git',
          type: 'git.status',
          payload: {
            projectId: this.activeProjectId,
            isRepo: true,
            status
          }
        });
      }
    } catch (e) {
      // Ignore poll errors to prevent spam
    }
  }
}

export const gitService = new GitService();
