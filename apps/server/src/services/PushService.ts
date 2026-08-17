import webpush from 'web-push';
import { isSovereignMode, announceSovereignBlock } from './SovereignMode';
import { dbService } from './DatabaseService';
import { secretVault } from './security/SecretVaultService';
import { eventBus } from './EventBus';
import { AsterimEvent, ApprovalRequestPayload } from '@asterim/shared';

export class PushService {
  private vapidPublicKey: string = '';
  private vapidPrivateKey: string = '';

  constructor() {
    this.init();
    this.setupListeners();
  }

  /**
   * The VAPID pair identifies this Core to the push gateways; its private half
   * is a signing key and is stored through the vault (P9-01) rather than as a
   * plaintext JSON blob in `settings`.
   *
   * A pair that cannot be read back — an unparseable row, or a vault key that
   * no longer matches this machine — is replaced. Existing browser
   * subscriptions were bound to the old public key and stop working either way,
   * so a fresh pair is the only state from which push can work again.
   */
  private init() {
    const stored = secretVault.getSecret('vapid_keys');
    let keys: { publicKey?: string; privateKey?: string } | null = null;

    if (stored) {
      try {
        keys = JSON.parse(stored);
      } catch (err) {
        console.error(
          `[PushService] Stored VAPID keys are unreadable (${(err as Error).message}); generating a new pair.`
        );
      }
    }

    if (keys && keys.publicKey && keys.privateKey) {
      this.vapidPublicKey = keys.publicKey;
      this.vapidPrivateKey = keys.privateKey;
    } else {
      // Generate new VAPID keys
      const vapidKeys = webpush.generateVAPIDKeys();
      this.vapidPublicKey = vapidKeys.publicKey;
      this.vapidPrivateKey = vapidKeys.privateKey;
      secretVault.setSecret('vapid_keys', JSON.stringify(vapidKeys));
    }

    webpush.setVapidDetails(
      'mailto:asterim@example.com',
      this.vapidPublicKey,
      this.vapidPrivateKey
    );
    console.log('[PushService] Web Push initialized');
  }

  public getPublicKey(): string {
    return this.vapidPublicKey;
  }

  public addSubscription(subscription: webpush.PushSubscription) {
    const db = dbService.getDb();
    const existing = db
      .prepare('SELECT endpoint FROM push_subscriptions WHERE endpoint = ?')
      .get(subscription.endpoint);
    if (!existing) {
      db.prepare('INSERT INTO push_subscriptions (endpoint, keys_json) VALUES (?, ?)').run(
        subscription.endpoint,
        JSON.stringify(subscription.keys)
      );
      console.log(
        `[PushService] Added new push subscription: ${subscription.endpoint.substring(0, 30)}...`
      );
    }
  }

  public async sendPushNotification(title: string, body: string, data?: any) {
    // Push travels through Google's or Mozilla's gateway, not through Asterim.
    // Returning before reading the subscription table means an air-gapped host
    // never even assembles the payload.
    if (isSovereignMode()) {
      announceSovereignBlock('PushService', 'Web Push dispatch disabled.');
      return;
    }

    const db = dbService.getDb();
    const rows = db.prepare('SELECT endpoint, keys_json FROM push_subscriptions').all() as {
      endpoint: string;
      keys_json: string;
    }[];

    const payload = JSON.stringify({
      title,
      body,
      data
    });

    for (const row of rows) {
      const pushSubscription: webpush.PushSubscription = {
        endpoint: row.endpoint,
        keys: JSON.parse(row.keys_json)
      };

      try {
        await webpush.sendNotification(pushSubscription, payload);
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription has expired or is no longer valid
          console.log(
            `[PushService] Removing expired subscription: ${row.endpoint.substring(0, 30)}...`
          );
          db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(row.endpoint);
        } else {
          console.error('[PushService] Failed to send push notification', err);
        }
      }
    }
  }

  private setupListeners() {
    eventBus.subscribe<ApprovalRequestPayload>('agent.approval_request', async event => {
      await this.sendPushNotification('Agent Action Required', event.payload.description, {
        actionId: event.payload.actionId,
        projectId: (event.payload as any).projectId
      });
    });
  }
}

export const pushService = new PushService();
