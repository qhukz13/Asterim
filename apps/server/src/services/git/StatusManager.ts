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
}

export class StatusManager {
  constructor(private provider: GitProvider) {}

  public async getStatus(projectPath: string): Promise<RepoStatus> {
    // Get current branch
    const branch = await this.provider.exec('git branch --show-current', projectPath);

    // Get porcelain status
    // Format: XY PATH
    const rawStatus = await this.provider.exec('git status --porcelain', projectPath);
    
    const files: FileStatus[] = [];
    if (rawStatus) {
      const lines = rawStatus.split('\n');
      for (const line of lines) {
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

    return { branch, files };
  }
}
