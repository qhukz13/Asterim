Task-ID: P9-02
Status: COMPLETE

# Execution Report: P9-02 — Workspace Environment Secrets Subsystem & In-Transit Credential Masking

**Task ID:** P9-02
**Phase:** Phase 9 — Enterprise Hardening, Desktop Shell & Production Release
**Status:** VERIFIED
**Date:** 2026-08-17
**Author:** Claude Code

---

## 1. Summary

`environment_secrets` now holds credentials the way `settings` has since P9-01: every value rests as a
`vault:v1:` AES-256-GCM envelope produced by the singleton `SecretVaultService`, under the same
machine-derived key. `EnvironmentSecretService` owns the table, and the three properties it was asked for
hold in all three places a credential can escape:

- **At rest** — nothing writes `environment_secrets.secret_value` except through `SecretVaultService.encrypt()`.
  Legacy cleartext rows upgrade on read and on a startup sweep.
- **In transit** — the read path never decrypts. `GET .../secrets` returns `{ key, maskedValue: "••••••••", isSet, createdAt }`
  and nothing else, and `GET /api/v1/system/settings` now masks `ai_api_key` with a `hasApiKey` flag instead of
  returning the key it used to hand back in cleartext.
- **In output** — every plaintext the service decrypts is registered with the vault's redaction index before it
  is returned, so a token an agent echoes back is stripped from the log file and from EventBus payloads.

Resolved secrets reach the agent process through a new `LaunchConfig.env`, merged in `BaseAdapter.start` beneath
whatever the provider pins for itself.

One thing the task did not ask for turned out to be necessary and is included: encrypting a row **in place** does
not remove what it used to say, because SQLite frees the old page rather than overwriting it. On a real server boot
the migrated cleartext was still greppable in `asterim.db` afterwards — see § 7. `DatabaseService.compact()` (VACUUM
plus a truncating WAL checkpoint) now runs once, only after a sweep that actually migrated something, and the
cleartext is gone from the files.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `apps/server/src/services/security/EnvironmentSecretService.ts` | Created | The subsystem: CRUD over `environment_secrets` with encryption, masking, key validation, agent-variable resolution, legacy migration, status counts |
| `apps/server/src/routes/environmentSecrets.ts` | Created | `GET`/`POST`/`DELETE` under both `/api/v1/environments/:id/secrets` and `/api/v1/workspaces/:id/secrets`, with RBAC and error→status mapping |
| `apps/server/src/services/security/__tests__/EnvironmentSecretService.test.ts` | Created | 181-assertion suite: crypto round-trip, on-disk bytes, tamper rejection, migration, masking, redaction, REST, RBAC, settings masking, cross-machine |
| `apps/server/src/services/security/SecretVaultService.ts` | Modified | `registerRedactedValue` / `unregisterRedactedValue`: lets a secret this vault does not store share the one redaction index |
| `apps/server/src/routes/system.ts` | Modified | `GET /system/settings` masks every `SECRET_SETTING_KEYS` row and reports `hasApiKey` / `maskedKeys`; `POST` ignores a mask or a blank credential, and clears on explicit `null` |
| `apps/server/src/routes/security.ts` | Modified | `vault-status` reports `vault.environmentSecrets` and folds it into `healthy` |
| `apps/server/src/index.ts` | Modified | Registers the new routes; runs the environment-secret sweep at startup; compacts the database when either sweep migrated something |
| `apps/server/src/services/AgentService.ts` | Modified | `resolveEnvironmentSecrets()` — decrypts the environment's secrets per session start and passes them as `config.env` |
| `apps/server/src/services/DatabaseService.ts` | Modified | `compact()`: VACUUM + `PRAGMA wal_checkpoint(TRUNCATE)`, never throws |
| `apps/server/src/services/RbacService.ts` | Modified | `getWorkspaceMemberCount()` — separates "not a member" from "workspace predates RBAC" |
| `apps/server/src/services/WorkspaceService.ts` | Modified | Deleting an environment also unregisters its secrets from redaction (the FK already cascades the rows) |
| `packages/adapters/src/sdk/types.ts` | Modified | `LaunchConfig.env` |
| `packages/adapters/src/sdk/BaseAdapter.ts` | Modified | Passes `{ ...config.env, ...launchParams.env }` to the PTY |
| `packages/adapters/src/sdk/__tests__/ProcessManager.test.ts` | Modified | +6 assertions that the session environment actually reaches `pty.spawn`, and that a provider's own variable still wins |
| `apps/server/package.json` | Modified | New suite wired into `"test"` (now 23 server suites) |
| `apps/web/src/components/AISettings.tsx` | Modified | Stops holding the API key: tracks `hasApiKey`, submits the field only when the operator typed a new one |

## 3. Implementation Details

**Service.** `EnvironmentSecretService` takes the vault and a lazy db accessor by constructor option, so tests run
it on a 1,000-round key while the exported singleton shares the production vault. `getSecrets` deliberately does
not decrypt — there is no plaintext on the listing path to leak. `getSecretValue` and
`resolveEnvironmentVariables` share one private `openRow()`, so single reads and bulk resolution migrate legacy
rows and register redaction on identical terms.

**Key rules.** A key must be a POSIX variable name (`/^[A-Za-z_][A-Za-z0-9_]{0,127}$/`), since these values are
injected into an agent's environment. `PATH`, `LD_PRELOAD`, `LD_AUDIT`, `LD_LIBRARY_PATH`, `DYLD_*`,
`NODE_OPTIONS`, `BASH_ENV`, `ENV`, `IFS` and `SHELL` are refused: they decide what the agent process *is*, not
what it can reach, so accepting them would turn write access to a workspace's secrets into code execution inside
every session it starts. The same check runs again on the way out, so a row written by hand or by an older build
is skipped rather than injected.

**Storage.** `INSERT … ON CONFLICT(environment_id, secret_key) DO UPDATE SET secret_value = excluded.secret_value`
— a rotation keeps the row's original `created_at`. `ensureEnvironmentRow()` exists because
`WorkspaceService` writes the mirrored `environments` row best-effort inside a `try/catch`; where that mirror is
missing, it is filled in from `workspaces` so the foreign key holds. A genuinely unknown id raises
`ENVIRONMENT_NOT_FOUND_ERROR` → 404.

**Redaction.** `SecretVaultService` keeps one redaction index. The new public register/unregister pair namespaces
entries as `env-secret:<environmentId>:<KEY>`, so a rotated or deleted workspace secret stops being redacted
without touching the `settings` entries. The startup sweep deliberately does **not** register values: it walks the
whole table, and loading every workspace credential into a process-lifetime index would make the redactor scan all
agent output against secrets no running session uses.

**Agent injection.** `AgentService.startAgent` resolves the environment's variables at session start (never
cached — a rotated secret belongs to the next session) and hands them to `SessionManager` → `BaseAdapter` →
`ProcessManager`. Merge order puts provider env last, so an adapter's deliberate choice is not overridden by a
stored credential. A credential that will not decrypt on this machine is omitted rather than fatal: an agent
reporting an auth error is more useful than a session that refuses to start.

**Failure semantics.** `EnvironmentSecretError` carries `INVALID_SECRET_KEY_ERROR` / `PROTECTED_SECRET_KEY_ERROR`
(400), `ENVIRONMENT_NOT_FOUND_ERROR` (404), `SECRET_STORAGE_ERROR` (500); routes map the code, never message text.

**Authorization.** Secrets routes require a session (401). Where the environment has members, `workspace:read`
governs the masked listing and `workspace:write` governs writes and deletes — a viewer can see which keys exist
but cannot change them, and a non-member gets 403. Where the environment has **no** membership rows at all — a
workspace written before `workspace_memberships` existed, which is the normal case on a single-user workstation —
the authenticated local user is allowed through. That fallback is called out in § 8.

## 4. Verification

Everything below was run in this session. There is still no test runner in the repo; "test" means the standalone
assertion scripts, and the CI gates are typecheck / lint / test / build.

| Gate | Command | Result |
| :--- | :--- | :--- |
| New suite | `pnpm --filter asterim exec tsx src/services/security/__tests__/EnvironmentSecretService.test.ts` | **181/181 assertions passed** |
| P9-01 suite (regression) | `pnpm --filter asterim exec tsx src/services/security/__tests__/SecretVaultService.test.ts` | **133/133 assertions passed** |
| Server suites | `pnpm --filter asterim run test` | **23/23 suites pass**, 0 failures (63, 60, 140, 52, 51, 64, 89, 111, 21, 231, 52, 102, 115, 89, 43, 67, 160, 169, 138, 461, 196, 133, 181) |
| Adapters | `pnpm --filter @asterim/adapters run test` | **29/29** (was 23 — +6 for the injection wiring) |
| Relay / Web / MCP memory | `pnpm --filter @asterim/relay run test`, `… @asterim/web run test`, `… @asterim/mcp-memory-server run test` | **71/71**, **686/686**, **24/24** |
| Typecheck | `tsc --noEmit` in `asterim`, `@asterim/adapters`, `@asterim/web`, `@asterim/marketing`, `@asterim/shared`, `@asterim/relay`, `@asterim/mcp-memory-server` | clean, 0 errors |
| Lint | `eslint` in all seven workspaces | **0 errors** (warnings unchanged: 298 server, 28 adapters, 302 web, 18 marketing, 3 shared, 12 mcp) |
| Build | `@asterim/shared`, `@asterim/adapters`, `@asterim/web`, `asterim`, `@asterim/marketing`, `@asterim/relay`, `@asterim/mcp-memory-server` | all succeed (`asterim` → `dist/index.js` 956.15 KB after the web build) |

The root `pnpm run typecheck|lint|test|build` (turbo) forms were blocked by this session's command sandbox, so each
workspace was run individually — same tasks, same tools, one process per package instead of turbo's fan-out.

**Live end-to-end run.** The real Core was booted on port 3999 against a temp data dir seeded — by direct
`node:sqlite` writes, not through the service — with a cleartext `environment_secrets` row and a cleartext
`ai_api_key`:

```
[SecretVault] Encrypted 1 legacy plaintext secret(s) at rest: ai_api_key.
[EnvironmentSecrets] Encrypted 1 legacy plaintext environment secret(s) at rest.
[Startup] Rebuilt the database so the migrated cleartext is gone from its freed pages.
[DEBUG] Registering environmentSecretRoutes
```

Endpoints, over loopback HTTP against that running server:

```
POST   /api/v1/environments/env_e2e/secrets  → 201 {"success":true,"secret":{"key":"LIVE_TOKEN","maskedValue":"••••••••","isSet":true,…}}
GET    /api/v1/environments/env_e2e/secrets  → 200 two secrets, both masked; body contains the stored value: false
GET    /api/v1/workspaces/env_e2e/secrets    → 200 identical (alias hits the same rows)
GET    /api/v1/system/settings               → 200 {"settings":{"ai_provider":"gemini","ai_api_key":"••••••••"},"hasApiKey":true,"maskedKeys":["ai_api_key"]}
GET    /api/v1/security/vault-status         → 200 …"environmentSecrets":{"total":2,"encrypted":2,"plaintext":0,"unreadable":0,"environments":1,"migrationComplete":true},"healthy":true
DELETE /api/v1/environments/env_e2e/secrets/LIVE_TOKEN → 200, again → 404
POST   {key:"PATH"}                          → 400 PROTECTED_SECRET_KEY_ERROR
```

**On-disk check** (independent script, raw `node:sqlite` plus a byte grep of `asterim.db`, `-wal`, `-shm`):

```
env_e2e/LEGACY_TOKEN = vault:v1:a71a0e3f…:be37a52b…:22626d11…
ai_api_key           = vault:v1:1c9fcaa2…:870dca14…:14a94e30…
asterim.db     contains "plaintext-legacy-token-9f3aa1c4": false
asterim.db     contains "AIzaSy-plaintext-e2e-key-0000":  false
asterim.db-wal contains either:                           false
```

No screenshots: the change to `apps/web` is one settings field whose behaviour is what matters (the key is no
longer fetched into the form), and the sandbox blocked driving a browser at a live server.

## 5. Acceptance Criteria Review

- [x] **1. `EnvironmentSecretService` encrypts all stored environment secrets using `vault:v1:` AES-256-GCM envelopes** —
  every write goes through `SecretVaultService.encrypt()`; asserted on the raw column (`vault:v1:` prefix, plaintext
  absent, two environments storing the same secret produce different ciphertext), and confirmed on the real
  database file after a live server run (§ 4).
- [x] **2. `GET /api/v1/environments/:id/secrets` returns masked representations and presence metadata without plaintext** —
  `getSecrets` never decrypts; the response is `{ key, maskedValue: "••••••••", isSet, createdAt }` and the raw HTTP
  body is asserted to contain neither value, nor the password inside a connection URL, nor any envelope. Verified in
  the suite and live, on both `/environments` and `/workspaces`.
- [x] **3. `GET /system/settings` masks `ai_api_key` while `POST` supports seamless updates and preservation** —
  GET returns the mask plus `hasApiKey` / `maskedKeys`; POST ignores a re-submitted mask and a blank field
  (stored key asserted unchanged), stores a genuinely new key as an envelope, and clears on explicit `null`.
  `apps/web/AISettings.tsx` was updated in step so the form cannot overwrite the key with a mask.
- [x] **4. Resolved environment variables are injected decrypted, with their plaintext registered for log and EventBus redaction** —
  `resolveEnvironmentVariables` returns the decrypted map and registers each value first: a cold service registers
  0 values before the resolve and 1 after; a log line containing the token comes back with `[REDACTED_SECRET]`
  (string and Buffer chunks); an `agent.output` event published through the real EventBus reaches its subscriber
  with the credential removed and `projectId`/`threadId` intact. The injection itself is asserted at the spawn
  boundary in `ProcessManager.test.ts` — the variable reaches `pty.spawn`, and a provider's own variable still wins.
- [x] **5. Legacy unencrypted rows are transparently upgraded** — upgraded on read in the same call that returns the
  value, and by `migrateLegacyPlaintext()` at startup (2 migrated / 0 failed in the suite; second sweep migrates 0).
  Verified end-to-end on a real boot, including the file-level consequence in § 7.
- [x] **6. `EnvironmentSecretService.test.ts` passes with unit, integration and REST assertions** — 181/181, covering
  CRUD round-trip, empty/multi-line/Unicode values, key validation and the protected-name list, tamper and
  malformed-envelope rejection, foreign-machine envelopes, migration on read and by sweep, FK cascade, masking,
  redaction through both seams, all six REST routes with 400/401/403/404 paths, RBAC by role, settings masking,
  vault-status health, freed-page compaction, and a copied-database scenario.
- [x] **7. Monorepo CI gates pass with 0 errors** — typecheck clean, lint 0 errors, all test suites pass (23 server
  suites plus adapters/relay/web/mcp — 40+ in total across the monorepo), every build succeeds. Per-workspace
  invocation as noted in § 4.

Definition of Done: service implemented and exported ✔; routes registered and verified against a running server ✔;
`ai_api_key` masking implemented and tested ✔; agent variable resolution and redaction integrated ✔; suite created,
wired into `"test"`, passing ✔; CI gates clean ✔.

## 6. Git Diff Review

Reviewed `git diff` and `git status` in full. 3 files added, 13 modified, 369 insertions / 147 deletions. Against
the forbidden list:

- **No plaintext environment secrets** — the only writer of `secret_value` other than `encrypt()` output is
  `writeEnvelope()`, which is fed by `encrypt()`. Confirmed on disk.
- **No cleartext in GET responses** — the removed lines in `routes/system.ts` are exactly the
  `decryptIfEnvelope` → response path that used to return the key; nothing replaced it with another read of a value.
- **Existing `settings` encryption and existing suites intact** — `SecretVaultService` gained two public methods and
  changed no existing behaviour; all pre-existing suites pass unchanged, including 133/133 for P9-01.
- **No external network dependency or KMS** — no new package, no new import outside the repo; Sovereign Mode (DEC-028)
  untouched, and the live run above was made with `ASTERIM_SOVEREIGN_MODE=true`.
- No stray files: the scratch seed/boot/inspect scripts used for the live run were written to `/tmp`, not the repo,
  and nothing was added to `docs/`.

One pre-existing unstaged change is **not** mine and was left alone: `tests/report.md` was already modified when this
session started (the previous test-gate report). It is excluded from the commit rather than folded into a P9-02 change.

## 7. Problems Discovered

1. **Encrypting in place leaves the cleartext in the file.** The first live migration run looked correct at the query
   level — both rows came back as `vault:v1:` envelopes — but grepping the bytes of `asterim.db` still found
   `plaintext-legacy-token-9f3aa1c4` and the old `ai_api_key`. SQLite marks the superseded page free rather than
   overwriting it, so "encrypted at rest" was true of the rows and false of the file, which is the exposure the vault
   exists to close (a backup or a support bundle copies free pages too). A probe confirmed that `VACUUM` **alone does
   not fix it in WAL mode** — the rebuilt pages sit in the sidecar while the main file keeps its old content until a
   checkpoint — so `DatabaseService.compact()` does `VACUUM` followed by `PRAGMA wal_checkpoint(TRUNCATE)`, and
   `index.ts` calls it once when either sweep actually migrated something. Re-run end-to-end: no cleartext in
   `asterim.db`, `-wal` or `-shm`. **Note for Antigravity: the same exposure applies to any database already migrated
   by P9-01 before this change; those files are cleaned by the first boot that migrates anything, and otherwise not
   at all.**
2. **`environment_secrets` had no reader or writer anywhere.** The table was created in P3.5 and never used, so there
   was no existing call path to preserve — but also no prior art for how an environment id resolves. `workspaces` and
   `environments` are mirror tables written by `WorkspaceService`, and the mirror insert is best-effort inside a
   `try/catch`, while the FK points at `environments`. A workspace could therefore exist that cannot hold a secret;
   `ensureEnvironmentRow()` repairs the mirror from `workspaces` instead of failing.
3. **Foreign keys are enforced.** `node:sqlite` enables them by default even though nothing in `DatabaseService` sets
   the pragma, so a secret for an unknown environment is a constraint failure rather than an orphan row — verified,
   along with the `ON DELETE CASCADE` that removes an environment's secrets with it.
4. **Masking the settings GET would have silently wiped the key.** The web form loaded `ai_api_key` into a field and
   posted it back on every save; masking the response without touching the client would have written `••••••••` over
   the credential on the next save. Handled on both sides — the server ignores masks and blank credentials, and the
   form no longer holds the key at all.
5. **`MIN_REDACTABLE_LENGTH = 8`** (P9-01) applies to environment secrets too: a stored value of eight characters or
   fewer is *not* registered for redaction, deliberately, because such a string collides with ordinary terminal text.
   Short credentials are encrypted at rest but will not be stripped from agent output.

## 8. Architectural Concerns

1. **The RBAC fallback for member-less environments.** Where an environment has no `workspace_memberships` rows, any
   authenticated caller may read and write its secrets. That is what a pre-RBAC or single-user local database looks
   like, and enforcing membership strictly would lock the operator out of their own environment — but it is a policy
   decision, not a technical one, and it is worth confirming. Tightening it later is a one-line change in
   `authorize()`.
2. **`environment_secrets` still has no UI.** The API is complete and the agent path consumes it, but nothing in
   `apps/web` lets a user manage workspace secrets; today they can only be created over REST. A Workspace Settings
   panel is a natural next vertical, and the masked shape was designed for it.
3. **Machine-bound keys remain non-portable** (carried over from P9-01 § 8): moving `asterim.db` to another machine
   yields secrets that will not decrypt, now including workspace credentials. The suite asserts this rather than
   working around it. An export/import flow under an operator passphrase is the escape hatch if enterprise
   deployments need one.
4. **The startup compaction can be skipped under contention.** `compact()` needs a lock the MCP memory servers could
   be holding; it warns and returns `false` rather than blocking the boot, and the migration is still correct — only
   the freed-page cleanup is deferred to the next boot that migrates something. A dedicated
   `POST /api/v1/security/compact` for an operator to run on demand would close that gap.
5. **`environment_secrets` has no `updated_at`.** Rotation currently preserves `created_at`, so the API can say when a
   secret was introduced but not when it last changed — worth a column if the audit surface needs it.

## 9. Recommended Next Step

**P9-03 — Workspace Secrets & Security surface in the dashboard.** The vault, the environment-secret API and the
health endpoint now exist with nothing in `apps/web` reading any of them. One vertical: a Workspace Settings →
Secrets panel over the masked API (list / add / rotate / delete, never displaying a value), plus a Security card
rendering `GET /api/v1/security/vault-status` — including the new `vault.environmentSecrets` counts and the
`healthy` flag — so an operator can see at a glance that nothing on the workstation is readable on disk. That closes
§ 8.2 and gives the two P9-01/P9-02 subsystems the operator-facing surface enterprise hardening is ultimately for.
