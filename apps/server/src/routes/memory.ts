import { FastifyInstance, FastifyReply } from 'fastify';
import { projectMemoryService, DECISION_STATUSES } from '../services/ProjectMemoryService';
import type { DecisionStatus } from '@asterim/shared';

/**
 * Translates a ProjectMemoryService error into an HTTP response.
 *
 * The service signals failure by throwing, and SQLite signals a missing
 * foreign key the same way. This is the only place that knows how those map
 * onto status codes — the handlers stay free of branching on error text.
 *
 *   404 — the referenced project or decision does not exist
 *   400 — the request was understood but the input is not acceptable
 *   500 — anything else
 */
function replyForServiceError(err: unknown, reply: FastifyReply): { error: string } {
  const message = err instanceof Error ? err.message : String(err);

  // A decision id that resolves to nothing.
  if (/ not found$/.test(message)) {
    reply.code(404);
    return { error: message };
  }

  // project_id references projects(id); an unknown project fails the constraint.
  if (message.includes('FOREIGN KEY constraint failed')) {
    reply.code(404);
    return { error: 'Project not found' };
  }

  // Everything the service rejects deliberately: missing text, unrecognised
  // enum values, a supersede that crosses projects.
  if (message.startsWith('[ProjectMemoryService]')) {
    reply.code(400);
    return { error: message };
  }

  reply.code(500);
  return { error: 'Internal server error' };
}

/**
 * REST surface for the Project Memory Core.
 *
 * Deliberately thin: no SQL, no lifecycle rules, no validation beyond what HTTP
 * itself requires (a body must be an object; a status query parameter must be a
 * member of the union). Everything else is the service's decision.
 */
export default async function memoryRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/v1/projects/:id/memory/decisions
   * Body: { title, summary, rationale, constraints?, provenance?, confidence?, relatedFiles?, codeRefs? }
   */
  fastify.post('/api/v1/projects/:id/memory/decisions', async (request: any, reply) => {
    const { id } = request.params;
    const body = request.body || {};

    if (!body.title || !body.summary || !body.rationale) {
      reply.code(400);
      return { error: 'title, summary and rationale are required' };
    }

    try {
      const decision = projectMemoryService.createDecision({ ...body, projectId: id });
      reply.code(201);
      return { decision };
    } catch (err) {
      return replyForServiceError(err, reply);
    }
  });

  /**
   * GET /api/v1/projects/:id/memory/decisions?status=ACTIVE
   */
  fastify.get('/api/v1/projects/:id/memory/decisions', async (request: any, reply) => {
    const { id } = request.params;
    const { status } = request.query || {};

    if (status !== undefined && !DECISION_STATUSES.includes(status)) {
      reply.code(400);
      return { error: `Invalid status '${status}'. Expected one of: ${DECISION_STATUSES.join(', ')}` };
    }

    try {
      const decisions = projectMemoryService.listDecisions(
        id,
        status ? { status: status as DecisionStatus } : undefined
      );
      return { decisions };
    } catch (err) {
      return replyForServiceError(err, reply);
    }
  });

  /**
   * POST /api/v1/projects/:id/memory/decisions/:decisionId/supersede
   * Body: the replacement decision's fields.
   */
  fastify.post(
    '/api/v1/projects/:id/memory/decisions/:decisionId/supersede',
    async (request: any, reply) => {
      const { id, decisionId } = request.params;
      const body = request.body || {};

      if (!body.title || !body.summary || !body.rationale) {
        reply.code(400);
        return { error: 'title, summary and rationale are required' };
      }

      try {
        const decision = projectMemoryService.supersedeDecision(decisionId, {
          ...body,
          projectId: id
        });
        reply.code(201);
        return { decision };
      } catch (err) {
        return replyForServiceError(err, reply);
      }
    }
  );

  /**
   * PATCH /api/v1/projects/:id/memory/decisions/:decisionId/status
   * Body: { status: DecisionStatus }
   *
   * The one lifecycle transition that stands alone: archiving a decision, or
   * marking it stale, without another decision taking its place. Supersession has
   * its own endpoint because it writes two rows.
   */
  fastify.patch(
    '/api/v1/projects/:id/memory/decisions/:decisionId/status',
    async (request: any, reply) => {
      const { id, decisionId } = request.params;
      const { status } = request.body || {};

      if (!status) {
        reply.code(400);
        return { error: 'status is required' };
      }

      if (!DECISION_STATUSES.includes(status)) {
        reply.code(400);
        return { error: `Invalid status '${status}'. Expected one of: ${DECISION_STATUSES.join(', ')}` };
      }

      try {
        // Scope check before the write. `updateDecisionStatus` takes an id alone
        // and would happily retire a decision belonging to another project, so
        // this route is the only thing standing between a caller and that.
        const existing = projectMemoryService.getDecision(decisionId);
        if (!existing) {
          reply.code(404);
          return { error: `Decision ${decisionId} not found` };
        }
        if (existing.projectId !== id) {
          // Deliberately does not name the owning project: the caller has no
          // business learning where a decision it cannot see actually lives.
          // See blueprint/audit/IMPLEMENTATION_DRIFT.md § 8.
          reply.code(400);
          return { error: `Decision ${decisionId} does not belong to project ${id}` };
        }

        return { decision: projectMemoryService.updateDecisionStatus(decisionId, status as DecisionStatus) };
      } catch (err) {
        return replyForServiceError(err, reply);
      }
    }
  );

  /**
   * GET /api/v1/projects/:id/memory/briefing
   */
  fastify.get('/api/v1/projects/:id/memory/briefing', async (request: any, reply) => {
    const { id } = request.params;
    try {
      return { briefing: projectMemoryService.getProjectBriefing(id) };
    } catch (err) {
      return replyForServiceError(err, reply);
    }
  });

  /**
   * POST /api/v1/projects/:id/memory/intents
   * Body: { goal, constraints?, nonGoals? }
   */
  fastify.post('/api/v1/projects/:id/memory/intents', async (request: any, reply) => {
    const { id } = request.params;
    const body = request.body || {};

    if (!body.goal) {
      reply.code(400);
      return { error: 'goal is required' };
    }

    try {
      const intent = projectMemoryService.createIntent({ ...body, projectId: id });
      reply.code(201);
      return { intent };
    } catch (err) {
      return replyForServiceError(err, reply);
    }
  });

  /**
   * GET /api/v1/projects/:id/memory/intents/active
   * Returns { intent: null } when the project has no active intent — an absent
   * intent is a valid state, not a missing resource.
   */
  fastify.get('/api/v1/projects/:id/memory/intents/active', async (request: any, reply) => {
    const { id } = request.params;
    try {
      return { intent: projectMemoryService.getActiveIntent(id) };
    } catch (err) {
      return replyForServiceError(err, reply);
    }
  });

  /**
   * POST /api/v1/projects/:id/memory/rules
   * Body: { title, statement, severity?, scopePattern? }
   */
  fastify.post('/api/v1/projects/:id/memory/rules', async (request: any, reply) => {
    const { id } = request.params;
    const body = request.body || {};

    if (!body.title || !body.statement) {
      reply.code(400);
      return { error: 'title and statement are required' };
    }

    try {
      const rule = projectMemoryService.createRule({ ...body, projectId: id });
      reply.code(201);
      return { rule };
    } catch (err) {
      return replyForServiceError(err, reply);
    }
  });

  /**
   * GET /api/v1/projects/:id/memory/rules
   */
  fastify.get('/api/v1/projects/:id/memory/rules', async (request: any, reply) => {
    const { id } = request.params;
    try {
      return { rules: projectMemoryService.listRules(id) };
    } catch (err) {
      return replyForServiceError(err, reply);
    }
  });
}
