import fs from 'fs';
import path from 'path';
import { dbService } from 'asterim/src/services/DatabaseService';

/** Header carrying the loopback token issued in `server.json`. */
export const LOOPBACK_TOKEN_HEADER = 'x-asterim-loopback-token';

/** How long to wait for the Core before giving up. */
export const RELAY_TIMEOUT_MS = 500;

/** The shape written by the Core's ServerRegistry. */
export interface ServerDescriptor {
  url: string;
  token: string;
  pid?: number;
  startedAt?: number;
}

/**
 * Where the Core publishes its loopback descriptor.
 *
 * Derived from the database this process already opened rather than re-deriving
 * `ASTERIM_DATA_DIR`, so the relay can never point at a different data directory
 * than the one it just wrote to.
 */
export function descriptorPath(): string {
  return path.join(path.dirname(dbService.dbPath), 'server.json');
}

/**
 * Reads the Core's descriptor, or null when there is nothing usable.
 *
 * Every failure is a null: no file (the Core is not running), unparseable JSON, or
 * missing fields (a truncated or half-written file). None of them is worth an
 * error — the relay is an optimisation, and its absence is a supported state.
 */
export function readDescriptor(): ServerDescriptor | null {
  try {
    const raw = fs.readFileSync(descriptorPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<ServerDescriptor>;
    if (typeof parsed?.url !== 'string' || typeof parsed?.token !== 'string') return null;
    if (!parsed.url || !parsed.token) return null;
    return parsed as ServerDescriptor;
  } catch {
    return null;
  }
}

/**
 * Tells the Core server that memory changed, if it happens to be running.
 *
 * Deliberately incapable of failing. The decision is already committed to SQLite
 * before this is called, so anything that goes wrong here costs a live UI update
 * and nothing else — and an agent's `record_decision` must not slow down or error
 * because a dashboard is closed.
 *
 * Returns true when the Core acknowledged, false otherwise. The caller is free to
 * ignore it; the return value exists so this is testable.
 */
export async function notifyCoreServer(event: {
  id?: string;
  timestamp?: number;
  source?: string;
  type: string;
  payload: Record<string, unknown>;
}): Promise<boolean> {
  const descriptor = readDescriptor();
  if (!descriptor) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RELAY_TIMEOUT_MS);

  try {
    const response = await fetch(`${descriptor.url}/api/v1/internal/memory-events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [LOOPBACK_TOKEN_HEADER]: descriptor.token
      },
      body: JSON.stringify(event),
      signal: controller.signal
    });
    return response.ok;
  } catch {
    // ECONNREFUSED (Core stopped since the file was written), abort on timeout,
    // DNS, anything. All of it is "no live update this time".
    return false;
  } finally {
    clearTimeout(timer);
  }
}
