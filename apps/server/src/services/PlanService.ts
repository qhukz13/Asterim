import { dbService } from './DatabaseService';
import { FeatureKey, PlanDefinition } from '@asterim/shared';

export const PLANS: Record<string, PlanDefinition> = {
  free: {
    id: 'plan_free',
    name: 'Community Edition',
    tier: 'free',
    description: 'Local execution and standard agent adapters for individual developers.',
    priceMonthly: 0,
    priceYearly: 0,
    defaultEntitlements: {
      cloud_sync: { isEnabled: true, usageLimit: -1 },
      teams: { isEnabled: false, usageLimit: 0 },
      remote_relay: { isEnabled: true, usageLimit: -1 },
      mcp_marketplace: { isEnabled: true, usageLimit: -1 },
      premium_extensions: { isEnabled: false, usageLimit: 0 },
      enterprise_sso: { isEnabled: false, usageLimit: 0 },
      audit_logs: { isEnabled: false, usageLimit: 0 },
      custom_models: { isEnabled: false, usageLimit: 0 },
      priority_support: { isEnabled: false, usageLimit: 0 },
    },
  },
  pro: {
    id: 'plan_pro',
    name: 'Pro Tier',
    tier: 'pro',
    description: 'Unlimited Cloud Relay, cross-device sync, and priority orchestration.',
    priceMonthly: 1900, // $19.00
    priceYearly: 19000, // $190.00
    defaultEntitlements: {
      cloud_sync: { isEnabled: true, usageLimit: -1 },
      teams: { isEnabled: false, usageLimit: 0 },
      remote_relay: { isEnabled: true, usageLimit: -1 },
      mcp_marketplace: { isEnabled: true, usageLimit: -1 },
      premium_extensions: { isEnabled: true, usageLimit: -1 },
      enterprise_sso: { isEnabled: false, usageLimit: 0 },
      audit_logs: { isEnabled: true, usageLimit: -1 },
      custom_models: { isEnabled: true, usageLimit: -1 },
      priority_support: { isEnabled: true, usageLimit: -1 },
    },
  },
  team: {
    id: 'plan_team',
    name: 'Team Tier',
    tier: 'team',
    description: 'Collaborative workspaces, shared agent threads, and team audit logs.',
    priceMonthly: 4900, // $49.00 / seat
    priceYearly: 49000,
    defaultEntitlements: {
      cloud_sync: { isEnabled: true, usageLimit: -1 },
      teams: { isEnabled: true, usageLimit: -1 },
      remote_relay: { isEnabled: true, usageLimit: -1 },
      mcp_marketplace: { isEnabled: true, usageLimit: -1 },
      premium_extensions: { isEnabled: true, usageLimit: -1 },
      enterprise_sso: { isEnabled: false, usageLimit: 0 },
      audit_logs: { isEnabled: true, usageLimit: -1 },
      custom_models: { isEnabled: true, usageLimit: -1 },
      priority_support: { isEnabled: true, usageLimit: -1 },
    },
  },
  enterprise: {
    id: 'plan_enterprise',
    name: 'Enterprise Tier',
    tier: 'enterprise',
    description: 'Air-gapped deployments, custom SSO/SAML, dedicated SLA, and compliance.',
    priceMonthly: 0, // Custom
    priceYearly: 0,
    defaultEntitlements: {
      cloud_sync: { isEnabled: true, usageLimit: -1 },
      teams: { isEnabled: true, usageLimit: -1 },
      remote_relay: { isEnabled: true, usageLimit: -1 },
      mcp_marketplace: { isEnabled: true, usageLimit: -1 },
      premium_extensions: { isEnabled: true, usageLimit: -1 },
      enterprise_sso: { isEnabled: true, usageLimit: -1 },
      audit_logs: { isEnabled: true, usageLimit: -1 },
      custom_models: { isEnabled: true, usageLimit: -1 },
      priority_support: { isEnabled: true, usageLimit: -1 },
    },
  },
};

export class PlanService {
  public getPlan(planId: string): PlanDefinition {
    return PLANS[planId] || PLANS.free;
  }

  public async updateAccountPlan(accountId: string, newPlanId: string, stripeCustomerId?: string): Promise<void> {
    const plan = this.getPlan(newPlanId);
    const db = dbService.getDb();
    const now = Date.now();

    // 1. Update account record
    db.prepare(
      `UPDATE accounts 
       SET current_plan_id = ?, subscription_status = 'active', billing_status = 'ok', stripe_customer_id = COALESCE(?, stripe_customer_id), updated_at = ?
       WHERE id = ?`
    ).run(plan.tier, stripeCustomerId || null, now, accountId);

    // 2. Sync Feature Entitlements
    const upsertStmt = db.prepare(
      `INSERT INTO feature_entitlements (id, account_id, feature_key, is_enabled, usage_limit, current_usage)
       VALUES (?, ?, ?, ?, ?, 0)
       ON CONFLICT(account_id, feature_key) DO UPDATE SET is_enabled = excluded.is_enabled, usage_limit = excluded.usage_limit`
    );

    for (const [key, config] of Object.entries(plan.defaultEntitlements)) {
      upsertStmt.run(`ent_${accountId}_${key}`, accountId, key, config.isEnabled ? 1 : 0, config.usageLimit);
    }
  }
}

export const planService = new PlanService();
