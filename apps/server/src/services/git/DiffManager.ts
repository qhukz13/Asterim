import { GitProvider } from './GitProvider';

export class DiffManager {
  constructor(private provider: GitProvider) {}

  /**
   * Gets the diff for a specific file.
   * If the file is staged, we might want the cached diff.
   */
  public async getDiff(projectPath: string, file?: string, staged: boolean = false): Promise<string> {
    try {
      const fileTarget = file ? `-- "${file}"` : '';
      const command = staged 
        ? `git diff --cached ${fileTarget}`.trim() 
        : `git diff ${fileTarget}`.trim();
        
      let diff = await this.provider.exec(command, projectPath);
      
      // If unstaged diff is empty and file is specified, check if it's an untracked file using git diff --no-index
      if (!diff && !staged && file) {
        try {
          diff = await this.provider.exec(`git diff --no-index -- /dev/null "${file}"`, projectPath);
        } catch {
          // --no-index cannot read the path (no /dev/null on Windows); leave the
          // diff empty rather than fail the request.
        }
      }

      return diff;
    } catch (err) {
      return '';
    }
  }
}
