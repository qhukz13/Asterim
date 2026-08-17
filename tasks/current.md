Task-ID: P9-02
Phase: 9

# [P9-02] — Workspace Environment Secrets Subsystem & In-Transit Credential Masking

**Task ID:** P9-02  
**Phase:** Phase 9 — Enterprise Hardening, Desktop Shell & Production Release  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-17  

---

## 1. Objective

Implement the Workspace & Environment Secrets management subsystem (`EnvironmentSecretService.ts`) in `apps/server`: encrypt all workspace-scoped environment secrets stored in the SQLite `environment_secrets` table at rest using `SecretVaultService` (`AES-256-GCM`), provide REST API routes for environment secret CRUD with masked values, wire dynamic environment secret resolution and redaction into agent execution contexts, and implement credential masking on system settings endpoints (`GET /api/v1/system/settings`).

---

## 2. Why This Task Exists

In task P9-01, the local cryptographic keystore (`SecretVaultService`) was established for machine-level configuration secrets (`settings` table). However, per `reports/current.md` § 8.1–8.2 and the Enterprise Hardening roadmap (Phase 9), workspace and environment-scoped credentials (e.g. project-specific tokens, third-party API keys injected into agent sessions via `environment_secrets`) remain unmanaged and unencrypted at rest.

Additionally, `GET /api/v1/system/settings` previously returned raw cleartext credentials to authenticated callers. To achieve enterprise data sovereignty and complete credential isolation:
1. All workspace/environment secrets stored in `environment_secrets` must be encrypted at rest with `vault:v1:` AES-256-GCM envelopes.
2. Sensitive credentials must never be broadcast in cleartext over GET endpoints — instead returning masked representations (`••••••••`) and boolean presence flags (`isSet: true` / `hasApiKey: true`).
3. Injected environment secrets must be registered dynamically with the vault's redaction engine so that agent terminal output, EventBus broadcasts, and debug logs never leak workspace secrets.

---

## 3. Context & Architecture

- **Cryptographic Storage**:
  - Encrypt `secret_value` in `environment_secrets` table (`id`, `environment_id`, `secret_key`, `secret_value`, `created_at`) using `SecretVaultService.encrypt()` and `SecretVaultService.decrypt()`.
  - Transparent migration: legacy plaintext rows are upgraded to `vault:v1:` envelopes upon retrieval or during the startup migration sweep.
- **Redaction & Agent Process Isolation**:
  - When environment secrets are loaded or injected into agent environments via `EnvironmentSecretService`, their plaintext values are registered in `SecretVaultService` for redaction from logs and EventBus payloads.
- **REST Surface & Masking**:
  - `GET /api/v1/environments/:id/secrets` (and `/api/v1/workspaces/:id/secrets`): returns array of `{ key, isSet: true, maskedValue: "••••••••", createdAt }` — never raw plaintext secrets.
  - `POST /api/v1/environments/:id/secrets` (and `/api/v1/workspaces/:id/secrets`): accepts `{ key, value }`, encrypts at rest, registers for redaction.
  - `DELETE /api/v1/environments/:id/secrets/:key`: deletes secret and unregisters from redaction.
  - `GET /api/v1/system/settings`: returns masked `ai_api_key` (e.g. `••••••••` or masked string with `hasApiKey: true`), while `POST /api/v1/system/settings` handles updates (ignoring masked value placeholders).

---

## 4. Repository Evidence

- `apps/server/src/services/security/SecretVaultService.ts` — Core AES-256-GCM vault, envelope serialization, and redaction engine.
- `apps/server/src/services/DatabaseService.ts:411` — `environment_secrets` table definition.
- `apps/server/src/routes/workspaces.ts` & `apps/server/src/routes/system.ts` — Workspace/environment routes and system settings endpoints.
- `apps/server/src/services/WorkspaceService.ts` — Workspace lifecycle management.
- `apps/server/src/services/security/__tests__/SecretVaultService.test.ts` — Existing 133-assertion cryptographic vault suite.

---

## 5. Implementation Scope

1. **`EnvironmentSecretService.ts` (`apps/server/src/services/security/EnvironmentSecretService.ts`)**:
   - `getSecrets(environmentId: string): Array<{ key: string; maskedValue: string; isSet: boolean; createdAt: number }>`
   - `getSecretValue(environmentId: string, key: string): string | null` (decrypts and registers for redaction)
   - `setSecret(environmentId: string, key: string, value: string): void` (encrypts with AES-256-GCM and persists)
   - `deleteSecret(environmentId: string, key: string): boolean`
   - `resolveEnvironmentVariables(environmentId: string): Record<string, string>` (resolves decrypted key-value map for agent process injection)
   - `migrateLegacyPlaintext(): { migrated: number; failed: number }`

2. **REST API Endpoints**:
   - Expose Environment Secrets routes in `apps/server/src/routes/workspaces.ts` (or `routes/environmentSecrets.ts` registered in `index.ts`):
     - `GET /api/v1/environments/:id/secrets` & `GET /api/v1/workspaces/:id/secrets`
     - `POST /api/v1/environments/:id/secrets` & `POST /api/v1/workspaces/:id/secrets`
     - `DELETE /api/v1/environments/:id/secrets/:key` & `DELETE /api/v1/workspaces/:id/secrets/:key`
   - Update `GET /api/v1/system/settings` in `apps/server/src/routes/system.ts` to return masked `ai_api_key` and boolean presence flag, while allowing `POST /api/v1/system/settings` to update only when a new non-masked key is provided.

3. **Vault & Redaction Integration**:
   - Ensure environment secret values are redacted across `SecretVaultService` log redaction and EventBus payload redaction.
   - Extend `SecretVaultService.getStatus()` / `GET /api/v1/security/vault-status` to reflect environment secret encryption health.

4. **Automated Unit & Integration Test Suite (`apps/server/src/services/security/__tests__/EnvironmentSecretService.test.ts`)**:
   - Test CRUD operations over `environment_secrets` with encryption round-trip.
   - Test tamper detection & invalid envelope rejection for environment secrets.
   - Test legacy plaintext migration on read and startup sweep.
   - Test REST route behavior (masking in GET, persistence in POST, deletion in DELETE).
   - Test environment variable resolution and redaction from log streams / EventBus.
   - Wire new test suite into `apps/server/package.json` `"test"` script.

---

## 6. Explicitly Forbidden Changes

- Do NOT store plaintext environment secrets in SQLite without `vault:v1:` envelope encryption.
- Do NOT return raw cleartext secret values in `GET` responses for environment secrets or system settings.
- Do NOT break existing `settings` encryption or any of the 39 existing test suites.
- Do NOT add external network dependencies or remote key management services (maintain Sovereign Mode compatibility per DEC-028).

---

## 7. Acceptance Criteria

1. `EnvironmentSecretService` encrypts all stored environment secrets using `vault:v1:` AES-256-GCM envelopes.
2. `GET /api/v1/environments/:id/secrets` returns masked secret representations and presence metadata without exposing plaintext values.
3. `GET /api/v1/system/settings` masks `ai_api_key` while `POST /api/v1/system/settings` supports seamless updates and preservation.
4. Resolved environment variables are injected as decrypted key-values while their plaintext values are registered for automatic log and EventBus redaction.
5. Legacy unencrypted rows in `environment_secrets` are transparently upgraded to encrypted envelopes.
6. `EnvironmentSecretService.test.ts` passes with comprehensive unit, integration, and REST endpoint assertions.
7. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test` (40+ test suites), `pnpm run build`.

---

## 8. Definition of Done

- [ ] `EnvironmentSecretService.ts` implemented and exported
- [ ] Environment secrets REST endpoints registered and verified
- [ ] System settings `ai_api_key` masking implemented and tested
- [ ] Agent environment variable resolution & redaction integrated
- [ ] `EnvironmentSecretService.test.ts` suite created and passing
- [ ] Monorepo CI gates pass cleanly (typecheck, lint, test, build)

---

## 9. Verification Commands

```bash
# Run Environment Secrets and Secret Vault test suites
pnpm --filter asterim exec tsx src/services/security/__tests__/EnvironmentSecretService.test.ts
pnpm --filter asterim exec tsx src/services/security/__tests__/SecretVaultService.test.ts

# Run full monorepo CI pipeline
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 10. Self-Review Requirements

- Inspect `git diff` against all acceptance criteria and forbidden changes before reporting.
- Verify that SQLite `environment_secrets` rows contain valid `vault:v1:` envelopes on disk.
- Verify that GET endpoints never leak cleartext secrets.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
