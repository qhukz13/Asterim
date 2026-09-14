import { FastifyInstance } from 'fastify';
import fs from 'fs';
import nodePath from 'path';
import { projectManager } from '../services/ProjectManager';

export default async function projectRoutes(fastify: FastifyInstance) {
  fastify.get('/api/v1/projects', async (request: any, reply) => {
    const { workspaceId } = request.query || {};
    return { projects: projectManager.getProjects(workspaceId) };
  });

  fastify.post('/api/v1/projects', async (request: any, reply) => {
    const { name, path, workspaceId, visibility } = request.body || {};
    if (typeof name !== 'string' || !name.trim() || typeof path !== 'string' || !path.trim()) {
      reply.code(400);
      return { error: 'Name and path are required' };
    }

    // A project is a directory the agent will run in. Registering one that does
    // not exist only produces a confusing failure later, at session start, so
    // the check happens here where the person can still fix the path.
    const resolved = nodePath.resolve(path.trim());
    let stat: fs.Stats | null;
    try {
      stat = fs.statSync(resolved);
    } catch {
      stat = null;
    }
    if (!stat || !stat.isDirectory()) {
      reply.code(400);
      return { error: `Folder not found: ${resolved}. Enter the absolute path of an existing folder.` };
    }

    const project = projectManager.addProject(name.trim(), resolved, workspaceId, visibility);
    return { project };
  });

  fastify.delete('/api/v1/projects/:id', async (request: any, reply) => {
    const { id } = request.params;
    projectManager.removeProject(id);
    return { success: true };
  });

  fastify.get('/api/v1/projects/:id/threads', async (request: any, reply) => {
    const { id } = request.params;
    return { threads: projectManager.getThreads(id) };
  });

  fastify.post('/api/v1/projects/:id/threads', async (request: any, reply) => {
    const { id } = request.params;
    const { name } = request.body;
    if (!name) {
      reply.code(400);
      return { error: 'Name is required' };
    }
    const thread = projectManager.createThread(id, name);
    return { thread };
  });
}
