import { FastifyInstance } from 'fastify';
import type { AsterimEvent } from '@asterim/shared';
import { eventBus } from '../services/EventBus';
import { serverRegistry } from '../services/ServerRegistry';

/** Header carrying the loopback token issued in `server.json`. */
export const LOOPBACK_TOKEN_HEADER = 'x-asterim-loopback-token';

/**
 * True for addresses that can only be reached from this machine.
 *
 * The server binds `::`, so without this check the internal endpoint would be
 * reachable from the LAN with nothing but a guessed token in front of it. The
 * token is the credential; this is the reason an attacker never gets to guess.
 */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  // Node reports IPv4-mapped IPv6 for dual-stack sockets.
  const normalized = address.startsWith('::ffff:') ? address.slice(7) : address;
  return normalized === '127.0.0.1' || normalized === '::1' || normalized.startsWith('127.');
}

/**
 * Accepts an event only if it is a memory event from a local process.
 *
 * This endpoint publishes straight onto the EventBus, which fans out to every
 * connected browser and into the events table. Anything that is not a
 * well-formed `memory.*` event carrying a projectId is refused rather than
 * relayed: an unfiltered relay would let a local process inject arbitrary event
 * types into every client's stream.
 */
export function validateRelayedEvent(body: unknown): { ok: true; event: AsterimEvent<any> } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Body must be an event object' };
  }

  const event = body as Partial<AsterimEvent<any>>;

  if (typeof event.type !== 'string' || !event.type.startsWith('memory.')) {
    return { ok: false, error: "Only 'memory.*' events may be relayed" };
  }
  if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
    return { ok: false, error: 'Event payload must be an object' };
  }
  if (typeof (event.payload as { projectId?: unknown }).projectId !== 'string') {
    return { ok: false, error: 'Event payload must carry a projectId' };
  }

  return {
    ok: true,
    event: {
      id: typeof event.id === 'string' && event.id ? event.id : crypto.randomUUID(),
      timestamp: typeof event.timestamp === 'number' ? event.timestamp : Date.now(),
      // Overwritten deliberately: the relay is the origin as far as this process
      // is concerned, and a caller should not get to claim it is something else.
      source: 'relay:mcp',
      type: event.type,
      payload: event.payload
    } as AsterimEvent<any>
  };
}

/**
 * Loopback-only endpoints used by other Asterim processes on this machine.
 *
 * Not part of the public API surface. See DEC-026 and
 * blueprint/audit/MISSING_SPECIFICATION.md § 4.
 */
export default async function internalRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/v1/internal/memory-events
   *
   * The MCP memory server writes to SQLite in its own process; this is how that
   * write reaches this process's EventBus and, through it, connected browsers.
   */
  fastify.post('/api/v1/internal/memory-events', async (request: any, reply) => {
    if (!isLoopbackAddress(request.ip)) {
      reply.code(403);
      return { error: 'Internal endpoints are reachable from this machine only' };
    }

    if (!serverRegistry.isAuthorized(request.headers[LOOPBACK_TOKEN_HEADER])) {
      reply.code(401);
      return { error: 'Invalid loopback token' };
    }

    const validated = validateRelayedEvent(request.body);
    if (!validated.ok) {
      reply.code(400);
      return { error: validated.error };
    }

    eventBus.publish(validated.event);
    return { ok: true };
  });
}
