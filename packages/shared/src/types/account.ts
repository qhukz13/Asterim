export type PlanTier = 'free' | 'pro' | 'team' | 'enterprise';

export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing';

export type BillingStatus = 'ok' | 'payment_failed' | 'grace_period';

export interface Account {
  id: string;
  ownerUserId: string;
  accountName: string;
  currentPlanId: PlanTier;
  subscriptionStatus: SubscriptionStatus;
  billingStatus: BillingStatus;
  stripeCustomerId: string | null;
  planExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface TrustedDevice {
  id: string;
  userId: string;
  deviceName: string;
  osType: 'macos' | 'linux' | 'windows' | 'ios' | 'android' | 'other';
  osVersion: string | null;
  clientVersion: string;
  hardwareFingerprint: string | null;
  isTrusted: boolean;
  lastActiveAt: number;
  createdAt: number;
}

export interface ApiKey {
  id: string;
  accountId: string;
  userId: string;
  keyName: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: number | null;
  expiresAt: number | null;
  createdAt: number;
}

export interface CreateApiKeyRequest {
  keyName: string;
  scopes?: string[];
  expiresInDays?: number;
}

export interface CreateApiKeyResponse {
  apiKey: ApiKey;
  rawSecretKey: string; // Only displayed once on creation
}

export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export interface WorkspaceMembership {
  id: string;
  workspaceId: string;
  userId: string;
  role: Role;
  createdAt: number;
}

export interface TeamMembership {
  id: string;
  teamId: string;
  userId: string;
  role: Role;
  createdAt: number;
}
