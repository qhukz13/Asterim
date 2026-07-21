import { FastifyInstance } from 'fastify';
import { contextService } from '../services/ContextService';
import type { ContextEntryType, ContextEntryCreator } from '@asterim/shared';

export default async function contextRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/v1/threads/:threadId/context
   * Returns all context entries for a thread.
   */
  fastify.get('/api/v1/threads/:threadId/context', async (request: any, reply) => {
    const { threadId } = request.params;
    const entries = contextService.getEntries(threadId);
    return { entries };
  });

  /**
   * POST /api/v1/threads/:threadId/context
   * Adds a new context entry.
   *
   * Body: { projectId, entryType, path?, label?, content?, status?, createdBy?, position? }
   */
  fastify.post('/api/v1/threads/:threadId/context', async (request: any, reply) => {
    const { threadId } = request.params;
    const {
      projectId,
      entryType,
      path,
      label,
      content,
      status,
      createdBy,
      position
    } = request.body;

    if (!projectId || !entryType) {
      reply.code(400);
      return { error: 'projectId and entryType are required' };
    }

    const entry = contextService.addEntry({
      threadId,
      projectId,
      entryType: entryType as ContextEntryType,
      path,
      label,
      content,
      status,
      createdBy: (createdBy as ContextEntryCreator) || 'user',
      position
    });

    reply.code(201);
    return { entry };
  });

  /**
   * PATCH /api/v1/context/:entryId
   * Updates a context entry's mutable fields.
   *
   * Body: { status?, label?, content?, position? }
   */
  fastify.patch('/api/v1/context/:entryId', async (request: any, reply) => {
    const { entryId } = request.params;
    const { status, label, content, position } = request.body;

    const updated = contextService.updateEntry(entryId, { status, label, content, position });
    if (!updated) {
      reply.code(404);
      return { error: 'Context entry not found' };
    }

    return { entry: updated };
  });

  /**
   * DELETE /api/v1/context/:entryId
   * Removes a single context entry.
   */
  fastify.delete('/api/v1/context/:entryId', async (request: any, reply) => {
    const { entryId } = request.params;
    const removed = contextService.removeEntry(entryId);
    if (!removed) {
      reply.code(404);
      return { error: 'Context entry not found' };
    }
    return { success: true };
  });

  /**
   * DELETE /api/v1/threads/:threadId/context
   * Clears all context entries for a thread.
   *
   * Body: { projectId }
   */
  fastify.delete('/api/v1/threads/:threadId/context', async (request: any, reply) => {
    const { threadId } = request.params;
    const { projectId } = request.body || {};

    if (!projectId) {
      reply.code(400);
      return { error: 'projectId is required' };
    }

    contextService.clearEntries(threadId, projectId);
    return { success: true };
  });
}
