/**
 * Tests for Stripe checkout, the customer portal and webhook security (P5.6-04).
 *
 * Nothing here talks to Stripe. The gateway is an injectable interface, so
 * checkout and portal creation are asserted on the parameters that would have
 * been sent; the webhook half is driven through the real Fastify route with
 * genuinely signed payloads, against a real SQLite database in a temp
 * directory — which is the only way to prove that a subscription event actually
 * lands in `accounts` and `feature_entitlements`.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/__tests__/BillingService.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-billing-'));
process.env.ASTERIM_DATA_DIR = tmpDir;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

const Fastify = require('fastify');
const { dbService } = require('../DatabaseService');
const { BillingService } = require('../BillingService');
const { verifyStripeSignature, resolvePlanId } = require('../../routes/webhooks');
const webhookRoutes = require('../../routes/webhooks').default;
const billingRoutes = require('../../routes/billing').default;

import type { StripeGateway } from '../BillingService';

// --- Assertion harness ---

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(
    label,
    ok,
    ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

function describe(name: string): void {
  console.log(`\n${name}`);
}

function cleanup(): void {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n[cleanup] removed ${tmpDir}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${tmpDir}:`, (err as Error).message);
  }
}

const WEBHOOK_SECRET = 'whsec_test_secret';
const ACCOUNT = 'acc_billing_test';
const CUSTOMER = 'cus_test_123';

/** Records what would have been sent to Stripe, and answers with fixtures. */
class RecordingGateway implements StripeGateway {
  public checkoutCalls: Record<string, unknown>[] = [];
  public portalCalls: Record<string, unknown>[] = [];

  async createCheckoutSession(
    params: Record<string, unknown>
  ): Promise<{ id: string; url: string }> {
    this.checkoutCalls.push(params);
    return { id: 'cs_test_session', url: 'https://checkout.stripe.com/c/pay/cs_test_session' };
  }

  async createPortalSession(params: Record<string, unknown>): Promise<{ url: string }> {
    this.portalCalls.push(params);
    return { url: 'https://billing.stripe.com/p/session/test' };
  }
}

function seedAccount(id: string, planId = 'free', customerId: string | null = null): void {
  const now = Date.now();
  const db = dbService.getDb();
  // accounts.owner_user_id is a foreign key, so the owner has to exist first.
  db.prepare(
    `INSERT OR IGNORE INTO users (id, email, password_hash, full_name, is_email_verified, created_at, updated_at)
     VALUES ('usr_billing_test', 'billing@asterim.test', 'x', 'Billing Test', 1, ?, ?)`
  ).run(now, now);
  db.prepare('DELETE FROM feature_entitlements WHERE account_id = ?').run(id);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  db.prepare(
    `INSERT INTO accounts (id, owner_user_id, account_name, current_plan_id, subscription_status, billing_status, stripe_customer_id, created_at, updated_at)
     VALUES (?, 'usr_billing_test', 'Billing Test', ?, 'active', 'ok', ?, ?, ?)`
  ).run(id, planId, customerId, now, now);
}

function accountRow(id: string): Record<string, unknown> {
  return dbService.getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}

function entitlement(accountId: string, key: string): Record<string, unknown> {
  return dbService
    .getDb()
    .prepare('SELECT * FROM feature_entitlements WHERE account_id = ? AND feature_key = ?')
    .get(accountId, key);
}

/** A signed Stripe delivery: the exact bytes plus a matching header. */
function signedEvent(
  event: Record<string, unknown>,
  options: { secret?: string; timestamp?: number } = {}
): { body: string; header: string } {
  const body = JSON.stringify(event);
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', options.secret ?? WEBHOOK_SECRET)
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('hex');
  return { body, header: `t=${timestamp},v1=${signature}` };
}

function subscriptionEvent(
  type: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'evt_test',
    type,
    data: {
      object: {
        id: 'sub_test',
        customer: CUSTOMER,
        metadata: { accountId: ACCOUNT, planId: 'pro' },
        ...overrides
      }
    }
  };
}

interface CaughtBillingError {
  code?: string;
  message?: string;
}

/** Captures a thrown BillingError, or fails the labelled assertion. */
async function rejection(label: string, promise: Promise<unknown>): Promise<CaughtBillingError> {
  try {
    await promise;
    check(label, false, 'expected a rejection, got a resolved promise');
    return {};
  } catch (err) {
    return err as CaughtBillingError;
  }
}

async function main(): Promise<void> {
  dbService.getDb();

  // --- Signature verification ------------------------------------------------
  describe('verifyStripeSignature');
  {
    const { body, header } = signedEvent(subscriptionEvent('customer.subscription.created'));

    equal('a genuine signature verifies', verifyStripeSignature(body, header, WEBHOOK_SECRET), {
      valid: true
    });
    check(
      'the same body as a Buffer verifies too',
      verifyStripeSignature(Buffer.from(body, 'utf8'), header, WEBHOOK_SECRET).valid
    );

    const forged = header.replace(/v1=.*/, `v1=${'a'.repeat(64)}`);
    check(
      'a forged signature is rejected',
      !verifyStripeSignature(body, forged, WEBHOOK_SECRET).valid
    );
    check(
      'a signature made with another secret is rejected',
      !verifyStripeSignature(
        body,
        signedEvent(subscriptionEvent('x'), { secret: 'whsec_other' }).header,
        WEBHOOK_SECRET
      ).valid
    );
    check(
      'a body altered after signing is rejected',
      !verifyStripeSignature(body.replace('"pro"', '"team"'), header, WEBHOOK_SECRET).valid
    );

    const truncated = header.replace(/v1=.*/, 'v1=abc');
    const short = verifyStripeSignature(body, truncated, WEBHOOK_SECRET);
    check('a truncated signature is rejected without throwing', !short.valid);

    equal(
      'an empty header is rejected',
      verifyStripeSignature(body, '', WEBHOOK_SECRET).valid,
      false
    );
    check(
      'a header with no timestamp is rejected',
      !verifyStripeSignature(body, 'v1=deadbeef', WEBHOOK_SECRET).valid
    );
    check(
      'a header with no v1 is rejected',
      !verifyStripeSignature(body, `t=${Math.floor(Date.now() / 1000)}`, WEBHOOK_SECRET).valid
    );
    check(
      'a non-numeric timestamp is rejected',
      !verifyStripeSignature(body, 't=yesterday,v1=deadbeef', WEBHOOK_SECRET).valid
    );

    const replayed = signedEvent(subscriptionEvent('customer.subscription.created'), {
      timestamp: Math.floor(Date.now() / 1000) - 600
    });
    const replay = verifyStripeSignature(replayed.body, replayed.header, WEBHOOK_SECRET);
    check('a replayed delivery is refused on freshness', !replay.valid);
    check('and says why', (replay.reason || '').includes('outside'));

    const recent = signedEvent(subscriptionEvent('customer.subscription.created'), {
      timestamp: Math.floor(Date.now() / 1000) - 120
    });
    check(
      'a delivery inside the window is accepted',
      verifyStripeSignature(recent.body, recent.header, WEBHOOK_SECRET).valid
    );

    // Stripe sends several v1 values while an endpoint secret is rotating.
    const rotating = `${signedEvent(subscriptionEvent('x'), { secret: 'whsec_old' }).header},v1=${crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(`${header.split(',')[0].slice(2)}.${body}`, 'utf8')
      .digest('hex')}`;
    check(
      'any matching v1 during a secret rotation is enough',
      verifyStripeSignature(
        body,
        `t=${header.split(',')[0].slice(2)},v1=${'b'.repeat(64)},${rotating.split(',').pop()}`,
        WEBHOOK_SECRET
      ).valid
    );
  }

  describe('resolvePlanId');
  equal('a known plan is used', resolvePlanId('team'), 'team');
  equal('a missing plan falls back to the cheapest paid tier', resolvePlanId(undefined), 'pro');
  equal('and so does an unknown one', resolvePlanId('platinum'), 'pro');
  equal('free is not a subscription plan, so it also falls back', resolvePlanId('free'), 'free');

  // --- Checkout --------------------------------------------------------------
  describe('createCheckoutSession');
  {
    seedAccount(ACCOUNT);
    const unconfigured = new BillingService({});
    const err = await rejection(
      'an unconfigured deployment rejects',
      unconfigured.createCheckoutSession({
        accountId: ACCOUNT,
        planId: 'pro',
        successUrl: 'https://asterim.dev/ok',
        cancelUrl: 'https://asterim.dev/no'
      })
    );
    equal('with STRIPE_NOT_CONFIGURED', err.code, 'STRIPE_NOT_CONFIGURED');
    check(
      'and says the Community edition is unaffected',
      String(err.message).includes('Community edition')
    );

    const gateway = new RecordingGateway();
    const billing = new BillingService({
      gateway,
      priceIds: { pro: 'price_pro', team: 'price_team' }
    });

    for (const planId of ['free', 'enterprise', 'platinum']) {
      const invalid = await rejection(
        `${planId} cannot be checked out`,
        billing.createCheckoutSession({
          accountId: ACCOUNT,
          planId,
          successUrl: 'https://asterim.dev/ok',
          cancelUrl: 'https://asterim.dev/no'
        })
      );
      equal(`  with INVALID_PLAN for ${planId}`, invalid.code, 'INVALID_PLAN');
    }

    const missingAccount = await rejection(
      'an unknown account rejects',
      billing.createCheckoutSession({
        accountId: 'acc_nope',
        planId: 'pro',
        successUrl: 'https://asterim.dev/ok',
        cancelUrl: 'https://asterim.dev/no'
      })
    );
    equal('with ACCOUNT_NOT_FOUND', missingAccount.code, 'ACCOUNT_NOT_FOUND');

    const session = await billing.createCheckoutSession({
      accountId: ACCOUNT,
      planId: 'pro',
      successUrl: 'https://asterim.dev/ok',
      cancelUrl: 'https://asterim.dev/no'
    });
    equal('a configured checkout returns the session id', session.sessionId, 'cs_test_session');
    check('and a checkout URL', session.checkoutUrl.startsWith('https://checkout.stripe.com/'));
    equal('the price for the chosen plan is used', gateway.checkoutCalls[0].priceId, 'price_pro');
    equal('the account travels with the session', gateway.checkoutCalls[0].accountId, ACCOUNT);
    equal('so the webhook can find its way home', gateway.checkoutCalls[0].planId, 'pro');
    equal('a first-time buyer has no customer yet', gateway.checkoutCalls[0].customerId, undefined);

    seedAccount(ACCOUNT, 'free', CUSTOMER);
    await billing.createCheckoutSession({
      accountId: ACCOUNT,
      planId: 'team',
      successUrl: 'https://asterim.dev/ok',
      cancelUrl: 'https://asterim.dev/no'
    });
    equal(
      'a returning buyer reuses their Stripe customer',
      gateway.checkoutCalls[1].customerId,
      CUSTOMER
    );
    equal('with the team price', gateway.checkoutCalls[1].priceId, 'price_team');

    const noPrice = new BillingService({ gateway: new RecordingGateway(), priceIds: {} });
    const priceless = await rejection(
      'a plan with no configured price rejects',
      noPrice.createCheckoutSession({
        accountId: ACCOUNT,
        planId: 'pro',
        successUrl: 'https://asterim.dev/ok',
        cancelUrl: 'https://asterim.dev/no'
      })
    );
    equal('with STRIPE_NOT_CONFIGURED', priceless.code, 'STRIPE_NOT_CONFIGURED');
    check('naming the variable to set', String(priceless.message).includes('STRIPE_PRICE_PRO'));
  }

  // --- Portal ----------------------------------------------------------------
  describe('createPortalSession');
  {
    const gateway = new RecordingGateway();
    const billing = new BillingService({ gateway });

    seedAccount(ACCOUNT, 'free', null);
    const noCustomer = await rejection(
      'an account that never paid has no portal',
      billing.createPortalSession({ accountId: ACCOUNT, returnUrl: 'https://asterim.dev/account' })
    );
    equal('with NO_CUSTOMER_RECORD', noCustomer.code, 'NO_CUSTOMER_RECORD');

    seedAccount(ACCOUNT, 'pro', CUSTOMER);
    const session = await billing.createPortalSession({
      accountId: ACCOUNT,
      returnUrl: 'https://asterim.dev/account'
    });
    check(
      'a paying account gets a portal URL',
      session.portalUrl.startsWith('https://billing.stripe.com/')
    );
    equal('for its own customer', gateway.portalCalls[0].customerId, CUSTOMER);
    equal(
      'returning where it was asked to',
      gateway.portalCalls[0].returnUrl,
      'https://asterim.dev/account'
    );

    const unconfigured = new BillingService({});
    const err = await rejection(
      'an unconfigured deployment rejects',
      unconfigured.createPortalSession({
        accountId: ACCOUNT,
        returnUrl: 'https://asterim.dev/account'
      })
    );
    equal('with STRIPE_NOT_CONFIGURED', err.code, 'STRIPE_NOT_CONFIGURED');
  }

  // --- The subscription overview ---------------------------------------------
  describe('getSubscriptionOverview');
  {
    const billing = new BillingService({});
    seedAccount(ACCOUNT, 'free', null);

    const free = await billing.getSubscriptionOverview(ACCOUNT);
    equal('a Community account reports the free plan', free.planId, 'free');
    equal('named', free.planName, 'Community Edition');
    equal('at no cost', free.priceMonthly, 0);
    equal('with no Stripe customer', free.stripeCustomerId, null);
    equal('and billing reported as unconfigured', free.billingConfigured, false);
    equal('while still listing what could be bought', free.purchasablePlans, ['pro', 'team']);

    const { planService } = require('../PlanService');
    await planService.updateAccountPlan(ACCOUNT, 'pro', CUSTOMER);
    const pro = await billing.getSubscriptionOverview(ACCOUNT);
    equal('after an upgrade the plan is reported', pro.planId, 'pro');
    equal('with its price', pro.priceMonthly, 1900);
    equal('and its customer', pro.stripeCustomerId, CUSTOMER);
    check('entitlements come with it', pro.entitlements.length >= 9);
    check(
      'including the paid ones',
      pro.entitlements.find((e: { featureKey: string }) => e.featureKey === 'premium_extensions')
        ?.isEnabled === true
    );

    const missing = await rejection(
      'an unknown account rejects',
      billing.getSubscriptionOverview('acc_nope')
    );
    equal('with ACCOUNT_NOT_FOUND', missing.code, 'ACCOUNT_NOT_FOUND');
  }

  // --- The webhook, through the real route ------------------------------------
  describe('POST /api/v1/webhooks/stripe — signature enforcement');
  {
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const app = Fastify();
    await app.register(webhookRoutes);
    await app.ready();

    seedAccount(ACCOUNT, 'free', null);
    const { body, header } = signedEvent(subscriptionEvent('customer.subscription.created'));

    const unsigned = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe',
      payload: body,
      headers: { 'content-type': 'application/json' }
    });
    equal('a delivery with no signature is a 400', unsigned.statusCode, 400);
    equal('with a plain reason', unsigned.json().error, 'Invalid webhook signature');
    equal('and the account is untouched', accountRow(ACCOUNT).current_plan_id, 'free');

    const forged = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe',
      payload: body,
      headers: {
        'content-type': 'application/json',
        'stripe-signature': header.replace(/v1=.*/, `v1=${'0'.repeat(64)}`)
      }
    });
    equal('a forged signature is a 400', forged.statusCode, 400);
    equal('and changes nothing', accountRow(ACCOUNT).current_plan_id, 'free');

    // Same signature, different body: proves the bytes are what is verified.
    const tampered = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe',
      payload: body.replace('"planId":"pro"', '"planId":"team"'),
      headers: { 'content-type': 'application/json', 'stripe-signature': header }
    });
    equal('a body edited in flight is a 400', tampered.statusCode, 400);
    equal('and no upgrade happens', accountRow(ACCOUNT).current_plan_id, 'free');

    await app.close();
  }

  describe('POST /api/v1/webhooks/stripe — the subscription lifecycle');
  {
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const app = Fastify();
    await app.register(webhookRoutes);
    await app.ready();

    const deliver = async (event: Record<string, unknown>) => {
      const { body, header } = signedEvent(event);
      return app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        payload: body,
        headers: { 'content-type': 'application/json', 'stripe-signature': header }
      });
    };

    seedAccount(ACCOUNT, 'free', null);

    const created = await deliver(subscriptionEvent('customer.subscription.created'));
    equal('a signed subscription.created is accepted', created.statusCode, 200);
    equal('acknowledged the way Stripe expects', created.json(), { received: true });
    equal('the account is on the pro plan', accountRow(ACCOUNT).current_plan_id, 'pro');
    equal('its Stripe customer is recorded', accountRow(ACCOUNT).stripe_customer_id, CUSTOMER);
    equal('and it is active', accountRow(ACCOUNT).subscription_status, 'active');
    equal(
      'a paid entitlement is switched on',
      entitlement(ACCOUNT, 'premium_extensions').is_enabled,
      1
    );
    equal('with no usage cap', entitlement(ACCOUNT, 'premium_extensions').usage_limit, -1);
    equal('team features stay off on pro', entitlement(ACCOUNT, 'teams').is_enabled, 0);

    const upgraded = await deliver(
      subscriptionEvent('customer.subscription.updated', {
        metadata: { accountId: ACCOUNT, planId: 'team' }
      })
    );
    equal('subscription.updated is accepted', upgraded.statusCode, 200);
    equal('the account moves to team', accountRow(ACCOUNT).current_plan_id, 'team');
    equal('and team features switch on', entitlement(ACCOUNT, 'teams').is_enabled, 1);

    const failed = await deliver({
      id: 'evt_invoice',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_test', customer: CUSTOMER } }
    });
    equal('a failed invoice is accepted', failed.statusCode, 200);
    equal(
      'the account is found by its Stripe customer alone',
      accountRow(ACCOUNT).billing_status,
      'payment_failed'
    );
    equal('and marked past due', accountRow(ACCOUNT).subscription_status, 'past_due');
    equal('but its plan is not taken away', accountRow(ACCOUNT).current_plan_id, 'team');
    equal('nor its entitlements', entitlement(ACCOUNT, 'teams').is_enabled, 1);

    const deleted = await deliver(subscriptionEvent('customer.subscription.deleted'));
    equal('subscription.deleted is accepted', deleted.statusCode, 200);
    equal('the account returns to the free plan', accountRow(ACCOUNT).current_plan_id, 'free');
    equal(
      'paid entitlements are withdrawn',
      entitlement(ACCOUNT, 'premium_extensions').is_enabled,
      0
    );
    equal('and so are team features', entitlement(ACCOUNT, 'teams').is_enabled, 0);
    equal('while the free ones remain', entitlement(ACCOUNT, 'remote_relay').is_enabled, 1);
    equal('with billing back to ok', accountRow(ACCOUNT).billing_status, 'ok');

    // An account referenced only by client_reference_id still resolves.
    seedAccount('acc_ref_only', 'free', null);
    const byReference = await deliver({
      id: 'evt_ref',
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_ref',
          customer: 'cus_ref',
          client_reference_id: 'acc_ref_only',
          metadata: {}
        }
      }
    });
    equal('client_reference_id is enough to find the account', byReference.statusCode, 200);
    equal('and it is upgraded', accountRow('acc_ref_only').current_plan_id, 'pro');

    const unknown = await deliver({ id: 'evt_x', type: 'charge.succeeded', data: { object: {} } });
    equal('an event we do not handle is still acknowledged', unknown.statusCode, 200);
    equal('and changes nothing', accountRow(ACCOUNT).current_plan_id, 'free');

    const malformed = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe',
      payload: 'not json at all',
      headers: { 'content-type': 'application/json' }
    });
    equal('a body that is not JSON is a 400', malformed.statusCode, 400);

    await app.close();
  }

  describe('POST /api/v1/webhooks/stripe — development mode');
  {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const app = Fastify();
    await app.register(webhookRoutes);
    await app.ready();

    seedAccount(ACCOUNT, 'free', null);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/webhooks/stripe',
      payload: JSON.stringify(subscriptionEvent('customer.subscription.created')),
      headers: { 'content-type': 'application/json' }
    });
    equal('an unsigned delivery is processed when no secret is set', res.statusCode, 200);
    equal('and the plan is applied', accountRow(ACCOUNT).current_plan_id, 'pro');

    await app.close();
  }

  // --- The REST surface -------------------------------------------------------
  describe('the billing routes');
  {
    delete process.env.STRIPE_SECRET_KEY;
    const app = Fastify();
    // Stands in for authMiddleware, which is exercised by its own suites.
    app.addHook(
      'preHandler',
      async (request: { headers: Record<string, unknown>; user?: unknown }) => {
        if (request.headers['x-test-anonymous']) return;
        request.user = { acc: ACCOUNT, sub: 'usr_billing_test' };
      }
    );
    await app.register(billingRoutes);
    await app.ready();

    seedAccount(ACCOUNT, 'free', null);

    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/subscription',
      headers: { 'x-test-anonymous': '1' }
    });
    equal('an unauthenticated caller is refused', anonymous.statusCode, 401);

    const overview = await app.inject({ method: 'GET', url: '/api/v1/billing/subscription' });
    equal('the subscription endpoint answers', overview.statusCode, 200);
    equal('with the account plan', overview.json().planId, 'free');
    check('and its entitlements', Array.isArray(overview.json().entitlements));

    const noPlan = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/checkout',
      payload: {}
    });
    equal('checkout without a plan is a 400', noPlan.statusCode, 400);

    const badPlan = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/checkout',
      payload: { planId: 'platinum', successUrl: 'https://a', cancelUrl: 'https://b' }
    });
    equal('an unknown plan is a 400', badPlan.statusCode, 400);
    equal('with a machine-readable code', badPlan.json().code, 'INVALID_PLAN');

    const unconfigured = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/checkout',
      payload: { planId: 'pro', successUrl: 'https://a', cancelUrl: 'https://b' }
    });
    equal('an unconfigured deployment answers 503, not 500', unconfigured.statusCode, 503);
    equal('saying billing is not set up', unconfigured.json().code, 'STRIPE_NOT_CONFIGURED');

    const noCustomer = await app.inject({
      method: 'POST',
      url: '/api/v1/billing/portal',
      payload: { returnUrl: 'https://a' }
    });
    equal('a portal for an account that never paid is a 409', noCustomer.statusCode, 409);
    equal('with NO_CUSTOMER_RECORD', noCustomer.json().code, 'NO_CUSTOMER_RECORD');

    await app.close();
  }

  // --- The Community edition is never gated ------------------------------------
  describe('the Community edition');
  {
    seedAccount(ACCOUNT, 'free', null);
    const { entitlementService } = require('../EntitlementService');
    const { planService } = require('../PlanService');
    await planService.updateAccountPlan(ACCOUNT, 'free');

    check(
      'local execution stays available without a card',
      await entitlementService.canAccessFeature(ACCOUNT, 'remote_relay')
    );
    check(
      'as does the MCP marketplace',
      await entitlementService.canAccessFeature(ACCOUNT, 'mcp_marketplace')
    );
    check('and cloud sync', await entitlementService.canAccessFeature(ACCOUNT, 'cloud_sync'));
    check(
      'while paid features are simply off',
      !(await entitlementService.canAccessFeature(ACCOUNT, 'premium_extensions'))
    );
  }
}

main()
  .catch(err => {
    failed++;
    console.error('\nUNCAUGHT ERROR:', err);
  })
  .finally(() => {
    cleanup();
    console.log(`\n${passed}/${passed + failed} assertions passed`);
    if (failures.length > 0) {
      console.log('Failed assertions:');
      for (const f of failures) console.log(`  - ${f}`);
    }
    process.exit(failed === 0 ? 0 : 1);
  });
