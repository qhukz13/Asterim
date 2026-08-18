/**
 * The Shared Team Agent REST surface (P8-01, P8-03, DEC-031).
 *
 * Ten routes over `TeamAgentService`: create, read, change and retire the
 * shared roles, open a collaborative thread on one, read that thread's
 * transcript and queue, put an instruction into the queue, take one back out,
 * and answer the approval prompt a parked turn is waiting on.
 *
 * Three things are decided here rather than in the service.
 *
 * **Whether they may.** A shared agent is team property, so every route is
 * authorized against the caller's membership of the team that owns the thing
 * they are touching — never against a `teamId` the request supplied. The one
 * deliberate exception is a team with no membership rows at all, which is what
 * a single-developer workstation looks like and must keep working (DEC-028).
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
import type {
  CreateTeamAgentInput,
  TeamApprovalDecision,
  TeamThreadViewer,
  UpdateTeamAgentInput,
  WorkspacePermission
} from '@asterim/shared';
import {
  TeamAgentError,
  TeamAgentErrorCode,
  TeamApprovalCaller,
  evaluateTeamApproval,
  isTeamAdminRole,
  teamAgentService
} from '../services/ai/TeamAgentService';
import { rbacService } from '../services/RbacService';

/** How a team agent failure reads over HTTP. */
const STATUS_BY_CODE: Record<TeamAgentErrorCode, number> = {
  INVALID_INPUT: 400,
  AGENT_NOT_FOUND: 404,
  THREAD_NOT_FOUND: 404,
  TURN_NOT_FOUND: 404,
  // The request is permitted and well-formed; the turn is simply past the point
  // where withdrawing it is possible.
  TURN_NOT_CANCELLABLE: 409,
  NO_PROJECT_BOUND: 409,
  TURN_NOT_AWAITING_APPROVAL: 409,
  // Authenticated, well-formed, and refused: the caller does not hold what the
  // team's approval policy or role model requires (DEC-031 § 3).
  FORBIDDEN: 403
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

  const userIdOf = (request: { user?: unknown }): string =>
    (request.user as { sub?: string; userId?: string } | undefined)?.sub ??
    (request.user as { userId?: string } | undefined)?.userId ??
    '';

  const userNameOf = (request: { user?: unknown }): string | undefined =>
    (request.user as { name?: string; email?: string } | undefined)?.name ??
    (request.user as { email?: string } | undefined)?.email;

  const forbid = (reply: FastifyReply, message: string): FastifyReply =>
    reply.status(403).send({ error: message, code: AuthErrorCode.FORBIDDEN });

  /**
   * What standing the caller has in a team.
   *
   * The fallback is deliberate and narrow, and matches what the environment
   * secrets surface already does: a team with no membership rows at all
   * predates RBAC — `workspace_memberships` is written by the account
   * subsystem, and a workstation that has never had accounts on it has none —
   * and on a single-developer install that is the normal case rather than an
   * intrusion. Refusing there would lock the only user out of their own shared
   * agent, which DEC-028 exists to prevent, not to cause. A team that *does*
   * have members is governed by them, with no exceptions.
   */
  const standingIn = (
    request: { user?: unknown },
    teamId: string
  ): TeamApprovalCaller & { userId: string } => {
    const userId = userIdOf(request);
    const role = teamId ? rbacService.getUserRole(teamId, userId) : null;
    const unmanaged = role ? false : rbacService.getWorkspaceMemberCount(teamId) === 0;
    return { userId, userName: userNameOf(request), role, unmanaged };
  };

  /** Refuses unless the caller holds `permission` in the team. */
  const authorizeTeam = (
    request: { user?: unknown },
    reply: FastifyReply,
    teamId: string,
    permission: WorkspacePermission
  ): boolean => {
    const standing = standingIn(request, teamId);
    if (!standing.role) {
      if (standing.unmanaged) return true;
      forbid(reply, 'You are not a member of this team.');
      return false;
    }
    if (!rbacService.hasPermission(standing.role, permission)) {
      forbid(reply, `Forbidden: '${permission}' is required in this team.`);
      return false;
    }
    return true;
  };

  /**
   * Refuses unless the caller administers the team.
   *
   * Retiring a shared role deletes every collaborative thread hanging off it,
   * transcripts included, for everybody. That is not an edit, and `member` —
   * who may create and change agents — does not get to make it.
   */
  const authorizeTeamAdmin = (
    request: { user?: unknown },
    reply: FastifyReply,
    teamId: string
  ): boolean => {
    const standing = standingIn(request, teamId);
    if (!standing.role) {
      if (standing.unmanaged) return true;
      forbid(reply, 'You are not a member of this team.');
      return false;
    }
    if (!isTeamAdminRole(standing.role)) {
      forbid(reply, 'Only a team admin or owner may retire a shared agent.');
      return false;
    }
    return true;
  };

  /** The team a thread belongs to, by way of its agent. */
  const teamOfThread = (threadId: string): { teamId: string } => {
    const thread = teamAgentService.requireTeamThread(threadId);
    return { teamId: teamAgentService.requireTeamAgent(thread.teamAgentId).teamId };
  };

  // POST /api/v1/team-agents — create a shared agent for a team
  fastify.post('/api/v1/team-agents', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const body = (request.body as Record<string, unknown> | null) ?? null;
    if (!requireObjectBody(body, reply, 'team agent')) return reply;

    // Checked before the service, so a caller who is not on the team cannot
    // learn from a validation error which fields a team agent has.
    const teamId = typeof body!.teamId === 'string' ? body!.teamId.trim() : '';
    if (!authorizeTeam(request, reply, teamId, 'workspace:write')) return reply;

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
        approvalPolicy: body!.approvalPolicy as CreateTeamAgentInput['approvalPolicy'],
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

    if (!authorizeTeam(request, reply, teamId.trim(), 'workspace:read')) return reply;

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
      if (!authorizeTeam(request, reply, agent.teamId, 'workspace:read')) return reply;
      return reply.send({ agent, threads: teamAgentService.listTeamThreads(agent.id) });
    } catch (err) {
      return sendTeamAgentError(reply, err);
    }
  });

  // PATCH /api/v1/team-agents/:id — change a shared role
  //
  // Editing is a team-visible act: the system prompt here is what every
  // member's next turn runs under, so it goes through the same authenticated
  // surface as creating one rather than being a client-side preference.
  fastify.patch('/api/v1/team-agents/:id', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    const body = (request.body as Record<string, unknown> | null) ?? null;
    if (!requireObjectBody(body, reply, 'team agent')) return reply;

    try {
      // The agent is read first so the check is against the team that actually
      // owns it, never against a `teamId` the body supplied.
      const existing = teamAgentService.requireTeamAgent(id);
      if (!authorizeTeam(request, reply, existing.teamId, 'workspace:write')) return reply;

      // Passed through field by field rather than spread, so a body naming
      // `teamId` or `createdBy` cannot move an agent between teams or rewrite
      // who authored it.
      const agent = teamAgentService.updateTeamAgent(id, {
        name: body!.name as string | undefined,
        role: body!.role as string | undefined,
        description: body!.description as string | undefined,
        systemPrompt: body!.systemPrompt as string | undefined,
        model: body!.model as string | undefined,
        temperature: body!.temperature as number | undefined,
        enabledMcpServers: body!.enabledMcpServers as string[] | undefined,
        enabledSkills: body!.enabledSkills as string[] | undefined,
        approvalPolicy: body!.approvalPolicy as UpdateTeamAgentInput['approvalPolicy']
      });
      return reply.send({ agent });
    } catch (err) {
      return sendTeamAgentError(reply, err);
    }
  });

  // DELETE /api/v1/team-agents/:id — retire a shared role
  fastify.delete('/api/v1/team-agents/:id', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    try {
      const existing = teamAgentService.requireTeamAgent(id);
      if (!authorizeTeamAdmin(request, reply, existing.teamId)) return reply;

      teamAgentService.deleteTeamAgent(id);
      return reply.send({ deleted: true, id });
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
      const agent = teamAgentService.requireTeamAgent(id);
      if (!authorizeTeam(request, reply, agent.teamId, 'workspace:write')) return reply;

      const thread = teamAgentService.createTeamThread({
        teamAgentId: id,
        title: body.title as string | undefined,
        projectId: body.projectId as string | undefined,
        approvalPolicy: body.approvalPolicy as CreateTeamAgentInput['approvalPolicy']
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
      const agent = teamAgentService.requireTeamAgent(thread.teamAgentId);
      if (!authorizeTeam(request, reply, agent.teamId, 'workspace:read')) return reply;

      const standing = standingIn(request, agent.teamId);
      const policy = teamAgentService.effectiveApprovalPolicy(thread, agent);
      const active = teamAgentService.getQueueState(thread.id).activeTurn;
      // Answered by the Core rather than inferred by the dashboard: a client
      // cannot be trusted to know its own role, and one that guessed would
      // either offer a button the Core refuses or hide one the member holds.
      const viewer: TeamThreadViewer = {
        userId: standing.userId,
        role: standing.role,
        unmanaged: standing.unmanaged === true,
        approvalPolicy: policy,
        canApprove: evaluateTeamApproval({
          policy,
          caller: standing,
          // Without a parked turn there is nobody to be the initiator, so
          // TURN_INITIATOR is answered against the caller themselves: the
          // question the dashboard is asking is "could you approve your own".
          turnUserId: active?.userId ?? standing.userId
        }).allowed,
        canAdminister: standing.role ? isTeamAdminRole(standing.role) : standing.unmanaged === true
      };

      return reply.send({
        thread,
        agent,
        viewer,
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
      if (!authorizeTeam(request, reply, teamOfThread(id).teamId, 'workspace:write')) return reply;

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
  //
  // A queued instruction belongs to the person who wrote it. Anyone else
  // withdrawing it is deleting a colleague's request out from under them, so
  // that is an administrative act rather than an ordinary one.
  fastify.delete('/api/v1/team-threads/:id/turns/:turnId', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id, turnId } = request.params as { id: string; turnId: string };
    try {
      const { teamId } = teamOfThread(id);
      const standing = standingIn(request, teamId);
      if (!standing.role && !standing.unmanaged) {
        return forbid(reply, 'You are not a member of this team.');
      }

      const existing = teamAgentService.getTurn(turnId);
      if (!existing || existing.teamThreadId !== id) {
        return reply
          .status(404)
          .send({ error: `Turn ${turnId} was not found on this thread.`, code: 'TURN_NOT_FOUND' });
      }
      const isSubmitter = existing.userId === standing.userId;
      const mayOverride = standing.role ? isTeamAdminRole(standing.role) : standing.unmanaged === true;
      if (!isSubmitter && !mayOverride) {
        return forbid(
          reply,
          'Only the member who queued this turn, or a team admin, may withdraw it.'
        );
      }

      const turn = teamAgentService.cancelTurn(id, turnId);
      return reply.send({ turn, queue: teamAgentService.getQueueState(id) });
    } catch (err) {
      return sendTeamAgentError(reply, err);
    }
  });

  // POST /api/v1/team-threads/:id/approvals — answer a parked turn's prompt
  //
  // Its own route rather than a field on the turn, because it is a different
  // act with a different authority: submitting is something any member may do,
  // while deciding whether the agent may go ahead with a destructive action is
  // whatever the thread's policy says it is (DEC-031 § 3). The decision is
  // taken from the session for the same reason the author of a turn is — the
  // whole team reads who approved it.
  fastify.post('/api/v1/team-threads/:id/approvals', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    const body = (request.body as Record<string, unknown> | null) ?? null;
    if (!requireObjectBody(body, reply, 'approval')) return reply;

    try {
      const { teamId } = teamOfThread(id);
      const standing = standingIn(request, teamId);
      if (!standing.userId) {
        return reply
          .status(401)
          .send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
      }
      // Membership is checked here; which members may decide is the policy's
      // question, and the service asks it.
      if (!standing.role && !standing.unmanaged) {
        return forbid(reply, 'You are not a member of this team.');
      }

      const turnId = typeof body!.turnId === 'string' ? body!.turnId.trim() : '';
      if (!turnId) {
        return reply.status(400).send({ error: 'turnId is required.', code: 'INVALID_INPUT' });
      }

      const result = teamAgentService.resolveTurnApproval(
        id,
        turnId,
        standing,
        body!.decision as TeamApprovalDecision,
        body!.comment as string | undefined
      );

      return reply.send({ ...result, queue: teamAgentService.getQueueState(id) });
    } catch (err) {
      return sendTeamAgentError(reply, err);
    }
  });
}
