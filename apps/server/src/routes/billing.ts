import { FastifyInstance, FastifyReply } from 'fastify';
import { AuthErrorCode } from '@asterim/shared';
import { billingService, BillingError, BillingErrorCode } from '../services/BillingService';

/** How a billing failure reads over HTTP. */
const STATUS_BY_CODE: Record<BillingErrorCode, number> = {
  INVALID_PLAN: 400,
  ACCOUNT_NOT_FOUND: 404,
  NO_CUSTOMER_RECORD: 409,
  // Not the caller's fault and not permanent: the deployment has no Stripe keys.
  STRIPE_NOT_CONFIGURED: 503,
  STRIPE_REQUEST_FAILED: 502
};

function sendBillingError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof BillingError) {
    return reply.status(STATUS_BY_CODE[err.code]).send({ error: err.message, code: err.code });
  }
  console.error('[Billing] Unexpected failure', err);
  return reply.status(500).send({ error: 'Billing request failed' });
}

export default async function billingRoutes(fastify: FastifyInstance) {
  // POST /api/v1/billing/checkout — start a Stripe Checkout for a paid plan
  fastify.post('/api/v1/billing/checkout', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    }

    const body =
      (request.body as { planId?: string; successUrl?: string; cancelUrl?: string }) || {};
    if (!body.planId) {
      return reply.status(400).send({ error: 'planId is required' });
    }

    try {
      // The account comes from the session, never from the request body: a
      // caller must not be able to start a checkout against someone else.
      const session = await billingService.createCheckoutSession({
        accountId: request.user.acc,
        planId: body.planId,
        successUrl: body.successUrl || '',
        cancelUrl: body.cancelUrl || ''
      });
      return reply.send(session);
    } catch (err) {
      return sendBillingError(reply, err);
    }
  });

  // POST /api/v1/billing/portal — open the Stripe-hosted billing portal
  fastify.post('/api/v1/billing/portal', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    }

    const body = (request.body as { returnUrl?: string }) || {};
    try {
      const session = await billingService.createPortalSession({
        accountId: request.user.acc,
        returnUrl: body.returnUrl || ''
      });
      return reply.send(session);
    } catch (err) {
      return sendBillingError(reply, err);
    }
  });

  // GET /api/v1/billing/subscription — plan, billing state and entitlements
  fastify.get('/api/v1/billing/subscription', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    }

    try {
      return reply.send(await billingService.getSubscriptionOverview(request.user.acc));
    } catch (err) {
      return sendBillingError(reply, err);
    }
  });
}
