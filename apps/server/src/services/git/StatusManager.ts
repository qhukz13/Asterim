import { GitProvider } from './GitProvider';

export interface FileStatus {
  file: string;
  staged: boolean;
  untracked: boolean;
  modified: boolean;
}

export interface RepoStatus {
  branch: string;
  files: FileStatus[];
  syncStatus?: string;
  ahead?: number;
  behind?: number;
  lastCommit?: string;
  hasRemote?: boolean;
  remoteUrl?: string;
}

export class StatusManager {
  constructor(private provider: GitProvider) {}

  public async getStatus(projectPath: string): Promise<RepoStatus> {
    // Check if remote origin exists and get URL
    let hasRemote = false;
    let remoteUrl: string | undefined = undefined;
    try {
      const remotes = await this.provider.exec('git remote', projectPath);
      if (remotes.trim()) {
        hasRemote = true;
        try {
          const url = await this.provider.exec('git remote get-url origin', projectPath);
          if (url.trim()) {
            remoteUrl = url.trim();
          }
        } catch {
          // Origin might have a different name, default to first remote name if needed
        }
      }
    } catch {}

    // Get porcelain status with branch info
    // Format: ## branch...upstream [ahead X, behind Y]
    // Followed by: XY PATH
    const rawStatus = await this.provider.exec('git status -b --porcelain', projectPath);
    
    let branch = '';
    let syncStatus = '';
    let ahead = 0;
    let behind = 0;
    const files: FileStatus[] = [];
    
    if (rawStatus) {
      const lines = rawStatus.split('\n');
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        if (line.startsWith('##')) {
          // Parse branch and sync status
          // e.g. ## main...origin/main [ahead 1, behind 2]
          const regex = /##\s+([^\s]+?)(?:\.\.\.([^\s]+))?(?:\s+\[(.*)\])?$/;
          const match = line.match(regex);
          if (match) {
            branch = match[1];
            if (match[3]) {
              syncStatus = match[3];
              const aheadMatch = syncStatus.match(/ahead\s+(\d+)/);
              if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
              const behindMatch = syncStatus.match(/behind\s+(\d+)/);
              if (behindMatch) behind = parseInt(behindMatch[1], 10);
            }
          }
          continue;
        }

        if (line.length < 3) continue;
        const x = line[0];
        const y = line[1];
        const file = line.substring(3);
        
        files.push({
          file,
          staged: x !== ' ' && x !== '?', // A, M, D, etc. in index
          untracked: x === '?' && y === '?',
          modified: y !== ' ' && y !== '?' // M, D in work tree
        });
      }
    }
    
    // Get last commit info
    let lastCommit = '';
    try {
      const log = await this.provider.exec('git log -1 --pretty=format:"%h %s (%cr)"', projectPath);
      lastCommit = log.trim();
    } catch {
      lastCommit = 'No commits yet';
    }

    // Calculate unpushed commits count if ahead is 0 and remote is configured
    if (ahead === 0 && hasRemote) {
      try {
        const unpushed = await this.provider.exec('git rev-list HEAD --not --remotes --count', projectPath);
        ahead = parseInt(unpushed.trim(), 10) || 0;
      } catch (e) {}
    }

    return { branch: branch.trim(), files, syncStatus, ahead, behind, lastCommit, hasRemote, remoteUrl };
  }
}
