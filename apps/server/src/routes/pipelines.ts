/**
 * The declarative pipeline REST surface (P9-01).
 *
 * Six routes over `PipelineEngine`: save or validate a definition, list them,
 * read one, start a run, read a run's progress, and stop it.
 *
 * Three things are decided here rather than in the engine.
 *
 * **Whether they may.** A pipeline starts agent sessions that edit a checkout,
 * so nothing here is public and the write routes are authorized against the
 * caller's standing in the workspace that owns the pipeline — never against a
 * `workspaceId` the request supplied for a pipeline that already exists. The
 * one deliberate exception is a workspace with no membership rows at all, which
 * is what a single-developer workstation looks like and must keep working
 * (DEC-028).
 *
 * **`POST /run` waits.** It holds the request open until the run reaches a
 * terminal status, because the thing worth returning is the outcome, and a
 * caller that only wanted the run's id can read it from the `pipeline:*` events
 * on the socket. The cancel route is what makes that bearable: without it the
 * only ways out of a pipeline that has stopped making progress are the steps'
 * own timeouts and killing the Core.
 *
 * **A bad definition is a 400 with a line number.** The parser is the gate, and
 * what it refuses is what an operator has to fix, so its message is passed
 * through rather than replaced with a generic failure.
 */

import { FastifyInstance, FastifyReply } from 'fastify';
import { AuthErrorCode } from '@asterim/shared';
import type { WorkspacePermission } from '@asterim/shared';
import {
  PipelineError,
  PipelineErrorCode,
  pipelineEngine
} from '../services/pipeline/PipelineEngine';
import { PipelineParseError } from '../services/pipeline/PipelineParser';
import { rbacService } from '../services/RbacService';

/** How a pipeline failure reads over HTTP. */
const STATUS_BY_CODE: Record<PipelineErrorCode, number> = {
  INVALID_INPUT: 400,
  PIPELINE_NOT_FOUND: 404,
  RUN_NOT_FOUND: 404,
  PROJECT_NOT_FOUND: 404,
  // The request is permitted and well-formed; the pipeline is simply already
  // doing the thing that was asked for.
  ALREADY_RUNNING: 409,
  // The run kept no worktree fleet — an old run, or a project that is not a
  // repository. Nothing about the request is wrong, so it is a 400 rather than
  // a 404: the run exists, it just has no branches to answer about.
  NO_FLEET: 400,
  RUN_IN_PROGRESS: 409,
  // The state of the repository is what refuses this, not the request.
  SYNTHESIS_CONFLICT: 409
};

function sendPipelineError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof PipelineParseError) {
    return reply.status(400).send({
      error: err.message,
      code: 'INVALID_DEFINITION',
      ...(err.line > 0 ? { line: err.line } : {})
    });
  }
  if (err instanceof PipelineError) {
    return reply.status(STATUS_BY_CODE[err.code]).send({ error: err.message, code: err.code });
  }
  console.error('[Pipelines] Unexpected failure', err);
  return reply.status(500).send({ error: 'Pipeline request failed' });
}

export default async function pipelineRoutes(fastify: FastifyInstance) {
  /** Pipelines run agents against a checkout; none of this is public. */
  const requireUser = (request: { user?: unknown }, reply: FastifyReply): boolean => {
    if (request.user) return true;
    reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    return false;
  };

  const userIdOf = (request: { user?: unknown }): string =>
    (request.user as { sub?: string; userId?: string } | undefined)?.sub ??
    (request.user as { userId?: string } | undefined)?.userId ??
    '';

  /**
   * Refuses unless the caller holds `permission` in the workspace.
   *
   * A pipeline that belongs to no workspace is a workstation-wide one, which is
   * every pipeline on a single-developer install; there is no membership to
   * check and refusing would lock the only user out of their own automation.
   */
  const authorize = (
    request: { user?: unknown },
    reply: FastifyReply,
    workspaceId: string | undefined,
    permission: WorkspacePermission
  ): boolean => {
    if (!workspaceId) return true;

    const role = rbacService.getUserRole(workspaceId, userIdOf(request));
    if (!role) {
      // A workspace with no membership rows predates RBAC on this workstation.
      if (rbacService.getWorkspaceMemberCount(workspaceId) === 0) return true;
      reply
        .status(403)
        .send({ error: 'You are not a member of this workspace.', code: AuthErrorCode.FORBIDDEN });
      return false;
    }
    if (!rbacService.hasPermission(role, permission)) {
      reply.status(403).send({
        error: `Forbidden: '${permission}' is required in this workspace.`,
        code: AuthErrorCode.FORBIDDEN
      });
      return false;
    }
    return true;
  };

  // POST /api/v1/pipelines — save (and thereby validate) a definition
  fastify.post('/api/v1/pipelines', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const body =
      (request.body as {
        id?: string;
        workspaceId?: string;
        yaml?: string;
        definition?: string;
      } | null) || null;

    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return reply
        .status(400)
        .send({ error: 'A pipeline body is required.', code: 'INVALID_INPUT' });
    }

    try {
      // An existing pipeline is governed by the workspace it already belongs
      // to, not by the one the request names.
      const existing = body.id ? pipelineEngine.getPipeline(body.id) : null;
      if (body.id && !existing) {
        return reply
          .status(404)
          .send({ error: `No pipeline with id ${body.id}.`, code: 'PIPELINE_NOT_FOUND' });
      }
      const workspaceId = existing ? existing.workspaceId : body.workspaceId;
      if (!authorize(request, reply, workspaceId, 'workspace:write')) return reply;

      const pipeline = pipelineEngine.savePipeline({
        id: body.id,
        workspaceId: body.workspaceId,
        yaml: body.yaml ?? body.definition ?? ''
      });
      return reply.status(existing ? 200 : 201).send({ pipeline });
    } catch (err) {
      return sendPipelineError(reply, err);
    }
  });

  // GET /api/v1/pipelines — what this workspace can see
  fastify.get('/api/v1/pipelines', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const query = (request.query as { workspaceId?: string } | undefined) ?? {};
    if (!authorize(request, reply, query.workspaceId, 'workspace:read')) return reply;

    try {
      return reply.send({ pipelines: pipelineEngine.listPipelines(query.workspaceId) });
    } catch (err) {
      return sendPipelineError(reply, err);
    }
  });

  // GET /api/v1/pipelines/:id — one definition, parsed
  fastify.get('/api/v1/pipelines/:id', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    try {
      const pipeline = pipelineEngine.requirePipeline(id);
      if (!authorize(request, reply, pipeline.workspaceId, 'workspace:read')) return reply;
      return reply.send({ pipeline, runs: pipelineEngine.listRuns(id) });
    } catch (err) {
      return sendPipelineError(reply, err);
    }
  });

  // POST /api/v1/pipelines/:id/run — execute it, and answer with what it did
  fastify.post('/api/v1/pipelines/:id/run', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    const body = (request.body as { runContext?: unknown; context?: unknown } | null) || null;
    const raw = body?.runContext ?? body?.context;
    const runContext =
      raw !== null && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};

    try {
      const pipeline = pipelineEngine.requirePipeline(id);
      // Running a pipeline starts agent sessions, which is the permission the
      // rest of the Core guards session creation with.
      if (!authorize(request, reply, pipeline.workspaceId, 'agent:spawn')) return reply;

      const run = await pipelineEngine.runPipeline(id, runContext);
      return reply.send({ run });
    } catch (err) {
      return sendPipelineError(reply, err);
    }
  });

  // GET /api/v1/pipeline-runs/:id — a run's status and per-step progress
  fastify.get('/api/v1/pipeline-runs/:id', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    try {
      const run = pipelineEngine.requireRun(id);
      const pipeline = pipelineEngine.getPipeline(run.pipelineId);
      if (!authorize(request, reply, pipeline?.workspaceId, 'workspace:read')) return reply;
      return reply.send({ run });
    } catch (err) {
      return sendPipelineError(reply, err);
    }
  });

  // GET /api/v1/pipeline-runs/:id/conflicts — could this run's branches combine?
  //
  // A read: it merges the run's step branches in a throwaway checkout to find
  // out, and changes nothing in the repository, so `workspace:read` is the bar.
  fastify.get('/api/v1/pipeline-runs/:id/conflicts', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    try {
      const run = pipelineEngine.requireRun(id);
      const pipeline = pipelineEngine.getPipeline(run.pipelineId);
      if (!authorize(request, reply, pipeline?.workspaceId, 'workspace:read')) return reply;

      const analysis = await pipelineEngine.analyzeRunConflicts(id);
      return reply.send({ runId: id, analysis });
    } catch (err) {
      return sendPipelineError(reply, err);
    }
  });

  // POST /api/v1/pipeline-runs/:id/synthesize — consolidate the passing steps
  //
  // Writes: it creates `asterim/pipeline/<runId>/pr` in the project's
  // repository, which is a change to the repository even though it is not a
  // change to the operator's branch or working tree. `workspace:write`, and a
  // conflict comes back as a 409 naming the files rather than as a merge
  // somebody has to undo.
  fastify.post('/api/v1/pipeline-runs/:id/synthesize', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    const body = (request.body as { stepIds?: unknown; message?: unknown } | null) || null;
    const stepIds = Array.isArray(body?.stepIds)
      ? body.stepIds.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim())
      : undefined;
    const message = typeof body?.message === 'string' ? body.message : undefined;

    try {
      const run = pipelineEngine.requireRun(id);
      const pipeline = pipelineEngine.getPipeline(run.pipelineId);
      if (!authorize(request, reply, pipeline?.workspaceId, 'workspace:write')) return reply;

      const synthesis = await pipelineEngine.synthesizeRun(id, { stepIds, message });
      return reply.send({ synthesis, run: pipelineEngine.getRun(id) });
    } catch (err) {
      return sendPipelineError(reply, err);
    }
  });

  // POST /api/v1/pipeline-runs/:id/cancel — stop a run and its running steps
  fastify.post('/api/v1/pipeline-runs/:id/cancel', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    const body = (request.body as { reason?: string } | null) || null;
    const reason = typeof body?.reason === 'string' ? body.reason : undefined;

    try {
      const run = pipelineEngine.requireRun(id);
      const pipeline = pipelineEngine.getPipeline(run.pipelineId);
      if (!authorize(request, reply, pipeline?.workspaceId, 'agent:spawn')) return reply;

      // `false` is not an error: a run that settled a moment before the request
      // landed answers with what it settled as, so an operator clicking Cancel
      // on a pipeline that has just finished is not shown a failure for it.
      const cancelled = await pipelineEngine.cancelPipeline(id, reason);
      return reply.send({ success: true, cancelled, run: pipelineEngine.getRun(id) });
    } catch (err) {
      return sendPipelineError(reply, err);
    }
  });
}
