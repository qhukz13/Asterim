import { FastifyPluginAsync } from 'fastify';
import { workspaceService } from '../services/WorkspaceService';
import { rbacService } from '../services/RbacService';

export const workspaceRoutes: FastifyPluginAsync = async (fastify) => {
  // Helper to extract userId and accountId safely from request.user
  const getUserContext = (reqUser: any) => ({
    userId: reqUser.sub || reqUser.userId || 'usr_dev',
    accountId: reqUser.acc || reqUser.accountId || 'acc_dev',
  });

  // GET /api/v1/workspaces - List user's workspaces
  fastify.get('/api/v1/workspaces', async (request, reply) => {
    const { userId, accountId } = getUserContext(request.user);

    // Ensure personal workspace exists
    workspaceService.ensurePersonalWorkspace(accountId, userId);
    const workspaces = workspaceService.getUserWorkspaces(userId);
    return reply.send({ workspaces });
  });

  // POST /api/v1/workspaces - Create a new workspace
  fastify.post('/api/v1/workspaces', async (request, reply) => {
    const { name, slug } = request.body as { name: string; slug?: string };
    const { userId, accountId } = getUserContext(request.user);

    if (!name) return reply.status(400).send({ error: 'Workspace name is required' });

    const workspace = workspaceService.createWorkspace(
      accountId,
      userId,
      name,
      slug
    );

    return reply.status(201).send({ workspace });
  });

  // GET /api/v1/workspaces/:id/members - List members of a workspace
  fastify.get('/api/v1/workspaces/:id/members', async (request, reply) => {
    if (!request.user) return reply.status(401).send({ error: 'Unauthorized' });
    const { id } = request.params as { id: string };
    const { userId } = getUserContext(request.user);

    const role = rbacService.getUserRole(id, userId);
    if (!role) return reply.status(403).send({ error: 'Not a member of this workspace' });

    const members = workspaceService.getWorkspaceMembers(id);
    return reply.send({ members });
  });

  // POST /api/v1/workspaces/:id/invite - Invite a member to a workspace
  fastify.post('/api/v1/workspaces/:id/invite', async (request, reply) => {
    if (!request.user) return reply.status(401).send({ error: 'Unauthorized' });
    const { id } = request.params as { id: string };
    const { email, role } = request.body as { email: string; role: any };
    const { userId } = getUserContext(request.user);

    if (!email) return reply.status(400).send({ error: 'Email is required' });

    const hasPerm = rbacService.userHasPermission(id, userId, 'member:invite');
    if (!hasPerm) return reply.status(403).send({ error: 'Forbidden: Insufficient permissions to invite members' });

    const invitation = workspaceService.inviteMember(id, email, role || 'member');
    return reply.status(201).send({ invitation });
  });

  // POST /api/v1/workspaces/join - Join workspace via token
  fastify.post('/api/v1/workspaces/join', async (request, reply) => {
    if (!request.user) return reply.status(401).send({ error: 'Unauthorized' });
    const { token } = request.body as { token: string };
    const { userId } = getUserContext(request.user);

    if (!token) return reply.status(400).send({ error: 'Invitation token is required' });

    try {
      const member = workspaceService.joinWorkspace(token, userId);
      return reply.send({ member });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'Failed to join workspace' });
    }
  });

  // PATCH /api/v1/workspaces/:id/members/:targetUserId - Update member role
  fastify.patch('/api/v1/workspaces/:id/members/:targetUserId', async (request, reply) => {
    if (!request.user) return reply.status(401).send({ error: 'Unauthorized' });
    const { id, targetUserId } = request.params as { id: string; targetUserId: string };
    const { role } = request.body as { role: any };
    const { userId } = getUserContext(request.user);

    const hasPerm = rbacService.userHasPermission(id, userId, 'member:role');
    if (!hasPerm) return reply.status(403).send({ error: 'Forbidden: Insufficient permissions to update member role' });

    workspaceService.updateMemberRole(id, targetUserId, role);
    return reply.send({ success: true });
  });

  // DELETE /api/v1/workspaces/:id/members/:targetUserId - Remove member
  fastify.delete('/api/v1/workspaces/:id/members/:targetUserId', async (request, reply) => {
    if (!request.user) return reply.status(401).send({ error: 'Unauthorized' });
    const { id, targetUserId } = request.params as { id: string; targetUserId: string };
    const { userId } = getUserContext(request.user);

    const hasPerm = rbacService.userHasPermission(id, userId, 'member:remove');
    if (!hasPerm && userId !== targetUserId) {
      return reply.status(403).send({ error: 'Forbidden: Cannot remove this member' });
    }

    workspaceService.removeMember(id, targetUserId);
    return reply.send({ success: true });
  });

  // GET /api/v1/workspaces/:id/audit-log - Fetch team audit log feed
  fastify.get('/api/v1/workspaces/:id/audit-log', async (request, reply) => {
    if (!request.user) return reply.status(401).send({ error: 'Unauthorized' });
    const { id } = request.params as { id: string };
    const { limit, offset } = request.query as { limit?: string; offset?: string };

    const { auditService } = await import('../services/AuditService');
    const logs = auditService.getWorkspaceAuditLogs(
      id,
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0
    );

    return reply.send({ auditLogs: logs });
  });
};

export default workspaceRoutes;
