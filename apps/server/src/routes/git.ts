import { FastifyPluginAsync } from 'fastify';
import { gitService } from '../services/git/GitService';
import { projectManager } from '../services/ProjectManager';

export const gitRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/v1/projects/:id/git/status
  fastify.get('/api/v1/projects/:id/git/status', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = projectManager.getProject(id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    try {
      const isRepo = await gitService.repository.isRepository(project.path);
      if (!isRepo) {
        return reply.send({ isRepo: false, status: null });
      }
      const status = await gitService.status.getStatus(project.path);
      return reply.send({ isRepo: true, status });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Failed to fetch git status' });
    }
  });

  // GET /api/v1/projects/:id/git/branches
  fastify.get('/api/v1/projects/:id/git/branches', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = projectManager.getProject(id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    try {
      const branches = await gitService.branch.getBranches(project.path);
      const current = await gitService.branch.getCurrentBranch(project.path);
      return reply.send({ branches, current });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Failed to list branches' });
    }
  });

  // POST /api/v1/projects/:id/git/checkout
  fastify.post('/api/v1/projects/:id/git/checkout', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { branch } = request.body as { branch: string };
    if (!branch) return reply.status(400).send({ error: 'Branch name is required' });

    const project = projectManager.getProject(id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    try {
      await gitService.branch.switchBranch(project.path, branch);
      return reply.send({ success: true, activeBranch: branch });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message || 'Failed to checkout branch' });
    }
  });

  // GET /api/v1/projects/:id/git/diff
  fastify.get('/api/v1/projects/:id/git/diff', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { file, staged } = request.query as { file?: string; staged?: string };

    const project = projectManager.getProject(id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    try {
      const isStaged = staged === 'true';
      const diff = await gitService.diff.getDiff(project.path, file, isStaged);
      return reply.send({ diff });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Failed to fetch diff' });
    }
  });

  // POST /api/v1/projects/:id/git/generate-commit
  fastify.post('/api/v1/projects/:id/git/generate-commit', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = projectManager.getProject(id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });

    try {
      const commitMessage = await gitService.commit.generateCommitMessage(project.path);
      return reply.send({ commitMessage });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message || 'Failed to generate commit message' });
    }
  });
};

export default gitRoutes;
