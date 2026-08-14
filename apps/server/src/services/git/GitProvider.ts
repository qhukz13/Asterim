import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';

const execAsync = promisify(exec);

/** The Windows OpenSSH agent listens on this named pipe. */
export const WINDOWS_SSH_AGENT_PIPE = '//./pipe/openssh-ssh-agent';

/**
 * Everything `resolveGitEnv` reads about the machine. Defaulted from the real
 * process; supplied explicitly by the tests, which have to describe a Windows
 * workstation from a Linux one.
 */
export interface GitEnvProbe {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  fileExists?: (path: string) => boolean;
  homedir?: () => string;
}

/** True when `command` already carries `-o <option>=`, in any casing. */
function hasSshOption(command: string, option: string): boolean {
  return new RegExp(`-o\\s+${option}\\s*=`, 'i').test(command);
}

function quoteIfNeeded(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

/**
 * Builds the environment every git subprocess runs under.
 *
 * Asterim never stores credentials (`blueprint/GIT.md`); it borrows the ones the
 * developer already has. That only works if the subprocess can see them, which
 * is what this function arranges:
 *
 * - the running `ssh-agent`, through `SSH_AUTH_SOCK` — inherited on POSIX,
 *   pointed at the OpenSSH named pipe on Windows when nothing else set it;
 * - the configured credential helper, which git finds on `PATH` and reads its
 *   configuration for from `HOME`, so both are guaranteed to be present;
 * - and, above all, no prompt: `GIT_TERMINAL_PROMPT=0` plus ssh's `BatchMode`
 *   turn a credential request into an error instead of a background process
 *   blocked forever on a terminal nobody is attached to.
 *
 * A `GIT_SSH_COMMAND` the developer set is kept rather than replaced — only the
 * non-interactive options are added to it, and only when it lacks them.
 */
export function resolveGitEnv(probe: GitEnvProbe = {}): NodeJS.ProcessEnv {
  const platform = probe.platform ?? process.platform;
  const base = probe.env ?? process.env;
  const fileExists = probe.fileExists ?? ((p: string) => fs.existsSync(p));
  const homedir = probe.homedir ?? (() => os.homedir());

  const isWindows = platform === 'win32';
  const env: NodeJS.ProcessEnv = { ...base };

  // Non-negotiable: a background push must fail loudly rather than wait on a
  // prompt that no one can answer.
  env.GIT_TERMINAL_PROMPT = '0';

  // The agent socket. On POSIX it is inherited above and only needs to survive;
  // on Windows there is no socket to inherit, so the OpenSSH agent's named pipe
  // is used when it is actually there.
  if (!env.SSH_AUTH_SOCK && isWindows && fileExists(WINDOWS_SSH_AGENT_PIPE)) {
    env.SSH_AUTH_SOCK = WINDOWS_SSH_AGENT_PIPE;
  }

  let sshCommand = base.GIT_SSH_COMMAND?.trim();
  if (!sshCommand) {
    // Only the Windows OpenSSH client can talk to that pipe — the ssh.exe
    // bundled with Git for Windows cannot — so it is named explicitly when the
    // pipe is what we are relying on.
    const systemRoot = base.SystemRoot || base.SYSTEMROOT || 'C:\\Windows';
    const windowsSsh = `${systemRoot}\\System32\\OpenSSH\\ssh.exe`;
    sshCommand =
      isWindows && env.SSH_AUTH_SOCK === WINDOWS_SSH_AGENT_PIPE && fileExists(windowsSsh)
        ? quoteIfNeeded(windowsSsh)
        : 'ssh';
  }

  if (!hasSshOption(sshCommand, 'BatchMode')) {
    sshCommand += ' -o BatchMode=yes';
  }
  if (!hasSshOption(sshCommand, 'StrictHostKeyChecking')) {
    sshCommand += ' -o StrictHostKeyChecking=accept-new';
  }
  env.GIT_SSH_COMMAND = sshCommand;

  // Credential helpers are found on PATH and read their configuration out of
  // the home directory. A service-managed process can start without either.
  if (!env.HOME) {
    env.HOME = env.USERPROFILE || homedir();
  }
  if (isWindows && !env.USERPROFILE) {
    env.USERPROFILE = env.HOME;
  }

  return env;
}

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

      const { stdout } = await execAsync(command, { cwd, env: resolveGitEnv() });
      return stdout.trim();
    } catch (error: any) {
      // Special case for git diff --no-index which exits with code 1 when diff exists
      if (command.includes('diff --no-index') && error.stdout && typeof error.stdout === 'string') {
        return error.stdout.trim();
      }
      const fullError = error.stderr || error.stdout || error.message || 'Git command failed';
      throw new Error(fullError.trim(), { cause: error });
    }
  }

  /**
   * The credential helper git would use in this repository, or null when none is
   * configured. Only the helper's name is read — never a credential.
   */
  public async detectCredentialHelper(cwd: string): Promise<string | null> {
    try {
      const helper = await this.exec('git config --get credential.helper', cwd);
      return helper.trim() || null;
    } catch {
      // `git config --get` exits non-zero when the key is unset.
      return null;
    }
  }
}
