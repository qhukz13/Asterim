import { GitProvider } from './GitProvider';

export type RemoteProtocol = 'ssh' | 'https';

/** The parts of a remote URL that survive a protocol conversion. */
interface ParsedRemote {
  protocol: RemoteProtocol;
  host: string;
  /** Repository path with no leading or trailing slash and no `.git` suffix. */
  path: string;
  hasGitSuffix: boolean;
}

// The userinfo group is greedy so that a credential containing '@' is consumed
// whole and the host is still read correctly.
const HTTP_REMOTE = /^https?:\/\/(?:[^/]*@)?([^/:@]+)(?::\d+)?\/(.+)$/i;
const SSH_URL_REMOTE = /^ssh:\/\/(?:[^/]*@)?([^/:@]+)(?::\d+)?\/(.+)$/i;
const SCP_REMOTE = /^(?:([^@\s/]+)@)?([^\s/:]+):(?!\/)(.+)$/;

function stripPath(rawPath: string): { path: string; hasGitSuffix: boolean } {
  let path = rawPath.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  const hasGitSuffix = /\.git$/i.test(path);
  if (hasGitSuffix) {
    path = path.slice(0, -4);
  }
  return { path, hasGitSuffix };
}

/**
 * Splits a remote URL into host and repository path, or returns null when the
 * URL is not one this module knows how to convert (a local path, a `file://`
 * URL, a Windows drive path).
 */
function parseRemote(url: string): ParsedRemote | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const http = HTTP_REMOTE.exec(trimmed);
  if (http) {
    const { path, hasGitSuffix } = stripPath(http[2]);
    return path ? { protocol: 'https', host: http[1], path, hasGitSuffix } : null;
  }

  const sshUrl = SSH_URL_REMOTE.exec(trimmed);
  if (sshUrl) {
    const { path, hasGitSuffix } = stripPath(sshUrl[2]);
    return path ? { protocol: 'ssh', host: sshUrl[1], path, hasGitSuffix } : null;
  }

  const scp = SCP_REMOTE.exec(trimmed);
  if (scp) {
    const [, user, host, rawPath] = scp;
    // `C:\repos\thing` also matches the scp shape. A real remote either names a
    // user or has a dotted hostname, and never continues with a backslash.
    const looksLikeHost = Boolean(user) || host.includes('.');
    if (looksLikeHost && !rawPath.startsWith('\\')) {
      const { path, hasGitSuffix } = stripPath(rawPath);
      return path ? { protocol: 'ssh', host, path, hasGitSuffix } : null;
    }
  }

  return null;
}

/** The protocol a remote URL speaks, or null when it is neither HTTP(S) nor SSH. */
export function detectRemoteProtocol(url: string): RemoteProtocol | null {
  return parseRemote(url)?.protocol ?? null;
}

/**
 * Converts a remote URL between HTTPS and SSH.
 *
 * Returns the URL unchanged when it already speaks the requested protocol or
 * when it is not convertible, so a caller can treat "nothing changed" as
 * "there is nothing to try".
 *
 * Two deliberate losses. Embedded credentials (`https://TOKEN@host/…`) are
 * dropped rather than carried into an SSH URL, where they mean nothing and
 * would only leak. An explicit port is dropped too: an HTTPS port says nothing
 * about which port sshd listens on, so the default is the only honest guess.
 */
export function convertRemoteUrl(url: string, targetProtocol: RemoteProtocol): string {
  const parsed = parseRemote(url);
  if (!parsed || parsed.protocol === targetProtocol) {
    return url.trim() || url;
  }

  if (targetProtocol === 'ssh') {
    // scp-style remotes conventionally carry the `.git` suffix.
    return `git@${parsed.host}:${parsed.path}.git`;
  }
  return `https://${parsed.host}/${parsed.path}${parsed.hasGitSuffix ? '.git' : ''}`;
}

/** Replaces any embedded credentials with `***` so a URL is safe to show. */
export function redactRemoteUrl(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, '$1***@');
}

/**
 * Git failed because it could not authenticate — as opposed to failing on a
 * conflict, a missing upstream, or a network error. `GIT_TERMINAL_PROMPT=0` and
 * ssh's `BatchMode` turn what would have been a prompt into one of these.
 */
export function isAuthFailure(message: string): boolean {
  return [
    'could not read Username',
    'could not read Password',
    'Authentication failed',
    'Permission denied',
    'Host key verification failed',
    'terminal prompts disabled',
    'Support for password authentication was removed'
  ].some(pattern => message.includes(pattern));
}

/** The message of whatever git threw, without assuming it was an Error. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? '');
}

/** Rejects anything that would break out of the quoted argument in `set-url`. */
function isSafeRemoteUrl(url: string): boolean {
  return !/["'`$\\;\s]/.test(url);
}

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
      // No origin configured, or not a repository.
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

  /**
   * Pushes the current branch, setting its upstream on the first push.
   *
   * When the push fails for want of credentials, the remote is converted to the
   * other protocol and the push is tried once more: a repository cloned over
   * HTTPS on a workstation whose keys live in ssh-agent authenticates over SSH
   * without the developer doing anything. A successful retry keeps the new URL;
   * a failed one puts the original back before reporting.
   */
  public async push(projectPath: string): Promise<void> {
    const remotes = await this.provider.exec('git remote', projectPath);
    if (!remotes.trim()) {
      throw new Error(
        'No remote repository configured. Please connect a GitHub or Git remote origin URL.'
      );
    }

    try {
      await this.pushCurrentBranch(projectPath);
    } catch (err) {
      if (!isAuthFailure(errorMessage(err))) {
        throw err;
      }
      await this.retryOverOtherProtocol(projectPath, err);
    }
  }

  /** `git push`, falling back to `push -u origin <branch>` for a new branch. */
  private async pushCurrentBranch(projectPath: string): Promise<void> {
    try {
      await this.provider.exec('git push', projectPath);
      return;
    } catch (err) {
      const errMsg = errorMessage(err);
      const needsUpstream =
        errMsg.includes('no upstream branch') ||
        errMsg.includes('has no upstream branch') ||
        errMsg.includes('set-upstream');
      if (!needsUpstream) {
        throw err;
      }

      const currentBranch = (
        await this.provider.exec('git rev-parse --abbrev-ref HEAD', projectPath)
      ).trim();
      try {
        await this.provider.exec(`git push -u origin "${currentBranch}"`, projectPath);
      } catch (e) {
        // Authentication failures are re-thrown untouched so the caller can
        // recognise them and try the other protocol.
        if (isAuthFailure(errorMessage(e))) {
          throw e;
        }
        throw new Error(`Failed to push branch: ${errorMessage(e)}`, { cause: e });
      }
    }
  }

  /**
   * Converts origin to the other protocol and pushes again. Always throws
   * unless the retry succeeds.
   */
  private async retryOverOtherProtocol(projectPath: string, originalError: unknown): Promise<void> {
    const originUrl = await this.getRemoteUrl(projectPath);
    if (!originUrl) {
      throw authError(originalError, null, 'origin has no URL to convert');
    }

    const protocol = detectRemoteProtocol(originUrl);
    if (!protocol) {
      throw authError(originalError, originUrl, 'the origin URL is not an HTTPS or SSH remote');
    }

    const target: RemoteProtocol = protocol === 'https' ? 'ssh' : 'https';

    // Going the other way — SSH to HTTPS — is only worth attempting when a
    // credential helper exists to answer for it. Without one it would fail the
    // same way and churn the remote URL for nothing.
    if (target === 'https' && !(await this.provider.detectCredentialHelper(projectPath))) {
      throw authError(
        originalError,
        originUrl,
        'no credential helper is configured to authenticate over HTTPS'
      );
    }

    const convertedUrl = convertRemoteUrl(originUrl, target);
    if (convertedUrl === originUrl.trim()) {
      throw authError(
        originalError,
        originUrl,
        `the origin URL could not be converted to ${target.toUpperCase()}`
      );
    }
    if (!isSafeRemoteUrl(convertedUrl)) {
      throw authError(originalError, originUrl, 'the converted URL contained unsafe characters');
    }

    await this.provider.exec(`git remote set-url origin "${convertedUrl}"`, projectPath);
    try {
      await this.pushCurrentBranch(projectPath);
    } catch (retryError) {
      let restoreNote = '';
      try {
        await this.provider.exec(`git remote set-url origin "${originUrl}"`, projectPath);
      } catch {
        restoreNote = ` The original remote URL could not be restored; origin is now ${redactRemoteUrl(convertedUrl)}.`;
      }
      throw authError(
        retryError,
        originUrl,
        `retrying over ${target.toUpperCase()} (${redactRemoteUrl(convertedUrl)}) failed as well${restoreNote}`
      );
    }
  }
}

/**
 * The message a developer sees when a push cannot authenticate. It names what
 * was tried and what to do about it — Asterim cannot ask for a password, by
 * design, so the fix is always something to set up once on the workstation.
 */
function authError(cause: unknown, originUrl: string | null, detail: string): Error {
  const where = originUrl ? ` to ${redactRemoteUrl(originUrl)}` : '';
  return new Error(
    `Git push${where} failed to authenticate, and ${detail}. ` +
      'Asterim runs git non-interactively and never stores credentials, so it cannot prompt for one. ' +
      'Load your key into the agent (ssh-add ~/.ssh/id_ed25519) for SSH, ' +
      'or configure a credential helper (git config --global credential.helper manager) ' +
      'or a Personal Access Token remote (https://TOKEN@github.com/user/repo.git) for HTTPS.',
    { cause }
  );
}
