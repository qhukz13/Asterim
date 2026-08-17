import { isSovereignMode } from '../services/SovereignMode';
import { FastifyInstance } from 'fastify';
import { relayClient } from '../services/RelayClient';
import { pushService } from '../services/PushService';
import { dbService } from '../services/DatabaseService';
import { secretVault, SECRET_SETTING_KEYS } from '../services/security/SecretVaultService';
import { SECRET_MASK, isMasked } from '../services/security/EnvironmentSecretService';
import { startupService } from '../services/StartupService';
import { mdnsService } from '../services/mDNSService';

export default async function systemRoutes(fastify: FastifyInstance) {
  fastify.get('/api/v1/system', async (request, reply) => {
    let isFirstRun = true;
    try {
      const db = dbService.getDb();
      const query = db.prepare("SELECT value FROM settings WHERE key = 'first_run_completed'");
      const row = query.get() as { value: string } | undefined;
      if (row && row.value === 'true') {
        isFirstRun = false;
      }
    } catch (dbErr) {
      console.error('[SystemRoute] Failed to query settings for first run:', dbErr);
    }

    return {
      tunnelId: relayClient.tunnelId,
      relayUrl: relayClient.relayUrl,
      isFirstRun,
      sovereignMode: isSovereignMode(),
      binaries: startupService.getAgentBinariesStatus()
    };
  });

  fastify.post('/api/v1/system/first-run-complete', async (request, reply) => {
    try {
      const db = dbService.getDb();
      const insert = db.prepare(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('first_run_completed', 'true')"
      );
      insert.run();
      return { success: true };
    } catch (dbErr) {
      console.error('[SystemRoute] Failed to save first run complete status:', dbErr);
      reply.status(500).send({ error: 'Failed to write setting' });
    }
  });

  fastify.get('/api/v1/system/settings', async (request, reply) => {
    try {
      const db = dbService.getDb();
      const query = db.prepare("SELECT key, value FROM settings WHERE key LIKE 'ai_%'");
      const rows = query.all() as { key: string; value: string }[];

      // P9-01 encrypted `ai_api_key` at rest; P9-02 stops it leaving the machine.
      // The key is a credential the operator pasted in once — the settings form
      // needs to know whether one is stored, not what it is, and an endpoint that
      // hands it back turns any authenticated session, stolen token or logged
      // response body into a copy of the credential.
      const settings: Record<string, string> = {};
      const maskedKeys: string[] = [];
      let hasApiKey = false;

      for (const row of rows) {
        if ((SECRET_SETTING_KEYS as readonly string[]).includes(row.key)) {
          const plaintext = secretVault.decryptIfEnvelope(row.value, row.key);
          const isSet = typeof plaintext === 'string' && plaintext.length > 0;
          settings[row.key] = isSet ? SECRET_MASK : '';
          if (isSet) maskedKeys.push(row.key);
          if (row.key === 'ai_api_key' && isSet) hasApiKey = true;
          continue;
        }
        settings[row.key] = row.value;
      }

      return { settings, hasApiKey, maskedKeys, mask: SECRET_MASK };
    } catch (dbErr) {
      console.error('[SystemRoute] Failed to fetch settings:', dbErr);
      reply.status(500).send({ error: 'Failed to fetch settings' });
    }
  });

  fastify.post('/api/v1/system/settings', async (request: any, reply) => {
    try {
      const { settings } = request.body;
      const db = dbService.getDb();
      const insert = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
      
      db.exec('BEGIN');
      try {
        for (const [key, value] of Object.entries(settings)) {
          const isSecret = (SECRET_SETTING_KEYS as readonly string[]).includes(key);

          // An explicit null clears a credential. It is the only way to remove
          // one now that a blank field means "unchanged" rather than "empty" —
          // without it a stored key could never be taken back out.
          if (isSecret && value === null) {
            secretVault.deleteSecret(key);
            continue;
          }

          if (typeof value !== 'string') continue;

          // A credential goes in through the vault and lands as an envelope;
          // ordinary configuration is written as it arrives (P9-01).
          if (isSecret) {
            // GET now answers with a mask, so a form that re-submits what it was
            // shown — or submits an untouched empty field — is saying "leave the
            // stored key alone", not "replace it with this" (P9-02).
            if (value.length === 0 || isMasked(value)) continue;
            secretVault.setSecret(key, value);
          } else {
            insert.run(key, value);
          }
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      
      return { success: true };
    } catch (dbErr) {
      console.error('[SystemRoute] Failed to update settings:', dbErr);
      reply.status(500).send({ error: 'Failed to update settings' });
    }
  });

  fastify.get('/api/v1/system/vapid', async (request, reply) => {
    return { publicKey: pushService.getPublicKey() };
  });

  fastify.get('/api/v1/system/workstations', async (request, reply) => {
    return { workstations: mdnsService.getWorkstations() };
  });

  fastify.post('/api/v1/system/subscribe', async (request: any, reply) => {
    const subscription = request.body;
    pushService.addSubscription(subscription);
    return { success: true };
  });
}
