import crypto from 'crypto';
import { secretVault } from './security/SecretVaultService';
import { printToConsole } from '../utils/logger';

/** Outcome of a single device pairing attempt. */
export type PairingAttemptResult =
  | { status: 'paired'; token: string }
  | { status: 'invalid'; remainingAttempts: number }
  | { status: 'locked'; retryAfterMs: number };

/** Per-client brute-force bookkeeping. Lives in memory; resets with the process. */
interface AttemptRecord {
  failures: number;
  lastFailureAt: number;
  /** Epoch ms until which the client is locked out; 0 when not locked. */
  lockedUntil: number;
}

/**
 * Injection points for the brute-force guard. Production uses every default;
 * tests override the clock and the sleeper so the exponential back-off and the
 * 15-minute cooldown can be exercised without spending that wall-clock time.
 */
export interface PairingServiceOptions {
  /** Consecutive failures that trigger the lockout. */
  maxAttempts?: number;
  /** Cooldown applied once the failure budget is exhausted. */
  lockoutMs?: number;
  /** Delay before the second attempt; doubles with each further failure. */
  baseDelayMs?: number;
  /** Ceiling for the exponential delay. */
  maxDelayMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class PairingService {
  private currentPin: string = '';
  private hmacSecret: string = '';

  /** Failed pairing attempts keyed by client identifier (the request IP). */
  private readonly attempts = new Map<string, AttemptRecord>();

  private readonly maxAttempts: number;
  private readonly lockoutMs: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: PairingServiceOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.lockoutMs = options.lockoutMs ?? 15 * 60 * 1000;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 8000;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms: number) => new Promise(resolve => setTimeout(resolve, ms)));

    this.init();
  }

  private init() {
    // Generate a fresh PIN on startup
    this.currentPin = this.generatePin();

    // Load or generate the HMAC secret for session tokens. Encrypted at rest
    // through the vault (P9-01) — it is what makes a pairing token unforgeable,
    // so a readable copy of it is as good as the PIN.
    const stored = secretVault.getSecret('hmac_secret');
    if (stored) {
      this.hmacSecret = stored;
    } else {
      this.hmacSecret = crypto.randomBytes(32).toString('hex');
      secretVault.setSecret('hmac_secret', this.hmacSecret);
    }

    printToConsole('\n=======================================');
    printToConsole('[AUTH] ASTERIM DEVICE PAIRING PIN');
    printToConsole(`[PIN] PIN: ${this.currentPin}`);
    printToConsole('=======================================\n');
    try {
      require('fs').writeFileSync(
        require('path').join(process.cwd(), 'pairing_pin.txt'),
        this.currentPin,
        'utf8'
      );
    } catch (e) {
      console.error('[AUTH] Failed to write pairing_pin.txt', e);
    }
  }

  private generatePin(): string {
    // 6 digit random number
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  public getPin(): string {
    return this.currentPin;
  }

  /**
   * Compares a candidate PIN against the current one in constant time.
   * Does no attempt accounting — callers facing the network must go through
   * {@link attemptPairing} so the brute-force guard applies.
   */
  public validatePin(pin: string): boolean {
    if (typeof pin !== 'string') return false;
    const expected = Buffer.from(this.currentPin, 'utf8');
    const actual = Buffer.from(pin, 'utf8');
    if (expected.length !== actual.length) return false;
    return crypto.timingSafeEqual(expected, actual);
  }

  /**
   * The single entry point for network-facing pairing.
   *
   * A 6-digit PIN is a million-wide keyspace, which a script exhausts in
   * minutes over LAN. Two mechanisms narrow that: every attempt after the first
   * failure waits an exponentially growing delay before the PIN is even
   * compared (throttling the attempt rate), and the client is locked out for
   * {@link lockoutMs} once it burns its consecutive-failure budget. A correct
   * PIN clears both.
   *
   * `clientId` is the caller's identity — the request IP for the REST route.
   */
  public async attemptPairing(clientId: string, pin: string): Promise<PairingAttemptResult> {
    this.pruneIfCrowded();

    const lock = this.getLockState(clientId);
    if (lock.locked) {
      return { status: 'locked', retryAfterMs: lock.retryAfterMs };
    }

    const failures = this.getFailedAttempts(clientId);
    const nextFailures = failures + 1;
    const now = this.now();
    const lockedOut = nextFailures >= this.maxAttempts;

    // The attempt is charged *before* the PIN is compared, and before the
    // delay is awaited. Counting afterwards would let an attacker fire a
    // thousand requests in parallel: each would read the same failure count,
    // pay the same small delay, and collapse into a single recorded failure.
    this.attempts.set(clientId, {
      failures: nextFailures,
      lastFailureAt: now,
      lockedUntil: lockedOut ? now + this.lockoutMs : 0
    });

    const delay = this.delayForFailures(failures);
    if (delay > 0) {
      await this.sleep(delay);
    }

    if (this.validatePin(pin)) {
      this.resetAttempts(clientId);
      return { status: 'paired', token: this.generateToken() };
    }

    if (lockedOut) {
      return { status: 'locked', retryAfterMs: this.lockoutMs };
    }
    return { status: 'invalid', remainingAttempts: this.maxAttempts - nextFailures };
  }

  /** Consecutive failures currently recorded for a client. */
  public getFailedAttempts(clientId: string): number {
    return this.readRecord(clientId)?.failures ?? 0;
  }

  /** Whether a client is inside its lockout cooldown. */
  public isLocked(clientId: string): boolean {
    return this.getLockState(clientId).locked;
  }

  /**
   * Delay the next attempt from this client will wait: none while it has no
   * failures, then 500ms, 1s, 2s, … capped at {@link maxDelayMs}.
   */
  public getRetryDelayMs(clientId: string): number {
    return this.delayForFailures(this.getFailedAttempts(clientId));
  }

  private delayForFailures(failures: number): number {
    if (failures <= 0) return 0;
    return Math.min(this.baseDelayMs * 2 ** (failures - 1), this.maxDelayMs);
  }

  /**
   * Drops records that {@link readRecord} would discard anyway. Attempts are
   * keyed by client, so an attacker rotating source addresses would otherwise
   * grow this map without bound; the sweep only runs once it is large enough
   * for that to matter.
   */
  private pruneIfCrowded(): void {
    if (this.attempts.size < 1024) return;
    for (const clientId of [...this.attempts.keys()]) {
      this.readRecord(clientId);
    }
  }

  /** Clears the failure counter — on success, or for a whole-service reset. */
  public resetAttempts(clientId?: string): void {
    if (clientId === undefined) this.attempts.clear();
    else this.attempts.delete(clientId);
  }

  /**
   * Reads a client's record, discarding it when the lockout has expired or the
   * last failure fell outside the tracking window. Both cases mean the failures
   * are no longer "consecutive", so the client starts clean.
   */
  private readRecord(clientId: string): AttemptRecord | undefined {
    const record = this.attempts.get(clientId);
    if (!record) return undefined;

    const now = this.now();
    if (record.lockedUntil > 0 && record.lockedUntil <= now) {
      this.attempts.delete(clientId);
      return undefined;
    }
    if (record.lockedUntil === 0 && now - record.lastFailureAt > this.lockoutMs) {
      this.attempts.delete(clientId);
      return undefined;
    }
    return record;
  }

  private getLockState(clientId: string): { locked: boolean; retryAfterMs: number } {
    const record = this.readRecord(clientId);
    if (!record || record.lockedUntil === 0) return { locked: false, retryAfterMs: 0 };
    return { locked: true, retryAfterMs: record.lockedUntil - this.now() };
  }

  public generateToken(): string {
    const payload = {
      issuedAt: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex')
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', this.hmacSecret)
      .update(payloadB64)
      .digest('base64url');
    return `${payloadB64}.${signature}`;
  }

  public validateToken(token: string): boolean {
    try {
      const parts = token.split('.');
      if (parts.length !== 2) return false;
      const [payloadB64, signature] = parts;

      const expectedSignature = crypto
        .createHmac('sha256', this.hmacSecret)
        .update(payloadB64)
        .digest('base64url');
      if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
        // 30 day expiration
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
        if (Date.now() - payload.issuedAt > thirtyDaysMs) {
          return false;
        }
        return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  }
}

export const pairingService = new PairingService();
