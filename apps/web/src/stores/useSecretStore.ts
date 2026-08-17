import { create } from 'zustand';
import {
  SECRET_MASK,
  isProtectedSecretKey,
  isValidSecretKeyFormat,
  type EnvironmentSecretSummary,
  type EnvironmentSecretsResponse,
  type VaultStatusResponse
} from '@asterim/shared';
import { getAuthHeaders } from '../utils/auth';

/**
 * Environment secrets and workstation vault health, as the dashboard sees them
 * (P9-03).
 *
 * This store is deliberately asymmetric, because the API is: a credential goes
 * *in* through `setSecret` and never comes back. There is no state field that
 * could hold a plaintext value — `secretsByEnvironment` holds only the masked
 * summaries the Core returns, and the value passed to `setSecret` is an argument
 * that lives for the length of one request and is never written into the store.
 * A "reveal" action is not missing; it cannot exist, because the read path in
 * the Core does not decrypt.
 *
 * Secrets are keyed by environment rather than held for one active environment.
 * The settings view can be open on one environment while the workspace switcher
 * moves to another, and a single list would briefly show one environment's key
 * names under another's name.
 */

const SECRETS_BASE = '/api/v1/environments';
const VAULT_STATUS_URL = '/api/v1/security/vault-status';

export interface SecretMutationResult {
  ok: boolean;
  /** The message to show the operator. Absent on success. */
  error?: string;
  /** The Core's error code, when it sent one — `PROTECTED_SECRET_KEY_ERROR` etc. */
  code?: string;
}

interface SecretState {
  /** Environment id → the masked summaries the Core returned for it. */
  secretsByEnvironment: Record<string, EnvironmentSecretSummary[]>;
  vaultStatus: VaultStatusResponse | null;
  isLoading: boolean;
  isSaving: boolean;
  isVaultLoading: boolean;
  /** The last listing failure, and the last vault-status failure. Kept apart:
   *  the two panels fail independently and one must not blank the other. */
  error: string | null;
  vaultError: string | null;

  fetchSecrets: (environmentId: string) => Promise<void>;
  setSecret: (environmentId: string, key: string, value: string) => Promise<SecretMutationResult>;
  deleteSecret: (environmentId: string, key: string) => Promise<SecretMutationResult>;
  fetchVaultStatus: () => Promise<void>;
  clearError: () => void;
}

/**
 * One shared empty list, so a selector for an environment with no secrets
 * returns the same reference every render. A fresh `[]` here would make zustand
 * see a new value on every store read and re-render without end.
 */
const NO_SECRETS: EnvironmentSecretSummary[] = [];

/** The masked summaries known for an environment. */
export function secretsFor(
  secretsByEnvironment: Record<string, EnvironmentSecretSummary[]>,
  environmentId: string | null | undefined
): EnvironmentSecretSummary[] {
  if (!environmentId) return NO_SECRETS;
  return secretsByEnvironment[environmentId] || NO_SECRETS;
}

/**
 * Why a key cannot be used, or null when it can.
 *
 * Runs before the request purely so the operator gets an answer without a round
 * trip; the Core checks the same rules against the same shared constants on
 * arrival and its verdict is the one that counts. The wording names the actual
 * rule rather than saying "invalid", because "PATH is refused" and "a key
 * cannot start with a digit" are different problems with different fixes.
 */
export function validateSecretKey(key: string): string | null {
  const trimmed = (key || '').trim();
  if (trimmed.length === 0) return 'A key is required.';
  if (isProtectedSecretKey(trimmed)) {
    return `${trimmed.toUpperCase()} decides what the agent process is, not what it can reach, and cannot be stored as a secret.`;
  }
  if (!isValidSecretKeyFormat(trimmed)) {
    if (/^[0-9]/.test(trimmed)) return 'A key must start with a letter or underscore.';
    if (trimmed.length > 128) return 'A key must be 128 characters or fewer.';
    return 'A key may contain only letters, digits and underscores.';
  }
  return null;
}

/** True when a value is the mask the Core hands back rather than a credential. */
export function isMaskPlaceholder(value: string): boolean {
  const trimmed = (value || '').trim();
  if (trimmed.length === 0) return false;
  return trimmed === SECRET_MASK || /^[•*·●]+$/u.test(trimmed);
}

/**
 * The Core's failure, in words an operator can act on.
 *
 * Branches on the code rather than the message: the codes are the contract, and
 * matching message text would break the first time the wording changed.
 */
export function describeSecretError(code: string | undefined, message: string | undefined, status?: number): string {
  switch (code) {
    case 'PROTECTED_SECRET_KEY_ERROR':
      return message || 'That variable name is reserved and cannot be stored as a secret.';
    case 'INVALID_SECRET_KEY_ERROR':
      return message || 'A key must be a POSIX variable name (letters, digits and underscores).';
    case 'ENVIRONMENT_NOT_FOUND_ERROR':
      return message || 'This environment no longer exists.';
    case 'SECRET_STORAGE_ERROR':
      return message || 'The Core could not store the secret.';
    default:
      break;
  }
  if (status === 401) return 'Sign in to manage this environment’s secrets.';
  if (status === 403) return message || 'You do not have permission to change this environment’s secrets.';
  if (status === 404) return message || 'Not found.';
  return message || 'The request failed.';
}

/** Reads a response body without letting a non-JSON error page throw. */
async function readBody(res: Response): Promise<{ error?: string; code?: string } & Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const useSecretStore = create<SecretState>(set => ({
  secretsByEnvironment: {},
  vaultStatus: null,
  isLoading: false,
  isSaving: false,
  isVaultLoading: false,
  error: null,
  vaultError: null,

  fetchSecrets: async (environmentId: string) => {
    if (!environmentId) return;
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${SECRETS_BASE}/${encodeURIComponent(environmentId)}/secrets`, {
        headers: getAuthHeaders()
      });
      const body = (await readBody(res)) as unknown as Partial<EnvironmentSecretsResponse> & {
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        set({ error: describeSecretError(body.code, body.error, res.status), isLoading: false });
        return;
      }
      set(state => ({
        secretsByEnvironment: {
          ...state.secretsByEnvironment,
          [environmentId]: body.secrets || []
        },
        isLoading: false
      }));
    } catch (err) {
      set({ error: (err as Error).message || 'Could not reach the Core.', isLoading: false });
    }
  },

  setSecret: async (environmentId: string, key: string, value: string) => {
    const trimmedKey = (key || '').trim();
    const clientside = validateSecretKey(trimmedKey);
    if (clientside) {
      set({ error: clientside });
      return { ok: false, error: clientside };
    }
    // Re-submitting what a listing showed would otherwise store the placeholder
    // over the real credential. The Core refuses this too; catching it here
    // saves a round trip and gives a clearer reason.
    if (isMaskPlaceholder(value)) {
      const message = 'That is the mask shown in the list, not a credential.';
      set({ error: message });
      return { ok: false, error: message };
    }

    set({ isSaving: true, error: null });
    try {
      const res = await fetch(`${SECRETS_BASE}/${encodeURIComponent(environmentId)}/secrets`, {
        method: 'POST',
        headers: getAuthHeaders({ json: true }),
        body: JSON.stringify({ key: trimmedKey, value })
      });
      const body = await readBody(res);
      if (!res.ok) {
        const message = describeSecretError(body.code, body.error, res.status);
        set({ error: message, isSaving: false });
        return { ok: false, error: message, code: body.code };
      }

      // The Core returns the masked summary it stored; a rotation replaces the
      // existing row in place so the list does not reorder under the operator.
      const stored = (body as { secret?: EnvironmentSecretSummary }).secret;
      set(state => {
        const current = state.secretsByEnvironment[environmentId] || [];
        const summary: EnvironmentSecretSummary = stored || {
          key: trimmedKey,
          maskedValue: SECRET_MASK,
          isSet: true,
          createdAt: Date.now()
        };
        const exists = current.some(secret => secret.key === summary.key);
        return {
          secretsByEnvironment: {
            ...state.secretsByEnvironment,
            [environmentId]: exists
              ? current.map(secret => (secret.key === summary.key ? summary : secret))
              : [...current, summary]
          },
          isSaving: false
        };
      });
      return { ok: true };
    } catch (err) {
      const message = (err as Error).message || 'Could not reach the Core.';
      set({ error: message, isSaving: false });
      return { ok: false, error: message };
    }
  },

  deleteSecret: async (environmentId: string, key: string) => {
    set({ isSaving: true, error: null });
    try {
      const res = await fetch(
        `${SECRETS_BASE}/${encodeURIComponent(environmentId)}/secrets/${encodeURIComponent(key)}`,
        { method: 'DELETE', headers: getAuthHeaders() }
      );
      const body = await readBody(res);
      if (!res.ok) {
        const message = describeSecretError(body.code, body.error, res.status);
        set({ error: message, isSaving: false });
        return { ok: false, error: message, code: body.code };
      }
      set(state => ({
        secretsByEnvironment: {
          ...state.secretsByEnvironment,
          [environmentId]: (state.secretsByEnvironment[environmentId] || []).filter(
            secret => secret.key !== key
          )
        },
        isSaving: false
      }));
      return { ok: true };
    } catch (err) {
      const message = (err as Error).message || 'Could not reach the Core.';
      set({ error: message, isSaving: false });
      return { ok: false, error: message };
    }
  },

  fetchVaultStatus: async () => {
    set({ isVaultLoading: true, vaultError: null });
    try {
      const res = await fetch(VAULT_STATUS_URL, { headers: getAuthHeaders() });
      const body = await readBody(res);
      if (!res.ok) {
        set({
          vaultError: describeSecretError(undefined, body.error, res.status),
          isVaultLoading: false
        });
        return;
      }
      set({ vaultStatus: body as unknown as VaultStatusResponse, isVaultLoading: false });
    } catch (err) {
      set({
        vaultError: (err as Error).message || 'Could not reach the Core.',
        isVaultLoading: false
      });
    }
  },

  clearError: () => set({ error: null, vaultError: null })
}));

/** Convenience for components that only need one environment's list. */
export function useEnvironmentSecrets(environmentId: string | null | undefined): EnvironmentSecretSummary[] {
  return useSecretStore(state => secretsFor(state.secretsByEnvironment, environmentId));
}
