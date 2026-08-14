# Execution Report: P5.6-02 — Zero-Friction Git Credential & SSH Auto-Detection Engine

**Task ID:** P5.6-02  
**Phase:** Phase 5.6 — SaaS Foundation & Commercial Beta Release  
**Status:** IMPLEMENTED & VERIFIED  
**Date:** 2026-08-15  
**Author:** Claude Code  

---

## 1. Summary

`GitProvider` now builds its subprocess environment through `resolveGitEnv()` instead of two hardcoded
variables: the running `ssh-agent` is inherited on POSIX and located on the Windows OpenSSH named pipe,
`HOME`/`USERPROFILE`/`PATH` are guaranteed so credential helpers are reachable, a `GIT_SSH_COMMAND` the
developer already set is respected rather than overwritten, and the non-interactive guarantee
(`GIT_TERMINAL_PROMPT=0` plus ssh `BatchMode`) is enforced on every path.

`RemoteManager` gained `convertRemoteUrl()` — a pure HTTPS ↔ SSH converter for GitHub, GitLab,
Bitbucket and arbitrary hosts — and a fallback retry: when a push fails for want of credentials, origin
is converted to the other protocol and pushed once more. A successful retry keeps the new URL; a failed
one restores the original before reporting an error that names what was tried and what to set up.
Embedded tokens are dropped during conversion and redacted in every message.

A new **89-assertion** suite (`RemoteManager.test.ts`) covers the conversion table, the environment
resolution across platforms, error classification, and the full push/retry/restore command sequence
against a scripted `GitProvider`. It is wired into `pnpm run test`, which now runs **22 suites /
1,629 assertions**. All four CI gates pass.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `apps/server/src/services/git/GitProvider.ts` | Modified | `resolveGitEnv()` with SSH agent, credential-helper and non-interactive resolution; `detectCredentialHelper()`; `WINDOWS_SSH_AGENT_PIPE` |
| `apps/server/src/services/git/RemoteManager.ts` | Modified | `convertRemoteUrl()`, `detectRemoteProtocol()`, `isAuthFailure()`, `redactRemoteUrl()`; protocol-fallback retry in `push()` |
| `apps/server/src/services/git/__tests__/RemoteManager.test.ts` | Created | 89 assertions across conversion, environment, classification and push behaviour |
| `apps/server/package.json` | Modified | New suite wired into the `test` script (10 suites for this package) |

## 3. Implementation Details

### 3.1 `resolveGitEnv(probe)` — `GitProvider.ts`

Replaces the inline env object. Every input it reads about the machine is injectable
(`platform`, `env`, `fileExists`, `homedir`), defaulted from the real process — which is how a Windows
workstation is described from a Linux one in the tests.

| Concern | Behaviour |
| :--- | :--- |
| Non-interactive | `GIT_TERMINAL_PROMPT=0` always. `-o BatchMode=yes` and `-o StrictHostKeyChecking=accept-new` are appended to the ssh command **only when it does not already specify them**. |
| SSH agent (POSIX) | `SSH_AUTH_SOCK` is inherited. Nothing is invented when there is no agent. |
| SSH agent (Windows) | When `SSH_AUTH_SOCK` is unset *and* `//./pipe/openssh-ssh-agent` exists, it is pointed at that pipe. An agent the developer already set is never overridden. |
| Windows ssh client | When the pipe is what we are relying on, `GIT_SSH_COMMAND` names `%SystemRoot%\System32\OpenSSH\ssh.exe` explicitly (and only if it exists) — the MSYS `ssh.exe` bundled with Git for Windows cannot read that pipe. Quoted if the path contains a space. |
| Developer's `GIT_SSH_COMMAND` | Kept. Previously it was silently discarded; now only the missing non-interactive options are added. |
| Credential helpers | `PATH` passes through untouched. A missing `HOME` is filled from `USERPROFILE` or `os.homedir()`, and `USERPROFILE` from `HOME` on Windows — a service-managed process can start without either, and both `git-credential-manager` and `git-credential-osxkeychain` need them. |

`detectCredentialHelper(cwd)` reads `git config --get credential.helper` and returns the helper's
**name** or null. No credential value is ever read or logged.

### 3.2 `convertRemoteUrl(url, target)` — `RemoteManager.ts`

Pure and exported. Parsing covers three shapes — `https?://`, `ssh://`, and scp-style
`user@host:path` — and returns null for anything else, which the caller reads as "nothing to try".

| Input | → `'ssh'` |
| :--- | :--- |
| `https://github.com/owner/repo.git` | `git@github.com:owner/repo.git` |
| `https://github.com/owner/repo` | `git@github.com:owner/repo.git` |
| `https://gitlab.com/group/subgroup/repo.git` | `git@gitlab.com:group/subgroup/repo.git` |
| `https://bitbucket.org/owner/repo.git` | `git@bitbucket.org:owner/repo.git` |
| `http://git.internal/team/repo.git` | `git@git.internal:team/repo.git` |
| `https://github.com/owner/repo/` | `git@github.com:owner/repo.git` |
| `https://ghp_TOKEN@github.com/owner/repo.git` | `git@github.com:owner/repo.git` |
| `https://git.example.com:8443/team/repo.git` | `git@git.example.com:team/repo.git` |

| Input | → `'https'` |
| :--- | :--- |
| `git@github.com:owner/repo.git` | `https://github.com/owner/repo.git` |
| `git@github.com:owner/repo` | `https://github.com/owner/repo` |
| `ssh://git@git.example.com:2222/team/repo.git` | `https://git.example.com/team/repo.git` |
| `deploy@git.example.com:team/repo.git` | `https://git.example.com/team/repo.git` |

Three decisions worth naming, all asserted:

- **Credentials are dropped, never carried.** `https://TOKEN@host/…` → `git@host:…`; a token means
  nothing in an SSH URL and carrying it would only spread it.
- **An explicit port is dropped.** An HTTPS port says nothing about which port sshd listens on, and
  scp-style syntax cannot express one. The default is the only honest guess.
- **`.git` handling.** SSH output always carries `.git` (the scp-style convention, and what the task's
  notation shows); HTTPS output carries it only if the source did. Both round trips are stable:
  `https…/repo.git → ssh → https` and `git@…/repo.git → https → ssh` return the original.

A local path, a `file://` URL, a Windows drive path (`C:\repos\thing`, which matches the scp shape by
accident) and an empty string are all returned unchanged. The scp branch requires either a `user@`
prefix or a dotted hostname, which is what excludes the drive path.

### 3.3 The push fallback — `RemoteManager.push()`

```
git remote                      → no remotes? error, unchanged
git push                        → success? done
  ↳ no upstream? git push -u origin <branch>
auth failure?                   → not an auth failure: rethrow untouched
  git remote get-url origin
  HTTPS → SSH always            SSH → HTTPS only if a credential helper exists
  git remote set-url origin <converted>
  retry push (upstream fallback included)
    success → keep the converted URL
    failure → git remote set-url origin <original>, then throw
```

`isAuthFailure()` is exported and matches the seven strings git and ssh actually emit when a prompt is
suppressed (`could not read Username`, `Authentication failed`, `Permission denied`,
`Host key verification failed`, `terminal prompts disabled`, …). A rejected non-fast-forward, a missing
upstream and a DNS failure are all classified as *not* auth failures and pass through untouched.

The SSH → HTTPS direction is gated on a configured credential helper. Without one the retry would fail
identically and churn the remote URL for nothing, so instead the error says so.

Guards: the converted URL is rejected if it contains a quote, backslash, backtick, `$`, `;` or
whitespace before being interpolated into `git remote set-url origin "…"`. If the *restore* also fails,
the error says the remote was left converted and names what it now points at (redacted).

Error text is one actionable sentence set — what failed, what was tried, and the two ways to fix it
(`ssh-add` for SSH, a credential helper or PAT remote for HTTPS) — with a note that Asterim runs git
non-interactively by design and cannot prompt.

## 4. Verification

### 4.1 Gates

```
pnpm run typecheck  → 11 successful, 11 total (0 errors)
pnpm run lint       → 7 successful, 7 total   (0 errors)
pnpm run test       → 8 successful, 8 total   (22 suites, 1,629 assertions), exit 0
pnpm run build      → 7 successful, 7 total
```

### 4.2 The new suite

`pnpm --filter asterim exec tsx src/services/git/__tests__/RemoteManager.test.ts` → **89/89 assertions
passed**, in 14 groups:

| Group | Covers |
| :--- | :--- |
| `convertRemoteUrl` — HTTPS→SSH (12) | GitHub, GitLab, Bitbucket, self-hosted, subgroups, `http://`, trailing slash, no-`.git`, embedded token, `user:password`, explicit port, case preservation |
| `convertRemoteUrl` — SSH→HTTPS (7) | scp-style, `ssh://`, ssh port, non-`git` user, subgroups, no-`.git` |
| `convertRemoteUrl` — no-ops (7) | already-SSH, already-HTTPS, local path, Windows drive path, `file://`, empty, whitespace |
| Round trips (2) | HTTPS→SSH→HTTPS and SSH→HTTPS→SSH are stable |
| `detectRemoteProtocol` (5), `redactRemoteUrl` (4) | protocol detection; token and `user:password` redaction |
| `isAuthFailure` (8) | five real auth failures classified true; upstream, non-fast-forward and DNS failures classified false |
| `resolveGitEnv` (16) | prompt suppression, POSIX passthrough, Windows pipe present/absent, an agent already set, a developer `GIT_SSH_COMMAND` (kept, options added, not duplicated), `PATH`/`HOME`/`USERPROFILE` |
| `push` — ordinary (8) | success, no remote, upstream fallback, non-auth error passthrough |
| `push` — HTTPS fallback (12) | conversion + retry + URL kept; retry failure + **restore asserted as an exact command sequence**; token never in the message; upstream-and-credentials on a fresh clone |
| `push` — SSH fallback (8) | refused without a helper, taken with one, unconvertible remote, origin with no URL, failed restore reported |

### 4.3 Against real git on this workstation

`resolveGitEnv()` and `GitProvider` were exercised against the real `git` binary (scratch script, not
committed):

```
GIT_TERMINAL_PROMPT = 0
GIT_SSH_COMMAND     = ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new
SSH_AUTH_SOCK       = /run/user/1000/gcr/ssh      ← inherited, previously not passed deliberately
HOME                = /home/qhukz
PATH present        = true
branch  : main        remote : origin
helper  : null        status : 4 lines
```

The resulting `GIT_SSH_COMMAND` is byte-identical to the previously hardcoded value, so POSIX
behaviour is unchanged apart from the agent socket now being explicitly resolved.
`detectCredentialHelper()` correctly returns null on a machine with none configured.

The Windows paths cannot be executed from Linux; they are covered by injected-probe assertions
(§4.2) and are written to degrade to plain `ssh` whenever the pipe or `ssh.exe` is absent.

## 5. Acceptance Criteria Review

- [x] **1. `convertRemoteUrl()` converts bidirectionally across GitHub, GitLab, Bitbucket and custom
      hosts with full test coverage** — 28 conversion assertions plus 2 round trips; every branch of
      the parser (HTTP, `ssh://`, scp-style, unconvertible) is exercised, including ports, trailing
      slashes, nested paths, missing `.git` and embedded credentials.
- [x] **2. `GitProvider` resolves and injects SSH agent environment across platforms while preventing
      interactive hangs** — `resolveGitEnv()`, 16 assertions across Linux and Windows probes;
      `GIT_TERMINAL_PROMPT=0` and `BatchMode=yes` asserted on every path; verified against real git
      (§4.3).
- [x] **3. `push()` performs the protocol-conversion retry and cleanly restores the remote URL on
      failure** — asserted as an exact command sequence: `set-url <ssh>` → retry → `set-url <original>`.
      A successful retry performs exactly one `set-url` and keeps it. A failed restore is reported
      rather than swallowed.
- [x] **4. `RemoteManager.test.ts` passes with comprehensive assertions** — 89/89.
- [x] **5. Monorepo CI gates pass with 0 errors** — typecheck 11/11, lint 7/7 (0 errors), test 22
      suites / 1,629 assertions, build 7/7.

Definition of Done:

- [x] `convertRemoteUrl` handles HTTPS ↔ SSH transformations robustly
- [x] SSH agent socket auto-discovery implemented in `GitProvider`
- [x] `RemoteManager.test.ts` created and passing
- [x] `pnpm run typecheck` passes (11/11 turbo tasks)
- [x] `pnpm run lint` passes with 0 errors
- [x] `pnpm run test` passes across all 22 test suites
- [x] `pnpm run build` passes (7/7 packages)
- [x] Clean Git diff

## 6. Git Diff Review

Three modified files and one new file. Nothing outside `apps/server/src/services/git/` and the server
`package.json`. Reviewed against §6:

- **Nothing became interactive.** `GIT_TERMINAL_PROMPT` is written unconditionally as `'0'` and is
  never read from the caller's environment; `BatchMode=yes` is appended whenever the ssh command does
  not already carry a `BatchMode` setting. Two assertions pin both.
- **No credential is logged or written.** `detectCredentialHelper` reads only the helper's name.
  Every message that mentions a URL passes through `redactRemoteUrl()`, and a test asserts that a
  `ghp_…` token in origin never reaches the error text. Nothing is persisted anywhere.
- **`GitDriftDetector` and memory indexing are untouched** — neither file is in the diff, and
  `GitDriftDetector.test.ts` still passes 64/64 inside `pnpm run test`.

Behaviour deliberately changed, both in service of the feature:

1. `push()` performs its `git remote` check outside the try block. Previously the check's own failure
   fell through the catch chain and was rethrown unchanged; it now propagates directly. Same error,
   fewer branches. Asserted.
2. An **authentication** failure of `git push -u origin <branch>` is re-thrown untouched instead of
   being wrapped as `Failed to push branch: …`, so the retry can classify it. Non-auth failures still
   produce the original wrapped message. Both paths asserted.

Incidental: the two pre-existing `catch (err: any)` clauses in `RemoteManager` became typed `catch`
blocks with an `errorMessage(unknown)` helper, so the file adds no new `no-explicit-any` warnings and
drops two (server warnings 244 → 242). The new files are Prettier-clean.

## 7. Problems Discovered

1. **The old hardcoded `GIT_SSH_COMMAND` silently discarded the developer's own.** Anyone using
   `GIT_SSH_COMMAND` to select a key or a jump host was overridden by Asterim on every git call. The
   new resolution keeps it and only adds the options that guarantee non-interactivity.
2. **Windows needed two things, not one.** Setting `SSH_AUTH_SOCK` to the OpenSSH pipe is not enough:
   the MSYS `ssh.exe` that ships with Git for Windows cannot read a Windows named pipe, so the client
   has to be named explicitly. Both are conditional on the file actually existing, so a machine with
   neither degrades to plain `ssh` rather than breaking.
3. **`C:\repos\thing` parses as an scp-style remote.** `host:path` is exactly the shape of a Windows
   drive path. The parser requires a `user@` prefix or a dotted hostname, which rejects it; asserted
   directly, since a false positive here would rewrite a working local remote.
4. **The SSH→HTTPS direction needed a gate.** Retrying an SSH failure over HTTPS with no credential
   helper fails identically and leaves the remote URL churned. It is now attempted only when a helper
   is configured, and the error explains the refusal.
5. **`tsx` cannot run a scratch script with top-level `await`** in this package (no `"type": "module"`),
   which is worth knowing for future ad-hoc verification — the smoke script in §4.3 needed an
   `async main()` wrapper.

## 8. Architectural Concerns

1. **`setRemoteUrl()` still interpolates a user-supplied URL into a shell command.**
   `git remote set-url origin "${cleanUrl}"` runs through `child_process.exec`, so a URL containing a
   quote or `$(…)` is a command-injection vector from the `set_remote` route. I added
   `isSafeRemoteUrl()` on the **automatic** retry path only — tightening the public setter would
   change existing behaviour and is outside this task. `blueprint/GIT.md` §Security explicitly calls
   for sanitising these arguments; worth its own task, ideally by moving `GitProvider.exec` from
   `exec` to `execFile` with an argument array.
2. **The retry mutates `origin` as a side effect of a push.** It is restored on failure and asserted,
   but a developer who pushes successfully once will find their remote silently converted to SSH.
   That is the intended zero-friction behaviour, and it is durable and visible in the Changes UI —
   but it may deserve a one-line notification through the EventBus so the change is announced rather
   than discovered.
3. **`GIT_SSH_COMMAND` options are appended textually.** Safe for ordinary values, and git parses the
   variable with shell-like quoting, but a pathological value (an ssh wrapper script taking positional
   arguments) could be mis-parsed. The alternative — refusing to touch a developer-set command — would
   forfeit the non-interactive guarantee, which §6 makes non-negotiable.
4. **Host-key policy is `accept-new`.** Unchanged from before this task, but worth recording: Asterim
   trusts a host's key on first contact. `yes` would be stricter but would break every first push to a
   new host, and `no` would be worse. This is the same trade-off the previous hardcoded value made.

## 9. Recommended Next Step

**`P5.6-03` — argument-safe git execution.** Move `GitProvider.exec` from `child_process.exec` to
`execFile` with an argument array (or add strict validation to `setRemoteUrl`, `stageFile`, and the
branch commands). §8.1 above is a real injection surface reachable from the `set_remote` route and the
file-path arguments in `CommitManager`/`DiffManager`, and `blueprint/GIT.md` names it as a security
requirement. The command surface is small and every git subsystem call already funnels through the one
provider, so the change is contained and testable — and the 22-suite gate now standing in CI would
catch any regression it caused.
