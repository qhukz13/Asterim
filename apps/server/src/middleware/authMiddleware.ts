import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { pairingService } from '../services/PairingService';
import { tokenService } from '../services/TokenService';
import { accountsEnabled } from '../services/AccountsFeature';
import { AccessTokenPayload } from '@asterim/shared';

/** True for addresses that can only originate on this machine. */
function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.startsWith('::ffff:') ? address.slice(7) : address;
  return normalized === '127.0.0.1' || normalized === '::1' || normalized.startsWith('127.');
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AccessTokenPayload;
  }
}

export const authMiddleware = fp(async (fastify: FastifyInstance) => {
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Only protect API routes
    if (!request.url.startsWith('/api/v1/')) return;

    // Public auth endpoints. The three account routes are on this list because
    // an unauthenticated registration endpoint cannot work otherwise; the
    // routes themselves answer 404 unless `accountsEnabled()`, which is what
    // stops the list from being a way past the PIN.
    if (
      request.url.startsWith('/api/v1/auth/pair') ||
      request.url.startsWith('/api/v1/auth/register') ||
      request.url.startsWith('/api/v1/auth/login') ||
      request.url.startsWith('/api/v1/auth/refresh')
    ) {
      return;
    }

    // Stripe calls the webhook endpoint; there is no user session behind it.
    // It authenticates itself with an HMAC signature over the raw body
    // (STRIPE_WEBHOOK_SECRET), checked in the route. Without this exemption the
    // endpoint would 401 every delivery whenever NODE_ENV=production.
    if (request.url.startsWith('/api/v1/webhooks/')) {
      return;
    }

    // Loopback-only internal endpoints carry their own credential (the ephemeral
    // token in server.json) and are checked for a loopback source address in the
    // route itself. They are exempt here because the caller is another Asterim
    // process on this machine, which has no user session to present — without
    // this the relay would 401 whenever NODE_ENV=production. See DEC-026.
    if (request.url.startsWith('/api/v1/internal/')) {
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
        // 1. An account access token, but only where accounts exist. A JWT
        //    signed before the feature was turned off, or minted by a build
        //    that had it on, must not open anything on a workstation whose
        //    only stated credential is the pairing PIN.
        if (accountsEnabled()) {
          const jwtPayload = tokenService.verifyAccessToken(token);
          if (jwtPayload) {
            request.user = jwtPayload;
            return;
          }
        }
        // 2. Fallback to PIN pairing token
        if (pairingService.validateToken(token)) {
          request.user = defaultDevUser;
          return;
        }
      }
    }

    // Development convenience, and nothing more. Before the 2026-09 audit this
    // fallback applied to every request whenever NODE_ENV was not `production`,
    // which is every way the Core is normally started — so anyone on the LAN
    // could call any route without a token (docs/audit/security-audit.md, S1).
    // It now needs an explicit opt-in *and* a loopback source address, so it
    // can never be reached from another machine.
    if (
      process.env.NODE_ENV !== 'production' &&
      process.env.ASTERIM_DEV_AUTH_BYPASS === 'true' &&
      isLoopbackAddress(request.ip)
    ) {
      request.user = defaultDevUser;
      return;
    }

    reply.status(401).send({ error: 'Unauthorized: Invalid token or expired' });
    return reply;
  });
});
