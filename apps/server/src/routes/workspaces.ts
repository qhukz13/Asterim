import { FastifyPluginAsync } from 'fastify';
import { workspaceService } from '../services/WorkspaceService';
import { rbacService } from '../services/RbacService';

export const workspaceRoutes: FastifyPluginAsync = async (fastify) => {
  // Helper to extract userId and accountId safely from request.user
  const getUserContext = (reqUser: any) => ({
    userId: reqUser?.sub || reqUser?.userId || 'usr_dev',
    accountId: reqUser?.acc || reqUser?.accountId || 'acc_dev',
  });

  // GET /api/v1/workspaces & /api/v1/environments - List user's environments/workspaces
  const handleListWorkspaces = async (request: any, reply: any) => {
    const { userId, accountId } = getUserContext(request.user);

    // Ensure personal workspace exists
    workspaceService.ensurePersonalWorkspace(accountId, userId);
    const workspaces = workspaceService.getUserWorkspaces(userId);
    return reply.send({ workspaces, environments: workspaces });
  };

  fastify.get('/api/v1/workspaces', handleListWorkspaces);
  fastify.get('/api/v1/environments', handleListWorkspaces);

  // POST /api/v1/workspaces & /api/v1/environments - Create a new environment/workspace
  const handleCreateWorkspace = async (request: any, reply: any) => {
    const { name, slug, preset } = request.body as { name: string; slug?: string; preset?: string };
    const { userId, accountId } = getUserContext(request.user);

    if (!name) return reply.status(400).send({ error: 'Environment name is required' });

    const workspace = workspaceService.createWorkspace(
      accountId,
      userId,
      name,
      slug,
      false,
      preset || 'personal'
    );

    return reply.status(201).send({ workspace, environment: workspace });
  };

  fastify.post('/api/v1/workspaces', handleCreateWorkspace);
  fastify.post('/api/v1/environments', handleCreateWorkspace);

  // POST /api/v1/environments/:id/attach-project - Attach an existing project to an environment
  const handleAttachProject = async (request: any, reply: any) => {
    const { id } = request.params as { id: string };
    const { projectId } = request.body as { projectId: string };
    if (!projectId) return reply.status(400).send({ error: 'projectId is required' });

    const { dbService } = await import('../services/DatabaseService');
    const { projectManager } = await import('../services/ProjectManager');
    const db = dbService.getDb();
    const attachId = `epa_${crypto.randomUUID()}`;

    try {
      db.prepare(
        'INSERT OR IGNORE INTO environment_project_attachments (id, environment_id, project_id, attached_at) VALUES (?, ?, ?, ?)'
      ).run(attachId, id, projectId, Date.now());
    } catch (e) {}

    const project = projectManager.getProject(projectId);
    return reply.send({ success: true, project });
  };

  fastify.post('/api/v1/workspaces/:id/attach-project', handleAttachProject);
  fastify.post('/api/v1/environments/:id/attach-project', handleAttachProject);

  // POST /api/v1/environments/:id/attach-projects - Batch attach projects
  const handleBatchAttach = async (request: any, reply: any) => {
    const { id } = request.params as { id: string };
    const { projectIds } = request.body as { projectIds: string[] };
    if (!projectIds || !Array.isArray(projectIds)) {
      return reply.status(400).send({ error: 'projectIds array is required' });
    }

    const { dbService } = await import('../services/DatabaseService');
    const db = dbService.getDb();
    const now = Date.now();

    for (const pid of projectIds) {
      try {
        const attachId = `epa_${crypto.randomUUID()}`;
        db.prepare(
          'INSERT OR IGNORE INTO environment_project_attachments (id, environment_id, project_id, attached_at) VALUES (?, ?, ?, ?)'
        ).run(attachId, id, pid, now);
      } catch (e) {}
    }

    return reply.send({ success: true, count: projectIds.length });
  };

  fastify.post('/api/v1/workspaces/:id/attach-projects', handleBatchAttach);
  fastify.post('/api/v1/environments/:id/attach-projects', handleBatchAttach);

  // POST /api/v1/environments/:id/unattach-project - Detach project
  const handleUnattachProject = async (request: any, reply: any) => {
    const { id } = request.params as { id: string };
    const { projectId } = request.body as { projectId: string };
    if (!projectId) return reply.status(400).send({ error: 'projectId is required' });

    const { dbService } = await import('../services/DatabaseService');
    const db = dbService.getDb();

    try {
      db.prepare('DELETE FROM environment_project_attachments WHERE environment_id = ? AND project_id = ?')
        .run(id, projectId);
    } catch (e) {}

    return reply.send({ success: true });
  };

  fastify.post('/api/v1/workspaces/:id/unattach-project', handleUnattachProject);
  fastify.post('/api/v1/environments/:id/unattach-project', handleUnattachProject);

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

  // DELETE /api/v1/workspaces/:id & /api/v1/environments/:id - Delete an environment
  const handleDeleteWorkspace = async (request: any, reply: any) => {
    const { id } = request.params as { id: string };
    try {
      workspaceService.deleteWorkspace(id);
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'Failed to delete environment' });
    }
  };

  fastify.delete('/api/v1/workspaces/:id', handleDeleteWorkspace);
  fastify.delete('/api/v1/environments/:id', handleDeleteWorkspace);
};

export default workspaceRoutes;
