import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { pairingService } from '../services/PairingService';

export const authMiddleware = fp(async (fastify: FastifyInstance) => {
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Only protect API routes
    if (!request.url.startsWith('/api/v1/')) return;

    // The auth endpoint must be public
    if (request.url.startsWith('/api/v1/auth/pair')) return;

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.status(401).send({ error: 'Unauthorized: Missing or invalid token' });
      return reply;
    }

    const token = authHeader.substring(7);
    if (!pairingService.validateToken(token)) {
      reply.status(401).send({ error: 'Unauthorized: Invalid token or expired' });
      return reply;
    }
  });
});
