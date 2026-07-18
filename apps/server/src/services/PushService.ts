import webpush from 'web-push';
import { dbService } from './DatabaseService';
import { eventBus } from './EventBus';
import { AsterimEvent, ApprovalRequestPayload } from '@asterim/shared';

export class PushService {
  private vapidPublicKey: string = '';
  private vapidPrivateKey: string = '';

  constructor() {
    this.init();
    this.setupListeners();
  }

  private init() {
    const db = dbService.getDb();
    
    // Check if VAPID keys exist
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('vapid_keys') as { value: string } | undefined;
    
    if (row) {
      const keys = JSON.parse(row.value);
      this.vapidPublicKey = keys.publicKey;
      this.vapidPrivateKey = keys.privateKey;
    } else {
      // Generate new VAPID keys
      const vapidKeys = webpush.generateVAPIDKeys();
      this.vapidPublicKey = vapidKeys.publicKey;
      this.vapidPrivateKey = vapidKeys.privateKey;
      
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('vapid_keys', JSON.stringify(vapidKeys));
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
    const existing = db.prepare('SELECT endpoint FROM push_subscriptions WHERE endpoint = ?').get(subscription.endpoint);
    if (!existing) {
      db.prepare('INSERT INTO push_subscriptions (endpoint, keys_json) VALUES (?, ?)').run(
        subscription.endpoint,
        JSON.stringify(subscription.keys)
      );
      console.log(`[PushService] Added new push subscription: ${subscription.endpoint.substring(0, 30)}...`);
    }
  }

  public async sendPushNotification(title: string, body: string, data?: any) {
    const db = dbService.getDb();
    const rows = db.prepare('SELECT endpoint, keys_json FROM push_subscriptions').all() as { endpoint: string, keys_json: string }[];
    
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
          console.log(`[PushService] Removing expired subscription: ${row.endpoint.substring(0, 30)}...`);
          db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(row.endpoint);
        } else {
          console.error('[PushService] Failed to send push notification', err);
        }
      }
    }
  }

  private setupListeners() {
    eventBus.subscribe<ApprovalRequestPayload>('agent.approval_request', async (event) => {
      await this.sendPushNotification(
        'Agent Action Required',
        event.payload.description,
        {
          actionId: event.payload.actionId,
          projectId: (event.payload as any).projectId
        }
      );
    });
  }
}

export const pushService = new PushService();
