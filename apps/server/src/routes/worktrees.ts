/**
 * The worktree sandbox REST surface (P8-01).
 *
 * Three things over `GitWorktreeService`, addressed by thread because a thread
 * is what an operator is looking at when they want them: see what a delegated
 * agent changed, keep it, or throw it away.
 *
 * The decision these routes exist to serve is the one at the end of a
 * delegation. A subagent has finished and its work is sitting in a branch nobody
 * has looked at; `GET` is the looking, `POST /merge` is keeping it, and `DELETE`
 * is the other answer. Merging is the only one that touches the operator's real
 * checkout, and it is a `POST` an operator makes deliberately — an agent has no
 * route to it, which is the same rule the rest of the Git subsystem follows
 * (`blueprint/GIT.md`: agents never commit without explicit approval).
 */

import fs from 'fs';
import { FastifyInstance, FastifyReply } from 'fastify';
import { AuthErrorCode, MAX_VERIFICATION_TIMEOUT_MS, isSafeScriptName } from '@asterim/shared';
import { dbService } from '../services/DatabaseService';
import {
  WorktreeError,
  WorktreeErrorCode,
  gitWorktreeService
} from '../services/git/GitWorktreeService';
import { verificationPipelineService } from '../services/verification/VerificationPipelineService';
import {
  loadThreadVerificationReport,
  saveThreadVerificationReport
} from '../services/verification/threadVerificationStore';

/** How a worktree failure reads over HTTP. */
const STATUS_BY_CODE: Record<WorktreeErrorCode, number> = {
  INVALID_INPUT: 400,
  NOT_A_REPOSITORY: 400,
  // The request is well-formed; the repository is not in a state that can
  // answer it.
  NO_COMMITS: 409,
  WORKTREE_NOT_FOUND: 404,
  WORKTREE_EXISTS: 409,
  DIRTY_TARGET: 409,
  TARGET_NOT_CHECKED_OUT: 409,
  MERGE_CONFLICT: 409,
  GIT_FAILED: 500
};

function sendWorktreeError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof WorktreeError) {
    return reply.status(STATUS_BY_CODE[err.code]).send({ error: err.message, code: err.code });
  }
  console.error('[Worktree] Unexpected failure', err);
  return reply.status(500).send({ error: 'Worktree request failed' });
}

interface ThreadWorktreeRow {
  id: string;
  project_id: string;
  worktree_path: string | null;
  worktree_branch: string | null;
  project_path: string | null;
}

/**
 * A thread, its project's directory, and whatever sandbox is recorded for it.
 *
 * One query rather than a service, because this is the only thing in the
 * subsystem that has to cross from a thread id to a repository path — the
 * service itself deals only in paths, the way every other git manager does.
 */
function getThreadWorktreeRow(threadId: string): ThreadWorktreeRow | null {
  try {
    const row = dbService
      .getDb()
      .prepare(
        `SELECT t.id            AS id,
                t.project_id    AS project_id,
                t.worktree_path AS worktree_path,
                t.worktree_branch AS worktree_branch,
                p.path          AS project_path
           FROM threads t
           LEFT JOIN projects p ON p.id = t.project_id
          WHERE t.id = ?`
      )
      .get(threadId) as unknown as ThreadWorktreeRow | undefined;
    return row ?? null;
  } catch (err) {
    console.warn(`[Worktree] Could not read thread ${threadId}: ${(err as Error).message}`);
    return null;
  }
}

/** Forgets a sandbox on the thread row, once it is no longer there. */
function clearThreadWorktree(threadId: string): void {
  try {
    dbService
      .getDb()
      .prepare('UPDATE threads SET worktree_path = NULL, worktree_branch = NULL WHERE id = ?')
      .run(threadId);
  } catch (err) {
    console.warn(
      `[Worktree] Could not clear the sandbox of thread ${threadId}: ${(err as Error).message}`
    );
  }
}

export default async function worktreeRoutes(fastify: FastifyInstance) {
  /** Sandboxes hold source code and merging writes to the repository. */
  const requireUser = (request: { user?: unknown }, reply: FastifyReply): boolean => {
    if (request.user) return true;
    reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    return false;
  };

  /**
   * The thread's repository, or a reply already sent saying why there is none.
   */
  const resolveRepo = (
    threadId: string,
    reply: FastifyReply
  ): { row: ThreadWorktreeRow; repoPath: string } | null => {
    const row = getThreadWorktreeRow(threadId);
    if (!row) {
      reply.status(404).send({ error: `No thread with id ${threadId}.`, code: 'THREAD_NOT_FOUND' });
      return null;
    }
    if (!row.project_path) {
      reply.status(404).send({
        error: `Thread ${threadId} belongs to a project with no directory on this workstation.`,
        code: 'PROJECT_NOT_FOUND'
      });
      return null;
    }
    return { row, repoPath: row.project_path };
  };

  // GET /api/v1/threads/:id/worktree — the sandbox and what it has changed
  fastify.get('/api/v1/threads/:id/worktree', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    const resolved = resolveRepo(id, reply);
    if (!resolved) return reply;

    try {
      const worktree = await gitWorktreeService.getWorktree(resolved.repoPath, id);
      if (!worktree) {
        // Not an error: most threads have never had a sandbox, and a delegation
        // whose sandbox was discarded is a thread in exactly the same position.
        return reply.send({
          threadId: id,
          worktree: null,
          // What the row still claims, so a dashboard can tell "never had one"
          // from "had one and it is gone".
          recordedPath: resolved.row.worktree_path,
          recordedBranch: resolved.row.worktree_branch,
          diff: null
        });
      }

      const diff = await gitWorktreeService.getDiff(worktree.path, worktree.baseCommit);
      return reply.send({ threadId: id, worktree, diff });
    } catch (err) {
      return sendWorktreeError(reply, err);
    }
  });

  // POST /api/v1/threads/:id/worktree/merge — keep the delegated work
  fastify.post('/api/v1/threads/:id/worktree/merge', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    const body = (request.body as { targetBranch?: string; message?: string } | null) || null;
    const targetBranch =
      body && typeof body.targetBranch === 'string' ? body.targetBranch : undefined;
    const message = body && typeof body.message === 'string' ? body.message : undefined;

    const resolved = resolveRepo(id, reply);
    if (!resolved) return reply;

    try {
      const result = await gitWorktreeService.mergeWorktree(
        resolved.repoPath,
        id,
        targetBranch,
        message
      );
      return reply.send({ success: result.merged, result });
    } catch (err) {
      return sendWorktreeError(reply, err);
    }
  });

  // DELETE /api/v1/threads/:id/worktree — discard the delegated work
  fastify.delete('/api/v1/threads/:id/worktree', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    const resolved = resolveRepo(id, reply);
    if (!resolved) return reply;

    try {
      const removed = await gitWorktreeService.removeWorktree(resolved.repoPath, id);
      // Cleared whether or not anything was there to remove: the row's job is to
      // say where the session runs, and after this it runs in the project.
      clearThreadWorktree(id);
      return reply.send({ success: true, removed, threadId: id });
    } catch (err) {
      return sendWorktreeError(reply, err);
    }
  });

  // POST /api/v1/threads/:id/worktree/verify — run the project's own checks
  //
  // The on-demand half of P8-02. A delegation verifies itself as it finishes,
  // but an operator who has since edited the sandbox by hand, or who is looking
  // at a delegation that ran before the pipeline was configured, needs to be
  // able to ask again. Same directory, same pipeline, same report.
  fastify.post('/api/v1/threads/:id/worktree/verify', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    const body = (request.body as { steps?: unknown; timeoutMs?: unknown } | null) || null;

    // Names of steps the project already declares, never commands: this endpoint
    // is authenticated, but "authenticated" is not "may run arbitrary shell on
    // the workstation", and nothing else in the REST surface offers that either.
    let steps: string[] | undefined;
    if (body?.steps !== undefined && body?.steps !== null) {
      if (!Array.isArray(body.steps) || body.steps.some(step => !isSafeScriptName(step))) {
        return reply.status(400).send({
          error: 'steps must be an array of verification step names, e.g. ["typecheck", "test"].',
          code: 'INVALID_INPUT'
        });
      }
      steps = body.steps as string[];
    }

    let timeoutMs: number | undefined;
    if (body?.timeoutMs !== undefined && body?.timeoutMs !== null) {
      const asked = body.timeoutMs;
      if (typeof asked !== 'number' || !Number.isFinite(asked) || asked <= 0) {
        return reply
          .status(400)
          .send({ error: 'timeoutMs must be a positive number.', code: 'INVALID_INPUT' });
      }
      timeoutMs = Math.min(asked, MAX_VERIFICATION_TIMEOUT_MS);
    }

    const resolved = resolveRepo(id, reply);
    if (!resolved) return reply;

    // The sandbox when there still is one on disk, the project when there is
    // not. A thread whose sandbox was merged and discarded is a thread whose
    // work is now in the project, and that is the directory to verify.
    const sandbox = resolved.row.worktree_path;
    const targetDir = sandbox && fs.existsSync(sandbox) ? sandbox : resolved.repoPath;

    try {
      const report = await verificationPipelineService.runPipeline(targetDir, {
        steps,
        timeoutMs,
        configDir: resolved.repoPath
      });
      saveThreadVerificationReport(id, report);
      return reply.send({ threadId: id, sandboxed: targetDir !== resolved.repoPath, report });
    } catch (err) {
      console.error('[Verification] Pipeline run failed', err);
      return reply.status(500).send({ error: 'Verification pipeline failed to run' });
    }
  });

  // GET /api/v1/threads/:id/worktree/verify — the last thing verification said
  fastify.get('/api/v1/threads/:id/worktree/verify', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    const row = getThreadWorktreeRow(id);
    if (!row) {
      return reply.status(404).send({ error: `No thread with id ${id}.`, code: 'THREAD_NOT_FOUND' });
    }

    // Null rather than 404 for a thread that has never been verified: it is a
    // thread in exactly the same position as one that has no sandbox, and a
    // dashboard asking "what do we know about this thread" is owed an answer.
    return reply.send({ threadId: id, report: loadThreadVerificationReport(id) });
  });
}
