/**
 * The desktop daemon REST surface (P10-01).
 *
 * Five endpoints, and the asymmetry between them is the point. `GET /status` is
 * a read a dashboard polls; the four `POST`s each cause something to happen on
 * the developer's physical desktop — a browser window opens, a file manager
 * appears, a toast is shown, an entry is written to the OS login items. That is
 * a side effect on the machine the Core runs on, not on the Core's data, so
 * every one of them requires an authenticated session even though none of them
 * reads or returns anything private.
 *
 * The routes take no path the client chose. `open-dashboard`, `open-data-dir`
 * and `view-log` all launch a target the Core computed for itself; there is no
 * `POST { path }` variant, because that would turn a session into "open
 * anything on this machine with the default handler for its extension".
 */

import { FastifyInstance } from 'fastify';
import type {
  DesktopActionResponse,
  DesktopAutoStartResponse,
  DesktopNotificationInput,
  DesktopNotificationType,
  DesktopNotifyResponse,
  DesktopStatusResponse
} from '@asterim/shared';
import { desktopDaemonService } from '../services/desktop/DesktopDaemonService';
import { desktopNotificationService } from '../services/desktop/DesktopNotificationService';

/** The four kinds a client may ask for; anything else is `SYSTEM`. */
const NOTIFICATION_TYPES: DesktopNotificationType[] = [
  'APPROVAL_REQUIRED',
  'DELEGATION_COMPLETED',
  'PIPELINE_FAILED',
  'SYSTEM'
];

export default async function desktopRoutes(fastify: FastifyInstance) {
  /** Every route here needs a session; none of them is public. */
  const authorize = (request: any, reply: any): boolean => {
    if (!request.user) {
      reply.status(401).send({ error: 'Unauthorized' });
      return false;
    }
    return true;
  };

  fastify.get('/api/v1/desktop/status', async (request, reply) => {
    if (!authorize(request, reply)) return reply;
    try {
      // Refreshed before the synchronous read so `autoStartEnabled` is the
      // registry's or the filesystem's answer rather than the cached one.
      await desktopDaemonService.getAutoStart();
      const body: DesktopStatusResponse = {
        desktop: desktopDaemonService.getStatus(),
        menu: desktopDaemonService.getTrayMenu()
      };
      return reply.send(body);
    } catch (err) {
      console.error('[DesktopRoute] Could not assemble desktop status:', err);
      return reply.status(500).send({ error: 'Failed to read desktop status' });
    }
  });

  fastify.post('/api/v1/desktop/open-dashboard', async (request, reply) => {
    if (!authorize(request, reply)) return reply;
    const success = await desktopDaemonService.openDashboard();
    const body: DesktopActionResponse = success
      ? { success: true }
      : { success: false, reason: `no browser launcher on ${desktopDaemonService.getPlatform()}` };
    return reply.send(body);
  });

  fastify.post('/api/v1/desktop/open-data-dir', async (request, reply) => {
    if (!authorize(request, reply)) return reply;
    const success = await desktopDaemonService.openDataDirectory();
    const body: DesktopActionResponse = success
      ? { success: true }
      : {
          success: false,
          reason: `no file manager launcher on ${desktopDaemonService.getPlatform()}`
        };
    return reply.send(body);
  });

  fastify.post('/api/v1/desktop/open-log', async (request, reply) => {
    if (!authorize(request, reply)) return reply;
    const success = await desktopDaemonService.openLogFile();
    const body: DesktopActionResponse = success
      ? { success: true }
      : { success: false, reason: 'the server log could not be opened' };
    return reply.send(body);
  });

  fastify.post('/api/v1/desktop/notify', async (request, reply) => {
    if (!authorize(request, reply)) return reply;

    const { title, body, type, actionUrl } = (request.body ?? {}) as Partial<
      Record<keyof DesktopNotificationInput, unknown>
    >;
    if (typeof title !== 'string' || title.trim().length === 0) {
      return reply.status(400).send({ error: 'title is required' });
    }
    if (body !== undefined && typeof body !== 'string') {
      return reply.status(400).send({ error: 'body must be a string' });
    }
    if (actionUrl !== undefined && typeof actionUrl !== 'string') {
      return reply.status(400).send({ error: 'actionUrl must be a string' });
    }

    const result = await desktopNotificationService.dispatch({
      title,
      body: typeof body === 'string' ? body : '',
      type: NOTIFICATION_TYPES.includes(type as DesktopNotificationType)
        ? (type as DesktopNotificationType)
        : 'SYSTEM',
      actionUrl: typeof actionUrl === 'string' ? actionUrl : undefined
    });

    // 200 with `dispatched: false` rather than an error status: a headless host
    // skipping a toast is the designed behaviour, not a failed request.
    const payload: DesktopNotifyResponse = {
      success: result.dispatched || result.skipped === 'HEADLESS',
      dispatched: result.dispatched,
      skipped: result.skipped,
      reason: result.reason
    };
    return reply.send(payload);
  });

  fastify.post('/api/v1/desktop/autostart', async (request, reply) => {
    if (!authorize(request, reply)) return reply;

    const { enabled } = (request.body ?? {}) as { enabled?: unknown };
    if (typeof enabled !== 'boolean') {
      return reply.status(400).send({ error: 'enabled must be a boolean' });
    }

    const actual = await desktopDaemonService.setAutoStart(enabled);
    const body: DesktopAutoStartResponse = {
      // The requested state was reached, or it was not — a platform with no
      // auto-start mechanism answers `false` to `true` and says why.
      success: actual === enabled,
      enabled: actual,
      entryPath: desktopDaemonService.autoStartEntryPath(),
      reason:
        actual === enabled
          ? undefined
          : `auto-start is not available on ${desktopDaemonService.getPlatform()}`
    };
    return reply.send(body);
  });
}
