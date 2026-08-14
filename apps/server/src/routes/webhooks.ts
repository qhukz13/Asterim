import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import { planService, PLANS } from '../services/PlanService';
import { billingService } from '../services/BillingService';
import { PlanTier } from '@asterim/shared';

declare module 'fastify' {
  interface FastifyRequest {
    /** The exact bytes Stripe signed. Only set for webhook routes. */
    rawBody?: string;
  }
}

export interface SignatureVerification {
  valid: boolean;
  reason?: string;
}

/**
 * Verifies a `stripe-signature` header against the raw request body.
 *
 * Stripe signs `timestamp.payload` with the endpoint secret and sends
 * `t=<unix seconds>,v1=<hex>`; more than one `v1` appears while a secret is
 * being rotated, so any match counts. The timestamp is checked first — a
 * signature stays valid forever, and without a freshness window a captured
 * webhook could be replayed to re-apply an old subscription state.
 */
export function verifyStripeSignature(
  rawBody: string | Buffer,
  signatureHeader: string,
  secret: string,
  toleranceSeconds = 300
): SignatureVerification {
  if (!signatureHeader) {
    return { valid: false, reason: 'missing stripe-signature header' };
  }

  let timestamp: string | undefined;
  const provided: string[] = [];
  for (const part of signatureHeader.split(',')) {
    const [key, value] = part.trim().split('=');
    if (key === 't') timestamp = value;
    else if (key === 'v1' && value) provided.push(value);
  }

  if (!timestamp || !/^\d+$/.test(timestamp)) {
    return { valid: false, reason: 'signature header carries no timestamp' };
  }
  if (provided.length === 0) {
    return { valid: false, reason: 'signature header carries no v1 signature' };
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (ageSeconds > toleranceSeconds) {
    return {
      valid: false,
      reason: `timestamp is ${ageSeconds}s old, outside the ${toleranceSeconds}s window`
    };
  }

  const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  // Length is compared first: timingSafeEqual throws on a mismatch, which would
  // turn a truncated signature into a crash instead of a rejection.
  const matched = provided.some(candidate => {
    const candidateBuffer = Buffer.from(candidate, 'utf8');
    return (
      candidateBuffer.length === expectedBuffer.length &&
      crypto.timingSafeEqual(candidateBuffer, expectedBuffer)
    );
  });

  return matched ? { valid: true } : { valid: false, reason: 'signature does not match' };
}

/**
 * The plan a subscription event refers to.
 *
 * The metadata is written by our own checkout, so anything else is a bug or an
 * older session. Either way the fallback is `pro` — the cheapest paid tier —
 * because a subscription event means something was paid for, and guessing low
 * is the only safe direction to guess.
 */
export function resolvePlanId(raw: unknown): PlanTier {
  if (typeof raw === 'string' && PLANS[raw]) {
    return PLANS[raw].tier;
  }
  if (raw !== undefined && raw !== null) {
    console.warn(
      `[Billing Webhook] Unknown planId in metadata: ${String(raw)} — defaulting to pro`
    );
  }
  return 'pro';
}

/** The parts of a Stripe object this route reads. Everything else is ignored. */
interface StripeEventObject {
  metadata?: Record<string, unknown>;
  client_reference_id?: unknown;
  customer?: unknown;
}

interface StripeEvent {
  type?: string;
  data?: { object?: StripeEventObject };
}

/** The account an event belongs to: metadata first, then the Stripe customer. */
function resolveAccountId(object: StripeEventObject | undefined): string | null {
  const fromMetadata = object?.metadata?.accountId ?? object?.client_reference_id;
  if (typeof fromMetadata === 'string' && fromMetadata) return fromMetadata;

  const customer = typeof object?.customer === 'string' ? object.customer : '';
  return billingService.findAccountIdByCustomer(customer);
}

export default async function webhookRoutes(fastify: FastifyInstance) {
  // Stripe signs the bytes it sent, not the object we parse out of them, so the
  // raw body has to survive parsing. Scoped to this plugin: no other route sees
  // it. A body that is not JSON is rejected here rather than in the handler.
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (request, body: string | Buffer, done) => {
      const raw = typeof body === 'string' ? body : body.toString('utf8');
      request.rawBody = raw;
      if (!raw) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(raw));
      } catch (err) {
        (err as Error & { statusCode?: number }).statusCode = 400;
        done(err as Error, undefined);
      }
    }
  );

  // POST /api/v1/webhooks/stripe — Payment Gateway Webhook Listener
  fastify.post('/api/v1/webhooks/stripe', async (request, reply) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    if (secret) {
      const verification = verifyStripeSignature(
        request.rawBody ?? '',
        (request.headers['stripe-signature'] as string) || '',
        secret
      );
      if (!verification.valid) {
        console.warn(`[Billing Webhook] Rejected unverified payload: ${verification.reason}`);
        return reply.status(400).send({ error: 'Invalid webhook signature' });
      }
    } else {
      console.warn(
        '[Billing Webhook] STRIPE_WEBHOOK_SECRET is not set — accepting this payload unverified. Set it before exposing this endpoint.'
      );
    }

    const payload = request.body as StripeEvent | undefined;
    if (!payload || !payload.type) {
      return reply.status(400).send({ error: 'Invalid webhook payload' });
    }

    console.log(`[Billing Webhook] Received Stripe Event: ${payload.type}`);
    const object = payload.data?.object;

    switch (payload.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const accountId = resolveAccountId(object);
        const planId = resolvePlanId(object?.metadata?.planId);
        const stripeCustomerId = typeof object?.customer === 'string' ? object.customer : undefined;

        if (accountId) {
          await planService.updateAccountPlan(accountId, planId, stripeCustomerId);
          console.log(`[Billing Webhook] Updated account ${accountId} to plan ${planId}`);
        } else {
          console.warn('[Billing Webhook] Subscription event carried no resolvable account');
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const accountId = resolveAccountId(object);
        if (accountId) {
          await planService.updateAccountPlan(accountId, 'free');
          console.log(`[Billing Webhook] Downgraded account ${accountId} to Free plan`);
        }
        break;
      }
      case 'invoice.payment_failed': {
        const accountId = resolveAccountId(object);
        if (accountId) {
          billingService.markPaymentFailed(accountId);
          console.warn(`[Billing Webhook] Payment failed for account ${accountId}`);
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
