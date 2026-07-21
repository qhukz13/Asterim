import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class GitProvider {
  /**
   * Executes a git command in the given directory.
   * Prevents execution of non-git commands.
   */
  public async exec(command: string, cwd: string): Promise<string> {
    try {
      if (!command.startsWith('git ')) {
        throw new Error('GitProvider can only execute git commands.');
      }
      
      const { stdout } = await execAsync(command, { cwd });
      return stdout.trim();
    } catch (error: any) {
      throw new Error(`Git command failed: ${error.message}`);
    }
  }
}
