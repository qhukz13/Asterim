import { FastifyInstance } from 'fastify';
import { relayClient } from '../services/RelayClient';
import { pushService } from '../services/PushService';
import { dbService } from '../services/DatabaseService';
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
      binaries: startupService.getAgentBinariesStatus()
    };
  });

  fastify.post('/api/v1/system/first-run-complete', async (request, reply) => {
    try {
      const db = dbService.getDb();
      const insert = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('first_run_completed', 'true')");
      insert.run();
      return { success: true };
    } catch (dbErr) {
      console.error('[SystemRoute] Failed to save first run complete status:', dbErr);
      reply.status(500).send({ error: 'Failed to write setting' });
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
