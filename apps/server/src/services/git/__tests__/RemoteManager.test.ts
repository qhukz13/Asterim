/**
 * Tests for zero-friction Git authentication (P5.6-02).
 *
 * Three things are covered, none of which needs a network or a real key:
 * the URL conversion between HTTPS and SSH, the environment every git
 * subprocess is given, and what `RemoteManager.push()` does when git comes back
 * saying it could not authenticate. The last of these runs against a scripted
 * stand-in for GitProvider, so the exact sequence of git commands — including
 * whether the original remote URL was put back — is observable.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/git/__tests__/RemoteManager.test.ts
 */

import {
  RemoteManager,
  convertRemoteUrl,
  detectRemoteProtocol,
  isAuthFailure,
  redactRemoteUrl
} from '../RemoteManager';
import { resolveGitEnv, WINDOWS_SSH_AGENT_PIPE } from '../GitProvider';
import type { GitProvider } from '../GitProvider';

// --- Assertion harness ---

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(
    label,
    ok,
    ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

function describe(name: string): void {
  console.log(`\n${name}`);
}

/**
 * A GitProvider stand-in. `handler` answers each git command; throwing from it
 * is how a failing git invocation is expressed. Every command is recorded.
 */
class ScriptedGit {
  public readonly calls: string[] = [];
  public credentialHelper: string | null = null;

  constructor(private handler: (command: string, calls: string[]) => string) {}

  async exec(command: string, _cwd: string): Promise<string> {
    this.calls.push(command);
    return this.handler(command, this.calls);
  }

  async detectCredentialHelper(_cwd: string): Promise<string | null> {
    return this.credentialHelper;
  }

  /** Typed as the real provider for RemoteManager's constructor. */
  asProvider(): GitProvider {
    return this as unknown as GitProvider;
  }
}

const REPO = '/tmp/project';
const AUTH_ERROR =
  "fatal: could not read Username for 'https://github.com': terminal prompts disabled";
const NO_UPSTREAM =
  'fatal: The current branch feature has no upstream branch.\nuse: git push --set-upstream origin feature';

/** Captures the rejection of `promise`, or fails the labelled assertion. */
async function rejection(label: string, promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
    check(label, false, 'expected a rejection, got a resolved promise');
    return new Error('');
  } catch (err) {
    return err as Error;
  }
}

async function main(): Promise<void> {
  // --- convertRemoteUrl ------------------------------------------------------
  describe('convertRemoteUrl — HTTPS to SSH');
  equal(
    'GitHub',
    convertRemoteUrl('https://github.com/owner/repo.git', 'ssh'),
    'git@github.com:owner/repo.git'
  );
  equal(
    'GitHub without the .git suffix',
    convertRemoteUrl('https://github.com/owner/repo', 'ssh'),
    'git@github.com:owner/repo.git'
  );
  equal(
    'GitLab',
    convertRemoteUrl('https://gitlab.com/owner/repo.git', 'ssh'),
    'git@gitlab.com:owner/repo.git'
  );
  equal(
    'Bitbucket',
    convertRemoteUrl('https://bitbucket.org/owner/repo.git', 'ssh'),
    'git@bitbucket.org:owner/repo.git'
  );
  equal(
    'a nested GitLab subgroup path',
    convertRemoteUrl('https://gitlab.com/group/subgroup/repo.git', 'ssh'),
    'git@gitlab.com:group/subgroup/repo.git'
  );
  equal(
    'a self-hosted host',
    convertRemoteUrl('https://git.example.com/team/repo.git', 'ssh'),
    'git@git.example.com:team/repo.git'
  );
  equal(
    'a trailing slash',
    convertRemoteUrl('https://github.com/owner/repo/', 'ssh'),
    'git@github.com:owner/repo.git'
  );
  equal(
    'plain http',
    convertRemoteUrl('http://git.internal/team/repo.git', 'ssh'),
    'git@git.internal:team/repo.git'
  );
  equal(
    'an embedded token is dropped, not carried over',
    convertRemoteUrl('https://ghp_SECRETTOKEN@github.com/owner/repo.git', 'ssh'),
    'git@github.com:owner/repo.git'
  );
  equal(
    'embedded user:password is dropped too',
    convertRemoteUrl('https://user:p%40ss@github.com/owner/repo.git', 'ssh'),
    'git@github.com:owner/repo.git'
  );
  equal(
    'an HTTPS port is dropped — it says nothing about the SSH port',
    convertRemoteUrl('https://git.example.com:8443/team/repo.git', 'ssh'),
    'git@git.example.com:team/repo.git'
  );
  equal(
    'mixed case is preserved in the path',
    convertRemoteUrl('https://github.com/Owner/RepoName.git', 'ssh'),
    'git@github.com:Owner/RepoName.git'
  );

  describe('convertRemoteUrl — SSH to HTTPS');
  equal(
    'scp-style GitHub',
    convertRemoteUrl('git@github.com:owner/repo.git', 'https'),
    'https://github.com/owner/repo.git'
  );
  equal(
    'scp-style without .git',
    convertRemoteUrl('git@github.com:owner/repo', 'https'),
    'https://github.com/owner/repo'
  );
  equal(
    'scp-style GitLab subgroup',
    convertRemoteUrl('git@gitlab.com:group/subgroup/repo.git', 'https'),
    'https://gitlab.com/group/subgroup/repo.git'
  );
  equal(
    'scp-style Bitbucket',
    convertRemoteUrl('git@bitbucket.org:owner/repo.git', 'https'),
    'https://bitbucket.org/owner/repo.git'
  );
  equal(
    'an ssh:// URL',
    convertRemoteUrl('ssh://git@github.com/owner/repo.git', 'https'),
    'https://github.com/owner/repo.git'
  );
  equal(
    'an ssh:// URL with a port',
    convertRemoteUrl('ssh://git@git.example.com:2222/team/repo.git', 'https'),
    'https://git.example.com/team/repo.git'
  );
  equal(
    'a non-git ssh user',
    convertRemoteUrl('deploy@git.example.com:team/repo.git', 'https'),
    'https://git.example.com/team/repo.git'
  );

  describe('convertRemoteUrl — nothing to do');
  equal(
    'SSH asked for SSH is returned untouched',
    convertRemoteUrl('git@github.com:owner/repo.git', 'ssh'),
    'git@github.com:owner/repo.git'
  );
  equal(
    'HTTPS asked for HTTPS is returned untouched',
    convertRemoteUrl('https://github.com/owner/repo.git', 'https'),
    'https://github.com/owner/repo.git'
  );
  equal(
    'a local path is not a remote',
    convertRemoteUrl('/srv/repos/thing.git', 'ssh'),
    '/srv/repos/thing.git'
  );
  equal(
    'a Windows path is not an scp remote',
    convertRemoteUrl('C:\\repos\\thing', 'ssh'),
    'C:\\repos\\thing'
  );
  equal(
    'a file:// URL is left alone',
    convertRemoteUrl('file:///srv/repos/thing.git', 'ssh'),
    'file:///srv/repos/thing.git'
  );
  equal('an empty string is left alone', convertRemoteUrl('', 'ssh'), '');
  equal(
    'surrounding whitespace is trimmed',
    convertRemoteUrl('  https://github.com/owner/repo.git  ', 'ssh'),
    'git@github.com:owner/repo.git'
  );

  describe('convertRemoteUrl — round trips');
  {
    const https = 'https://github.com/owner/repo.git';
    equal(
      'HTTPS to SSH and back is stable',
      convertRemoteUrl(convertRemoteUrl(https, 'ssh'), 'https'),
      https
    );
    const ssh = 'git@gitlab.com:group/sub/repo.git';
    equal(
      'SSH to HTTPS and back is stable',
      convertRemoteUrl(convertRemoteUrl(ssh, 'https'), 'ssh'),
      ssh
    );
  }

  describe('detectRemoteProtocol');
  equal('https', detectRemoteProtocol('https://github.com/owner/repo.git'), 'https');
  equal('http counts as https', detectRemoteProtocol('http://git.internal/team/repo.git'), 'https');
  equal('scp-style', detectRemoteProtocol('git@github.com:owner/repo.git'), 'ssh');
  equal('ssh:// URL', detectRemoteProtocol('ssh://git@github.com/owner/repo.git'), 'ssh');
  equal('a local path has no protocol', detectRemoteProtocol('/srv/repos/thing.git'), null);

  describe('redactRemoteUrl');
  equal(
    'a token is replaced',
    redactRemoteUrl('https://ghp_SECRET@github.com/o/r.git'),
    'https://***@github.com/o/r.git'
  );
  equal(
    'user:password is replaced',
    redactRemoteUrl('https://user:pass@github.com/o/r.git'),
    'https://***@github.com/o/r.git'
  );
  equal(
    'a URL without credentials is unchanged',
    redactRemoteUrl('https://github.com/o/r.git'),
    'https://github.com/o/r.git'
  );
  check(
    'an ssh remote keeps its user, which is not a secret',
    redactRemoteUrl('git@github.com:o/r.git') === 'git@github.com:o/r.git'
  );

  // --- Error classification --------------------------------------------------
  describe('isAuthFailure');
  check('a suppressed username prompt', isAuthFailure(AUTH_ERROR));
  check(
    'a rejected password',
    isAuthFailure('remote: Support for password authentication was removed')
  );
  check('a rejected key', isAuthFailure('git@github.com: Permission denied (publickey).'));
  check('an unknown host key', isAuthFailure('Host key verification failed.'));
  check(
    'an HTTP 403 from the helper',
    isAuthFailure("fatal: Authentication failed for 'https://github.com/o/r.git/'")
  );
  check('a missing upstream is not an auth failure', !isAuthFailure(NO_UPSTREAM));
  check(
    'a rejected non-fast-forward is not an auth failure',
    !isAuthFailure('! [rejected] main -> main (fetch first)')
  );
  check(
    'a network error is not an auth failure',
    !isAuthFailure('fatal: unable to access: Could not resolve host: github.com')
  );

  // --- resolveGitEnv ---------------------------------------------------------
  describe('resolveGitEnv — non-interactive guarantees');
  {
    const env = resolveGitEnv({
      platform: 'linux',
      env: {},
      fileExists: () => false,
      homedir: () => '/home/dev'
    });
    equal('terminal prompts are disabled', env.GIT_TERMINAL_PROMPT, '0');
    check('ssh runs in batch mode', (env.GIT_SSH_COMMAND || '').includes('-o BatchMode=yes'));
    check(
      'and accepts a new host key rather than asking',
      (env.GIT_SSH_COMMAND || '').includes('-o StrictHostKeyChecking=accept-new')
    );
  }

  describe('resolveGitEnv — the ssh agent');
  {
    const env = resolveGitEnv({
      platform: 'linux',
      env: { SSH_AUTH_SOCK: '/run/user/1000/keyring/ssh' },
      fileExists: () => false,
      homedir: () => '/home/dev'
    });
    equal(
      'an inherited POSIX agent socket is passed through',
      env.SSH_AUTH_SOCK,
      '/run/user/1000/keyring/ssh'
    );
  }
  {
    const env = resolveGitEnv({
      platform: 'linux',
      env: {},
      fileExists: () => true,
      homedir: () => '/home/dev'
    });
    equal('no agent is invented on POSIX', env.SSH_AUTH_SOCK, undefined);
  }
  {
    const env = resolveGitEnv({
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\dev' },
      fileExists: () => true,
      homedir: () => 'C:\\Users\\dev'
    });
    equal(
      'the Windows OpenSSH pipe is used when it exists',
      env.SSH_AUTH_SOCK,
      WINDOWS_SSH_AGENT_PIPE
    );
    check(
      'and the Windows OpenSSH client is named, since only it can read that pipe',
      (env.GIT_SSH_COMMAND || '').startsWith('C:\\Windows\\System32\\OpenSSH\\ssh.exe')
    );
  }
  {
    const env = resolveGitEnv({
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\dev' },
      fileExists: () => false,
      homedir: () => 'C:\\Users\\dev'
    });
    equal('no pipe means no invented agent socket', env.SSH_AUTH_SOCK, undefined);
    check('and ssh is left to find itself on PATH', (env.GIT_SSH_COMMAND || '').startsWith('ssh '));
  }
  {
    const env = resolveGitEnv({
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows', SSH_AUTH_SOCK: '\\\\.\\pipe\\custom-agent' },
      fileExists: () => true,
      homedir: () => 'C:\\Users\\dev'
    });
    equal(
      'an agent the developer already set is never overridden',
      env.SSH_AUTH_SOCK,
      '\\\\.\\pipe\\custom-agent'
    );
  }

  describe('resolveGitEnv — a developer-supplied GIT_SSH_COMMAND');
  {
    const env = resolveGitEnv({
      platform: 'linux',
      env: { GIT_SSH_COMMAND: 'ssh -i /home/dev/.ssh/work_key' },
      fileExists: () => false,
      homedir: () => '/home/dev'
    });
    equal(
      'is kept, with only the non-interactive options added',
      env.GIT_SSH_COMMAND,
      'ssh -i /home/dev/.ssh/work_key -o BatchMode=yes -o StrictHostKeyChecking=accept-new'
    );
  }
  {
    const env = resolveGitEnv({
      platform: 'linux',
      env: { GIT_SSH_COMMAND: 'ssh -o BatchMode=no -o StrictHostKeyChecking=yes' },
      fileExists: () => false,
      homedir: () => '/home/dev'
    });
    equal(
      'and options it already sets are not duplicated',
      env.GIT_SSH_COMMAND,
      'ssh -o BatchMode=no -o StrictHostKeyChecking=yes'
    );
  }

  describe('resolveGitEnv — reaching credential helpers');
  {
    const env = resolveGitEnv({
      platform: 'linux',
      env: { PATH: '/usr/bin:/usr/local/bin' },
      fileExists: () => false,
      homedir: () => '/home/dev'
    });
    equal('PATH is passed through untouched', env.PATH, '/usr/bin:/usr/local/bin');
    equal('a missing HOME is filled in', env.HOME, '/home/dev');
  }
  {
    const env = resolveGitEnv({
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\dev' },
      fileExists: () => false,
      homedir: () => 'C:\\Users\\dev'
    });
    equal('HOME follows USERPROFILE on Windows', env.HOME, 'C:\\Users\\dev');
  }
  {
    const env = resolveGitEnv({
      platform: 'linux',
      env: { HOME: '/home/other', GIT_AUTHOR_NAME: 'Dev' },
      fileExists: () => false,
      homedir: () => '/home/dev'
    });
    equal('an existing HOME is not rewritten', env.HOME, '/home/other');
    equal('and unrelated variables survive', env.GIT_AUTHOR_NAME, 'Dev');
  }

  // --- push ------------------------------------------------------------------
  describe('push — the ordinary paths');
  {
    const git = new ScriptedGit(command => {
      if (command === 'git remote') return 'origin';
      if (command === 'git push') return 'Everything up-to-date';
      throw new Error(`unexpected command: ${command}`);
    });
    await new RemoteManager(git.asProvider()).push(REPO);
    equal('a working push runs exactly two commands', git.calls, ['git remote', 'git push']);
  }
  {
    const git = new ScriptedGit(command => {
      if (command === 'git remote') return '';
      throw new Error(`unexpected command: ${command}`);
    });
    const err = await rejection(
      'no remote configured rejects',
      new RemoteManager(git.asProvider()).push(REPO)
    );
    check('with an actionable message', err.message.includes('No remote repository configured'));
    equal('and nothing is pushed', git.calls, ['git remote']);
  }
  {
    const git = new ScriptedGit(command => {
      if (command === 'git remote') return 'origin';
      if (command === 'git push') throw new Error(NO_UPSTREAM);
      if (command === 'git rev-parse --abbrev-ref HEAD') return 'feature';
      if (command === 'git push -u origin "feature"')
        return 'branch feature set up to track origin/feature';
      throw new Error(`unexpected command: ${command}`);
    });
    await new RemoteManager(git.asProvider()).push(REPO);
    check('a branch with no upstream gets one', git.calls.includes('git push -u origin "feature"'));
  }
  {
    const git = new ScriptedGit(command => {
      if (command === 'git remote') return 'origin';
      if (command === 'git push') throw new Error('! [rejected] main -> main (fetch first)');
      throw new Error(`unexpected command: ${command}`);
    });
    const err = await rejection(
      'a non-auth failure rejects',
      new RemoteManager(git.asProvider()).push(REPO)
    );
    equal(
      'and is passed through untouched',
      err.message,
      '! [rejected] main -> main (fetch first)'
    );
    equal('without touching the remote URL', git.calls, ['git remote', 'git push']);
  }

  describe('push — HTTPS that cannot authenticate falls back to SSH');
  {
    let pushes = 0;
    const git = new ScriptedGit(command => {
      if (command === 'git remote') return 'origin';
      if (command === 'git remote get-url origin') return 'https://github.com/owner/repo.git';
      if (command === 'git push') {
        pushes++;
        if (pushes === 1) throw new Error(AUTH_ERROR);
        return 'To github.com:owner/repo.git';
      }
      if (command.startsWith('git remote set-url origin')) return '';
      throw new Error(`unexpected command: ${command}`);
    });
    await new RemoteManager(git.asProvider()).push(REPO);
    check(
      'origin is converted to SSH',
      git.calls.includes('git remote set-url origin "git@github.com:owner/repo.git"')
    );
    equal('the push is retried once', pushes, 2);
    equal(
      'and the working URL is kept — no restore',
      git.calls.filter(c => c.startsWith('git remote set-url')).length,
      1
    );
  }
  {
    const git = new ScriptedGit(command => {
      if (command === 'git remote') return 'origin';
      if (command === 'git remote get-url origin') return 'https://github.com/owner/repo.git';
      if (command === 'git push') throw new Error(AUTH_ERROR);
      if (command.startsWith('git remote set-url origin')) return '';
      throw new Error(`unexpected command: ${command}`);
    });
    const err = await rejection(
      'a failed retry rejects',
      new RemoteManager(git.asProvider()).push(REPO)
    );
    equal(
      'the original remote URL is restored',
      git.calls.filter(c => c.startsWith('git remote set-url')),
      [
        'git remote set-url origin "git@github.com:owner/repo.git"',
        'git remote set-url origin "https://github.com/owner/repo.git"'
      ]
    );
    check('the message says the SSH retry was tried', err.message.includes('retrying over SSH'));
    check('and tells the developer what to do', err.message.includes('ssh-add'));
    check(
      'and mentions the credential helper alternative',
      err.message.includes('credential.helper')
    );
    check(
      'the original failure is preserved as the cause',
      (err.cause as Error)?.message === AUTH_ERROR
    );
  }
  {
    // A token in the remote URL must not reach the error message.
    const git = new ScriptedGit(command => {
      if (command === 'git remote') return 'origin';
      if (command === 'git remote get-url origin')
        return 'https://ghp_SUPERSECRET@github.com/owner/repo.git';
      if (command === 'git push') throw new Error(AUTH_ERROR);
      if (command.startsWith('git remote set-url origin')) return '';
      throw new Error(`unexpected command: ${command}`);
    });
    const err = await rejection(
      'a failed retry on a tokenised URL rejects',
      new RemoteManager(git.asProvider()).push(REPO)
    );
    check('the token never appears in the message', !err.message.includes('ghp_SUPERSECRET'));
    check('it is redacted instead', err.message.includes('https://***@github.com/owner/repo.git'));
  }
  {
    // An unpushed branch on a fresh HTTPS clone: upstream *and* credentials.
    let upstreamPushes = 0;
    const git = new ScriptedGit(command => {
      if (command === 'git remote') return 'origin';
      if (command === 'git remote get-url origin') return 'https://github.com/owner/repo.git';
      if (command === 'git push') throw new Error(NO_UPSTREAM);
      if (command === 'git rev-parse --abbrev-ref HEAD') return 'feature';
      if (command === 'git push -u origin "feature"') {
        upstreamPushes++;
        if (upstreamPushes === 1) throw new Error(AUTH_ERROR);
        return 'branch feature set up to track origin/feature';
      }
      if (command.startsWith('git remote set-url origin')) return '';
      throw new Error(`unexpected command: ${command}`);
    });
    await new RemoteManager(git.asProvider()).push(REPO);
    check('the upstream push is retried over SSH too', upstreamPushes === 2);
    check(
      'after converting origin',
      git.calls.includes('git remote set-url origin "git@github.com:owner/repo.git"')
    );
  }

  describe('push — SSH that cannot authenticate');
  {
    const git = new ScriptedGit(command => {
      if (command === 'git remote') return 'origin';
      if (command === 'git remote get-url origin') return 'git@github.com:owner/repo.git';
      if (command === 'git push') throw new Error('git@github.com: Permission denied (publickey).');
      throw new Error(`unexpected command: ${command}`);
    });
    const err = await rejection(
      'rejects when no credential helper exists',
      new RemoteManager(git.asProvider()).push(REPO)
    );
    check(
      'explaining why HTTPS was not tried',
      err.message.includes('no credential helper is configured')
    );
    equal(
      'and the remote URL is left alone',
      git.calls.filter(c => c.startsWith('git remote set-url')),
      []
    );
  }
  {
    let pushes = 0;
    const git = new ScriptedGit(command => {
      if (command === 'git remote') return 'origin';
      if (command === 'git remote get-url origin') return 'git@github.com:owner/repo.git';
      if (command === 'git push') {
        pushes++;
        if (pushes === 1) throw new Error('git@github.com: Permission denied (publickey).');
        return 'To https://github.com/owner/repo.git';
      }
      if (command.startsWith('git remote set-url origin')) return '';
      throw new Error(`unexpected command: ${command}`);
    });
    git.credentialHelper = 'manager';
    await new RemoteManager(git.asProvider()).push(REPO);
    check(
      'a configured helper makes the HTTPS fallback worth trying',
      git.calls.includes('git remote set-url origin "https://github.com/owner/repo.git"')
    );
    equal('and the push succeeds on the retry', pushes, 2);
  }
  {
    const git = new ScriptedGit(command => {
      if (command === 'git remote') return 'origin';
      if (command === 'git remote get-url origin') return '/srv/mirrors/repo.git';
      if (command === 'git push') throw new Error(AUTH_ERROR);
      throw new Error(`unexpected command: ${command}`);
    });
    const err = await rejection(
      'a local remote rejects',
      new RemoteManager(git.asProvider()).push(REPO)
    );
    check('saying it is not convertible', err.message.includes('not an HTTPS or SSH remote'));
    equal(
      'and nothing is rewritten',
      git.calls.filter(c => c.startsWith('git remote set-url')),
      []
    );
  }
  {
    const git = new ScriptedGit(command => {
      if (command === 'git remote') return 'origin';
      if (command === 'git remote get-url origin') throw new Error('fatal: No such remote origin');
      if (command === 'git push') throw new Error(AUTH_ERROR);
      throw new Error(`unexpected command: ${command}`);
    });
    const err = await rejection(
      'an origin with no URL rejects',
      new RemoteManager(git.asProvider()).push(REPO)
    );
    check('saying there was nothing to convert', err.message.includes('no URL to convert'));
  }
  {
    // The retry fails *and* the restore fails: the developer must be told the
    // remote was left converted.
    const git = new ScriptedGit((command, calls) => {
      if (command === 'git remote') return 'origin';
      if (command === 'git remote get-url origin') return 'https://github.com/owner/repo.git';
      if (command === 'git push') throw new Error(AUTH_ERROR);
      if (command.startsWith('git remote set-url origin')) {
        if (calls.filter(c => c.startsWith('git remote set-url')).length > 1) {
          throw new Error('fatal: could not lock config file');
        }
        return '';
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const err = await rejection(
      'a failed restore still rejects',
      new RemoteManager(git.asProvider()).push(REPO)
    );
    check('and says the remote was left converted', err.message.includes('could not be restored'));
    check(
      'naming what origin now points at',
      err.message.includes('git@github.com:owner/repo.git')
    );
  }
}

main()
  .catch(err => {
    failed++;
    console.error('\nUNCAUGHT ERROR:', err);
  })
  .finally(() => {
    console.log(`\n${passed}/${passed + failed} assertions passed`);
    if (failures.length > 0) {
      console.log('Failed assertions:');
      for (const f of failures) console.log(`  - ${f}`);
    }
    process.exit(failed === 0 ? 0 : 1);
  });
