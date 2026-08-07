import { FastifyReply, FastifyRequest } from 'fastify';
import { entitlementService } from '../services/EntitlementService';
import { AuthErrorCode, FeatureKey } from '@asterim/shared';

export function entitlementGuard(featureKey: FeatureKey) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    }

    const hasAccess = await entitlementService.canAccessFeature(request.user.acc, featureKey);
    if (!hasAccess) {
      return reply.status(403).send({
        error: `Access Denied: Account lacks required entitlement '${featureKey}'`,
        code: AuthErrorCode.FORBIDDEN,
        featureKey,
      });
    }
  };
}
