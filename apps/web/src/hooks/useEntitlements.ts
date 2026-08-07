import { useState, useEffect } from 'react';
import { FeatureKey } from '@asterim/shared';

export function useEntitlements(token: string | null) {
  const [entitlements, setEntitlements] = useState<FeatureKey[]>([
    'cloud_sync',
    'remote_relay',
    'mcp_marketplace',
  ]);

  useEffect(() => {
    if (!token) return;

    fetch('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.entitlements)) {
          setEntitlements(data.entitlements);
        }
      })
      .catch(() => {});
  }, [token]);

  const canAccessFeature = (featureKey: FeatureKey): boolean => {
    return entitlements.includes(featureKey);
  };

  return { entitlements, canAccessFeature };
}
