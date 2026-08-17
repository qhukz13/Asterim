import crypto from 'crypto';
import { secretVault } from './security/SecretVaultService';
import { AccessTokenPayload, RefreshTokenPayload } from '@asterim/shared';

export class TokenService {
  private jwtSecret: string = '';

  constructor() {
    this.initSecret();
  }

  /**
   * The HS256 signing key for every access and refresh token this Core issues.
   * Held in the vault rather than as a plaintext `settings` row (P9-01): anyone
   * who could read it could mint a token for any account.
   *
   * A vault that cannot return the stored value — a database moved to another
   * machine, a lost `vault.salt` — yields a fresh secret, which invalidates
   * outstanding tokens and forces a re-login. That is the correct outcome; the
   * alternative is a Core that will not start.
   */
  private initSecret() {
    const stored = secretVault.getSecret('jwt_secret');
    if (stored) {
      this.jwtSecret = stored;
      return;
    }
    this.jwtSecret = crypto.randomBytes(64).toString('hex');
    secretVault.setSecret('jwt_secret', this.jwtSecret);
  }

  /**
   * Signs an Access Token JWT (HS256) valid for 15 minutes.
   */
  public signAccessToken(payload: Omit<AccessTokenPayload, 'iat' | 'exp'>): string {
    const now = Math.floor(Date.now() / 1000);
    const fullPayload: AccessTokenPayload = {
      ...payload,
      iat: now,
      exp: now + 15 * 60, // 15 mins
    };

    const header = { alg: 'HS256', typ: 'JWT' };
    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');

    const signature = crypto
      .createHmac('sha256', this.jwtSecret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    return `${headerB64}.${payloadB64}.${signature}`;
  }

  /**
   * Verifies and decodes an Access Token JWT.
   */
  public verifyAccessToken(token: string): AccessTokenPayload | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const [headerB64, payloadB64, signature] = parts;
      const expectedSignature = crypto
        .createHmac('sha256', this.jwtSecret)
        .update(`${headerB64}.${payloadB64}`)
        .digest('base64url');

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        return null;
      }

      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8')) as AccessTokenPayload;
      const now = Math.floor(Date.now() / 1000);

      if (payload.exp && now > payload.exp) {
        return null; // Expired
      }

      return payload;
    } catch (err) {
      return null;
    }
  }

  /**
   * Generates a cryptographically random opaque Refresh Token (`ast_rt_...`).
   */
  public generateRefreshToken(): string {
    return `ast_rt_${crypto.randomBytes(32).toString('hex')}`;
  }

  /**
   * Hashes a Refresh Token using SHA-256 for secure storage in database.
   */
  public hashRefreshToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Generates an Auth Code for OAuth deep-link exchange (`ast_code_...`).
   */
  public generateAuthCode(): string {
    return `ast_code_${crypto.randomBytes(24).toString('hex')}`;
  }
}

export const tokenService = new TokenService();
