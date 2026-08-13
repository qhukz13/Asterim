import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { resolveDataDir } from './DatabaseService';

/** What a local process needs to reach this server on the loopback interface. */
export interface ServerDescriptor {
  url: string;
  token: string;
  pid: number;
  startedAt: number;
}

/**
 * Publishes how to reach this Core server to other Asterim processes on the same
 * machine (DEC-026).
 *
 * The MCP memory server writes to the same SQLite file from its own process, so
 * its writes never touch this process's in-memory EventBus. It needs some way to
 * say "I changed something" — and the constraint is that it must work with no
 * daemon, no configuration, and no failure mode when the Core is not running.
 *
 * A file in the data directory both processes already share answers all three: its
 * presence *is* the discovery mechanism, and its absence is a complete answer.
 */
export class ServerRegistry {
  private descriptor: ServerDescriptor | null = null;

  /** Where the descriptor lives. Read fresh each time so ASTERIM_DATA_DIR is honoured. */
  public get filePath(): string {
    return path.join(resolveDataDir(), 'server.json');
  }

  /**
   * Writes the descriptor and returns it.
   *
   * The token is generated per start, so a descriptor left behind by a crashed
   * process cannot authorise anything against the next one.
   */
  public publish(port: number): ServerDescriptor {
    const descriptor: ServerDescriptor = {
      url: `http://127.0.0.1:${port}`,
      token: crypto.randomBytes(24).toString('hex'),
      pid: process.pid,
      startedAt: Date.now()
    };

    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // 0600: the token is a bearer credential for this machine's Core server.
    fs.writeFileSync(this.filePath, JSON.stringify(descriptor, null, 2), { mode: 0o600 });

    this.descriptor = descriptor;
    return descriptor;
  }

  public getToken(): string | null {
    return this.descriptor?.token ?? null;
  }

  public getDescriptor(): ServerDescriptor | null {
    return this.descriptor;
  }

  /**
   * Constant-time token check.
   *
   * `===` on a secret leaks its prefix through timing. The comparison is cheap to
   * do properly and this is the only thing standing in front of an endpoint that
   * publishes onto the event bus.
   */
  public isAuthorized(candidate: unknown): boolean {
    const token = this.descriptor?.token;
    if (!token || typeof candidate !== 'string' || candidate.length !== token.length) {
      return false;
    }
    try {
      return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(token));
    } catch {
      return false;
    }
  }

  /** Removes the descriptor. Safe to call when it was never written. */
  public clear(): void {
    const target = this.filePath;
    this.descriptor = null;
    try {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } catch (err) {
      console.warn('[ServerRegistry] Could not remove server.json:', (err as Error).message);
    }
  }

  /**
   * Removes the descriptor when this process ends, however it ends.
   *
   * A stale descriptor is not dangerous — its token died with the process that
   * wrote it — but it costs every MCP write a connection attempt to a port
   * nothing is listening on. Idempotent; safe to call more than once.
   */
  public registerCleanup(): void {
    if (this.cleanupRegistered) return;
    this.cleanupRegistered = true;

    const cleanup = () => this.clear();
    process.on('exit', cleanup);
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        cleanup();
        process.exit(0);
      });
    }
  }

  private cleanupRegistered = false;
}

export const serverRegistry = new ServerRegistry();
