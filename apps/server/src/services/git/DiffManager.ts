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
        
      let diff = await this.provider.exec(command, projectPath);
      
      // If unstaged diff is empty, check if it's an untracked file using git diff --no-index
      if (!diff && !staged) {
        try {
          diff = await this.provider.exec(`git diff --no-index -- /dev/null "${file}"`, projectPath);
        } catch (e) {}
      }

      return diff;
    } catch (err) {
      return '';
    }
  }
}
