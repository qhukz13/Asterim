/**
 * The Agent Profiles REST surface (P6-07).
 *
 * Five routes over `ProfileService`, all account-scoped. The service owns the
 * rules — validation, the built-in immutability guard — and this file only maps
 * its failures onto status codes, so the same guard applies whether a profile
 * is reached over HTTP or from the session that is about to start under it.
 */

import { FastifyInstance, FastifyReply } from 'fastify';
import { AuthErrorCode, CreateProfileInput, UpdateProfileInput } from '@asterim/shared';
import {
  ProfileError,
  ProfileErrorCode,
  profileService
} from '../services/ai/ProfileService';

/** How a profile failure reads over HTTP. */
const STATUS_BY_CODE: Record<ProfileErrorCode, number> = {
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  // A conflict rather than a 403: the request is permitted, the target is not
  // the kind of thing that can be changed.
  BUILTIN_IMMUTABLE: 409
};

function sendProfileError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof ProfileError) {
    return reply.status(STATUS_BY_CODE[err.code]).send({ error: err.message, code: err.code });
  }
  console.error('[Profiles] Unexpected failure', err);
  return reply.status(500).send({ error: 'Agent profile request failed' });
}

export default async function profileRoutes(fastify: FastifyInstance) {
  /** Every route here is account-scoped; none of them is public. */
  const requireUser = (request: { user?: unknown }, reply: FastifyReply): boolean => {
    if (request.user) return true;
    reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    return false;
  };

  // GET /api/v1/profiles — the built-ins plus whatever this workspace owns
  fastify.get('/api/v1/profiles', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { workspaceId } = (request.query as { workspaceId?: string }) || {};
    if (workspaceId !== undefined && typeof workspaceId !== 'string') {
      return reply
        .status(400)
        .send({ error: 'workspaceId must be a string.', code: 'INVALID_INPUT' });
    }

    try {
      return reply.send({ profiles: profileService.listProfiles(workspaceId || undefined) });
    } catch (err) {
      return sendProfileError(reply, err);
    }
  });

  // GET /api/v1/profiles/:id — one profile, with its full system prompt
  fastify.get('/api/v1/profiles/:id', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    try {
      return reply.send({ profile: profileService.requireProfile(id) });
    } catch (err) {
      return sendProfileError(reply, err);
    }
  });

  // POST /api/v1/profiles — create a custom profile
  fastify.post('/api/v1/profiles', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const body = (request.body as (CreateProfileInput & { cloneOf?: string }) | null) || null;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return reply
        .status(400)
        .send({ error: 'A profile body is required.', code: 'INVALID_INPUT' });
    }

    try {
      // `cloneOf` is how the manager's "clone this role" button reaches the
      // server: the built-in supplies every field the request leaves out, so
      // the client does not have to echo a prompt it never showed the user.
      const profile = body.cloneOf
        ? profileService.cloneProfile(body.cloneOf, body)
        : profileService.createProfile(body);
      return reply.status(201).send({ profile });
    } catch (err) {
      return sendProfileError(reply, err);
    }
  });

  // PUT /api/v1/profiles/:id — update a custom profile; built-ins refuse
  fastify.put('/api/v1/profiles/:id', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    const body = (request.body as UpdateProfileInput | null) || null;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return reply
        .status(400)
        .send({ error: 'An update body is required.', code: 'INVALID_INPUT' });
    }

    try {
      return reply.send({ profile: profileService.updateProfile(id, body) });
    } catch (err) {
      return sendProfileError(reply, err);
    }
  });

  // DELETE /api/v1/profiles/:id — remove a custom profile; built-ins refuse
  fastify.delete('/api/v1/profiles/:id', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    try {
      profileService.deleteProfile(id);
      return reply.send({ deleted: true });
    } catch (err) {
      return sendProfileError(reply, err);
    }
  });
}
