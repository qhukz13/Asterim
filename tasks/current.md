Task-ID: P9-03
Phase: 9

# [P9-03] — Workspace Secrets Management UI & Workstation Security Status Dashboard

**Task ID:** P9-03  
**Phase:** Phase 9 — Enterprise Hardening, Desktop Shell & Production Release  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-17  

---

## 1. Objective

Build the frontend UI for Workspace & Environment Secrets management (`apps/web/src/components/environment/EnvironmentSecretsPanel.tsx` or integrated into `EnvironmentSettingsView.tsx` / `WorkspaceSettingsModal.tsx`) and the Workstation Security Status Card (`SecurityStatusCard.tsx` / `DeveloperSettings.tsx`): allow operators to list masked secrets, add/rotate credentials with client-side POSIX validation and server-enforced safety checks, delete secrets with confirmation, and inspect real-time workstation vault cryptographic health (`GET /api/v1/security/vault-status`), backed by comprehensive component and store tests.

---

## 2. Why This Task Exists

In P9-01 and P9-02, the local cryptographic vault (`SecretVaultService`) and the environment secrets backend subsystem (`EnvironmentSecretService`) were implemented, encrypted at rest (`vault:v1:` envelopes), masked over REST, and registered for runtime redaction.

However, per `reports/current.md` § 8.2 and § 9, the dashboard UI currently renders hardcoded dummy secrets in `EnvironmentSettingsView.tsx` and has no UI for inspecting workstation cryptographic health (`/api/v1/security/vault-status`). To deliver a complete, production-grade enterprise security surface:
1. Operators must be able to view masked secrets (`••••••••`), add new credentials, rotate existing ones, and delete secrets per environment directly from the dashboard.
2. Form inputs must enforce POSIX key naming (`^[A-Za-z_][A-Za-z0-9_]{0,127}$`) and gracefully surface server rejections for protected keys (`PATH`, `LD_PRELOAD`, `NODE_OPTIONS`, etc.).
3. The dashboard must provide an authoritative Security Status indicator displaying the machine vault cipher (AES-256-GCM), key derivation status, total managed secrets, unreadable keys count, and database encryption health.
4. Plaintext credentials must never be retained in client-side state after submission or exposed in DOM text.

---

## 3. Context & Architecture

- **Backend Endpoints Consumed**:
  - `GET /api/v1/environments/:id/secrets` (or `/api/v1/workspaces/:id/secrets`): returns `{ success: true, secrets: Array<{ key: string; maskedValue: string; isSet: boolean; createdAt: number }> }`.
  - `POST /api/v1/environments/:id/secrets`: accepts `{ key: string, value: string }`, returns 201 `{ success: true, secret: { ... } }`, returns 400 with `code: 'PROTECTED_SECRET_KEY_ERROR'` or `'INVALID_SECRET_KEY_ERROR'`.
  - `DELETE /api/v1/environments/:id/secrets/:key`: returns 200 `{ success: true }` or 404.
  - `GET /api/v1/security/vault-status`: returns `{ cipher: 'aes-256-gcm', kdf: 'pbkdf2-sha512', saltExists: boolean, rounds: number, settings: { total, encrypted, plaintext, unreadable, unreadableKeys }, environmentSecrets: { total, encrypted, plaintext, unreadable, environments, migrationComplete }, healthy: boolean }`.
- **UI Design System & State Management**:
  - Store: Extend `useWorkspaceStore.ts` (or dedicated hook/store) with `secrets`, `fetchSecrets(envId)`, `setSecret(envId, key, value)`, `deleteSecret(envId, key)`, `vaultStatus`, `fetchVaultStatus()`.
  - Tokens: Use `--color-bg-*`, `--color-surface-*`, `--color-border-*`, `--color-text-*`, `--color-state-completed` / `--color-state-error`, JetBrains Mono for keys/masks.
  - Interaction: Modal or inline drawer for adding/rotating secrets; confirmation dialog for deletion; non-revealing password inputs; inline status toasts for success/error.

---

## 4. Repository Evidence

- `apps/server/src/routes/environmentSecrets.ts` — Environment secrets REST API specification and error codes.
- `apps/server/src/routes/security.ts` — `GET /api/v1/security/vault-status` response contract.
- `apps/web/src/components/environment/EnvironmentSettingsView.tsx:804–835` — Existing mock secrets section to replace.
- `apps/web/src/components/WorkspaceSettingsModal.tsx` & `WorkspaceTabView.tsx` — Workspace settings surfaces.
- `apps/web/src/components/DeveloperSettings.tsx` & `AISettings.tsx` — Settings components and token management patterns.
- `apps/web/src/stores/useWorkspaceStore.ts` — Workspace state store.
- `apps/web/src/components/profiles/__tests__/ProfileSelector.test.ts` & `DelegationUI.test.ts` — Standard web test suite patterns.

---

## 5. Implementation Scope

1. **Workspace Store / State Layer (`apps/web/src/stores/useWorkspaceStore.ts` or `useSecretStore.ts`)**:
   - State for environment secrets list (`Array<{ key: string; maskedValue: string; isSet: boolean; createdAt: number }>`).
   - Actions: `fetchSecrets(environmentId: string)`, `addSecret(environmentId: string, key: string, value: string)`, `deleteSecret(environmentId: string, key: string)`.
   - Action / state for vault security status: `vaultStatus: VaultStatusResponse | null`, `fetchVaultStatus()`.
   - Error handling: structured error message extraction (e.g. protected variable name, invalid format, unauthorized).

2. **Environment Secrets Management UI Component (`apps/web/src/components/environment/EnvironmentSecretsPanel.tsx` or integrated in `EnvironmentSettingsView.tsx`)**:
   - Real-time list of configured secrets for the selected environment.
   - Per-secret row: key name in monospace font, masked value badge (`••••••••`), creation date, delete button with confirmation.
   - "Add Secret" form / modal:
     - `Secret Key`: Text input with client-side POSIX naming validation (`^[A-Za-z_][A-Za-z0-9_]{0,127}$`) and protected key warning (`PATH`, `LD_PRELOAD`, etc.).
     - `Secret Value`: Password input with show/hide toggle (only during entry before submission).
     - Submitting immediately clears the input field from memory and updates the list.
   - Empty state when no secrets are configured.

3. **Workstation Security Status Card (`apps/web/src/components/security/SecurityStatusCard.tsx` or `DeveloperSettings.tsx`)**:
   - Visual card displaying:
     - Health Status Badge (Green "Vault Active & Healthy" / Amber "Unreadable Envelopes Detected").
     - AES-256-GCM encryption indicator with PBKDF2 salt status.
     - Environment Secrets tally: Total encrypted secrets across all environments, migration completion status.
     - System Settings tally: Encrypted system keys count.
   - Accessible in Developer Settings or as a sub-panel in Environment Settings / Workspace Settings.

4. **Component & Store Test Suite (`apps/web/src/components/environment/__tests__/EnvironmentSecretsUI.test.ts`)**:
   - Unit tests for key validation logic (valid POSIX vs invalid characters vs protected system names).
   - Mocked fetch integration tests for `useWorkspaceStore` (or secret actions):
     - Fetching secrets list (asserting URL, headers, masked shape).
     - Adding secret (asserting POST payload, handling 201 success and 400 error codes).
     - Deleting secret (asserting DELETE URL and removal from state).
     - Fetching and parsing vault status.
   - Static markup render tests via `react-dom/server` verifying:
     - Masked representation rendered (`••••••••`), no cleartext leaked.
     - Add Secret form elements and labels.
     - Security Status card with health badges and metric tallies.
   - Wire into `apps/web/package.json` `"test"` script.

---

## 6. Explicitly Forbidden Changes

- Do NOT retain plaintext secret values in React state or localStorage after form submission.
- Do NOT add external UI library dependencies (keep using existing tokens and lightweight components).
- Do NOT weaken backend validation or bypass server RBAC rules.
- Do NOT break existing web test suites or monorepo build pipelines.

---

## 7. Acceptance Criteria

1. **Masked Secrets Display**: The Secrets tab in `EnvironmentSettingsView` dynamically fetches and displays masked secrets (`••••••••`) with timestamps and presence indicators from `GET /api/v1/environments/:id/secrets`.
2. **Add & Rotate Secret**: Operators can create new secrets or rotate existing ones via `POST /api/v1/environments/:id/secrets`, with client-side POSIX validation and proper handling of server error responses (e.g. `PROTECTED_SECRET_KEY_ERROR`).
3. **Delete Secret**: Operators can remove secrets with a confirmation step via `DELETE /api/v1/environments/:id/secrets/:key`.
4. **Security Vault Status Surface**: Workstation Security / Vault Status card renders live metrics from `GET /api/v1/security/vault-status` (cipher, health flag, system keys counts, environment secrets counts).
5. **Data Sovereignty & Zero Plaintext Leakage**: Plaintext secrets are cleared from form state immediately upon submission and are never rendered in the DOM or stored in client storage.
6. **Automated Web Test Suite**: `EnvironmentSecretsUI.test.ts` passes with complete store, helper, and static render assertions.
7. **Monorepo CI Gates**: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, and `pnpm run build` pass with 0 errors across the monorepo.

---

## 8. Definition of Done

- [ ] Workspace store extended with secrets and vault-status actions
- [ ] Secrets panel in `EnvironmentSettingsView` connected to real API
- [ ] Add/Rotate and Delete secret flows fully functional with validation and feedback
- [ ] Security Status card implemented and wired to `/api/v1/security/vault-status`
- [ ] `EnvironmentSecretsUI.test.ts` created and wired into `apps/web/package.json`
- [ ] Monorepo CI gates pass cleanly (typecheck, lint, test, build)

---

## 9. Verification Commands

```bash
# Run web Environment Secrets & Security UI test suite
pnpm --filter @asterim/web exec tsx src/components/environment/__tests__/EnvironmentSecretsUI.test.ts

# Run server cryptographic regression suites
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
- Verify that no plaintext secret value is stored in React component state or logged to console.
- Confirm all monorepo test suites pass and build succeeds.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
