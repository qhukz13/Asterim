import { GitProvider } from './GitProvider';

export class RemoteManager {
  constructor(private provider: GitProvider) {}

  public async fetch(projectPath: string): Promise<void> {
    await this.provider.exec('git fetch', projectPath);
  }

  public async pull(projectPath: string): Promise<void> {
    await this.provider.exec('git pull', projectPath);
  }

  public async push(projectPath: string): Promise<void> {
    try {
      const remotes = await this.provider.exec('git remote', projectPath);
      if (!remotes.trim()) {
        throw new Error('No remote repository configured. Add a Git remote origin to push changes.');
      }
      await this.provider.exec('git push', projectPath);
    } catch (err: any) {
      const errMsg = err.message || '';
      if (errMsg.includes('no upstream branch') || errMsg.includes('has no upstream branch') || errMsg.includes('set-upstream')) {
        try {
          const currentBranch = (await this.provider.exec('git rev-parse --abbrev-ref HEAD', projectPath)).trim();
          await this.provider.exec(`git push -u origin "${currentBranch}"`, projectPath);
          return;
        } catch (e: any) {
          throw new Error(`Failed to push branch: ${e.message}`);
        }
      }
      if (errMsg.includes('could not read Username') || errMsg.includes('Authentication failed') || errMsg.includes('Permission denied')) {
        throw new Error('Git authentication failed (non-interactive session). Please configure SSH keys or Git credential helper for this repository.');
      }
      throw err;
    }
  }
}
