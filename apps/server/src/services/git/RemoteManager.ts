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
    await this.provider.exec('git push', projectPath);
  }
}
