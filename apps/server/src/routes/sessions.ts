import { FastifyInstance } from 'fastify';
import { dbService } from '../services/DatabaseService';
import { AuthErrorCode } from '@asterim/shared';

export default async function sessionRoutes(fastify: FastifyInstance) {
  // GET /api/v1/sessions — List active user sessions
  fastify.get('/api/v1/sessions', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    }

    const db = dbService.getDb();
    const rows = db
      .prepare(
        `SELECT s.id, s.user_id, s.device_id, s.ip_address, s.user_agent, s.client_type, s.is_revoked, s.last_active_at, s.created_at, s.expires_at, d.device_name, d.os_type, d.client_version
         FROM user_sessions s
         LEFT JOIN trusted_devices d ON s.device_id = d.id
         WHERE s.user_id = ? AND s.is_revoked = 0 AND s.expires_at > ?
         ORDER BY s.last_active_at DESC`
      )
      .all(request.user.sub, Date.now()) as any[];

    const sessions = rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      deviceId: row.device_id,
      deviceName: row.device_name || 'Browser/Device',
      osType: row.os_type || 'other',
      clientVersion: row.client_version || 'v1.5.0',
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      clientType: row.client_type,
      isCurrentSession: row.id === request.user?.sid,
      lastActiveAt: row.last_active_at,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    }));

    return reply.send({ sessions });
  });

  // POST /api/v1/sessions/revoke — Revoke a specific session
  fastify.post('/api/v1/sessions/revoke', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    }

    const { sessionId } = (request.body as { sessionId?: string }) || {};
    if (!sessionId) {
      return reply.status(400).send({ error: 'Session ID is required' });
    }

    const db = dbService.getDb();
    const result = db
      .prepare('UPDATE user_sessions SET is_revoked = 1 WHERE id = ? AND user_id = ?')
      .run(sessionId, request.user.sub);

    if (result.changes === 0) {
      return reply.status(404).send({ error: 'Session not found or unauthorized' });
    }

    return reply.send({ ok: true, revokedSessionId: sessionId });
  });

  // POST /api/v1/sessions/revoke-others — Revoke all other active sessions except current
  fastify.post('/api/v1/sessions/revoke-others', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    }

    const db = dbService.getDb();
    const result = db
      .prepare('UPDATE user_sessions SET is_revoked = 1 WHERE user_id = ? AND id != ?')
      .run(request.user.sub, request.user.sid);

    return reply.send({ ok: true, revokedCount: result.changes });
  });
}
