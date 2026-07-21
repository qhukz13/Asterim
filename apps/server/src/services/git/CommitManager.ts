import { GitProvider } from './GitProvider';

export class CommitManager {
  constructor(private provider: GitProvider) {}

  public async stageFile(projectPath: string, file: string): Promise<void> {
    await this.provider.exec(`git add "${file}"`, projectPath);
  }

  public async stageAll(projectPath: string): Promise<void> {
    await this.provider.exec(`git add -A`, projectPath);
  }

  public async unstageFile(projectPath: string, file: string): Promise<void> {
    await this.provider.exec(`git restore --staged "${file}"`, projectPath);
  }

  public async commit(projectPath: string, message: string): Promise<void> {
    if (!message || message.trim() === '') {
      throw new Error('Commit message cannot be empty');
    }
    
    // We must escape quotes in the commit message
    const escapedMessage = message.replace(/"/g, '\\"');
    await this.provider.exec(`git commit -m "${escapedMessage}"`, projectPath);
  }
}
