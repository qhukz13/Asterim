import { FastifyRequest, FastifyReply } from 'fastify';
import { WorkspacePermission } from '@asterim/shared';
import { rbacService } from '../services/RbacService';

export function requireWorkspacePermission(permission: WorkspacePermission) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized: Authentication required' });
    }

    const workspaceId =
      (request.params as any)?.workspaceId ||
      (request.query as any)?.workspaceId ||
      (request.body as any)?.workspaceId;

    if (!workspaceId) {
      // If no workspaceId is specified, allow request to proceed (defaulting to personal scope)
      return;
    }

    const userId = (request.user as any)?.userId || request.user.sub;
    const hasPerm = rbacService.userHasPermission(workspaceId, userId, permission);
    if (!hasPerm) {
      return reply.status(403).send({
        error: `Forbidden: Account role in workspace '${workspaceId}' lacks '${permission}' permission`,
        permissionRequired: permission,
      });
    }
  };
}
