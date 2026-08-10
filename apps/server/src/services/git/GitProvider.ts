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
      
      const env = {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new'
      };

      const { stdout } = await execAsync(command, { cwd, env });
      return stdout.trim();
    } catch (error: any) {
      // Special case for git diff --no-index which exits with code 1 when diff exists
      if (command.includes('diff --no-index') && error.stdout && typeof error.stdout === 'string') {
        return error.stdout.trim();
      }
      const fullError = error.stderr || error.stdout || error.message || 'Git command failed';
      throw new Error(fullError.trim());
    }
  }
}
