import { FastifyInstance } from 'fastify';
import { pairingService } from '../services/PairingService';
import { authController } from '../controllers/AuthController';

export default async function authRoutes(fastify: FastifyInstance) {
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

    const body = request.body as { pin?: string } | undefined;
    if (!body || !body.pin) {
      reply.status(400).send({ error: 'PIN is required' });
      return;
    }

    console.log(`[Auth] Received pairing request from IP: ${ip}`);

    // Attempt accounting, exponential back-off and lockout all live in
    // PairingService — the route only translates the outcome to HTTP.
    const result = await pairingService.attemptPairing(ip, body.pin);

    if (result.status === 'paired') {
      console.log(`[Auth] Pairing successful for IP: ${ip}`);
      reply.send({ token: result.token });
      return;
    }

    if (result.status === 'locked') {
      const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      console.warn(`[Auth] Pair attempt blocked due to rate limit from IP: ${ip}`);
      reply.header('Retry-After', String(retryAfterSeconds));
      reply.status(429).send({
        error: `Too many failed pairing attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
        code: 'PAIRING_RATE_LIMITED',
        retryAfterSeconds
      });
      return;
    }

    console.warn(`[Auth] Pairing failed (Invalid PIN) for IP: ${ip}`);
    reply.status(401).send({
      error: 'Invalid PIN',
      code: 'PAIRING_INVALID_PIN',
      remainingAttempts: result.remainingAttempts
    });
  });

  fastify.get('/api/v1/auth/verify', async (request, reply) => {
    reply.send({ ok: true });
  });
}
