Task-ID: P9-01
Status: COMPLETE

# Execution Report: P9-01 — Local Secret Vault & Cryptographic Keystore for Credentials at Rest

**Task ID:** P9-01
**Phase:** Phase 9 — Enterprise Hardening, Desktop Shell & Production Release
**Status:** VERIFIED
**Date:** 2026-08-17
**Author:** Claude Code

---

## 1. Summary

`SecretVaultService` is implemented and every credential Asterim keeps on the workstation is now
encrypted at rest with AES-256-GCM under a key derived from the machine identity and a random
per-installation salt in `~/.asterim/vault.salt`. Five `settings` rows are now vault-managed —
`ai_api_key`, `vapid_keys`, `stripe_secret_key`, `jwt_secret`, `hmac_secret` — up from the two named
in `blueprint/audit/IMPLEMENTATION_DRIFT.md` § 11, because the JWT signing key and the pairing HMAC
secret are the two rows whose disclosure lets an attacker mint credentials for any account.

Legacy plaintext rows are upgraded two ways: transparently on the first `getSecret` (so a service
that reads its own secret at boot encrypts it there and then), and by an explicit startup sweep in
`index.ts` for the rows nothing reads until they are needed. `GET /api/v1/security/vault-status`
reports the cipher, the salt state and a per-state count of managed rows without reading a value.

A redaction engine strips known secret values from the log streams and from every EventBus payload,
installed through inverted registration seams (`registerLogRedactor`, `eventBus.setRedactor`) so
neither `utils/logger.ts` nor `EventBus.ts` gains a dependency on the database.

All monorepo gates pass with 0 errors, and an end-to-end smoke test against the packaged binary
(`apps/server/dist/index.js`) confirms the migration and the endpoint on a real two-boot sequence.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `apps/server/src/services/security/SecretVaultService.ts` | Created | The vault: AES-256-GCM envelope, PBKDF2-HMAC-SHA512 key derivation, secret CRUD over `settings`, legacy migration, redaction engine, status |
| `apps/server/src/services/security/__tests__/SecretVaultService.test.ts` | Created | 133-assertion suite: crypto, tamper detection, key binding, migration, redaction, status, REST route |
| `apps/server/src/routes/security.ts` | Created | `GET /api/v1/security/vault-status` |
| `apps/server/src/index.ts` | Modified | Startup migration sweep + `securityRoutes` registration |
| `apps/server/src/services/TokenService.ts` | Modified | `jwt_secret` read/written through the vault |
| `apps/server/src/services/PairingService.ts` | Modified | `hmac_secret` read/written through the vault |
| `apps/server/src/services/PushService.ts` | Modified | `vapid_keys` read/written through the vault, with recovery from an unreadable pair |
| `apps/server/src/services/BillingService.ts` | Modified | Stripe secret key resolved lazily: injected → env → vault |
| `apps/server/src/services/ai/AiService.ts` | Modified | Decrypts `ai_api_key` out of the bulk `ai_*` settings read |
| `apps/server/src/routes/system.ts` | Modified | Settings POST routes credentials through the vault; GET decrypts so the form still round-trips |
| `apps/server/src/services/EventBus.ts` | Modified | Payload redactor seam applied in `publish` |
| `apps/server/src/utils/logger.ts` | Modified | Log-stream redactor seam applied to the stdout/stderr intercepts |
| `apps/server/package.json` | Modified | New suite wired into the `test` script (22 server suites, 39 monorepo-wide) |

## 3. Implementation Details

**Envelope.** `vault:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>`. 12-byte IV freshly generated per
`encrypt()` call, 16-byte GCM tag at full length. `decrypt()` validates the prefix, the field count,
hex encoding and both field lengths before touching the cipher, then lets `decipher.final()` verify
the tag — OpenSSL compares it with `CRYPTO_memcmp`, so a modified ciphertext, a forged tag and a
foreign-machine envelope all fail identically and in constant time. Structural failures raise
`INVALID_ENVELOPE_ERROR`; authentication failures raise `TAMPERED_SECRET_ERROR`.

**Key derivation.** PBKDF2-HMAC-SHA512, 100,000 iterations, 32-byte key, derived once per process
and cached in memory. Input is `platform|arch|hostname|username|uid|homedir` plus 32 random bytes
read from `~/.asterim/vault.salt` (created 0600 on first use). No key material is ever written to
SQLite — the salt file holds only the salt, which is asserted by the suite. Windows has no `uid`
reachable from Node without a native module, so the account is identified there by username and home
directory, the same pair that decides which `~/.asterim` is in play.

**Migration.** `getSecret()` returns a non-envelope value as-is and re-writes the row encrypted in
the same call. `migrateLegacyPlaintext()` sweeps all five managed keys at startup and reports
`{migrated, alreadyEncrypted, failed}`. Non-secret configuration (`ai_provider`, `ai_model`,
`first_run_completed`) is deliberately untouched and stays readable.

**Failure posture.** A row that will not decrypt on this machine — a database copied from elsewhere,
a lost salt — reads as absent and is left on disk rather than destroyed. Services that mint their own
secret then generate a fresh one; the cost is a re-login and a new VAPID pair, which is the only
outcome that still boots. `vault-status` surfaces the condition as `unreadableKeys` so an operator
can see it.

**Redaction.** Plaintext values seen by the vault are registered longest-first; values of 8
characters or fewer are not registered, because a short secret collides with ordinary log text. A
JSON secret contributes its leaves as well as the whole blob (so the VAPID *private* key is redacted
on its own), except fields named `public*`. `redactPayload` returns its input **by reference** when
nothing changed, so the EventBus hot path — which carries every byte of agent output — does not pay
an allocation per subtree for the overwhelmingly common clean payload.

## 4. Verification

Everything below was run in this session. Note the repo has no test runner: suites are standalone
`tsx` scripts with their own assertion harnesses (`docs/p5.0-01-verification-report.md` § 3).

**New suite** — `pnpm --filter asterim exec tsx src/services/security/__tests__/SecretVaultService.test.ts`

```
133/133 assertions passed
```

**Full monorepo test gate** — 39 suites, all passing:

| Package | Command | Result |
| :--- | :--- | :--- |
| `asterim` | `pnpm --filter asterim run test` | 22 suites, 0 FAIL (63, 60, 140, 52, 51, 64, 89, 111, 21, 231, 52, 102, 115, 89, 43, 67, 160, 169, 138, 461, 196, **133**) |
| `@asterim/web` | `pnpm --filter @asterim/web run test` | 8 suites, 0 FAIL |
| `@asterim/mcp-memory-server` | `pnpm --filter @asterim/mcp-memory-server run test` | 7 suites (42, 82, 87, 62, 28, 23, 24), 0 FAIL |
| `@asterim/relay` | `pnpm --filter @asterim/relay run test` | 71/71 |
| `@asterim/adapters` | `pnpm --filter @asterim/adapters run test` | 23/23 |

The `mcp-memory-server` `relay_e2e` suite boots the real Core and pairs a device, so
`PairingService` → vault → `hmac_secret` is exercised end to end by an existing suite as well.

**Typecheck** — `tsc --noEmit` clean in all 7 workspaces (`asterim`, `@asterim/web`,
`@asterim/marketing` via `tsc -b`, `@asterim/relay`, `@asterim/shared`, `@asterim/adapters`,
`@asterim/mcp-memory-server`).

**Lint** — `eslint` across all 7 workspaces: **0 errors**. Warning counts are unchanged in character
from the pre-existing baseline (`asterim` 278, `@asterim/web` 302, `@asterim/adapters` 28,
`@asterim/marketing` 18, `@asterim/mcp-memory-server` 12, `@asterim/shared` 3, `@asterim/relay` 0).
`SecretVaultService.ts` and `routes/security.ts` produce **zero** warnings; the two on the new test
file are the repo-standard `no-explicit-any` on an event listener.

**Build** — all 7 workspaces built successfully, in dependency order, including the packaged
`asterim` binary (`dist/index.js`, 929.95 KB) with the web dashboard copied in.

**End-to-end smoke test against the packaged binary** (`scratch/p9-smoke/smoke.ts`, run via
`pnpm --filter asterim exec tsx`; gitignored, sandboxed `HOME` so the real `~/.asterim` was never
touched). Two boots of `apps/server/dist/index.js`, reading raw SQLite rows between them:

```
boot 1 — a fresh workstation                    8 assertions
  vault-status: AES-256-GCM / PBKDF2-HMAC-SHA512 / 100000, ready, healthy,
  encryptedKeys >= 3, plaintextKeys 0
  [disk] hmac_secret=vault:v1:f2e3d24de… jwt_secret=vault:v1:7c23d3b42… vapid_keys=vault:v1:5b3105389…
  no VAPID private key readable on disk; vault.salt present and 0600
a database carried over from before the vault existed
  planted ai_api_key = AIzaSy-LEGACY-PLAINTEXT-SMOKE-TEST-KEY (plaintext, direct SQLite write)
boot 2 — the startup migration hook
  vault-status: plaintextKeys 0, unreadableKeys 0, migrationComplete true, no credential in body
  GET /api/v1/system/settings still round-trips the value the user entered
  the row on disk is now an envelope; the plaintext is gone from it

25/25 assertions passed
```

## 5. Acceptance Criteria Review

- [x] **1. `SecretVaultService` encrypts and decrypts secrets using AES-256-GCM with random IVs and
  authenticated tags** — suite sections *"encrypt — the serialized envelope"* (5 fields, 24-hex IV,
  32-hex tag, no plaintext present), *"round trip"* (7 shapes incl. empty string, unicode, a value
  that itself looks like an envelope, 64 KB), *"a fresh IV for every call"* (50 encryptions of one
  plaintext → 50 distinct IVs and 50 distinct ciphertexts, all decrypting correctly).
- [x] **2. Tampered ciphertext or forged authentication tags are detected and rejected** — suite
  section *"tamper detection"*: modified ciphertext, forged tag and substituted IV each yield
  `TAMPERED_SECRET_ERROR`; truncated tag, short IV, missing field, non-hex body and a non-envelope
  each yield `INVALID_ENVELOPE_ERROR`; the untampered envelope still decrypts afterwards. Section
  *"the key is bound to the machine"* adds that an envelope from another machine identity is
  rejected the same way, and *"the process singleton"* proves it for the production instance.
- [x] **3. Legacy plaintext secrets in `settings` are transparently migrated and encrypted at rest** —
  suite sections *"transparent migration of legacy plaintext"* (first read returns the legacy value
  and upgrades the row in place; the plaintext is gone from disk) and *"the startup sweep"* (both
  plaintext credentials migrated, the already-encrypted one left alone, non-secret configuration
  untouched, a second sweep is a no-op). Confirmed against the packaged binary in the smoke test:
  a plaintext `ai_api_key` planted by direct SQLite write is an envelope after the next boot.
- [x] **4. `GET /api/v1/security/vault-status` reports vault encryption status without leaking
  secrets** — suite section *"GET /api/v1/security/vault-status"*: 200, reports cipher / KDF /
  100,000 rounds / ready / counts; the raw response body contains no secret value, no envelope and
  not the salt; a planted plaintext row flips `healthy` to false and is reported as a count without
  its value appearing. Confirmed live over HTTP against the packaged binary in the smoke test.
- [x] **5. `SecretVaultService.test.ts` passes with comprehensive cryptographic assertions** —
  133/133, covering envelope shape, round trip, IV freshness, tamper detection, machine key binding,
  salt file permissions, secret CRUD, legacy migration, the startup sweep, unreadable rows, the
  redaction engine (strings, JSON leaves, nested payloads, the log-stream seam, the EventBus seam),
  status, and the REST route.
- [x] **6. Monorepo CI gates pass with 0 errors** — typecheck clean in all 7 workspaces; lint 0
  errors in all 7; **39** test suites pass (22 server + 8 web + 7 mcp-memory-server + 1 relay + 1
  adapters), up from 38; all 7 builds succeed. Full outputs in § 4.

**Definition of Done**

- [x] `SecretVaultService.ts` implemented and tested
- [x] Database secret storage updated to use vault (5 managed keys across TokenService,
      PairingService, PushService, AiService, BillingService, system routes)
- [x] Legacy plaintext migration hook operational (startup sweep + transparent per-read upgrade)
- [x] `/api/v1/security/vault-status` REST endpoint registered in `index.ts`
- [x] `SecretVaultService.test.ts` created and passing
- [x] Monorepo CI gates pass cleanly

## 6. Git Diff Review

Reviewed `git diff` and `git status` line by line against every criterion and every forbidden change.

12 files in `apps/server` plus one package.json script line. Nothing outside `apps/server`. No
schema change was needed — the vault reuses the existing `settings` table, so no `ALTER TABLE` was
added and existing databases at `~/.asterim/asterim.db` keep opening (proved by the smoke test's
second boot against a database written by the first).

Forbidden-change audit:

- **No decryption key in the database.** Asserted by the suite (`'no settings row holds the vault
  salt'`) and by construction: the derived key exists only in process memory, the salt only in
  `vault.salt`.
- **No unauthenticated cipher.** `aes-256-gcm` is the only cipher referenced; no CBC, no hand-rolled
  HMAC-then-encrypt.
- **No existing suite broken.** All 38 pre-existing suites pass unchanged; none was edited.

Two nits found in self-review and fixed before reporting: a stray double blank line left in
`index.ts`, and an unused `err` binding in the new `PushService` catch (now included in the message).
One design issue found in self-review and fixed: `redactPayload` originally rebuilt every object it
walked, which would have put an allocation per subtree on the EventBus hot path once any secret was
registered — it now returns its input by reference when nothing changed, with two assertions added
to cover it.

`tests/report.md` shows as modified. **That change predates this session** — it was already dirty in
the working tree at the start of P9-01 and belongs to the previous test gate, so it is deliberately
excluded from this commit. `scratch/p9-smoke/` holds the end-to-end smoke test and is gitignored.

## 7. Problems Discovered

1. **Import-time construction order.** `dbService`, `tokenService`, `pairingService` and
   `pushService` are all module-level singletons, and esbuild hoists every `import` to the top of the
   module — so placing the migration sweep "before" the service imports in `index.ts` would have been
   an illusion. Solved by making `getSecret` self-migrating, so each service upgrades its own row at
   construction, and keeping the explicit sweep for the rows nothing reads until later.
2. **The logger runs before the database exists.** `initLogger()` is the first statement in
   `index.ts`. Importing the vault from `utils/logger.ts` would have opened SQLite before the streams
   were redirected. Solved with inverted registration (`registerLogRedactor`); the same shape is used
   for `EventBus.setRedactor`, which also avoids a `EventBus → vault → DatabaseService` cycle in a
   module nearly every service imports.
3. **`BillingService` captured `STRIPE_SECRET_KEY` in its constructor,** and the module constructs an
   instance on import — so a vault read there would have hit the database at import time and would
   also have frozen the answer before any secret could be stored. Resolution is now lazy
   (`resolveSecretKey()`), which also makes a key stored after startup take effect without a restart.
4. **Short secrets are hostile to redaction.** A registered value of a few characters would blank out
   ordinary log text. Values of 8 characters or fewer are not registered; the suite pins this.
5. **`/api/v1/system/settings` would have broken the AI settings form.** `AISettings.tsx` reads
   `ai_api_key` back into its input. The GET handler now decrypts envelopes, so the UI is unchanged;
   the change is to how the key rests on disk, not to who may read it back over an already
   authenticated request. Flagged in § 8.

## 8. Architectural Concerns

1. **`GET /api/v1/system/settings` still returns `ai_api_key` in cleartext to any authenticated
   caller.** This is unchanged behaviour, kept deliberately so the existing settings form keeps
   working, and it is out of this task's scope — but "encrypted at rest" and "never leaves the
   server" are different guarantees. The usual fix is to return a masked value plus a
   `hasApiKey: true` flag and treat an empty submission as "unchanged". That is a UI change and needs
   a task of its own.
2. **`environment_secrets.secret_value` is still plaintext.** The vault manages the `settings` table
   only; the workspace-scoped secrets table (`DatabaseService.ts:411`) was not named in the task's
   scope and is untouched. It is the obvious next candidate — the vault primitives are already
   table-agnostic (`encrypt`/`decrypt` take strings), so it is a call-site change, not a design one.
3. **Machine-bound keys make backups non-portable.** Restoring `asterim.db` onto a new machine, or
   renaming the host, orphans every stored secret. The failure is graceful (re-login, new VAPID pair)
   and visible in `vault-status.unreadableKeys`, but if Phase 9 ships a desktop migration story it
   will need an explicit export/import path — a passphrase-wrapped key envelope, not a second copy of
   the machine key.
4. **The OS keychain option in the drift item was not taken.** `IMPLEMENTATION_DRIFT.md` § 11 offers
   "machine-derived keys **or** OS Keychain primitives (keytar / DPAPI / libsecret)". The former was
   implemented because it adds no native dependency and works headless and air-gapped, which
   DEC-028's sovereign mode wants. Worth a decision record if the enterprise tier needs the latter.

## 9. Recommended Next Step

Extend the vault to `environment_secrets` (workspace-scoped credentials injected into agent
processes) — the same envelope, a different table, plus redaction registration for the values so they
cannot appear in agent stdout. Pair it with the `ai_api_key` masking change from § 8.1 as one
vertical "secrets never leave the Core" task, since both touch the same REST surface and both are
prerequisites for the Phase 9 enterprise hardening claim.
