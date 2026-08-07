import crypto from 'crypto';
import { dbService } from './DatabaseService';
import { AccessTokenPayload, RefreshTokenPayload } from '@asterim/shared';

export class TokenService {
  private jwtSecret: string = '';

  constructor() {
    this.initSecret();
  }

  private initSecret() {
    const db = dbService.getDb();
    const query = db.prepare("SELECT value FROM settings WHERE key = 'jwt_secret'");
    const row = query.get() as { value: string } | undefined;

    if (row) {
      this.jwtSecret = row.value;
    } else {
      this.jwtSecret = crypto.randomBytes(64).toString('hex');
      const insert = db.prepare("INSERT INTO settings (key, value) VALUES ('jwt_secret', ?)");
      insert.run(this.jwtSecret);
    }
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
