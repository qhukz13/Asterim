/**
 * One place that decides which token a request carries.
 *
 * The dashboard can talk to more than one Core: the local one, or a workstation
 * discovered on the LAN. Each has its own pairing token, stored under
 * `asterim_token_<backendUrl>` — that is what `useSocket`, `useProjects` and
 * `App` have always done. The zustand stores, added later, read the plain
 * `asterim_token` key instead, which is correct only while the dashboard is
 * talking to its own host. Against a remote workstation they were sending the
 * wrong token.
 *
 * Both conventions live here now, in that order: the per-backend key first,
 * then the legacy plain key, so a session paired before this existed keeps
 * working rather than silently logging the user out.
 */

interface StoredWorkstation {
  ip?: string;
  port?: number;
}

interface StoredWorkstationConfig {
  preferredWorkstationId?: string;
  knownWorkstations?: Record<string, StoredWorkstation>;
}

export const LEGACY_TOKEN_KEY = 'asterim_token';
const CONFIG_KEY = 'asterim_workstation_config';

/**
 * The Core this dashboard is pointed at.
 *
 * Derived the same way `useWorkstations` derives it — the preferred
 * workstation, else the host serving the page — so a hook and a store cannot
 * disagree about which backend they are addressing.
 */
export function resolveBackendUrl(explicit?: string | null): string | null {
  if (explicit) return explicit;

  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    const config: StoredWorkstationConfig | null = raw ? JSON.parse(raw) : null;
    const preferredId = config?.preferredWorkstationId;
    const preferred = preferredId ? config?.knownWorkstations?.[preferredId] : undefined;
    if (preferred?.ip && preferred?.port) {
      return `http://${preferred.ip}:${preferred.port}`;
    }
  } catch {
    // A hand-edited or truncated config must not stop a request being made.
  }

  const hostname = typeof window !== 'undefined' ? window.location?.hostname : undefined;
  return hostname ? `http://${hostname}:3000` : null;
}

/** Where the token for a given backend is kept. */
export function tokenStorageKey(backendUrl?: string | null): string {
  const url = resolveBackendUrl(backendUrl);
  return url ? `${LEGACY_TOKEN_KEY}_${url}` : LEGACY_TOKEN_KEY;
}

/** The token for a backend, falling back to the pre-per-backend key. */
export function getAuthToken(backendUrl?: string | null): string | null {
  try {
    return (
      localStorage.getItem(tokenStorageKey(backendUrl)) ?? localStorage.getItem(LEGACY_TOKEN_KEY)
    );
  } catch {
    return null;
  }
}

export interface AuthHeaderOptions {
  /** Address the token belongs to. Resolved from local state when omitted. */
  backendUrl?: string | null;
  /** Adds `Content-Type: application/json` for requests that carry a body. */
  json?: boolean;
}

/** Headers for an authenticated call to the Core. */
export function getAuthHeaders(options: AuthHeaderOptions | boolean = {}): Record<string, string> {
  // `getAuthHeaders(true)` keeps the call sites that previously said
  // `authHeaders(true)` meaning "with a JSON body" readable.
  const resolved: AuthHeaderOptions = typeof options === 'boolean' ? { json: options } : options;

  const headers: Record<string, string> = {};
  const token = getAuthToken(resolved.backendUrl);
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (resolved.json) headers['Content-Type'] = 'application/json';
  return headers;
}
