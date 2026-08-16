/**
 * The delegation REST surface (P7-01, P7-03).
 *
 * Three things over `AgentDelegationService`: hand a thread's work to another
 * role, see what a thread has already handed out, and stop one that is running.
 * The service owns every rule — the depth bound, the role lookup, the parent's
 * waiting state, what a cancellation settles as — so the same guards apply
 * whether a delegation arrives from an agent's meta-tool call or from an
 * operator over HTTP.
 *
 * `POST /delegate` is deliberately synchronous: it holds the request open until
 * the child finishes, because the thing worth returning is the outcome, and a
 * caller that only wanted the child's id can read it from the delegation events
 * on the socket. Its own timeout is the delegation's.
 *
 * The cancel route is what makes that bearable. Without it the only ways out of
 * a child that has stopped making progress are the ten-minute timeout and
 * killing the Core.
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
  ALREADY_DELEGATING: 409,
  NOT_DELEGATING: 409
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

  /**
   * Stops the delegation this thread is part of, from either end (P7-03).
   *
   * `:id` may be the parent that is parked or the child that is running; the
   * service resolves which. A thread that is in neither position is a 409
   * rather than a 404 — it exists, it is simply not delegating — and a child
   * that settled a moment before the request landed answers 200 with what it
   * settled as, so an operator clicking Cancel on a delegation that has just
   * finished is not shown an error for it.
   */
  const cancel = async (
    request: { user?: unknown; params: unknown; body?: unknown },
    reply: FastifyReply
  ) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    const body = (request.body as { reason?: string } | null) || null;
    const reason =
      body && typeof body === 'object' && !Array.isArray(body) && typeof body.reason === 'string'
        ? body.reason
        : undefined;

    try {
      const result = await agentDelegationService.cancelDelegation(id, reason);
      return reply.send({ success: true, result });
    } catch (err) {
      return sendDelegationError(reply, err);
    }
  };

  // POST /api/v1/threads/:id/delegate/cancel — stop the running delegation
  fastify.post('/api/v1/threads/:id/delegate/cancel', cancel);
  // The same thing under the noun rather than the verb, because both readings
  // of the existing routes are plausible and a 404 here costs an operator a
  // runaway child.
  fastify.post('/api/v1/threads/:id/delegation/cancel', cancel);

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
