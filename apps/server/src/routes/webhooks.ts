import { FastifyInstance } from 'fastify';
import { planService } from '../services/PlanService';

export default async function webhookRoutes(fastify: FastifyInstance) {
  // POST /api/v1/webhooks/stripe — Payment Gateway Webhook Listener
  fastify.post('/api/v1/webhooks/stripe', async (request, reply) => {
    const payload = request.body as any;

    if (!payload || !payload.type) {
      return reply.status(400).send({ error: 'Invalid webhook payload' });
    }

    console.log(`[Billing Webhook] Received Stripe Event: ${payload.type}`);

    switch (payload.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = payload.data?.object;
        const accountId = sub?.metadata?.accountId;
        const planId = sub?.metadata?.planId || 'pro';
        const stripeCustomerId = sub?.customer;

        if (accountId) {
          await planService.updateAccountPlan(accountId, planId, stripeCustomerId);
          console.log(`[Billing Webhook] Updated account ${accountId} to plan ${planId}`);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = payload.data?.object;
        const accountId = sub?.metadata?.accountId;
        if (accountId) {
          await planService.updateAccountPlan(accountId, 'free');
          console.log(`[Billing Webhook] Downgraded account ${accountId} to Free plan`);
        }
        break;
      }
      default:
        // Ignore unhandled event types gracefully
        break;
    }

    return reply.send({ received: true });
  });
}
