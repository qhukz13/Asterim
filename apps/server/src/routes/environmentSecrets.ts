/**
 * Environment secrets REST surface (P9-02).
 *
 * The read side of this API cannot return a credential: `getSecrets` never
 * decrypts, so there is no plaintext anywhere on the GET path to leak by
 * accident. Values travel in one direction only — in on POST, out only into an
 * agent process.
 *
 * Every route is mounted twice, under `/environments/:id` and `/workspaces/:id`,
 * because the two are the same entity under two names in this codebase
 * (`WorkspaceService` writes both tables) and the rest of `routes/workspaces.ts`
 * already pairs them the same way.
 */

import { FastifyInstance } from 'fastify';
import {
  environmentSecretService,
  EnvironmentSecretError,
  SECRET_MASK,
  isMasked
} from '../services/security/EnvironmentSecretService';
import { rbacService } from '../services/RbacService';
import type { WorkspacePermission } from '@asterim/shared';

/** Maps a service failure onto the status that describes it. */
function statusFor(code: string): number {
  switch (code) {
    case 'INVALID_SECRET_KEY_ERROR':
    case 'PROTECTED_SECRET_KEY_ERROR':
      return 400;
    case 'ENVIRONMENT_NOT_FOUND_ERROR':
      return 404;
    default:
      return 500;
  }
}

export default async function environmentSecretRoutes(fastify: FastifyInstance) {
  const userIdOf = (reqUser: any): string => reqUser?.sub || reqUser?.userId || 'usr_dev';

  /**
   * Membership decides who may see or change an environment's credentials.
   *
   * The fallback is deliberate and narrow: an environment with no membership
   * rows at all predates RBAC (`workspace_memberships` is created by
   * `DatabaseService.init`, so a workspace written before it existed has none),
   * and on a single-user workstation that is the normal case. An environment that
   * *has* members is governed by them — a viewer may read the masked list, and
   * only `workspace:write` may set or delete.
   */
  const authorize = (
    request: any,
    reply: any,
    environmentId: string,
    permission: WorkspacePermission
  ): boolean => {
    if (!request.user) {
      reply.status(401).send({ error: 'Unauthorized' });
      return false;
    }

    const role = rbacService.getUserRole(environmentId, userIdOf(request.user));
    if (!role) {
      const members = rbacService.getWorkspaceMemberCount(environmentId);
      if (members > 0) {
        reply.status(403).send({ error: 'Forbidden: not a member of this environment' });
        return false;
      }
      return true;
    }

    if (!rbacService.hasPermission(role, permission)) {
      reply.status(403).send({ error: `Forbidden: '${permission}' is required` });
      return false;
    }
    return true;
  };

  const fail = (reply: any, err: unknown) => {
    if (err instanceof EnvironmentSecretError) {
      return reply.status(statusFor(err.code)).send({ error: err.message, code: err.code });
    }
    console.error('[EnvironmentSecretsRoute] Unexpected failure:', err);
    return reply.status(500).send({ error: 'Failed to process environment secret' });
  };

  // GET — the masked inventory. Never a value.
  const handleList = async (request: any, reply: any) => {
    const { id } = request.params as { id: string };
    if (!authorize(request, reply, id, 'workspace:read')) return reply;

    if (!environmentSecretService.environmentExists(id)) {
      return reply.status(404).send({ error: 'Environment not found' });
    }

    try {
      const secrets = environmentSecretService.getSecrets(id);
      return reply.send({ secrets, mask: SECRET_MASK });
    } catch (err) {
      return fail(reply, err);
    }
  };

  fastify.get('/api/v1/environments/:id/secrets', handleList);
  fastify.get('/api/v1/workspaces/:id/secrets', handleList);

  // POST — stores an encrypted envelope and registers the value for redaction.
  const handleSet = async (request: any, reply: any) => {
    const { id } = request.params as { id: string };
    const { key, value } = (request.body ?? {}) as { key?: string; value?: string };
    if (!authorize(request, reply, id, 'workspace:write')) return reply;

    if (typeof key !== 'string' || key.trim().length === 0) {
      return reply.status(400).send({ error: 'key is required' });
    }
    if (typeof value !== 'string') {
      return reply.status(400).send({ error: 'value is required' });
    }
    // The mask is what a GET hands back; accepting it as a value would store the
    // placeholder over the real credential the moment a form is re-submitted.
    if (isMasked(value)) {
      return reply.status(400).send({ error: 'value is the mask placeholder, not a secret' });
    }

    try {
      environmentSecretService.setSecret(id, key, value);
      const stored = environmentSecretService
        .getSecrets(id)
        .find(secret => secret.key === key.trim());
      return reply.status(201).send({ success: true, secret: stored });
    } catch (err) {
      return fail(reply, err);
    }
  };

  fastify.post('/api/v1/environments/:id/secrets', handleSet);
  fastify.post('/api/v1/workspaces/:id/secrets', handleSet);

  // DELETE — drops the row and stops redacting what it held.
  const handleDelete = async (request: any, reply: any) => {
    const { id, key } = request.params as { id: string; key: string };
    if (!authorize(request, reply, id, 'workspace:write')) return reply;

    try {
      const deleted = environmentSecretService.deleteSecret(id, key);
      if (!deleted) return reply.status(404).send({ error: 'Secret not found' });
      return reply.send({ success: true });
    } catch (err) {
      return fail(reply, err);
    }
  };

  fastify.delete('/api/v1/environments/:id/secrets/:key', handleDelete);
  fastify.delete('/api/v1/workspaces/:id/secrets/:key', handleDelete);
}
