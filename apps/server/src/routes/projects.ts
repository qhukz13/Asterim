import { FastifyInstance } from 'fastify';
import { projectManager } from '../services/ProjectManager';

export default async function projectRoutes(fastify: FastifyInstance) {
  fastify.get('/api/v1/projects', async (request, reply) => {
    return { projects: projectManager.getProjects() };
  });

  fastify.post('/api/v1/projects', async (request: any, reply) => {
    const { name, path } = request.body;
    if (!name || !path) {
      reply.code(400);
      return { error: 'Name and path are required' };
    }
    const project = projectManager.addProject(name, path);
    return { project };
  });

  fastify.delete('/api/v1/projects/:id', async (request: any, reply) => {
    const { id } = request.params;
    projectManager.removeProject(id);
    return { success: true };
  });
}
