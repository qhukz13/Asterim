/**
 * The Shared Team Agent REST surface (P8-01, DEC-031).
 *
 * Seven routes over `TeamAgentService`: create and read the shared roles, open
 * a collaborative thread on one, read that thread's transcript and queue, put
 * an instruction into the queue, and take one back out.
 *
 * Two things are decided here rather than in the service.
 *
 * **Who is asking.** The submitting user is taken from the authenticated
 * session, never from the body. In a shared thread the author of a turn is what
 * the whole team reads and what an approval policy is evaluated against
 * (DEC-031 § 3), so a client that could name someone else could put words in
 * their colleague's mouth. Only the display name is accepted from the request.
 *
 * **`POST /turns` does not wait.** It answers with the turn's place in line and
 * returns; the outcome arrives on the socket as `team_turn:*`, which every
 * member of the team is watching anyway. Holding the request open would make
 * the third person in a queue wait out the two turns ahead of them on a
 * connection, which is the failure a queue exists to replace.
 */

import { FastifyInstance, FastifyReply } from 'fastify';
import { AuthErrorCode } from '@asterim/shared';
import {
  TeamAgentError,
  TeamAgentErrorCode,
  teamAgentService
} from '../services/ai/TeamAgentService';

/** How a team agent failure reads over HTTP. */
const STATUS_BY_CODE: Record<TeamAgentErrorCode, number> = {
  INVALID_INPUT: 400,
  AGENT_NOT_FOUND: 404,
  THREAD_NOT_FOUND: 404,
  TURN_NOT_FOUND: 404,
  // The request is permitted and well-formed; the turn is simply past the point
  // where withdrawing it is possible.
  TURN_NOT_CANCELLABLE: 409,
  NO_PROJECT_BOUND: 409
};

function sendTeamAgentError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof TeamAgentError) {
    return reply.status(STATUS_BY_CODE[err.code]).send({ error: err.message, code: err.code });
  }
  console.error('[TeamAgents] Unexpected failure', err);
  return reply.status(500).send({ error: 'Team agent request failed' });
}

export default async function teamAgentRoutes(fastify: FastifyInstance) {
  /** Shared agents are team property; none of this is public. */
  const requireUser = (request: { user?: unknown }, reply: FastifyReply): boolean => {
    if (request.user) return true;
    reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    return false;
  };

  const requireObjectBody = (body: unknown, reply: FastifyReply, what: string): boolean => {
    if (body !== null && typeof body === 'object' && !Array.isArray(body)) return true;
    reply.status(400).send({ error: `A ${what} body is required.`, code: 'INVALID_INPUT' });
    return false;
  };

  // POST /api/v1/team-agents — create a shared agent for a team
  fastify.post('/api/v1/team-agents', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const body = (request.body as Record<string, unknown> | null) ?? null;
    if (!requireObjectBody(body, reply, 'team agent')) return reply;

    try {
      const agent = teamAgentService.createTeamAgent({
        teamId: body!.teamId as string,
        name: body!.name as string,
        role: body!.role as string,
        description: body!.description as string | undefined,
        systemPrompt: body!.systemPrompt as string,
        model: body!.model as string | undefined,
        temperature: body!.temperature as number | undefined,
        enabledMcpServers: body!.enabledMcpServers as string[] | undefined,
        enabledSkills: body!.enabledSkills as string[] | undefined,
        // The creator is the authenticated user, not whoever the body claims.
        createdBy: (request.user as { sub?: string } | undefined)?.sub
      });
      return reply.status(201).send({ agent });
    } catch (err) {
      return sendTeamAgentError(reply, err);
    }
  });

  // GET /api/v1/team-agents?teamId=... — the shared agents of one team
  fastify.get('/api/v1/team-agents', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { teamId } = (request.query as { teamId?: string }) || {};
    // Required rather than defaulted: there is no ambient "current team" on a
    // request, and answering with every team's agents would be a cross-team
    // disclosure dressed up as a convenience.
    if (typeof teamId !== 'string' || teamId.trim() === '') {
      return reply
        .status(400)
        .send({ error: 'teamId is required.', code: 'INVALID_INPUT' });
    }

    try {
      return reply.send({ agents: teamAgentService.listTeamAgents(teamId.trim()) });
    } catch (err) {
      return sendTeamAgentError(reply, err);
    }
  });

  // GET /api/v1/team-agents/:id — one shared agent, with its threads
  fastify.get('/api/v1/team-agents/:id', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    try {
      const agent = teamAgentService.requireTeamAgent(id);
      return reply.send({ agent, threads: teamAgentService.listTeamThreads(agent.id) });
    } catch (err) {
      return sendTeamAgentError(reply, err);
    }
  });

  // POST /api/v1/team-agents/:id/threads — open a collaborative thread
  fastify.post('/api/v1/team-agents/:id/threads', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    const body = (request.body as Record<string, unknown> | null) ?? {};
    if (!requireObjectBody(body, reply, 'team thread')) return reply;

    try {
      const thread = teamAgentService.createTeamThread({
        teamAgentId: id,
        title: body.title as string | undefined,
        projectId: body.projectId as string | undefined
      });
      return reply.status(201).send({ thread });
    } catch (err) {
      return sendTeamAgentError(reply, err);
    }
  });

  // GET /api/v1/team-threads/:id — transcript, live queue, and turn history
  fastify.get('/api/v1/team-threads/:id', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    try {
      const thread = teamAgentService.requireTeamThread(id);
      return reply.send({
        thread,
        agent: teamAgentService.getTeamAgent(thread.teamAgentId),
        messages: teamAgentService.listMessages(thread.id),
        // The live queue and the durable record are both here on purpose: the
        // first is what is outstanding right now, the second is what the thread
        // has been asked for since it existed, including across restarts.
        queue: teamAgentService.getQueueState(thread.id),
        history: teamAgentService.listTurnHistory(thread.id)
      });
    } catch (err) {
      return sendTeamAgentError(reply, err);
    }
  });

  // POST /api/v1/team-threads/:id/turns — put an instruction in the queue
  fastify.post('/api/v1/team-threads/:id/turns', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    const body = (request.body as Record<string, unknown> | null) ?? null;
    if (!requireObjectBody(body, reply, 'turn')) return reply;

    const user = request.user as { sub?: string } | undefined;
    const userId = user?.sub;
    if (!userId) {
      return reply
        .status(401)
        .send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    }

    try {
      const enqueued = teamAgentService.enqueueTurn({
        teamThreadId: id,
        userId,
        userName: (body!.userName as string | undefined) ?? userId,
        instruction: body!.instruction as string,
        context: body!.context
      });
      // The outcome is deliberately not awaited; it arrives on the socket. The
      // promise is consumed here so that a turn that fails long after the
      // response was sent cannot surface as an unhandled rejection.
      void enqueued.completion.catch(() => undefined);

      return reply.status(202).send({
        turn: enqueued.turn,
        queuePosition: enqueued.queuePosition,
        queue: teamAgentService.getQueueState(id)
      });
    } catch (err) {
      return sendTeamAgentError(reply, err);
    }
  });

  // DELETE /api/v1/team-threads/:id/turns/:turnId — withdraw a queued turn
  fastify.delete('/api/v1/team-threads/:id/turns/:turnId', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id, turnId } = request.params as { id: string; turnId: string };
    try {
      const turn = teamAgentService.cancelTurn(id, turnId);
      return reply.send({ turn, queue: teamAgentService.getQueueState(id) });
    } catch (err) {
      return sendTeamAgentError(reply, err);
    }
  });
}
