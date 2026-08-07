import { FastifyInstance } from 'fastify';
import { dbService } from '../services/DatabaseService';
import { AuthErrorCode } from '@asterim/shared';

export default async function deviceRoutes(fastify: FastifyInstance) {
  // GET /api/v1/devices — List all trusted devices for current user
  fastify.get('/api/v1/devices', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    }

    const db = dbService.getDb();
    const rows = db
      .prepare(
        `SELECT id, user_id, device_name, os_type, os_version, client_version, is_trusted, last_active_at, created_at
         FROM trusted_devices
         WHERE user_id = ? AND is_trusted = 1
         ORDER BY last_active_at DESC`
      )
      .all(request.user.sub) as any[];

    const devices = rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      deviceName: row.device_name,
      osType: row.os_type,
      osVersion: row.os_version,
      clientVersion: row.client_version,
      isTrusted: Boolean(row.is_trusted),
      lastActiveAt: row.last_active_at,
      createdAt: row.created_at,
    }));

    return reply.send({ devices });
  });

  // POST /api/v1/devices/rename — Rename a trusted device
  fastify.post('/api/v1/devices/rename', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    }

    const { deviceId, deviceName } = (request.body as { deviceId?: string; deviceName?: string }) || {};
    if (!deviceId || !deviceName) {
      return reply.status(400).send({ error: 'Device ID and new Device Name are required' });
    }

    const db = dbService.getDb();
    const result = db
      .prepare('UPDATE trusted_devices SET device_name = ? WHERE id = ? AND user_id = ?')
      .run(deviceName.trim(), deviceId, request.user.sub);

    if (result.changes === 0) {
      return reply.status(404).send({ error: 'Device not found or unauthorized' });
    }

    return reply.send({ ok: true, deviceId, deviceName: deviceName.trim() });
  });

  // POST /api/v1/devices/revoke — Revoke a device and all its active sessions
  fastify.post('/api/v1/devices/revoke', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    }

    const { deviceId } = (request.body as { deviceId?: string }) || {};
    if (!deviceId) {
      return reply.status(400).send({ error: 'Device ID is required' });
    }

    const db = dbService.getDb();

    // 1. Untrust device
    db.prepare('UPDATE trusted_devices SET is_trusted = 0 WHERE id = ? AND user_id = ?').run(deviceId, request.user.sub);

    // 2. Revoke all active sessions linked to this device
    const sessionResult = db
      .prepare('UPDATE user_sessions SET is_revoked = 1 WHERE device_id = ? AND user_id = ?')
      .run(deviceId, request.user.sub);

    return reply.send({ ok: true, deviceId, revokedSessionsCount: sessionResult.changes });
  });
}
