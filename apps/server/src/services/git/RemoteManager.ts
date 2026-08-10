import { GitProvider } from './GitProvider';

export class RemoteManager {
  constructor(private provider: GitProvider) {}

  public async fetch(projectPath: string): Promise<void> {
    await this.provider.exec('git fetch', projectPath);
  }

  public async pull(projectPath: string): Promise<void> {
    await this.provider.exec('git pull', projectPath);
  }

  public async getRemoteUrl(projectPath: string): Promise<string | null> {
    try {
      const url = await this.provider.exec('git remote get-url origin', projectPath);
      return url.trim() || null;
    } catch {
      return null;
    }
  }

  public async setRemoteUrl(projectPath: string, remoteUrl: string): Promise<void> {
    const cleanUrl = remoteUrl.trim();
    if (!cleanUrl) {
      throw new Error('Remote URL cannot be empty.');
    }

    const existingUrl = await this.getRemoteUrl(projectPath);
    if (existingUrl) {
      await this.provider.exec(`git remote set-url origin "${cleanUrl}"`, projectPath);
    } else {
      await this.provider.exec(`git remote add origin "${cleanUrl}"`, projectPath);
    }
  }

  public async push(projectPath: string): Promise<void> {
    try {
      const remotes = await this.provider.exec('git remote', projectPath);
      if (!remotes.trim()) {
        throw new Error('No remote repository configured. Please connect a GitHub or Git remote origin URL.');
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

