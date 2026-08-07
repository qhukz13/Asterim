import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { dbService } from '../services/DatabaseService';
import { AuthErrorCode, CreateApiKeyRequest } from '@asterim/shared';

export default async function apiKeyRoutes(fastify: FastifyInstance) {
  // GET /api/v1/apikeys — List active API keys for account
  fastify.get('/api/v1/apikeys', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    }

    const db = dbService.getDb();
    const rows = db
      .prepare(
        `SELECT id, account_id, user_id, key_name, key_prefix, scopes_json, last_used_at, expires_at, created_at
         FROM api_keys
         WHERE account_id = ?
         ORDER BY created_at DESC`
      )
      .all(request.user.acc) as any[];

    const apiKeys = rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      userId: row.user_id,
      keyName: row.key_name,
      keyPrefix: row.key_prefix,
      scopes: JSON.parse(row.scopes_json || '[]'),
      lastUsedAt: row.last_used_at,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }));

    return reply.send({ apiKeys });
  });

  // POST /api/v1/apikeys — Create new API key
  fastify.post('/api/v1/apikeys', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    }

    const body = (request.body as CreateApiKeyRequest) || {};
    if (!body.keyName) {
      return reply.status(400).send({ error: 'Key name is required' });
    }

    const keyId = `key_${crypto.randomUUID()}`;
    const rawRandom = crypto.randomBytes(24).toString('hex');
    const keyPrefix = `ast_ak_live_${rawRandom.slice(0, 6)}`;
    const fullRawKey = `${keyPrefix}_${rawRandom}`;
    const keyHash = crypto.createHash('sha256').update(fullRawKey).digest('hex');

    const scopesJson = JSON.stringify(body.scopes || ['read', 'write']);
    const now = Date.now();
    const expiresAt = body.expiresInDays ? now + body.expiresInDays * 24 * 60 * 60 * 1000 : null;

    const db = dbService.getDb();
    db.prepare(
      `INSERT INTO api_keys (id, account_id, user_id, key_name, key_prefix, key_hash, scopes_json, last_used_at, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    ).run(keyId, request.user.acc, request.user.sub, body.keyName.trim(), keyPrefix, keyHash, scopesJson, expiresAt, now);

    return reply.status(201).send({
      apiKey: {
        id: keyId,
        accountId: request.user.acc,
        userId: request.user.sub,
        keyName: body.keyName.trim(),
        keyPrefix,
        scopes: body.scopes || ['read', 'write'],
        lastUsedAt: null,
        expiresAt,
        createdAt: now,
      },
      rawSecretKey: fullRawKey,
    });
  });

  // DELETE /api/v1/apikeys/:id — Revoke API key
  fastify.delete('/api/v1/apikeys/:id', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    }

    const { id } = request.params as { id: string };
    const db = dbService.getDb();
    const result = db.prepare('DELETE FROM api_keys WHERE id = ? AND account_id = ?').run(id, request.user.acc);

    if (result.changes === 0) {
      return reply.status(404).send({ error: 'API Key not found or unauthorized' });
    }

    return reply.send({ ok: true, deletedKeyId: id });
  });
}
