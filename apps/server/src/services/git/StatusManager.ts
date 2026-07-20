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
  lastCommit?: string;
}

export class StatusManager {
  constructor(private provider: GitProvider) {}

  public async getStatus(projectPath: string): Promise<RepoStatus> {
    // Get porcelain status with branch info
    // Format: ## branch...upstream [ahead X, behind Y]
    // Followed by: XY PATH
    const rawStatus = await this.provider.exec('git status -b --porcelain', projectPath);
    
    let branch = '';
    let syncStatus = '';
    const files: FileStatus[] = [];
    
    if (rawStatus) {
      const lines = rawStatus.split('\n');
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        if (line.startsWith('##')) {
          // Parse branch and sync status
          // e.g. ## main...origin/main [ahead 1, behind 2]
          const regex = /##\s+([^.\s]+)(?:\.\.\.([^\s]+))?(?:\s+\[(.*)\])?/;
          const match = line.match(regex);
          if (match) {
            branch = match[1];
            if (match[3]) {
              syncStatus = match[3];
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

    // Fallback if branch is still empty (e.g., completely empty uninitialized repo, though 'git status -b' usually outputs '## No commits yet on master')
    if (!branch) {
      try {
        branch = await this.provider.exec('git branch --show-current', projectPath);
      } catch {
        branch = 'master';
      }
    }

    return { branch: branch.trim(), files, syncStatus, lastCommit };
  }
}
