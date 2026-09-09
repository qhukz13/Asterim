import { FastifyInstance } from 'fastify';
import { pairingService } from '../services/PairingService';
import { authController } from '../controllers/AuthController';
import { ACCOUNTS_DISABLED_BODY, accountsEnabled } from '../services/AccountsFeature';

export default async function authRoutes(fastify: FastifyInstance) {
  /**
   * Every account endpoint is gated on `accountsEnabled()`.
   *
   * These are on the public allow-list in `authMiddleware`, which is what an
   * unauthenticated registration endpoint needs to work at all. Shipped and
   * reachable, that made the pairing PIN optional: register from anywhere on
   * the LAN, receive a JWT, and the rest of the API opens
   * (`docs/audit/security-audit.md`, S5, raised to CRITICAL on 2026-09-09).
   * They answer 404 rather than 403 because a workstation with accounts off
   * has no account system, and saying so is not information anyone needs.
   */
  const requireAccounts = (reply: import('fastify').FastifyReply): boolean => {
    if (accountsEnabled()) return true;
    reply.status(404).send(ACCOUNTS_DISABLED_BODY);
    return false;
  };

  // Phase 2 Centralized Web Auth Endpoints
  fastify.post('/api/v1/auth/register', (req, reply) => {
    if (!requireAccounts(reply)) return;
    return authController.register(req, reply);
  });
  fastify.post('/api/v1/auth/login', (req, reply) => {
    if (!requireAccounts(reply)) return;
    return authController.login(req, reply);
  });
  fastify.post('/api/v1/auth/refresh', (req, reply) => {
    if (!requireAccounts(reply)) return;
    return authController.refresh(req, reply);
  });
  fastify.post('/api/v1/auth/logout', (req, reply) => {
    if (!requireAccounts(reply)) return;
    return authController.logout(req, reply);
  });
  fastify.get('/api/v1/auth/me', (req, reply) => {
    if (!requireAccounts(reply)) return;
    return authController.me(req, reply);
  });
  // The former `/api/v1/auth/oauth/token` exchange accepted any code and signed
  // the caller in as the oldest user. It was removed in the 2026-09 audit
  // (docs/audit/security-audit.md, S2). Desktop deep-link login, if it returns,
  // must verify a stored PKCE challenge before issuing anything.


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
