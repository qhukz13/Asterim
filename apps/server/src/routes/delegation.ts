/**
 * The delegation REST surface (P7-01).
 *
 * Two routes over `AgentDelegationService`: one to hand a thread's work to
 * another role, one to see what a thread has already handed out. The service
 * owns every rule — the depth bound, the role lookup, the parent's waiting
 * state — so the same guards apply whether a delegation arrives from an agent's
 * meta-tool call or from an operator over HTTP.
 *
 * `POST /delegate` is deliberately synchronous: it holds the request open until
 * the child finishes, because the thing worth returning is the outcome, and a
 * caller that only wanted the child's id can read it from the delegation events
 * on the socket. Its own timeout is the delegation's.
 */

import { FastifyInstance, FastifyReply } from 'fastify';
import { AuthErrorCode } from '@asterim/shared';
import {
  DelegationError,
  DelegationErrorCode,
  agentDelegationService
} from '../services/ai/AgentDelegationService';

/** How a delegation failure reads over HTTP. */
const STATUS_BY_CODE: Record<DelegationErrorCode, number> = {
  INVALID_INPUT: 400,
  THREAD_NOT_FOUND: 404,
  PROFILE_NOT_FOUND: 404,
  // The request is permitted and well-formed; the thread it names is not in a
  // state that can accept it.
  DEPTH_EXCEEDED: 409,
  ALREADY_DELEGATING: 409
};

function sendDelegationError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof DelegationError) {
    return reply.status(STATUS_BY_CODE[err.code]).send({ error: err.message, code: err.code });
  }
  console.error('[Delegation] Unexpected failure', err);
  return reply.status(500).send({ error: 'Delegation request failed' });
}

export default async function delegationRoutes(fastify: FastifyInstance) {
  /** Delegation starts agent sessions; none of it is public. */
  const requireUser = (request: { user?: unknown }, reply: FastifyReply): boolean => {
    if (request.user) return true;
    reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    return false;
  };

  // POST /api/v1/threads/:id/delegate — hand this thread's work to a role
  fastify.post('/api/v1/threads/:id/delegate', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    const body =
      (request.body as {
        role?: string;
        profileId?: string;
        task?: string;
        taskDescription?: string;
        context?: string;
        inputContext?: string;
        timeoutMs?: number;
        kind?: string;
        criteria?: string[];
        diff?: string;
      } | null) || null;

    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return reply
        .status(400)
        .send({ error: 'A delegation body is required.', code: 'INVALID_INPUT' });
    }

    try {
      const result =
        body.kind === 'REVIEW'
          ? await agentDelegationService.requestReview({
              parentThreadId: id,
              diff: body.diff ?? body.inputContext ?? body.context ?? '',
              criteria: body.criteria,
              role: body.role,
              profileId: body.profileId,
              timeoutMs: body.timeoutMs
            })
          : await agentDelegationService.delegateTask({
              parentThreadId: id,
              targetRole: body.role,
              profileId: body.profileId,
              taskDescription: body.task ?? body.taskDescription ?? '',
              inputContext: body.context ?? body.inputContext,
              timeoutMs: body.timeoutMs
            });
      return reply.send({ result });
    } catch (err) {
      return sendDelegationError(reply, err);
    }
  });

  // GET /api/v1/threads/:id/children — what this thread has delegated
  fastify.get('/api/v1/threads/:id/children', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    try {
      return reply.send({
        threadId: id,
        depth: agentDelegationService.getDelegationDepth(id),
        parentState: agentDelegationService.getParentState(id),
        pendingChildThreadId: agentDelegationService.getPendingChild(id),
        children: agentDelegationService.listChildren(id)
      });
    } catch (err) {
      return sendDelegationError(reply, err);
    }
  });
}
