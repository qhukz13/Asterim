Task-ID: P9-01
Phase: 9

# [P9-01] — Local Secret Vault & Cryptographic Keystore for Credentials at Rest

**Task ID:** P9-01  
**Phase:** Phase 9 — Enterprise Hardening, Desktop Shell & Production Release  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-17  

---

## 1. Objective

Implement the Local Secret Vault subsystem (`SecretVaultService.ts`) in `apps/server`: encrypt all sensitive credentials, API keys, and private tokens stored at rest in SQLite using authenticated symmetric encryption (`AES-256-GCM` with machine-derived key derivation), provide seamless zero-downtime migration for existing plaintext `settings` rows, implement automatic secret redaction in logs and event payloads, and author a comprehensive automated unit test suite.

---

## 2. Why This Task Exists

In Phase 8, Asterim achieved full multi-agent worktree sandboxing and automated verification pipelines. However, as documented in `blueprint/audit/IMPLEMENTATION_DRIFT.md` (Item 11), sensitive credentials (such as LLM provider API keys, Stripe secret keys, and VAPID private keys) are currently stored in plaintext within SQLite `settings` table.

For production, commercial beta, and enterprise desktop deployment, all secrets stored on the workstation must be encrypted at rest:
1. Protect developer credentials against unauthorized disk inspections or backup leaks.
2. Prevent plaintext tokens from appearing in debug logs, error traces, or EventBus WebSocket broadcasts.
3. Establish a tamper-proof cryptographic foundation for multi-tenant and desktop distributions.

---

## 3. Context & Architecture

- **Cryptographic Specifications**:
  - Algorithm: Authenticated `AES-256-GCM` (256-bit key, 12-byte random IV, 16-byte authentication tag).
  - Key Derivation: PBKDF2-HMAC-SHA512 (100,000 iterations) derived from machine identity / user SID + local salt stored in `~/.asterim/vault.salt`.
  - Serialized Format: `vault:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>`.
- **Transparent Migration**:
  - `SecretVaultService.getSecret(key)` checks if stored value begins with `vault:v1:`. If unencrypted (legacy plaintext), it returns the value and asynchronously upgrades the row to encrypted format.
- **Redaction Engine**:
  - In-memory set of active secret values sanitized from logging streams, error payloads, and process summaries.

---

## 4. Implementation Scope

1. **`SecretVaultService.ts` (`apps/server/src/services/security/SecretVaultService.ts`)**:
   - `encrypt(plaintext: string): string` — Generates random 12-byte IV, encrypts with AES-256-GCM, returns envelope string.
   - `decrypt(envelope: string): string` — Validates envelope header, verifies 16-byte authentication tag in constant time, decrypts payload. Throws structured error if tampered.
   - `setSecret(key: string, plaintext: string): void` — Encrypts and persists to SQLite `settings` table.
   - `getSecret(key: string): string | null` — Retrieves and decrypts secret (with transparent legacy plaintext migration).
   - `deleteSecret(key: string): void` — Removes secret row.
   - `redactSecrets(text: string): string` — Replaces known secret values with `[REDACTED_SECRET]`.

2. **Integration with Services**:
   - Update `DatabaseService.ts` and `PlanService.ts` / `BillingService.ts` to route secret reads/writes through `SecretVaultService`.
   - Update `PushService.ts` to store encrypted VAPID keys.
   - Add startup migration hook in `DatabaseService.init()` or `index.ts` to scan and encrypt unencrypted legacy keys (`ai_api_key`, `vapid_keys`, `stripe_secret_key`).

3. **REST API Endpoints (`apps/server/src/routes/security.ts` or `routes/vault.ts`)**:
   - `GET /api/v1/security/vault-status` — Returns vault health, encryption algorithm (`AES-256-GCM`), encrypted keys count, and plaintext migration status (never exposing actual secrets).
   - Register in `apps/server/src/index.ts`.

4. **Automated Unit & Integration Test Suite (`apps/server/src/services/security/__tests__/SecretVaultService.test.ts`)**:
   - Test encryption/decryption round-trip.
   - Test tamper detection: modified ciphertext or authentication tag throws `TAMPERED_SECRET_ERROR`.
   - Test fresh random IV generation for every encryption call (identical plaintexts produce different ciphertexts).
   - Test legacy plaintext migration on read.
   - Test secret redaction in log strings.
   - Wire into `apps/server/package.json` `"test"` script.

---

## 5. Constraints & Forbidden Changes

- Do NOT store decryption keys in plaintext in the SQLite database itself.
- Do NOT use unauthenticated ciphers (e.g. raw AES-CBC without HMAC).
- Do NOT break any of the existing 38 test suites.

---

## 6. Acceptance Criteria

1. `SecretVaultService` encrypts and decrypts secrets using `AES-256-GCM` with random IVs and authenticated tags.
2. Tampered ciphertext or forged authentication tags are detected and rejected.
3. Legacy plaintext secrets in `settings` table are transparently migrated and encrypted at rest.
4. `GET /api/v1/security/vault-status` reports vault encryption status without leaking secrets.
5. `SecretVaultService.test.ts` passes with comprehensive cryptographic assertions.
6. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test` (39 test suites), `pnpm run build`.

---

## 7. Definition of Done

- [ ] `SecretVaultService.ts` implemented and tested
- [ ] Database secret storage updated to use vault
- [ ] Legacy plaintext migration hook operational
- [ ] `/api/v1/security/vault-status` REST endpoint registered
- [ ] `SecretVaultService.test.ts` created and passing
- [ ] Monorepo CI gates pass cleanly

---

## 8. Verification Commands

```bash
# Run new Secret Vault test suite
pnpm --filter asterim exec tsx src/services/security/__tests__/SecretVaultService.test.ts

# Run all security & billing test suites
pnpm --filter asterim exec tsx src/services/__tests__/BillingService.test.ts
pnpm --filter asterim exec tsx src/services/__tests__/PairingService.test.ts

# Run full monorepo CI pipeline
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 9. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
