/**
 * E2E Encryption Module using WebCrypto API
 * Works in both Node.js (via global.crypto) and browsers.
 */
// In Node.js 18+, globalThis.crypto is available natively.
const cryptoProvider = typeof globalThis.crypto !== 'undefined' ? globalThis.crypto : require('crypto').webcrypto;
export async function generateECDHKeyPair() {
    return await cryptoProvider.subtle.generateKey({
        name: "ECDH",
        namedCurve: "P-256",
    }, true, ["deriveKey", "deriveBits"]);
}
export async function exportPublicKey(key) {
    return await cryptoProvider.subtle.exportKey("jwk", key);
}
export async function importPublicKey(jwk) {
    return await cryptoProvider.subtle.importKey("jwk", jwk, {
        name: "ECDH",
        namedCurve: "P-256",
    }, true, []);
}
export async function deriveSharedSecret(privateKey, publicKey) {
    return await cryptoProvider.subtle.deriveKey({
        name: "ECDH",
        public: publicKey
    }, privateKey, {
        name: "AES-GCM",
        length: 256
    }, true, ["encrypt", "decrypt"]);
}
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
function base64ToArrayBuffer(base64) {
    const binary_string = atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}
export async function encryptPayload(key, payload) {
    const enc = new TextEncoder();
    const encodedPayload = enc.encode(JSON.stringify(payload));
    // AES-GCM requires a 12-byte IV
    const iv = cryptoProvider.getRandomValues(new Uint8Array(12));
    const ciphertext = await cryptoProvider.subtle.encrypt({
        name: "AES-GCM",
        iv: iv
    }, key, encodedPayload);
    return {
        iv: arrayBufferToBase64(iv.buffer),
        ciphertext: arrayBufferToBase64(ciphertext)
    };
}
export async function decryptPayload(key, encrypted) {
    const ivBuffer = base64ToArrayBuffer(encrypted.iv);
    const ciphertextBuffer = base64ToArrayBuffer(encrypted.ciphertext);
    const decrypted = await cryptoProvider.subtle.decrypt({
        name: "AES-GCM",
        iv: new Uint8Array(ivBuffer)
    }, key, ciphertextBuffer);
    const dec = new TextDecoder();
    const jsonStr = dec.decode(decrypted);
    return JSON.parse(jsonStr);
}
