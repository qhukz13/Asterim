import { GitProvider } from './GitProvider';

export interface CommitHistory {
  hash: string;
  author: string;
  date: string;
  message: string;
}

export class HistoryManager {
  constructor(private provider: GitProvider) {}

  public async getHistory(projectPath: string, limit: number = 20): Promise<CommitHistory[]> {
    // Format: %H|%an|%ad|%s
    const format = '%H|%an|%ad|%s';
    try {
      const raw = await this.provider.exec(`git log -n ${limit} --format="${format}"`, projectPath);
      
      return raw.split('\n').filter(line => line.trim().length > 0).map(line => {
        const parts = line.split('|');
        return {
          hash: parts[0],
          author: parts[1],
          date: parts[2],
          message: parts.slice(3).join('|') // In case message had pipes
        };
      });
    } catch {
      return [];
    }
  }
}
