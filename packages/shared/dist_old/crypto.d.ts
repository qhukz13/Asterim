/**
 * E2E Encryption Module using WebCrypto API
 * Works in both Node.js (via global.crypto) and browsers.
 */
export declare function generateECDHKeyPair(): Promise<CryptoKeyPair>;
export declare function exportPublicKey(key: CryptoKey): Promise<JsonWebKey>;
export declare function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey>;
export declare function deriveSharedSecret(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey>;
export interface EncryptedPayload {
    iv: string;
    ciphertext: string;
}
export declare function encryptPayload(key: CryptoKey, payload: any): Promise<EncryptedPayload>;
export declare function decryptPayload(key: CryptoKey, encrypted: EncryptedPayload): Promise<any>;
//# sourceMappingURL=crypto.d.ts.map