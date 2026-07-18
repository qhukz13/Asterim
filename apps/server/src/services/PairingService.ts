import crypto from 'crypto';
import { dbService } from './DatabaseService';
import { printToConsole } from '../utils/logger';

export class PairingService {
  private currentPin: string = '';
  private hmacSecret: string = '';

  constructor() {
    this.init();
  }

  private init() {
    // Generate a fresh PIN on startup
    this.currentPin = this.generatePin();
    
    // Load or generate HMAC secret for session tokens
    const db = dbService.getDb();
    const query = db.prepare("SELECT value FROM settings WHERE key = 'hmac_secret'");
    const row = query.get() as { value: string } | undefined;

    if (row) {
      this.hmacSecret = row.value;
    } else {
      this.hmacSecret = crypto.randomBytes(32).toString('hex');
      const insert = db.prepare("INSERT INTO settings (key, value) VALUES ('hmac_secret', ?)");
      insert.run(this.hmacSecret);
    }

    printToConsole('\n=======================================');
    printToConsole('[AUTH] ASTERIM DEVICE PAIRING PIN');
    printToConsole(`[PIN] PIN: ${this.currentPin}`);
    printToConsole('=======================================\n');
    try {
      require('fs').writeFileSync(require('path').join(process.cwd(), 'pairing_pin.txt'), this.currentPin, 'utf8');
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

  public validatePin(pin: string): boolean {
    return this.currentPin === pin;
  }

  public generateToken(): string {
    const payload = {
      issuedAt: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex')
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', this.hmacSecret).update(payloadB64).digest('base64url');
    return `${payloadB64}.${signature}`;
  }

  public validateToken(token: string): boolean {
    try {
      const parts = token.split('.');
      if (parts.length !== 2) return false;
      const [payloadB64, signature] = parts;

      const expectedSignature = crypto.createHmac('sha256', this.hmacSecret).update(payloadB64).digest('base64url');
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
