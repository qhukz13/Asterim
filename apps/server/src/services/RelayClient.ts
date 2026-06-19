import { io, Socket } from 'socket.io-client';
import { eventBus } from './EventBus';
import { AgentDeckEvent } from '@agentdeck/shared';
import { generateECDHKeyPair, exportPublicKey, importPublicKey, deriveSharedSecret, encryptPayload, decryptPayload } from '@agentdeck/shared';
import crypto from 'crypto';
import { pairingService } from './PairingService';

export class RelayClient {
  private socket: Socket | null = null;
  public readonly tunnelId: string;
  /** The relay server URL this client is connected to. Served to web clients via /api/v1/system. */
  public readonly relayUrl: string;
  private keyPair: CryptoKeyPair | null = null;

  // Mapping of mobile client socket IDs to their shared AES keys
  private clientKeys = new Map<string, CryptoKey>();
  private authenticatedClients = new Set<string>();

  constructor() {
    // Generate a secure 6-character hex string for the tunnel pairing code
    this.tunnelId = crypto.randomBytes(3).toString('hex').toUpperCase();
    // P0-008: Read relay URL from env var so it can point to a real cloud relay
    this.relayUrl = process.env.AGENTDECK_RELAY_URL || 'http://localhost:4000';
    this.init();
  }

  private async init() {
    this.keyPair = await generateECDHKeyPair();

    console.log(`[RelayClient] Connecting to relay: ${this.relayUrl}`);
    this.socket = io(this.relayUrl);


    this.socket.on('connect', () => {
      console.log(`[RelayClient] Connected to Cloud Relay. Tunnel ID: ${this.tunnelId}`);
      this.socket?.emit('register_tunnel', this.tunnelId);
    });

    this.socket.on('client_joined', async ({ clientId }) => {
      console.log(`[RelayClient] Mobile client ${clientId} joined tunnel`);
      // When a client joins, we must send them our public key to start the E2E handshake
      if (this.keyPair) {
        const jwk = await exportPublicKey(this.keyPair.publicKey);
        this.socket?.emit('tunnel_message', {
          tunnelId: this.tunnelId,
          payload: {
            type: 'e2e_handshake_server',
            targetClient: clientId,
            publicKey: jwk
          }
        });
      }
    });

    this.socket.on('tunnel_message', async (message: any) => {
      if (message.type === 'e2e_handshake_client') {
        // Mobile client sent us their public key
        console.log(`[RelayClient] Received public key from mobile client`);
        if (this.keyPair) {
          const clientPubKey = await importPublicKey(message.publicKey);
          const sharedSecret = await deriveSharedSecret(this.keyPair.privateKey, clientPubKey);
          this.clientKeys.set(message.sourceClient, sharedSecret);
          console.log(`[RelayClient] E2E Encryption established with ${message.sourceClient}`);
        }
      } else if (message.type === 'encrypted_payload') {
        // Decrypt incoming message
        const sourceClient = message.sourceClient;
        const sharedKey = this.clientKeys.get(sourceClient);
        if (sharedKey) {
          try {
            const decryptedEvent = await decryptPayload(sharedKey, message.encrypted);
            
            const isAuthenticated = this.authenticatedClients.has(sourceClient);

            if (!isAuthenticated) {
              if (decryptedEvent.type === 'client.pair') {
                const { pin } = decryptedEvent.payload;
                if (pairingService.validatePin(pin) || pairingService.validateToken(pin)) {
                  this.authenticatedClients.add(sourceClient);
                  const token = pairingService.generateToken();
                  
                  const authResultEvent = {
                    id: crypto.randomUUID(),
                    timestamp: Date.now(),
                    source: 'server',
                    type: 'server.auth_result',
                    payload: { success: true, token }
                  };
                  const encrypted = await encryptPayload(sharedKey, authResultEvent);
                  this.socket?.emit('tunnel_message', {
                    tunnelId: this.tunnelId,
                    payload: { type: 'encrypted_payload', targetClient: sourceClient, encrypted }
                  });
                  console.log(`[RelayClient] Client ${sourceClient} authenticated successfully.`);
                } else {
                  const authResultEvent = {
                    id: crypto.randomUUID(),
                    timestamp: Date.now(),
                    source: 'server',
                    type: 'server.auth_result',
                    payload: { success: false, error: 'Invalid PIN or Token' }
                  };
                  const encrypted = await encryptPayload(sharedKey, authResultEvent);
                  this.socket?.emit('tunnel_message', {
                    tunnelId: this.tunnelId,
                    payload: { type: 'encrypted_payload', targetClient: sourceClient, encrypted }
                  });
                  console.warn(`[RelayClient] Client ${sourceClient} failed authentication.`);
                }
              } else {
                console.warn(`[RelayClient] Dropping unauthenticated message type ${decryptedEvent.type} from ${sourceClient}`);
              }
              return;
            }

            // Inject into local EventBus as if it came from a local client
            eventBus.publish(decryptedEvent);
          } catch (err) {
            console.error('[RelayClient] Failed to decrypt message from mobile client', err);
          }
        }
      }
    });

    // Bridge Local EventBus -> Relay Server
    eventBus.subscribe('*', async (event: AgentDeckEvent<any>) => {
      // Don't forward events that came from a remote client back to them
      if (event.source?.startsWith('remote:')) return;

      // Encrypt and send to all established remote clients
      for (const [clientId, sharedKey] of this.clientKeys.entries()) {
        if (!this.authenticatedClients.has(clientId)) continue;
        
        try {
          const encrypted = await encryptPayload(sharedKey, event);
          this.socket?.emit('tunnel_message', {
            tunnelId: this.tunnelId,
            payload: {
              type: 'encrypted_payload',
              targetClient: clientId,
              encrypted
            }
          });
        } catch (err) {
          console.error(`[RelayClient] Failed to encrypt event for ${clientId}`, err);
        }
      }
    });
  }
}

export const relayClient = new RelayClient();
