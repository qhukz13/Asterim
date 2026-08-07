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

    const defaultDevUser: AccessTokenPayload = {
      sub: 'usr_dev',
      acc: 'acc_dev',
      sid: 'local_session',
      dev: 'dev_device',
      typ: 'desktop',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400,
      ent: ['cloud_sync', 'teams', 'remote_relay', 'mcp_marketplace', 'premium_extensions'],
    };

    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      if (token) {
        // 1. Check Access Token
        const jwtPayload = tokenService.verifyAccessToken(token);
        if (jwtPayload) {
          request.user = jwtPayload;
          return;
        }
        // 2. Fallback to PIN pairing token
        if (pairingService.validateToken(token)) {
          request.user = defaultDevUser;
          return;
        }
      }
    }

    // In local development or desktop mode, fallback to defaultDevUser
    if (process.env.NODE_ENV !== 'production') {
      request.user = defaultDevUser;
      return;
    }

    reply.status(401).send({ error: 'Unauthorized: Invalid token or expired' });
    return reply;
  });
});
