/**
 * The enterprise governance surface (P10-01).
 *
 * Four routes: read the policy in force, replace the stored one, page through
 * the audit stream, and pull it out in a format a collector understands.
 *
 * Two things are decided here rather than in the services.
 *
 * **Nothing on this path is public.** A policy names what an organization has
 * forbidden and the audit stream records who cleared what — the first is a map
 * of the controls, the second is the evidence they worked. Every route is
 * refused without a session. Authorization stops there deliberately: a fleet
 * policy is installation-wide, so there is no `workspaceId` for `rbacGuard` to
 * resolve a role against, and inventing one would be inventing a scope the
 * domain model does not have. The control that actually protects a managed
 * fleet is `asterim.policy.json`, which no authenticated caller can edit.
 *
 * **A file-governed installation answers 409 on write.** `asterim.policy.json`
 * outranks the table by design; accepting a `PUT` that wrote a row nothing
 * reads would report success for a change that never took effect.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AuthErrorCode } from '@asterim/shared';
import type {
  AuditExportFormat,
  AuditSeverity,
  FleetPolicyConfig
} from '@asterim/shared';
import { auditLogger } from '../services/enterprise/AuditLoggerService';
import {
  FleetPolicyError,
  fleetPolicyService
} from '../services/enterprise/FleetPolicyService';

const EXPORT_FORMATS: AuditExportFormat[] = ['JSONL', 'SYSLOG_RFC5424', 'CSV'];
const SEVERITIES: AuditSeverity[] = ['INFO', 'WARN', 'HIGH', 'CRITICAL'];

/** How a policy failure reads over HTTP. */
const STATUS_BY_CODE: Record<string, number> = {
  INVALID_POLICY: 400,
  POLICY_FILE_ENFORCED: 409,
  POLICY_FILE_UNREADABLE: 500
};

function parseNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseSeverity(value: unknown): AuditSeverity | undefined {
  if (typeof value !== 'string') return undefined;
  const upper = value.toUpperCase();
  return (SEVERITIES as string[]).includes(upper) ? (upper as AuditSeverity) : undefined;
}

export default async function enterpriseRoutes(fastify: FastifyInstance) {
  const requireUser = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (request.user) return true;
    reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    return false;
  };

  // GET /api/v1/enterprise/policy — the rules in force, and where they came from
  fastify.get('/api/v1/enterprise/policy', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    try {
      const policy = fleetPolicyService.getActivePolicy();
      return {
        policy,
        // Surfaced rather than hidden: an operator looking at a locked-down
        // workstation needs to be told the policy is unreadable, because every
        // gate is currently refusing and the rules shown are not the ones in use.
        failure: fleetPolicyService.getPolicyFailure(),
        fileEnforced: fleetPolicyService.isFileEnforced(),
        policyFilePath: fleetPolicyService.getPolicyFilePath(),
        sovereignModeForced: fleetPolicyService.isSovereignModeForced()
      };
    } catch (err) {
      console.error('[Enterprise] Could not read the fleet policy:', err);
      return reply.status(500).send({ error: 'Failed to read the fleet policy' });
    }
  });

  // PUT /api/v1/enterprise/policy — replace the stored policy
  fastify.put('/api/v1/enterprise/policy', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const body = request.body as
      | (Partial<FleetPolicyConfig> & { name?: string; description?: string | null })
      | null;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return reply
        .status(400)
        .send({ error: 'A policy body is required.', code: 'INVALID_POLICY' });
    }

    try {
      const policy = fleetPolicyService.updatePolicy(body);
      return { policy };
    } catch (err) {
      if (err instanceof FleetPolicyError) {
        return reply
          .status(STATUS_BY_CODE[err.code] ?? 400)
          .send({ error: err.message, code: err.code });
      }
      console.error('[Enterprise] Could not update the fleet policy:', err);
      return reply.status(500).send({ error: 'Failed to update the fleet policy' });
    }
  });

  // GET /api/v1/enterprise/audit-logs — page through the recorded stream
  fastify.get('/api/v1/enterprise/audit-logs', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const query = (request.query ?? {}) as Record<string, unknown>;
    try {
      const events = auditLogger.query({
        startTime: parseNumber(query.startTime),
        endTime: parseNumber(query.endTime),
        eventType: typeof query.eventType === 'string' ? query.eventType : undefined,
        minSeverity: parseSeverity(query.minSeverity),
        threadId: typeof query.threadId === 'string' ? query.threadId : undefined,
        userId: typeof query.userId === 'string' ? query.userId : undefined,
        limit: parseNumber(query.limit),
        offset: parseNumber(query.offset)
      });

      return {
        events,
        // The count is over the same time window but before the severity
        // filter, which is what a pager needs and what a filtered count would
        // not give it.
        total: auditLogger.count({
          startTime: parseNumber(query.startTime),
          endTime: parseNumber(query.endTime),
          eventType: typeof query.eventType === 'string' ? query.eventType : undefined
        }),
        limit: parseNumber(query.limit) ?? 100,
        offset: parseNumber(query.offset) ?? 0
      };
    } catch (err) {
      console.error('[Enterprise] Could not read audit events:', err);
      return reply.status(500).send({ error: 'Failed to read audit events' });
    }
  });

  // GET /api/v1/enterprise/audit-logs/export — render for a SIEM collector
  fastify.get('/api/v1/enterprise/audit-logs/export', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const query = (request.query ?? {}) as Record<string, unknown>;
    const requested = typeof query.format === 'string' ? query.format.toUpperCase() : 'JSONL';
    if (!(EXPORT_FORMATS as string[]).includes(requested)) {
      return reply.status(400).send({
        error: `Unsupported export format '${requested}'. Expected one of ${EXPORT_FORMATS.join(', ')}.`,
        code: 'INVALID_FORMAT'
      });
    }
    const format = requested as AuditExportFormat;

    try {
      const body = auditLogger.exportLogs({
        format,
        startTime: parseNumber(query.startTime),
        endTime: parseNumber(query.endTime),
        minSeverity: parseSeverity(query.minSeverity),
        limit: parseNumber(query.limit)
      });

      return reply
        .header('content-type', auditLogger.contentTypeFor(format))
        // Named as a download: a browser that rendered a Syslog stream inline
        // would be the least useful thing to do with it.
        .header(
          'content-disposition',
          `attachment; filename="asterim-audit.${format === 'CSV' ? 'csv' : format === 'SYSLOG_RFC5424' ? 'log' : 'jsonl'}"`
        )
        .send(body);
    } catch (err) {
      console.error('[Enterprise] Could not export audit events:', err);
      return reply.status(500).send({ error: 'Failed to export audit events' });
    }
  });
}
