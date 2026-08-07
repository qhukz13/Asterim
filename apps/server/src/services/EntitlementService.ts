import { dbService } from './DatabaseService';
import { FeatureEntitlement, FeatureKey } from '@asterim/shared';

export class EntitlementService {
  /**
   * Evaluates if a given account has access to a feature.
   */
  public async canAccessFeature(accountId: string, featureKey: FeatureKey): Promise<boolean> {
    const db = dbService.getDb();
    const row = db
      .prepare(
        'SELECT is_enabled, usage_limit, current_usage, expires_at FROM feature_entitlements WHERE account_id = ? AND feature_key = ?'
      )
      .get(accountId, featureKey) as any;

    if (!row) {
      // Default to allowed for local accounts if unconfigured
      return true;
    }

    if (!Boolean(row.is_enabled)) {
      return false;
    }

    if (row.expires_at && Date.now() > row.expires_at) {
      return false;
    }

    if (row.usage_limit !== -1 && row.current_usage >= row.usage_limit) {
      return false; // Exceeded limit
    }

    return true;
  }

  /**
   * Retrieves feature entitlements for an account.
   */
  public async getAccountEntitlements(accountId: string): Promise<FeatureEntitlement[]> {
    const db = dbService.getDb();
    const rows = db
      .prepare('SELECT * FROM feature_entitlements WHERE account_id = ?')
      .all(accountId) as any[];

    return rows.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      featureKey: r.feature_key as FeatureKey,
      isEnabled: Boolean(r.is_enabled),
      usageLimit: r.usage_limit,
      currentUsage: r.current_usage,
      expiresAt: r.expires_at,
    }));
  }

  /**
   * Records usage against a capped feature limit.
   */
  public async recordFeatureUsage(accountId: string, featureKey: FeatureKey, amount: number = 1): Promise<void> {
    const db = dbService.getDb();
    db.prepare(
      'UPDATE feature_entitlements SET current_usage = current_usage + ? WHERE account_id = ? AND feature_key = ?'
    ).run(amount, accountId, featureKey);
  }
}

export const entitlementService = new EntitlementService();
