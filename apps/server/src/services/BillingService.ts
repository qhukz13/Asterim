import { dbService } from './DatabaseService';
import { secretVault } from './security/SecretVaultService';
import { entitlementService } from './EntitlementService';
import { PLANS } from './PlanService';
import { BillingStatus, FeatureEntitlement, PlanTier, SubscriptionStatus } from '@asterim/shared';

/**
 * Subscription billing.
 *
 * Two rules shape everything here. The Community edition is never gated — an
 * unconfigured Stripe means checkout is unavailable, not that the product is
 * (`blueprint/ROADMAP.md`). And Stripe is reached through a small injectable
 * gateway rather than the vendor SDK: the surface we need is two POSTs, the
 * webhook signature is verified by hand anyway, and the tests must never open a
 * socket.
 */

export type BillingErrorCode =
  | 'STRIPE_NOT_CONFIGURED'
  | 'INVALID_PLAN'
  | 'ACCOUNT_NOT_FOUND'
  | 'NO_CUSTOMER_RECORD'
  | 'STRIPE_REQUEST_FAILED';

export class BillingError extends Error {
  constructor(
    public readonly code: BillingErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

/** The plans a developer can buy. `free` is granted, `enterprise` is sold by hand. */
export const PURCHASABLE_PLANS: PlanTier[] = ['pro', 'team'];

export interface CheckoutSessionParams {
  accountId: string;
  planId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface PortalSessionParams {
  accountId: string;
  returnUrl: string;
}

export interface SubscriptionOverview {
  accountId: string;
  planId: PlanTier;
  planName: string;
  priceMonthly: number;
  subscriptionStatus: SubscriptionStatus;
  billingStatus: BillingStatus;
  stripeCustomerId: string | null;
  /** Whether this deployment can start a checkout at all. */
  billingConfigured: boolean;
  purchasablePlans: PlanTier[];
  entitlements: FeatureEntitlement[];
}

/** What Stripe has to do for us. Implemented over HTTP; replaced in tests. */
export interface StripeGateway {
  createCheckoutSession(params: {
    priceId: string;
    accountId: string;
    planId: string;
    successUrl: string;
    cancelUrl: string;
    customerId?: string;
  }): Promise<{ id: string; url: string }>;

  createPortalSession(params: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
}

interface AccountRow {
  id: string;
  current_plan_id: string;
  subscription_status: string;
  billing_status: string;
  stripe_customer_id: string | null;
}

const STRIPE_API = 'https://api.stripe.com/v1';

/** The real gateway: form-encoded POSTs to Stripe, no SDK. */
export class HttpStripeGateway implements StripeGateway {
  constructor(private readonly secretKey: string) {}

  private async post(path: string, form: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await fetch(`${STRIPE_API}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(form).toString()
    });

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      // Stripe's error text is safe to surface; the API key is never in it.
      const detail =
        (body.error as { message?: string } | undefined)?.message || response.statusText;
      throw new BillingError('STRIPE_REQUEST_FAILED', `Stripe rejected the request: ${detail}`);
    }
    return body;
  }

  async createCheckoutSession(params: {
    priceId: string;
    accountId: string;
    planId: string;
    successUrl: string;
    cancelUrl: string;
    customerId?: string;
  }): Promise<{ id: string; url: string }> {
    const form: Record<string, string> = {
      mode: 'subscription',
      'line_items[0][price]': params.priceId,
      'line_items[0][quantity]': '1',
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      // Both are carried back on the subscription webhook, which is how an
      // anonymous Stripe event is tied to a local account.
      client_reference_id: params.accountId,
      'metadata[accountId]': params.accountId,
      'metadata[planId]': params.planId,
      'subscription_data[metadata][accountId]': params.accountId,
      'subscription_data[metadata][planId]': params.planId
    };
    if (params.customerId) form.customer = params.customerId;

    const body = await this.post('/checkout/sessions', form);
    return { id: String(body.id || ''), url: String(body.url || '') };
  }

  async createPortalSession(params: {
    customerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const body = await this.post('/billing_portal/sessions', {
      customer: params.customerId,
      return_url: params.returnUrl
    });
    return { url: String(body.url || '') };
  }
}

export interface BillingServiceOptions {
  secretKey?: string;
  /** Stripe price ids, keyed by plan tier. */
  priceIds?: Partial<Record<PlanTier, string>>;
  gateway?: StripeGateway;
}

export class BillingService {
  private readonly injectedSecretKey?: string;
  private readonly priceIds: Partial<Record<PlanTier, string>>;
  private readonly injectedGateway?: StripeGateway;

  constructor(options: BillingServiceOptions = {}) {
    this.injectedSecretKey = options.secretKey;
    this.priceIds = options.priceIds ?? {
      pro: process.env.STRIPE_PRICE_PRO,
      team: process.env.STRIPE_PRICE_TEAM
    };
    this.injectedGateway = options.gateway;
  }

  /**
   * The Stripe secret key, in the order a deployment is allowed to supply it:
   * injected by a test, then the environment, then the vault (P9-01).
   *
   * Resolved on each use rather than in the constructor so that a key stored
   * through the vault after the process started is picked up, and so that
   * constructing a BillingService — which every import of this module does —
   * does not read the database.
   */
  private resolveSecretKey(): string | undefined {
    if (this.injectedSecretKey) return this.injectedSecretKey;
    if (process.env.STRIPE_SECRET_KEY) return process.env.STRIPE_SECRET_KEY;
    return secretVault.getSecret('stripe_secret_key') ?? undefined;
  }

  /** True when this deployment can actually start a checkout. */
  public isConfigured(): boolean {
    return Boolean(this.injectedGateway || this.resolveSecretKey());
  }

  private gateway(): StripeGateway {
    if (this.injectedGateway) return this.injectedGateway;
    const secretKey = this.resolveSecretKey();
    if (!secretKey) {
      throw new BillingError(
        'STRIPE_NOT_CONFIGURED',
        'Billing is not configured on this server. Set STRIPE_SECRET_KEY to enable checkout. The Community edition remains fully available without it.'
      );
    }
    return new HttpStripeGateway(secretKey);
  }

  private getAccount(accountId: string): AccountRow {
    const row = dbService
      .getDb()
      .prepare(
        'SELECT id, current_plan_id, subscription_status, billing_status, stripe_customer_id FROM accounts WHERE id = ?'
      )
      .get(accountId) as AccountRow | undefined;

    if (!row) {
      throw new BillingError('ACCOUNT_NOT_FOUND', `No account found for ${accountId}.`);
    }
    return row;
  }

  /**
   * Starts a Stripe Checkout for a paid plan. The account id travels in both
   * `client_reference_id` and the subscription metadata so the webhook can find
   * its way home.
   */
  public async createCheckoutSession(
    params: CheckoutSessionParams
  ): Promise<{ checkoutUrl: string; sessionId: string }> {
    const planId = params.planId as PlanTier;
    if (!PURCHASABLE_PLANS.includes(planId)) {
      throw new BillingError(
        'INVALID_PLAN',
        `${params.planId} is not a purchasable plan. Choose one of: ${PURCHASABLE_PLANS.join(', ')}.`
      );
    }
    if (!params.successUrl || !params.cancelUrl) {
      throw new BillingError('INVALID_PLAN', 'successUrl and cancelUrl are both required.');
    }

    const account = this.getAccount(params.accountId);
    const gateway = this.gateway();

    const priceId = this.priceIds[planId];
    if (!priceId) {
      throw new BillingError(
        'STRIPE_NOT_CONFIGURED',
        `No Stripe price is configured for the ${planId} plan. Set STRIPE_PRICE_${planId.toUpperCase()}.`
      );
    }

    const session = await gateway.createCheckoutSession({
      priceId,
      accountId: account.id,
      planId,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
      customerId: account.stripe_customer_id || undefined
    });

    return { checkoutUrl: session.url, sessionId: session.id };
  }

  /** Opens the Stripe-hosted portal, where cards and cancellation live. */
  public async createPortalSession(params: PortalSessionParams): Promise<{ portalUrl: string }> {
    const account = this.getAccount(params.accountId);
    if (!account.stripe_customer_id) {
      throw new BillingError(
        'NO_CUSTOMER_RECORD',
        'This account has no Stripe customer yet. Complete a checkout before opening the billing portal.'
      );
    }
    if (!params.returnUrl) {
      throw new BillingError('INVALID_PLAN', 'returnUrl is required.');
    }

    const gateway = this.gateway();
    const session = await gateway.createPortalSession({
      customerId: account.stripe_customer_id,
      returnUrl: params.returnUrl
    });
    return { portalUrl: session.url };
  }

  /** Plan, billing state and the entitlements that follow from them. */
  public async getSubscriptionOverview(accountId: string): Promise<SubscriptionOverview> {
    const account = this.getAccount(accountId);
    const plan = PLANS[account.current_plan_id] || PLANS.free;

    return {
      accountId: account.id,
      planId: plan.tier,
      planName: plan.name,
      priceMonthly: plan.priceMonthly,
      subscriptionStatus: account.subscription_status as SubscriptionStatus,
      billingStatus: account.billing_status as BillingStatus,
      stripeCustomerId: account.stripe_customer_id,
      billingConfigured: this.isConfigured(),
      purchasablePlans: PURCHASABLE_PLANS,
      entitlements: await entitlementService.getAccountEntitlements(account.id)
    };
  }

  /** The account a Stripe customer id belongs to, for events without metadata. */
  public findAccountIdByCustomer(customerId: string): string | null {
    if (!customerId) return null;
    const row = dbService
      .getDb()
      .prepare('SELECT id FROM accounts WHERE stripe_customer_id = ?')
      .get(customerId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  /**
   * Flags an account whose payment failed. Entitlements are deliberately left
   * alone: a failed card must not take a developer's workstation away mid-task.
   * Stripe retries, and the next `customer.subscription.*` event resolves it
   * either way.
   *
   * "Past due" is recorded on `subscription_status`, whose declared vocabulary
   * has that word; `billing_status` gets `payment_failed`, which is the value
   * its own union declares (`@asterim/shared`, `BillingStatus`).
   */
  public markPaymentFailed(accountId: string): void {
    dbService
      .getDb()
      .prepare(
        "UPDATE accounts SET billing_status = 'payment_failed', subscription_status = 'past_due', updated_at = ? WHERE id = ?"
      )
      .run(Date.now(), accountId);
  }
}

export const billingService = new BillingService();
