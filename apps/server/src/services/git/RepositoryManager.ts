import fs from 'fs/promises';
import path from 'path';
import { GitProvider } from './GitProvider';

export class RepositoryManager {
  constructor(private provider: GitProvider) {}

  /**
   * Checks if a .git directory exists in the given path.
   */
  public async isRepository(projectPath: string): Promise<boolean> {
    try {
      const stat = await fs.stat(path.join(projectPath, '.git'));
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Initializes a new repository.
   */
  public async initRepository(projectPath: string): Promise<void> {
    await this.provider.exec('git init', projectPath);
  }
}
