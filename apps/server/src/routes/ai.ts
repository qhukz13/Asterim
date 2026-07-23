import { FastifyInstance } from 'fastify';
import { aiService } from '../services/ai/AiService';
import { projectManager } from '../services/ProjectManager';
import { DiffManager } from '../services/git/DiffManager';
import { GitProvider } from '../services/git/GitProvider';
import { exec } from 'child_process';
import util from 'util';

const execAsync = util.promisify(exec);

export default async function aiRoutes(fastify: FastifyInstance) {
  fastify.post('/api/v1/ai/generate-commit', async (request: any, reply) => {
    try {
      const { projectId, stagedFiles } = request.body;
      const project = projectManager.getProject(projectId);
      if (!project) return reply.code(404).send({ error: 'Project not found' });

      // We need a diff of only the staged files to pass to AI
      const gitProvider = new GitProvider();
      const diffManager = new DiffManager(gitProvider);

      let fullDiff = '';
      for (const file of stagedFiles) {
        const diff = await diffManager.getDiff(project.path, file, true);
        fullDiff += diff + '\n';
      }

      if (!fullDiff.trim()) {
        return { commitMessage: 'Update files' };
      }

      const provider = aiService.getProvider();
      const commitMessage = await provider.generateCommitMessage(fullDiff, projectId);
      return { commitMessage };
    } catch (err: any) {
      console.error('[AIRoute] Failed to generate commit message:', err);
      reply.code(500).send({ error: err.message || 'Failed to generate commit message' });
    }
  });

  fastify.post('/api/v1/ai/explain-diff', async (request: any, reply) => {
    try {
      const { diff, projectId } = request.body;
      if (!diff) return reply.code(400).send({ error: 'Diff is required' });

      const provider = aiService.getProvider();
      const explanation = await provider.explainDiff(diff, projectId);
      return { explanation };
    } catch (err: any) {
      console.error('[AIRoute] Failed to explain diff:', err);
      reply.code(500).send({ error: err.message || 'Failed to explain diff' });
    }
  });

  fastify.post('/api/v1/ai/review-changes', async (request: any, reply) => {
    try {
      const { diff, projectId } = request.body;
      if (!diff) return reply.code(400).send({ error: 'Diff is required' });

      const provider = aiService.getProvider();
      const review = await provider.reviewChanges(diff, projectId);
      return { review };
    } catch (err: any) {
      console.error('[AIRoute] Failed to review changes:', err);
      reply.code(500).send({ error: err.message || 'Failed to review changes' });
    }
  });

  fastify.post('/api/v1/ai/suggest-files', async (request: any, reply) => {
    try {
      const { projectId, task } = request.body;
      const project = projectManager.getProject(projectId);
      if (!project) return reply.code(404).send({ error: 'Project not found' });

      // Get project file tree
      // Use standard git command to list tracked files, ignore node_modules
      const { stdout } = await execAsync('git ls-tree -r HEAD --name-only', { cwd: project.path });
      const fileTree = stdout.split('\n').filter(Boolean);

      const provider = aiService.getProvider();
      const suggestions = await provider.suggestFiles(task, fileTree, projectId);
      return { suggestions };
    } catch (err: any) {
      console.error('[AIRoute] Failed to suggest files:', err);
      reply.code(500).send({ error: err.message || 'Failed to suggest files' });
    }
  });

  fastify.post('/api/v1/ai/extract-mission', async (request: any, reply) => {
    try {
      const { projectId, history } = request.body;
      const project = projectManager.getProject(projectId);
      if (!project) return reply.code(404).send({ error: 'Project not found' });

      if (!history || !Array.isArray(history) || history.length === 0) {
        return reply.code(400).send({ error: 'Chat history is required' });
      }

      // Convert history to text format for prompt
      const chatText = history.map((msg: any) => `${msg.source === 'user' ? 'User' : 'Agent'}: ${msg.content}`).join('\n');
      
      const provider = aiService.getProvider();
      const mission = await provider.extractMission(chatText, projectId);
      
      return { mission };
    } catch (err: any) {
      console.error('[AIRoute] Failed to extract mission:', err);
      reply.code(500).send({ error: err.message || 'Failed to extract mission' });
    }
  });
}
