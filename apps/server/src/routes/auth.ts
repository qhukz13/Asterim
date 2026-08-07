import { FastifyInstance } from 'fastify';
import { pairingService } from '../services/PairingService';
import { authController } from '../controllers/AuthController';

export default async function authRoutes(fastify: FastifyInstance) {
  // Simple rate limiting state for local PIN pairing (in-memory, resets on restart)
  const attempts = new Map<string, { count: number; timestamp: number }>();

  // Phase 2 Centralized Web Auth Endpoints
  fastify.post('/api/v1/auth/register', (req, reply) => authController.register(req, reply));
  fastify.post('/api/v1/auth/login', (req, reply) => authController.login(req, reply));
  fastify.post('/api/v1/auth/refresh', (req, reply) => authController.refresh(req, reply));
  fastify.post('/api/v1/auth/logout', (req, reply) => authController.logout(req, reply));
  fastify.post('/api/v1/auth/oauth/token', (req, reply) => authController.oauthTokenExchange(req, reply));
  fastify.get('/api/v1/auth/me', (req, reply) => authController.me(req, reply));


  // Legacy local PIN pairing endpoint (retained for backward compatibility during transition)
  fastify.post('/api/v1/auth/pair', async (request, reply) => {
    const ip = request.ip;
    const now = Date.now();

    const record = attempts.get(ip) || { count: 0, timestamp: now };
    if (now - record.timestamp > 15 * 60 * 1000) {
      record.count = 0;
      record.timestamp = now;
    }

    if (record.count >= 10) {
      console.warn(`[Auth] Pair attempt blocked due to rate limit from IP: ${ip}`);
      reply.status(429).send({ error: 'Too many attempts. Please try again later.' });
      return;
    }

    const body = request.body as { pin?: string };
    if (!body || !body.pin) {
      reply.status(400).send({ error: 'PIN is required' });
      return;
    }

    console.log(`[Auth] Received pairing request from IP: ${ip}`);

    if (pairingService.validatePin(body.pin)) {
      console.log(`[Auth] Pairing successful for IP: ${ip}`);
      attempts.delete(ip);
      const token = pairingService.generateToken();
      reply.send({ token });
    } else {
      console.warn(`[Auth] Pairing failed (Invalid PIN) for IP: ${ip}`);
      record.count += 1;
      attempts.set(ip, record);
      reply.status(401).send({ error: 'Invalid PIN' });
    }
  });

  fastify.get('/api/v1/auth/verify', async (request, reply) => {
    reply.send({ ok: true });
  });
}
