import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { pairingService } from '../services/PairingService';
import { tokenService } from '../services/TokenService';
import { AccessTokenPayload } from '@asterim/shared';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AccessTokenPayload;
  }
}

export const authMiddleware = fp(async (fastify: FastifyInstance) => {
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Only protect API routes
    if (!request.url.startsWith('/api/v1/')) return;

    // Public auth endpoints
    if (
      request.url.startsWith('/api/v1/auth/pair') ||
      request.url.startsWith('/api/v1/auth/register') ||
      request.url.startsWith('/api/v1/auth/login') ||
      request.url.startsWith('/api/v1/auth/refresh') ||
      request.url.startsWith('/api/v1/auth/oauth')
    ) {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.status(401).send({ error: 'Unauthorized: Missing or invalid token' });
      return reply;
    }

    const token = authHeader.substring(7);

    // 1. Check Phase 2 JWT Access Token
    const jwtPayload = tokenService.verifyAccessToken(token);
    if (jwtPayload) {
      request.user = jwtPayload;
      return;
    }

    // 2. Fallback to Legacy PIN pairing token during transition
    if (pairingService.validateToken(token)) {
      request.user = {
        sub: 'local_user',
        acc: 'local_account',
        sid: 'local_session',
        typ: 'desktop',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400,
        ent: ['cloud_sync', 'teams', 'remote_relay', 'mcp_marketplace', 'premium_extensions'],
      };
      return;
    }

    reply.status(401).send({ error: 'Unauthorized: Invalid token or expired' });
    return reply;
  });
});
