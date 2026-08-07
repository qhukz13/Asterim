import crypto from 'crypto';

export class PasswordService {
  /**
   * Hashes a plain-text password using scrypt with a unique random salt.
   * Format: scrypt$16384$8$1$saltHex$hashHex
   */
  public async hashPassword(password: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const salt = crypto.randomBytes(16).toString('hex');
      crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
        if (err) return reject(err);
        const hash = derivedKey.toString('hex');
        resolve(`scrypt$16384$8$1$${salt}$${hash}`);
      });
    });
  }

  /**
   * Verifies a plain-text password against a stored scrypt hash in constant time.
   */
  public async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const parts = storedHash.split('$');
        if (parts.length !== 6 || parts[0] !== 'scrypt') {
          return resolve(false);
        }

        const [, NStr, rStr, pStr, salt, expectedHash] = parts;
        const options = {
          N: parseInt(NStr, 10),
          r: parseInt(rStr, 10),
          p: parseInt(pStr, 10),
        };

        crypto.scrypt(password, salt, 64, options, (err, derivedKey) => {
          if (err) return resolve(false);
          const derivedHash = derivedKey.toString('hex');
          const isMatch = crypto.timingSafeEqual(
            Buffer.from(derivedHash, 'hex'),
            Buffer.from(expectedHash, 'hex')
          );
          resolve(isMatch);
        });
      } catch (err) {
        resolve(false);
      }
    });
  }
}

export const passwordService = new PasswordService();
