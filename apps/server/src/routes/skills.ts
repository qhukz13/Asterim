/**
 * The Skills Explorer's read-only view of the skills library (P6-06).
 *
 * Two routes, both GET: nothing here creates, edits or runs a skill. A skill is
 * a file the developer owns in their own repository, and the dashboard is a
 * window onto it.
 *
 * `workspacePath` is the one parameter worth being careful about. Left
 * unchecked it would turn an authenticated request into "read the SKILL.md of
 * every directory under any path on this machine", so it is resolved against
 * the projects the Core already knows about; a path that is not one of them is
 * refused rather than scanned.
 */

import { FastifyInstance, FastifyReply } from 'fastify';
import path from 'path';
import { AuthErrorCode } from '@asterim/shared';
import { skillService } from '../services/skills/SkillService';
import { dbService } from '../services/DatabaseService';

/** True when `candidate` is a project this Core has been told about. */
export function isRegisteredProjectPath(candidate: string, projectPaths: string[]): boolean {
  const wanted = path.resolve(candidate);
  return projectPaths.some(projectPath => path.resolve(projectPath) === wanted);
}

/** Every project path on record. An unreadable database means no paths, not a 500. */
function registeredProjectPaths(): string[] {
  try {
    const rows = dbService.getDb().prepare('SELECT path FROM projects').all() as Array<{
      path?: string | null;
    }>;
    return rows.map(row => row.path).filter((value): value is string => !!value);
  } catch (err) {
    console.error('[Skills] Could not read project paths:', err);
    return [];
  }
}

export default async function skillRoutes(fastify: FastifyInstance) {
  /** Every route here is account-scoped; none of them is public. */
  const requireUser = (request: { user?: unknown }, reply: FastifyReply): boolean => {
    if (request.user) return true;
    reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    return false;
  };

  /**
   * Resolves the optional workspace filter.
   *
   * Returns `undefined` for "no filter" and `null` for "refused", which the
   * callers turn into a 400 — the two cases must not collapse, or an
   * unauthorised path would silently be answered with the global skills.
   */
  const resolveWorkspacePath = (raw: unknown): string | undefined | null => {
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw !== 'string') return null;
    return isRegisteredProjectPath(raw, registeredProjectPaths()) ? path.resolve(raw) : null;
  };

  const refuseWorkspacePath = (reply: FastifyReply): FastifyReply =>
    reply.status(400).send({
      error: 'workspacePath must be the path of a project registered with this workstation.',
      code: 'INVALID_WORKSPACE_PATH'
    });

  // GET /api/v1/skills — the library, optionally including one project's own
  fastify.get('/api/v1/skills', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { workspacePath } = (request.query as { workspacePath?: string }) || {};
    const resolved = resolveWorkspacePath(workspacePath);
    if (resolved === null) return refuseWorkspacePath(reply);

    try {
      return reply.send({ skills: skillService.discoverSkills(resolved) });
    } catch (err) {
      console.error('[Skills] Discovery failed:', err);
      return reply.status(500).send({ error: 'Skill discovery failed' });
    }
  });

  // GET /api/v1/skills/:name — one skill, with its full markdown instructions
  fastify.get('/api/v1/skills/:name', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { name } = request.params as { name: string };
    const { workspacePath } = (request.query as { workspacePath?: string }) || {};
    const resolved = resolveWorkspacePath(workspacePath);
    if (resolved === null) return refuseWorkspacePath(reply);

    try {
      const skill = skillService.getSkill(name, resolved);
      if (!skill) {
        return reply
          .status(404)
          .send({ error: `No skill named '${name}' was found.`, code: 'NOT_FOUND' });
      }
      return reply.send({ skill });
    } catch (err) {
      console.error(`[Skills] Could not read '${name}':`, err);
      return reply.status(500).send({ error: 'Reading the skill failed' });
    }
  });
}
