import { GitProvider } from './GitProvider';

export class BranchManager {
  constructor(private provider: GitProvider) {}

  public async getBranches(projectPath: string): Promise<string[]> {
    const raw = await this.provider.exec('git branch --format="%(refname:short)"', projectPath);
    return raw.split('\n').filter(b => b.trim() !== '');
  }

  public async switchBranch(projectPath: string, branch: string): Promise<void> {
    await this.provider.exec(`git checkout "${branch}"`, projectPath);
  }

  public async createBranch(projectPath: string, branch: string, checkout: boolean = true): Promise<void> {
    if (checkout) {
      await this.provider.exec(`git checkout -b "${branch}"`, projectPath);
    } else {
      await this.provider.exec(`git branch "${branch}"`, projectPath);
    }
  }
}
