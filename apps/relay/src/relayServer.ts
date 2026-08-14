import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { Server as SocketIOServer, Socket } from 'socket.io';
import crypto from 'crypto';

/**
 * The Cloud Relay is a blind forwarder. Everything it routes is E2E encrypted
 * between the workstation and the mobile client (DEC-028), so this process
 * never decrypts, inspects, or persists a payload — it only decides who is
 * allowed to open a tunnel, who may join one, and when a tunnel is dead.
 */

export const RELAY_VERSION = '0.1.0';

/** Registration payload. A bare string is the pre-authentication form. */
export interface TunnelRegistration {
  tunnelId: string;
  signature?: string;
  timestamp?: number;
}
export type RegisterTunnelPayload = string | TunnelRegistration;

export type RelayErrorCode =
  'AUTH_FAILED' | 'RATE_LIMITED' | 'INVALID_TUNNEL' | 'TUNNEL_NOT_FOUND' | 'NOT_IN_TUNNEL';

export interface RelayConfig {
  /** Shared secret. When absent the relay runs open, for local development. */
  secret?: string;
  /** Concurrent sockets allowed from one address. */
  maxConnectionsPerIp: number;
  /** `register_tunnel` + `join_tunnel` events allowed per address per window. */
  maxEventsPerMinute: number;
  /** How far a registration timestamp may drift from relay time. */
  timestampToleranceMs: number;
  /** Silence after which a tunnel is reaped. */
  idleTunnelMs: number;
  /** How often the reaper runs. */
  reapIntervalMs: number;
  now: () => number;
}

export const RELAY_DEFAULTS: Omit<RelayConfig, 'secret'> = {
  maxConnectionsPerIp: 50,
  maxEventsPerMinute: 20,
  timestampToleranceMs: 5 * 60 * 1000,
  idleTunnelMs: 15 * 60 * 1000,
  reapIntervalMs: 60 * 1000,
  now: () => Date.now()
};

export interface RelayMetrics {
  totalConnections: number;
  activeConnections: number;
  totalTunnelsCreated: number;
  activeTunnels: number;
  messagesForwarded: number;
  authRejections: number;
  rateLimitRejections: number;
  tunnelsReaped: number;
}

interface TunnelRecord {
  hostSocketId: string;
  createdAt: number;
  lastActivityAt: number;
}

export type RegistrationVerdict =
  { ok: true; tunnelId: string } | { ok: false; code: RelayErrorCode; message: string };

/** Tunnel ids are room names and map keys; keep them short and inert. */
const TUNNEL_ID = /^[A-Za-z0-9_.-]{1,64}$/;

/** `HMAC-SHA256(tunnelId + ":" + timestamp, secret)`, hex encoded. */
export function signTunnelRegistration(
  tunnelId: string,
  timestamp: number,
  secret: string
): string {
  return crypto.createHmac('sha256', secret).update(`${tunnelId}:${timestamp}`).digest('hex');
}

/**
 * Decides whether a registration may open a tunnel.
 *
 * With no secret configured the relay is in development mode and accepts the
 * legacy bare-string payload. With a secret, a registration must carry a fresh
 * timestamp and a matching signature; freshness is what stops a captured
 * registration from being replayed later.
 */
export function authorizeRegistration(
  payload: RegisterTunnelPayload,
  options: { secret?: string; now: number; timestampToleranceMs: number }
): RegistrationVerdict {
  const registration: TunnelRegistration =
    typeof payload === 'string' ? { tunnelId: payload } : payload || ({} as TunnelRegistration);
  const tunnelId = typeof registration.tunnelId === 'string' ? registration.tunnelId.trim() : '';

  if (!TUNNEL_ID.test(tunnelId)) {
    return {
      ok: false,
      code: 'INVALID_TUNNEL',
      message: 'Tunnel id must be 1-64 characters of A-Z, a-z, 0-9, dot, dash or underscore.'
    };
  }

  if (!options.secret) {
    return { ok: true, tunnelId };
  }

  const { signature, timestamp } = registration;
  if (
    typeof signature !== 'string' ||
    typeof timestamp !== 'number' ||
    !Number.isFinite(timestamp)
  ) {
    return {
      ok: false,
      code: 'AUTH_FAILED',
      message: 'This relay requires a signed registration.'
    };
  }

  if (Math.abs(options.now - timestamp) > options.timestampToleranceMs) {
    return {
      ok: false,
      code: 'AUTH_FAILED',
      message: 'Registration timestamp is outside the accepted window.'
    };
  }

  const expected = Buffer.from(signTunnelRegistration(tunnelId, timestamp, options.secret), 'utf8');
  const provided = Buffer.from(signature, 'utf8');
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return { ok: false, code: 'AUTH_FAILED', message: 'Registration signature does not match.' };
  }

  return { ok: true, tunnelId };
}

/** Counts events per key inside a rolling window. */
class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number
  ) {}

  allow(key: string): boolean {
    const cutoff = this.now() - this.windowMs;
    const recent = (this.hits.get(key) || []).filter(t => t > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(this.now());
    this.hits.set(key, recent);
    return true;
  }

  /** Drops keys whose window has emptied, so an address scan cannot grow this. */
  prune(): void {
    const cutoff = this.now() - this.windowMs;
    for (const [key, times] of this.hits.entries()) {
      const recent = times.filter(t => t > cutoff);
      if (recent.length === 0) this.hits.delete(key);
      else this.hits.set(key, recent);
    }
  }
}

/** `::ffff:127.0.0.1` and `127.0.0.1` are the same address for our purposes. */
function normalizeAddress(address: string | undefined): string {
  if (!address) return 'unknown';
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

export interface RelayServer {
  fastify: FastifyInstance;
  io: SocketIOServer;
  /** Starts listening. Returns the bound port (useful when port is 0). */
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
  /** Runs the idle sweep immediately; the interval calls the same code. */
  reapNow(): number;
  metrics(): RelayMetrics;
  authMode(): 'hmac_enabled' | 'development_open';
}

export function createRelayServer(config: Partial<RelayConfig> = {}): RelayServer {
  const cfg: RelayConfig = { ...RELAY_DEFAULTS, ...config };
  const startedAt = cfg.now();

  const fastify = Fastify({ logger: false });
  fastify.register(cors, { origin: '*' });

  const io = new SocketIOServer(fastify.server, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  const tunnels = new Map<string, TunnelRecord>();
  const connectionsPerIp = new Map<string, number>();
  const eventLimiter = new SlidingWindowLimiter(cfg.maxEventsPerMinute, 60_000, cfg.now);

  const counters = {
    totalConnections: 0,
    totalTunnelsCreated: 0,
    messagesForwarded: 0,
    authRejections: 0,
    rateLimitRejections: 0,
    tunnelsReaped: 0
  };

  const authMode = () => (cfg.secret ? ('hmac_enabled' as const) : ('development_open' as const));
  const metrics = (): RelayMetrics => ({
    ...counters,
    activeConnections: io.sockets.sockets.size,
    activeTunnels: tunnels.size
  });

  if (!cfg.secret) {
    console.warn(
      '[Relay] RELAY_SECRET is not set — running in development mode. Any client may register any tunnel. Do not deploy this way.'
    );
  }

  const fail = (socket: Socket, code: RelayErrorCode, message: string) => {
    socket.emit('tunnel_error', { code, message });
  };

  io.on('connection', (socket: Socket) => {
    const address = normalizeAddress(socket.handshake.address);
    const active = connectionsPerIp.get(address) || 0;

    if (active >= cfg.maxConnectionsPerIp) {
      counters.rateLimitRejections++;
      console.warn(`[Relay] Refused connection from ${address}: ${active} already open`);
      fail(socket, 'RATE_LIMITED', 'Too many concurrent connections from this address.');
      // Closed on the next tick so the reason reaches the client instead of
      // being dropped with the transport. No handlers are bound to this socket,
      // so it can do nothing in the meantime.
      setImmediate(() => socket.disconnect(true));
      return;
    }

    connectionsPerIp.set(address, active + 1);
    counters.totalConnections++;
    console.log(`[Relay] Client connected: ${socket.id}`);

    /** True when the address still has budget; emits and counts when it does not. */
    const withinEventBudget = (): boolean => {
      if (eventLimiter.allow(address)) return true;
      counters.rateLimitRejections++;
      fail(
        socket,
        'RATE_LIMITED',
        'Too many tunnel requests from this address. Try again shortly.'
      );
      return false;
    };

    // A workstation opens a tunnel.
    socket.on('register_tunnel', (payload: RegisterTunnelPayload) => {
      if (!withinEventBudget()) return;

      const verdict = authorizeRegistration(payload, {
        secret: cfg.secret,
        now: cfg.now(),
        timestampToleranceMs: cfg.timestampToleranceMs
      });

      if (!verdict.ok) {
        if (verdict.code === 'AUTH_FAILED') counters.authRejections++;
        // The tunnel id is not logged: it is the pairing secret a mobile client
        // needs to join.
        console.warn(`[Relay] Rejected registration from ${address}: ${verdict.code}`);
        fail(socket, verdict.code, verdict.message);
        return;
      }

      const now = cfg.now();
      const existing = tunnels.get(verdict.tunnelId);
      tunnels.set(verdict.tunnelId, {
        hostSocketId: socket.id,
        createdAt: existing?.createdAt ?? now,
        lastActivityAt: now
      });
      if (!existing) counters.totalTunnelsCreated++;

      socket.join(`tunnel_${verdict.tunnelId}`);
      console.log(`[Relay] Registered a tunnel for socket ${socket.id}`);
      socket.emit('tunnel_registered', { success: true });
    });

    // A mobile client joins an open tunnel.
    socket.on('join_tunnel', (tunnelId: string) => {
      if (!withinEventBudget()) return;

      const record = typeof tunnelId === 'string' ? tunnels.get(tunnelId) : undefined;
      if (!record) {
        fail(socket, 'TUNNEL_NOT_FOUND', 'Tunnel not found or local server disconnected');
        return;
      }

      socket.join(`tunnel_${tunnelId}`);
      record.lastActivityAt = cfg.now();
      console.log(`[Relay] Client ${socket.id} joined a tunnel`);
      io.to(record.hostSocketId).emit('client_joined', { clientId: socket.id });
    });

    // The forwarding path. The payload is opaque ciphertext and is passed
    // through untouched — never parsed, never logged.
    socket.on('tunnel_message', ({ tunnelId, payload }: { tunnelId: string; payload: unknown }) => {
      const room = `tunnel_${tunnelId}`;
      if (!socket.rooms.has(room)) {
        fail(socket, 'NOT_IN_TUNNEL', 'Join the tunnel before sending to it.');
        return;
      }

      const record = tunnels.get(tunnelId);
      if (record) record.lastActivityAt = cfg.now();

      counters.messagesForwarded++;
      socket.to(room).emit('tunnel_message', payload);
    });

    socket.on('disconnect', () => {
      const remaining = (connectionsPerIp.get(address) || 1) - 1;
      if (remaining > 0) connectionsPerIp.set(address, remaining);
      else connectionsPerIp.delete(address);

      console.log(`[Relay] Client disconnected: ${socket.id}`);

      // A socket may host more than one tunnel; close every one of them.
      for (const [tunnelId, record] of tunnels.entries()) {
        if (record.hostSocketId === socket.id) {
          tunnels.delete(tunnelId);
          io.to(`tunnel_${tunnelId}`).emit('tunnel_closed');
        }
      }
    });
  });

  /** Closes tunnels whose host is gone or that have been silent too long. */
  const reapNow = (): number => {
    const now = cfg.now();
    let reaped = 0;

    for (const [tunnelId, record] of tunnels.entries()) {
      const hostGone = !io.sockets.sockets.has(record.hostSocketId);
      const idle = now - record.lastActivityAt > cfg.idleTunnelMs;
      if (hostGone || idle) {
        tunnels.delete(tunnelId);
        io.to(`tunnel_${tunnelId}`).emit('tunnel_closed');
        reaped++;
      }
    }

    eventLimiter.prune();
    if (reaped > 0) {
      counters.tunnelsReaped += reaped;
      console.log(`[Relay] Reaped ${reaped} idle tunnel(s)`);
    }
    return reaped;
  };

  const reaper = setInterval(reapNow, cfg.reapIntervalMs);
  // Never keep the process alive on the reaper's account.
  reaper.unref?.();

  fastify.get('/health', async () => ({
    status: 'ok',
    service: 'asterim-relay',
    version: RELAY_VERSION,
    uptime: (cfg.now() - startedAt) / 1000,
    activeTunnels: tunnels.size,
    connectedSockets: io.sockets.sockets.size,
    authMode: authMode()
  }));

  // Counters only. A tunnel id is a join credential and never appears here.
  fastify.get('/metrics', async () => ({
    service: 'asterim-relay',
    version: RELAY_VERSION,
    uptime: (cfg.now() - startedAt) / 1000,
    ...metrics()
  }));

  return {
    fastify,
    io,
    async listen(port: number, host = '0.0.0.0'): Promise<number> {
      await fastify.listen({ port, host });
      const address = fastify.server.address();
      return typeof address === 'object' && address ? address.port : port;
    },
    async close(): Promise<void> {
      clearInterval(reaper);
      await io.close();
      await fastify.close();
    },
    reapNow,
    metrics,
    authMode
  };
}
