# Phase 9 Production Gate — Enterprise Security Hardening & the Local Secret Vault

**Gate ID:** P9-04
**Phase:** Phase 9 — Enterprise Hardening, Desktop Shell & Production Release
**Date:** 2026-08-17
**Auditor:** Claude Code (Execution Engineer)
**Orchestrator:** Antigravity
**Governance:** `AGENTS.md`, `CLAUDE.md`, `blueprint/AI_CONTEXT.md`, `decisions.md` (DEC-028)
**Commit under audit:** `34d08e6` (`pipeline: dispatch task P9-04`) — working tree clean apart from `tests/report.md`, an uncommitted P9-03 test-gate record carried over from a prior verification session and untouched by this audit
**Toolchain:** Node v24.13.1, pnpm 9.0.0, turbo 2.9.18, TypeScript 5.4

---

## 1. Executive Verdict

**PASS — READY FOR NEXT PHASE.**

Phase 9 closes the enterprise-hardening vertical across three workstreams (P9-01 → P9-03): a local
AES-256-GCM vault for machine credentials, an encrypted workspace-secret store with an API that
cannot return a credential, and the operator surface for both. Every acceptance criterion of every
workstream was re-checked against the code at `34d08e6` rather than against the prior reports.

All four monorepo quality gates were executed live in this session, **with Turbo's cache defeated**,
because a gate audit that accepts a replayed log is not evidence:

| Gate | Command | Result |
| :--- | :--- | :--- |
| Typecheck | `pnpm --filter "*" run typecheck` | **PASS** — 7/7 packages, **0 TypeScript errors** |
| Lint | `pnpm --filter "*" run lint` | **PASS** — 7/7 packages, **0 errors** (663 warnings, all pre-existing) |
| Test | `pnpm test -- --force` | **PASS** — 9/9 Turbo tasks, **0 cached**, **41 suites, 4,883 assertions, 0 failures** |
| Build | `pnpm --filter "*" run build` | **PASS** — 7/7 packages, every artefact produced |
| Turbo aggregate | `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` | **PASS** — 11/11, 7/7, 9/9, 7/7 tasks |

Beyond the suites, a **live end-to-end pass over the production cryptographic configuration** was
executed (§7). This matters more here than in any previous phase: the P9-01/02/03 suites run the
vault at **1,000** PBKDF2 rounds under a synthetic machine identity, which is the right call for a
unit suite and the wrong one for a production gate. The live pass drives the **process-wide
singletons exactly as `apps/server/src/index.ts` constructs them** — 100,000 PBKDF2-HMAC-SHA512
rounds, `defaultMachineIdentity()`, a real `vault.salt` on disk, redaction installed into the real
logger and the real EventBus — and reaches them only through the real Fastify routes. It asserts at
the layers where a leak would actually occur: the raw SQLite column, **the raw bytes of the database
file**, the raw HTTP body, and the payload a Socket.IO subscriber receives. **115/115 live checks
passed.**

Housekeeping: the untracked preview artefact `apps/web/src/__p903_preview.ts`, which the P9-03
session could not remove, is **deleted** (§6).

No product code was modified by this audit. No cryptographic guarantee, PBKDF2 bound or validation
rule was weakened. Six observations are recorded in §8; none blocks the phase.

---

## 2. Subsystem Audit Matrix

| # | Subsystem | Source of truth | Verdict | Evidence |
| :-: | :--- | :--- | :---: | :--- |
| 1 | **Cipher & envelope** | `SecretVaultService.encrypt/decrypt` (`apps/server/src/services/security/SecretVaultService.ts:233,248`) | **PASS** | AES-256-GCM, 12-byte IV from `crypto.randomBytes` per call, full 16-byte tag, `vault:v1:<iv>:<tag>:<ciphertext>` all-hex. Live checks §7.2 — the same secret encrypted twice yields different IVs and different envelopes, so identical credentials in two environments are not correlatable on disk |
| 2 | **Key derivation & machine binding** | `key()` (`:209`), `defaultMachineIdentity()` (`:121`) | **PASS** | PBKDF2-HMAC-SHA512, **100,000 rounds** in the shipped configuration, 32-byte key, derived once per process and **held only in memory**. Identity binds platform, arch, hostname, username, uid and home directory. Live checks §7.1 |
| 3 | **Salt handling** | `loadSalt()` (`:181`) | **PASS** | 32 random bytes at `~/.asterim/vault.salt`, written `0600` with an explicit `chmodSync` on POSIX, created once and never rewritten; a malformed salt warns rather than crashing. Live checks §7.1 verify the mode, the length, that the file holds nothing but the salt, and that no derived key appears anywhere in the data directory |
| 4 | **Tamper resistance** | `decrypt` (`:248`) | **PASS** | The tag is verified by `decipher.final()` before any plaintext is returned; OpenSSL compares it in constant time. Structural faults (wrong IV length, truncated tag, non-hex, wrong part count) are `INVALID_ENVELOPE_ERROR` *before* a key is touched; authentication faults are `TAMPERED_SECRET_ERROR`. All seven forms verified live (§7.3) at production rounds |
| 5 | **Foreign-machine safety** | `getSecret` (`:317`), `getStatus` (`:575`) | **PASS** | A vault with a different machine identity over the *same* salt cannot open an envelope; `getSecret` logs and returns `null` rather than throwing, so a copied `asterim.db` opens and the Core boots. `vault-status` counts such rows as `unreadableKeys` and flips `healthy` to false. Live checks §7.4, §7.11 |
| 6 | **Machine credentials at rest** | `SECRET_SETTING_KEYS` (`:60`), `setSecret` (`:300`) | **PASS** | `ai_api_key`, `vapid_keys`, `stripe_secret_key`, `jwt_secret`, `hmac_secret`. Every consumer routes through the vault: `TokenService:23,29`, `PairingService:69,74`, `PushService:28,49`, `BillingService:185`, `AiService:41`, `routes/system.ts:65,97,110`. Non-secret configuration (`ai_provider`, `ai_model`, `first_run_completed`) stays readable by design |
| 7 | **Zero-downtime migration** | `migrateLegacyPlaintext` (`:390`) + read-path upgrade (`:327`) | **PASS** | Two paths: a startup sweep over the managed keys, and an in-place upgrade the first time a legacy row is read. Neither requires an operator action. Live check §7.10 drives a real legacy row from plaintext → envelope with the value unchanged |
| 8 | **Freed-page residue** | `DatabaseService.compact()` (`:726`), called at `index.ts:163` | **PASS** | Encrypting a row in place does **not** erase what the page used to hold — SQLite frees rather than overwrites. The Core runs `VACUUM` + `PRAGMA wal_checkpoint(TRUNCATE)` after any sweep that moved something. §7.10 proves both halves: the cleartext **is** still in the file before the rebuild and **is not** after it. This is the single most easily-missed at-rest exposure in the phase and it is already closed |
| 9 | **Workspace secrets at rest** | `EnvironmentSecretService.setSecret` (`EnvironmentSecretService.ts:310`) | **PASS** | Same vault, same key, same machine binding. Upsert on `(environment_id, secret_key)` keeps `created_at`. §7.5 reads the raw column *and* the raw `asterim.db` bytes: no credential, no fragment, no password — while the key *names* are present, which is correct, they are not secret |
| 10 | **In-transit masking** | `getSecrets` (`:212`), `routes/environmentSecrets.ts:88` | **PASS** | The read path **never decrypts** — there is no plaintext on it to leak. §7.6 asserts the raw body contains neither a credential nor an envelope, that every row is exactly `{key, maskedValue, isSet, createdAt}`, and that the `/workspaces/:id` alias is byte-identical |
| 11 | **System-settings masking** | `routes/system.ts:54–75` | **PASS** | `GET /api/v1/system/settings` returns `SECRET_MASK` plus `hasApiKey` and `maskedKeys`; `POST` ignores a re-submitted mask (`:106`). §7.10 asserts the API key is absent from the raw body |
| 12 | **Protected-key enforcement** | `PROTECTED_SECRET_KEYS` (`packages/shared/src/types/security.ts:36`), `validateKey` (`:126`), re-check on injection (`:425`) | **PASS** | All eleven names refused `400 PROTECTED_SECRET_KEY_ERROR`, case-insensitively; malformed keys refused `400 INVALID_SECRET_KEY_ERROR`. Checked **twice** — on the way in and on the way out — so a row written around the API is still not injected. §7.7, §7.9 |
| 13 | **Mask round-trip protection** | `isMasked` (`:65`), `routes/environmentSecrets.ts:121` | **PASS** | Submitting `••••••••` (or any run of mask glyphs) is a 400, and §7.7 confirms the stored credential survives it. Enforced in the Core *and* in the store (`useSecretStore.ts:186`) |
| 14 | **Redaction engine** | `registerForRedaction` (`:434`), `redactSecrets` (`:504`), `redactPayload` (`:518`) | **PASS** | One index, one owner. Installed into the log stream (`registerLogRedactor`) and the EventBus (`eventBus.setRedactor`) at construction. Longest-first replacement; structured secrets contribute their leaves but not their `public*` fields; identity-returned when nothing changed, so the hot path costs one length check. §7.8 drives an agent echoing its token through both seams, including a credential nested in an array |
| 15 | **Redaction lifecycle** | `unregisterRedactedValue` (`:490`), `deleteSecret` (`:342`), `deleteEnvironmentSecrets` (`:365`) | **PASS** | A deleted secret stops being redacted — a placeholder standing for a credential that no longer exists would send whoever reads the log looking for nothing. §7.8 verifies the deleted value passes through untouched while the remaining one is still stripped |
| 16 | **Agent injection path** | `resolveEnvironmentVariables` (`:404`), `AgentService.resolveEnvironmentSecrets` (`AgentService.ts:607`) | **PASS** | The only bulk plaintext path, and it has one caller. Every value is registered with the redactor before it returns. An undecryptable credential is omitted, not raised: one bad row must not stop a session. The log line names the keys, never the values (`AgentService.ts:614`) |
| 17 | **Environment lifecycle** | `deleteEnvironmentSecrets`, `WorkspaceService.ts:362` | **PASS** | Deleting a workspace drops its credentials *and* their redaction entries — the FK would cascade the rows, but the index lives in this process and has to be told |
| 18 | **REST surface & auth** | `routes/environmentSecrets.ts:51`, `routes/security.ts` | **PASS** | Six secret routes (three verbs × two aliases) behind `authorize`: 401 anonymous, 403 for a non-member of an environment that has members, `workspace:read` to list and `workspace:write` to mutate. `statusFor` maps every error code to 400/404/500. The membership-less fallback is deliberate and is recorded as a standing policy question (§8.5) |
| 19 | **Status surface carries no secret** | `getStatus` (`:575`), `routes/security.ts:20` | **PASS** | Counts and compiled-in algorithm names only. §7.11 asserts the raw body carries neither credential nor envelope, and that an unreadable envelope degrades `healthy` to false rather than 500-ing the endpoint |
| 20 | **Shared contract** | `packages/shared/src/types/security.ts` | **PASS** | Mask, key rules, protected list and every wire shape declared once and imported by both the Core and the dashboard; the server re-exports under its historical names so no Core call site changed. This is `CLAUDE.md`'s stated anti-pattern avoided, not merely tidiness — a client with its own idea of a valid key drifts silently |
| 21 | **Zero plaintext in the browser** | `EnvironmentSecretsPanel.tsx:352,456,464`; `useSecretStore.ts` | **PASS** | The value field is **uncontrolled** (`ref`, no `value` prop), so the credential never enters React state and cannot appear in the rendered tree — the failure mode the P9-03 suite caught. Read from the ref on submit, **cleared before the request is awaited**, and the store has no field that could hold a value. 203 assertions, including a regex that no `value` attribute is emitted in any state |
| 22 | **Client storage** | `useSecretStore.ts` | **PASS** | The only `localStorage` access is `getAuthHeaders` reading the session token. No credential, no cache, no draft |
| 23 | **Operator surface reachability** | `EnvironmentSettingsView.tsx:806`, `EnvironmentSecretsPanel.tsx:516` | **PASS** | The panel replaced three hardcoded mock password fields in the Secrets tab; the vault card renders beneath it. Both are reachable — unlike `DeveloperSettings.tsx`, which the brief offered and which nothing imports (§8.1) |
| 24 | **Design system compliance** | `blueprint/DESIGN_SYSTEM.md` | **PASS** | Both new components use `--color-surface-*`, `--color-border-*`, `--color-text-*`, `--color-state-completed/paused/error` and `--font-family-mono`. No hex literal was introduced; removing the mock section deleted three (`#131b2e`, `#090d16`, `#34d399`). No new dependency in any `package.json` |
| 25 | **Data sovereignty (DEC-028)** | §5 | **PASS** | Zero network primitives in the entire Phase 9 server surface; keys are derived from the workstation, never escrowed, never transmitted |

---

## 3. Workstream Acceptance-Criteria Audit

Each criterion is quoted from the brief that was dispatched for it (recovered from
`git show <dispatch-commit>:tasks/current.md`) and re-verified against the code at `34d08e6`.

### 3.1 P9-01 — Local Secret Vault & Cryptographic Keystore (`8c1ee86`)

| # | Criterion | Verdict | Evidence |
| :-: | :--- | :---: | :--- |
| 1 | AES-256-GCM with random IVs and authenticated tags | **PASS** | `crypto.createCipheriv('aes-256-gcm', …)`, fresh `randomBytes(12)` per call, full 16-byte tag. Matrix rows 1–2; live §7.2 at 100,000 rounds |
| 2 | Tampered ciphertext or forged tags detected and rejected | **PASS** | `TAMPERED_SECRET_ERROR` for a flipped ciphertext byte, a forged tag and a swapped IV; `INVALID_ENVELOPE_ERROR` for structural faults. Live §7.3 (7/7); suite `SecretVaultService.test.ts` **133/133** |
| 3 | Legacy plaintext in `settings` transparently migrated | **PASS** | Startup sweep (`index.ts:149`) plus read-path upgrade. Live §7.10 — and the audit found the Core already handles the harder half, the freed-page residue (matrix row 8) |
| 4 | `GET /api/v1/security/vault-status` reports status without leaking secrets | **PASS** | Registered `index.ts:209`. Counts and compiled-in names only; live §7.11 asserts the raw body over both a healthy and a degraded vault |
| 5 | `SecretVaultService.test.ts` passes with comprehensive cryptographic assertions | **PASS** | **133/133**, exit 0, real temp data dir, cleaned |
| 6 | Monorepo CI gates, 0 errors | **PASS** | §1 |

**Scope note.** The brief asked for `DatabaseService.ts` / `PlanService.ts` to route secrets through
the vault. The implementation instead routes the five *owners* of those credentials —
`TokenService`, `PairingService`, `PushService`, `BillingService`, `AiService` — and the
settings route. This is the same coverage reached at the layer that actually holds each secret;
`DatabaseService` is the connection, not a credential owner. **Audited and accepted.**

### 3.2 P9-02 — Workspace Environment Secrets & In-Transit Masking (`315f50e`)

| # | Criterion | Verdict | Evidence |
| :-: | :--- | :---: | :--- |
| 1 | All environment secrets stored as `vault:v1:` AES-256-GCM envelopes | **PASS** | Live §7.5 reads the raw column *and* the raw database file after a real `POST`: envelope present, credential absent, fragment absent. Suite **181/181** |
| 2 | `GET …/secrets` returns masked representations only | **PASS** | The read path never decrypts. Live §7.6 — no credential, no envelope, exactly four fields per row, `/workspaces` alias identical |
| 3 | `GET /system/settings` masks `ai_api_key`; `POST` supports update and preservation | **PASS** | `routes/system.ts:54–75`, `:106`. Live §7.10 — mask returned, `hasApiKey: true`, `maskedKeys` names it, raw body free of the key |
| 4 | Resolved variables injected decrypted and registered for redaction | **PASS** | `resolveEnvironmentVariables` → `AgentService:610`. Live §7.8 drives the whole loop: resolve, echo, and the value is gone from both the log stream and the EventBus payload — including nested in an array |
| 5 | Legacy unencrypted rows transparently upgraded | **PASS** | `openRow` (`:270`) on read and `migrateLegacyPlaintext` (`:450`) at startup; 181-assertion suite covers both |
| 6 | `EnvironmentSecretService.test.ts` passes | **PASS** | **181/181**, exit 0 |
| 7 | Monorepo CI gates, 40+ suites | **PASS** | §1, §4 — 41 suites |

**Beyond the brief, and material:** the protected-key list. Nothing in P9-02's criteria asked for it,
but without it write access to a workspace's secrets would have been code execution inside every
agent that workspace starts (`LD_PRELOAD`, `NODE_OPTIONS`, `PATH`). It is enforced on the way in
*and* on the way out, so a row written directly into the table is still refused injection (live
§7.9). **Audited and accepted as a security addition, not scope creep.**

### 3.3 P9-03 — Secrets Management UI & Workstation Security Status (`e323326`)

| # | Criterion | Verdict | Evidence |
| :-: | :--- | :---: | :--- |
| 1 | Masked secrets displayed from `GET …/secrets` | **PASS** | `EnvironmentSecretsPanel` mounted at `EnvironmentSettingsView.tsx:806`, keyed on environment id, re-fetches when it changes; key in mono, `••••••••` badge, Encrypted/Not-set indicator, `Added <date>`, real empty state |
| 2 | Add & rotate with client-side POSIX validation and server error handling | **PASS** | Validation from the **shared** constants the Core enforces; `describeSecretError` branches on the *code*, never on message text; rotation replaces the row in place with the Core's `createdAt` |
| 3 | Delete with a confirmation step | **PASS** | In-place `Delete <KEY>?` → `Confirm delete` / `Cancel`, only the armed row confirms; key URL-encoded; a 404 leaves the row alone |
| 4 | Vault status card renders live metrics | **PASS** | `SecurityStatusCard` at `EnvironmentSecretsPanel.tsx:516`; health badge, cipher, KDF and rounds, salt presence, system and environment tallies, migration state, redaction count. Amber/red states asserted separately |
| 5 | Zero plaintext leakage — cleared on submit, never in DOM or client storage | **PASS** | Matrix rows 21–22. Structural, not disciplinary: there is no state field that could hold a value, and the input is uncontrolled |
| 6 | `EnvironmentSecretsUI.test.ts` passes | **PASS** | **203/203**, exit 0 |
| 7 | Monorepo CI gates | **PASS** | §1 |

**Two contract discrepancies in the P9-03 brief were resolved in favour of the running code, and
this audit confirms the running code is what the brief got wrong**, not the other way round:

- The brief specified `GET …/secrets` → `{ success: true, secrets }`. The route returns
  `{ secrets, mask }` (`routes/environmentSecrets.ts:98`). A store branching on `body.success`
  would have read every successful listing as a failure.
- The brief specified a flat `{ cipher, kdf, saltExists, rounds, settings, … }` for vault-status.
  The route returns `{ vault: { …, environmentSecrets }, healthy }` (`routes/security.ts:28`) with
  fields named `algorithm` / `keyDerivation` / `iterations` / `saltPresent`. Reading the brief as
  written would have produced a card of `undefined`s.

Both shapes are now pinned by captured-real-body assertions in the 203-assertion suite, and both
were re-confirmed against live route output in §7.6 and §7.11.

---

## 4. Full Test Suite Census

**41 suites, 4,883 assertions, 0 failures**, executed with `pnpm test -- --force` — **0 of 9 Turbo
tasks cached**, 1m10s wall clock.

### `asterim` (server) — 23 suites, 2,788 assertions

| Suite | Assertions |
| :--- | ---: |
| `services/memory/MemoryRelevanceEngine` | 63 |
| `services/memory/DecisionExtractor` | 60 |
| `routes/memory` | 140 |
| `routes/memory-candidates` | 52 |
| `routes/internal` | 51 |
| `services/git/GitDriftDetector` | 64 |
| `services/git/RemoteManager` | 89 |
| `services/git/GitWorktreeService` | 111 |
| `services/SovereignMode` | 21 |
| `services/ProjectMemoryService` | 231 |
| `services/PairingService` | 52 |
| `services/BillingService` | 102 |
| `services/mcp/McpProcessSupervisor` | 115 |
| `services/mcp/McpCapabilityDiscovery` | 89 |
| `services/mcp/McpToolInvocation` | 43 |
| `services/mcp/McpAgentBridge` | 67 |
| `services/mcp/AgentMcpIntegration` | 160 |
| `services/skills/SkillService` | 169 |
| `services/ai/ProfileService` | 138 |
| `services/ai/AgentDelegationService` | 461 |
| `services/verification/VerificationPipelineService` | 196 |
| **`services/security/SecretVaultService`** *(P9-01)* | **133** |
| **`services/security/EnvironmentSecretService`** *(P9-02)* | **181** |

### `@asterim/web` — 9 suites, 1,647 assertions

| Suite | Assertions |
| :--- | ---: |
| `components/memory/DecisionExplorer` | 151 |
| `components/memory/CandidateReview` | 37 |
| `components/memory/MemoryTimeline` | 134 |
| `stores/useMemoryStore` | 113 |
| `components/mcp/McpServerExplorer` | 104 |
| `components/skills/SkillsExplorer` | 85 |
| `components/profiles/ProfileSelector` | 134 |
| `components/delegation/DelegationUI` | 686 |
| **`components/environment/EnvironmentSecretsUI`** *(P9-03)* | **203** |

### `@asterim/mcp-memory-server` — 7 suites, 348 assertions

`resolver` 42 · `record_decision` 82 · `retrieval_tools` 87 · `dogfood_scenario` 62 ·
`stdio_scaffold` 28 · `relay-client` 23 · `relay_e2e` 24

### `@asterim/relay` — 1 suite, 71 · `@asterim/adapters` — 1 suite, 29

`relay` 71 · `sdk/ProcessManager` 29

### Phase 9 suites, standalone

| Suite | Result |
| :--- | :--- |
| `SecretVaultService.test.ts` | **133/133**, exit 0 — real temp data dir, cleaned |
| `EnvironmentSecretService.test.ts` | **181/181**, exit 0 — real SQLite + real Fastify `inject`, cleaned |
| `EnvironmentSecretsUI.test.ts` | **203/203**, exit 0 |

**Phase-over-phase:** 38 suites / 4,360 assertions at the Phase 8 gate → **41 / 4,883** here.
+3 suites and +523 assertions, of which 517 are the three Phase 9 suites; the remaining 6 are
`sdk/ProcessManager` growing 23 → 29. No pre-existing suite lost assertions.

### Quality gate detail

- **Typecheck** — 7 packages, 0 errors: `packages/shared`, `packages/adapters`,
  `packages/mcp-memory-server`, `apps/relay`, `apps/marketing`, `apps/web`, `apps/server`.
  (`packages/config-eslint` declares no typecheck script; the Turbo aggregate reports 11 tasks
  because four upstream `build` tasks are dependencies.)
- **Lint** — 7 packages, **0 errors**, 663 warnings: web 304, server 298, adapters 28,
  marketing 18, mcp-memory-server 12, shared 3, relay 0. The delta from Phase 8's 636 is
  web 302 → 304 (two `react-refresh/only-export-components` on the new component files, the same
  warning every existing view file with an exported helper carries) and server 273 → 298 from the
  two new services. All are pre-existing rule classes; none is an error.
- **Build** — 7 packages: `tsc` for shared/adapters/relay, `tsc && vite build` for web (PWA
  service worker, 11 precache entries, 2,085 KiB) and marketing, `tsup` for server
  (`dist/index.js` 956.40 KB) and mcp-memory-server (88.54 KB). The server build copied
  `apps/web/dist` into `dist/web`, so the packaged binary still serves the dashboard.
- **CI parity** — `.github/workflows/ci.yml` runs typecheck → lint → test → build, the same four
  gates in the same order.

---

## 5. Security Invariants & Boundary Verifications

| Invariant | How it is held | Verified by |
| :--- | :--- | :--- |
| **No credential is readable in `asterim.db`** | Every managed `settings` row and every `environment_secrets` row is an AES-256-GCM envelope; a migration that moved something is followed by `VACUUM` + truncating WAL checkpoint so the superseded page is gone too | Live §7.5, §7.10 — raw column bytes *and* raw file bytes, before and after the rebuild |
| **The key exists only in memory** | PBKDF2 over a machine identity that is computed, never stored; the salt file holds a salt and nothing else; the key is never written to the database, the salt file or a log | Live §7.1 — salt is 64 hex chars and nothing more, `0600`, and no derived key appears anywhere in the data directory |
| **A modified envelope is never decrypted** | GCM tag verified by `decipher.final()` before any plaintext is returned, in constant time; structural faults are rejected before the key is touched | Live §7.3 (7/7) at production rounds; 133-assertion suite |
| **A copied database yields nothing** | Key derivation binds platform, arch, hostname, username, uid and home directory. A foreign vault over the same salt fails the tag check like any other tamper | Live §7.4 |
| **An unreadable envelope degrades, never crashes** | `getSecret` logs and returns `null`; `getStatus` counts it as `unreadableKeys`; the endpoint still answers 200 with `healthy: false`; secret-minting services simply mint a fresh one | Live §7.4, §7.11 |
| **No read path can return a credential** | `getSecrets` does not decrypt — there is no plaintext on the GET path to leak. `GET /system/settings` substitutes the mask. Both status shapes carry counts and compiled-in names only | Live §7.6, §7.10, §7.11 — asserted against the **raw response body**, not the parsed object |
| **A form cannot overwrite a secret with its own mask** | `isMasked` refuses the placeholder and any run of mask glyphs, in the Core and again in the store | Live §7.7 — the stored credential survives the attempt |
| **A stored secret cannot become code execution** | Eleven loader/shell names refused case-insensitively, on write **and** on injection; keys must be POSIX names ≤128 chars | Live §7.7 (17 refusals), §7.9 (hand-written `LD_PRELOAD` row not injected) |
| **A secret an agent echoes never reaches a log or a subscriber** | One redaction index, owned by the vault, installed into `registerLogRedactor` and `eventBus.setRedactor`; longest-first; walks nested payloads to depth 8; registered *before* `resolveEnvironmentVariables` returns | Live §7.8 — through the real logger and the real EventBus, including a credential nested in an array |
| **A deleted secret stops being redacted** | Namespaced index entries (`env-secret:<envId>:<KEY>`) removed on delete, rotation and environment teardown | Live §7.8 |
| **No credential reaches the browser's memory** | The value field is uncontrolled; the store has no field that could hold a value; the field is cleared *before* the request is awaited | 203-assertion suite: store serialised and asserted credential-free after success, after rotation and after every failure path |
| **Data sovereignty (DEC-028)** | §6 | Static scan + §6 |

---

## 6. Data Sovereignty Attestation (DEC-028)

The Phase 9 server surface — `SecretVaultService`, `EnvironmentSecretService`, `routes/security.ts`,
`routes/environmentSecrets.ts` and `packages/shared/src/types/security.ts` — contains **no network
primitive**: a scan for `fetch(`, `http`/`https` clients, `net.`, `dns.`, `axios`, `node-fetch` and
`XMLHttpRequest` across all five returns nothing.

| DEC-028 clause | Finding |
| :--- | :--- |
| Local-first data ownership | Key material is derived on the workstation from workstation facts and a local salt. It is never transmitted, never escrowed, and never written to the database |
| No cloud key management | No KMS, no HSM, no remote unwrap, no external SDK. Adding one would be a Change Proposal, not an implementation choice |
| Zero telemetry | Nothing in the vault or the secret store emits, counts or reports anything off-machine. The only egress is the operator's own dashboard over the existing REST/Socket.IO channel |
| Sovereign mode compatible | Both services are pure local SQLite + `node:crypto`. The P9-02 suite runs the whole REST surface with `ASTERIM_SOVEREIGN_MODE=true` |

The dashboard's four `fetch` calls in `useSecretStore.ts` are same-origin calls to the operator's own
Core (`/api/v1/…`) — the boundary DEC-028 governs is egress from the workstation, and there is none.

**A consequence worth stating plainly, because it is a support burden rather than a defect:** machine
binding means a restored backup on new hardware yields credentials that will not decrypt, and
deleting `vault.salt` orphans every stored secret. Both are the behaviour a local-first vault is
supposed to have — a key that travels with the ciphertext is not encryption — and both fail safe
(the Core boots, unreadable rows read as absent, self-minting secrets regenerate). The one cost that
lands on a user is a re-login and a re-entered API key.

---

## 7. Live End-to-End Verification — Production Configuration

**115/115 checks passed.** Driver: `scratch/p9-gate-live-check.ts` (git-ignored, part of no build).

The suites deliberately run the vault at 1,000 PBKDF2 rounds under a synthetic identity. This pass
uses the **process-wide singletons as `index.ts` constructs them**: 100,000 rounds,
`defaultMachineIdentity()`, a real salt file, redaction installed into the real logger and the real
EventBus, real SQLite in a temp data directory, and the real Fastify routes via `inject()`.

| § | Stage | Checks | Result |
| :-: | :--- | :--- | :---: |
| 7.1 | **The vault that ships** — AES-256-GCM, PBKDF2-HMAC-SHA512, 100,000 rounds, 12/16-byte IV/tag, v1, key derives, salt present, five managed keys, salt is 32 hex bytes and nothing else, `0600`, no derived key on disk | 13 | 13/13 |
| 7.2 | **The envelope** — prefix, five parts, IV and tag lengths, plaintext absent, two encryptions never repeat, IVs differ, both decrypt | 8 | 8/8 |
| 7.3 | **Tamper detection at production rounds** — flipped ciphertext, forged tag, swapped IV → `TAMPERED_SECRET_ERROR`; truncated tag, non-hex, malformed, bare plaintext → `INVALID_ENVELOPE_ERROR` | 7 | 7/7 |
| 7.4 | **A database on another machine** — foreign vault refused over the same salt, its own envelopes still round-trip, `getSecret` degrades instead of throwing | 3 | 3/3 |
| 7.5 | **POST → disk** — 201, masked reply, no credential in the 201 body, envelope in the column, credential and fragment absent from the column, credential/URL/password absent from `asterim.db`, key names present | 10 | 10/10 |
| 7.6 | **GET → the wire** — 200, no credential and no envelope in the raw body, two rows, shared mask, all masked and set, all timestamped, exactly four fields per row, `/workspaces` alias byte-identical | 9 | 9/9 |
| 7.7 | **Refusals** — all 11 protected names `400 PROTECTED_SECRET_KEY_ERROR`, case-insensitive, 6 malformed keys `400`, mask re-submission `400` with the credential intact, unknown environment `404` | 21 | 21/21 |
| 7.8 | **Redaction** — agent gets both variables; echoed output stripped from the real log stream and the real EventBus payload (including nested in an array) with surrounding text intact; DELETE unregisters the deleted value while the other stays redacted; second DELETE is 404 | 12 | 12/12 |
| 7.9 | **A row written around the API** — a hand-inserted encrypted `LD_PRELOAD` is refused injection; the legitimate secret still is injected | 2 | 2/2 |
| 7.10 | **Legacy machine credential** — plaintext row → sweep encrypts → column is an envelope → value unchanged → **cleartext still in the file before `compact()`, gone after it** → `GET /system/settings` returns the mask, `hasApiKey`, `maskedKeys` and no key | 13 | 13/13 |
| 7.11 | **`vault-status`** — 200, no credential, no envelope, healthy, zero plaintext, zero unreadable, encrypted tally matches the managed rows that exist and each really is an envelope, environment tally correct, migration complete on both stores, live redaction count, managed names present; then a foreign envelope → still 200, counted unreadable, `healthy: false`, `getSecret` returns null | 17 | 17/17 |

Two of these checks began as failures and both were **harness** faults, corrected rather than
excused, and both are worth recording because each taught the audit something:

1. *"the key is nowhere in the database file"* failed after a migration. The cause is real —
   SQLite frees pages rather than overwriting them — but the Core already handles it
   (`DatabaseService.compact()`, called from `index.ts:163` after any sweep that moved something).
   The harness had reproduced the sweep without the rebuild. It now reproduces the full startup
   sequence and asserts **both** sides of the boundary, which is a stronger check than the one it
   replaced.
2. *"one machine credential is encrypted"* expected a fixed count of 1. Importing the routes brings
   `TokenService` and `PairingService`, each of which mints and stores its own secret through the
   vault. The assertion now derives the expected count from the managed rows that actually exist
   and additionally asserts every one of them is a real envelope in the column.

---

## 8. Observations & Architectural Notes

1. **`DeveloperSettings.tsx` is dead code and the P9-03 brief pointed at it.** Nothing imports it
   (`grep` finds only its own declaration), yet it carries the entire multi-device workstation UI.
   P9-03 correctly put the security card somewhere reachable instead. This should be resolved
   explicitly — delete it, or wire it up — before the desktop shell, which will have to answer for
   it either way. **Highest-value follow-up in this list.**

2. **Vault status is a workstation fact displayed inside one environment.** The card answers a
   machine-level question but appears only under an environment's Secrets tab, so an operator with
   three environments sees the same card three times and an operator viewing none sees it never.
   The component is already props-only and connected, so relocating it to a global Security section
   is an import. Not moved here: this task forbids product-code changes that are not regression
   fixes.

3. **`MIN_REDACTABLE_LENGTH = 8` is a deliberate, documented hole.** A credential of eight
   characters or fewer is encrypted at rest but **not** stripped from agent output, because
   redacting short strings would scrub ordinary log text. The trade is right, but the card's
   "Output redaction — N values" tally silently undercounts in that case: it reports what the
   redactor holds, which is accurate and still misleading. A one-line note in the card, or a
   minimum-length hint on the value field, would close the gap in the operator's understanding
   without touching the redactor.

4. **No `updated_at` on `environment_secrets`.** The upsert keeps `created_at` deliberately — the
   row's history is when the credential was introduced — but that means the panel can say when a
   secret first appeared and never when it was last rotated, which is the field an enterprise audit
   actually asks for. The UI column is already there. A schema change follows the established
   `ALTER TABLE … ADD COLUMN` in try/catch pattern.

5. **The membership-less RBAC fallback is now user-visible.** An environment with no rows in
   `workspace_memberships` (every workspace written before RBAC existed, and the normal case on a
   single-user workstation) lets any authenticated caller add and delete its credentials. Carried
   forward from P9-02 §8.1; still the right default for local-first, still a policy decision worth
   the human operator confirming explicitly now that a UI exists for it.

6. **`CLAUDE.md`'s test section remains factually wrong** — flagged at the Phase 8 gate (§8.1
   there), unchanged since. It states there is "no test runner or test script anywhere in the repo"
   and that CI runs "only `pnpm run lint` and `pnpm run build`". At `34d08e6` there are **41 suites
   and 4,883 assertions**, a `test` script in five workspaces, a root `turbo run test`, and
   `ci.yml` runs typecheck → lint → **test** → build. The instruction that follows it — *"Don't
   claim tests pass"* — actively suppresses the strongest evidence an execution agent has, and it
   has now misdirected two consecutive phases. **Not fixed here:** `CLAUDE.md` is a governance
   document under the Source of Truth Matrix and outside this task's Implementation Scope.
   Recommended as a one-paragraph correction in the next dispatch.

---

## 9. Reproduction

```bash
# Quality gates — cache defeated, so each result is live execution
pnpm test -- --force              # 41 suites, 4,883 assertions, 0 failures
pnpm --filter "*" run typecheck   # 7 packages, 0 errors
pnpm --filter "*" run lint        # 7 packages, 0 errors (663 pre-existing warnings)
pnpm --filter "*" run build       # 7 packages, all artefacts produced

# Turbo aggregates (cached after the above)
pnpm typecheck && pnpm lint && pnpm test && pnpm build

# The three Phase 9 suites, standalone
pnpm --filter asterim exec tsx src/services/security/__tests__/SecretVaultService.test.ts
pnpm --filter asterim exec tsx src/services/security/__tests__/EnvironmentSecretService.test.ts
pnpm --filter @asterim/web exec tsx src/components/environment/__tests__/EnvironmentSecretsUI.test.ts

# The live production-configuration pass of §7 (git-ignored driver, no build depends on it)
pnpm --filter asterim exec tsx ../../scratch/p9-gate-live-check.ts
```

Note, carried from the Phase 8 gate: `pnpm typecheck -- --force` and `pnpm build -- --force`
forward `--force` to `tsc`, which rejects it (`TS5093`). Use the per-workspace form above to defeat
the cache for those two gates.

---

## 10. Sign-Off

| Role | Name | Verdict | Date |
| :--- | :--- | :--- | :--- |
| Execution Engineer / Auditor | Claude Code | **PASS — READY FOR NEXT PHASE** | 2026-08-17 |
| Orchestrator / Reviewer | Antigravity | *pending* | — |
| Product Director | Human Operator | *pending* | — |

**Scope of this sign-off.** Phase 9 workstreams P9-01, P9-02 and P9-03 at commit `34d08e6`: the
local AES-256-GCM secret vault and its machine-credential migration, the encrypted workspace
environment-secret store with its masked REST surface and agent-injection path, the shared security
contract in `@asterim/shared`, and the operator dashboard surface over both. Verified by 41
automated suites (4,883 assertions), 115 live checks against the **production cryptographic
configuration**, and four clean quality gates with Turbo's cache defeated.

No security defect was found. Six observations are recorded in §8: one is dead code the desktop
shell will have to resolve (§8.1), one is a governance document that has been stale for two phases
(§8.6), and four are enhancements or standing policy questions. None blocks Phase 9.

**Recommended next milestone:** the desktop shell and production release, per the phase title. The
enterprise-hardening vertical is closed end to end — encrypted at rest, never returned in transit,
stripped from output, and operable from the dashboard.
