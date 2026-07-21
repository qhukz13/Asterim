import { GitProvider } from './GitProvider';

export class DiffManager {
  constructor(private provider: GitProvider) {}

  /**
   * Gets the diff for a specific file.
   * If the file is staged, we might want the cached diff.
   */
  public async getDiff(projectPath: string, file: string, staged: boolean = false): Promise<string> {
    try {
      const command = staged 
        ? `git diff --cached -- "${file}"` 
        : `git diff -- "${file}"`;
        
      const diff = await this.provider.exec(command, projectPath);
      
      // If unstaged diff is empty but file is untracked, git diff returns nothing.
      // We might need to handle untracked files differently if needed, 
      // but standard git diff behaviour is generally fine for the MVP.
      return diff;
    } catch (err) {
      return '';
    }
  }
}
