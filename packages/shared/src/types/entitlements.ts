export type FeatureKey =
  | 'cloud_sync'
  | 'teams'
  | 'remote_relay'
  | 'mcp_marketplace'
  | 'premium_extensions'
  | 'enterprise_sso'
  | 'audit_logs'
  | 'custom_models'
  | 'priority_support';

export interface FeatureEntitlement {
  id: string;
  accountId: string;
  featureKey: FeatureKey;
  isEnabled: boolean;
  usageLimit: number; // -1 for unlimited
  currentUsage: number;
  expiresAt: number | null;
}

export interface PlanDefinition {
  id: string;
  name: string;
  tier: 'free' | 'pro' | 'team' | 'enterprise';
  description: string;
  priceMonthly: number; // USD cents
  priceYearly: number;  // USD cents
  defaultEntitlements: Record<FeatureKey, { isEnabled: boolean; usageLimit: number }>;
}

export interface EntitlementEvaluation {
  featureKey: FeatureKey;
  allowed: boolean;
  reason?: string;
  usageLimit?: number;
  currentUsage?: number;
  remainingUsage?: number;
}
