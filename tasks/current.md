# [P5.6-02] — Zero-Friction Git Credential & SSH Auto-Detection Engine

**Task ID:** P5.6-02  
**Phase:** Phase 5.6 — SaaS Foundation & Commercial Beta Release  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-15  

---

## 1. Objective

Implement dynamic discovery and inheritance of local SSH agent sockets (`SSH_AUTH_SOCK`, Windows OpenSSH agent pipes), system Git credential helpers (`credential.helper`), and automatic fallback conversion between HTTPS and SSH remote URLs on push authentication failures in `GitProvider.ts` and `RemoteManager.ts`.

---

## 2. Why This Task Exists

When Asterim performs non-interactive Git synchronization (`git push`, `git pull`, `git fetch`), background execution must seamlessly use the developer's workstation credentials (SSH keys loaded in `ssh-agent`, tokens in macOS Keychain, Git Credential Manager, or Linux libsecret) without interactive terminal prompts.

If a push fails because a repository was cloned over HTTPS without saved credentials while the workstation has SSH keys configured (or vice versa), Asterim should automatically attempt protocol conversion and retry the push before failing.

---

## 3. Context

* **Blueprint Reference**: `blueprint/ROADMAP.md` Phase 5 Deliverable 4.
* **Phase 5 Reconciliation**: [`docs/phase5-reconciliation.md`](file:///c:/Projects/Asterim/docs/phase5-reconciliation.md) (§4 Task P5.6-02).
* **Current Implementation**:
  - [`apps/server/src/services/git/GitProvider.ts`](file:///c:/Projects/Asterim/apps/server/src/services/git/GitProvider.ts): Currently injects hardcoded `GIT_TERMINAL_PROMPT: '0'` and `GIT_SSH_COMMAND`.
  - [`apps/server/src/services/git/RemoteManager.ts`](file:///c:/Projects/Asterim/apps/server/src/services/git/RemoteManager.ts): Manages `push`, `pull`, `fetch`, and basic error detection.

---

## 4. Repository Evidence

Inspect:
* [`apps/server/src/services/git/GitProvider.ts`](file:///c:/Projects/Asterim/apps/server/src/services/git/GitProvider.ts)
* [`apps/server/src/services/git/RemoteManager.ts`](file:///c:/Projects/Asterim/apps/server/src/services/git/RemoteManager.ts)
* [`apps/server/src/services/git/GitService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/git/GitService.ts)
* [`apps/server/src/services/git/__tests__/GitDriftDetector.test.ts`](file:///c:/Projects/Asterim/apps/server/src/services/git/__tests__/GitDriftDetector.test.ts)
* [`apps/server/package.json`](file:///c:/Projects/Asterim/apps/server/package.json)

---

## 5. Implementation Scope

1. **Dynamic Git Environment Resolution (`GitProvider.ts`)**:
   - Implement `resolveGitEnv()`:
     - Detect and pass through active `SSH_AUTH_SOCK` (Linux/macOS/WSL).
     - On Windows, check for OpenSSH Agent service/pipe (`//./pipe/openssh-ssh-agent`) and ensure standard `GIT_SSH_COMMAND` connects cleanly.
     - Preserve `GIT_TERMINAL_PROMPT: '0'` to guarantee non-interactive execution.
     - Ensure system `PATH` and user home (`HOME`, `USERPROFILE`) are intact so standard credential helpers (`git-credential-manager`, `git-credential-osxkeychain`) are reachable.

2. **Remote URL Protocol Conversion & Fallback Retry (`RemoteManager.ts`)**:
   - Implement pure utility `convertRemoteUrl(url: string, targetProtocol: 'ssh' | 'https'): string`:
     - `https://github.com/owner/repo(.git)` ↔ `git@github.com:owner/repo.git`
     - `https://gitlab.com/owner/repo(.git)` ↔ `git@gitlab.com:owner/repo.git`
     - `https://bitbucket.org/owner/repo(.git)` ↔ `git@bitbucket.org:owner/repo.git`
     - Generic `https://hostname/path/repo.git` ↔ `git@hostname:path/repo.git`
     - Preserve trailing `.git` and handle URLs with embedded credentials (stripping credentials during SSH conversion).
   - In `RemoteManager.push()`:
     - Catch authentication failures (matching `could not read Username`, `Authentication failed`, `Permission denied (publickey)`, `Host key verification failed`).
     - If the remote origin URL is HTTPS and push fails with credential prompt error, test-convert origin to SSH format, set new URL, retry push. If the retry succeeds, persist the new remote URL. If it also fails, restore the original remote URL and throw an actionable error message.

3. **Automated Unit Test Suite**:
   - Create `apps/server/src/services/git/__tests__/RemoteManager.test.ts`:
     - Test URL conversion: GitHub, GitLab, Bitbucket, nested paths, port numbers, trailing slashes, existing SSH/HTTPS formats.
     - Test push retry fallback behavior with mocked `GitProvider`.
     - Test non-interactive error classification.
   - Wire `RemoteManager.test.ts` into `apps/server/package.json` `"test"` script.

---

## 6. Explicitly Forbidden Changes

* Do **NOT** prompt interactively or allow `GIT_TERMINAL_PROMPT=1` (all git operations must be non-interactive).
* Do **NOT** log or write sensitive tokens/credentials to stdout or log files.
* Do **NOT** alter the behavior of `GitDriftDetector.ts` or project memory indexing.

---

## 7. Acceptance Criteria

1. `convertRemoteUrl()` correctly converts URLs bidirectionally across GitHub, GitLab, Bitbucket, and custom hosts with 100% test coverage.
2. `GitProvider` resolves and injects SSH agent environment variables across platforms while preventing interactive terminal hangs (`GIT_TERMINAL_PROMPT=0`).
3. `RemoteManager.push()` executes automatic protocol conversion retry upon authentication failure and cleanly restores the remote URL if retry fails.
4. `RemoteManager.test.ts` passes with comprehensive assertions.
5. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`.

---

## 8. Definition of Done

- [ ] `convertRemoteUrl` handles HTTPS ↔ SSH transformations robustly
- [ ] SSH agent socket auto-discovery implemented in `GitProvider`
- [ ] `RemoteManager.test.ts` created and passing
- [ ] `pnpm run typecheck` passes (11/11 turbo tasks)
- [ ] `pnpm run lint` passes with 0 errors
- [ ] `pnpm run test` passes across all 22 test suites
- [ ] `pnpm run build` passes (7/7 packages)
- [ ] Clean Git diff

---

## 9. Verification Commands

```bash
# Run new Git RemoteManager unit test suite
pnpm --filter asterim exec tsx src/services/git/__tests__/RemoteManager.test.ts

# Run all Git test suites
pnpm --filter asterim exec tsx src/services/git/__tests__/GitDriftDetector.test.ts

# Run full monorepo CI pipeline
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 10. Self-Review Requirements

- Inspect `git diff` to ensure URL conversion logic handles edge cases (e.g. `http://` vs `https://`, custom ports, usernames).
- Ensure error messages provide clear remediation instructions to the user.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
