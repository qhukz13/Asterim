/**
 * Tests for the hardened Cloud Relay (P5.6-03).
 *
 * The relay is a blind forwarder, so almost nothing here can be asserted by
 * inspecting a payload — what matters is who gets to open a tunnel, who is let
 * into one, what crosses between two tunnels (nothing), and what happens when a
 * host goes away. Every case therefore runs against a real relay listening on an
 * ephemeral port with real socket.io clients; only the clock is injected, so the
 * fifteen-minute idle sweep can be exercised in a millisecond.
 *
 * Run:  pnpm --filter @asterim/relay exec tsx src/__tests__/relay.test.ts
 */

import { io as connect, Socket } from 'socket.io-client';
import {
  createRelayServer,
  authorizeRegistration,
  signTunnelRegistration,
  RelayServer
} from '../relayServer';

// --- Assertion harness ---

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(
    label,
    ok,
    ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

function describe(name: string): void {
  console.log(`\n${name}`);
}

const SECRET = 'relay-test-secret';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Every socket opened by the suite, closed in the cleanup pass. */
const openSockets: Socket[] = [];

function client(port: number): Socket {
  const socket = connect(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    reconnection: false
  });
  openSockets.push(socket);
  return socket;
}

/** Resolves with the first `event` payload, or null if it never arrives. */
function once<T = unknown>(socket: Socket, event: string, timeoutMs = 1500): Promise<T | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(null);
    }, timeoutMs);
    const handler = (payload: T) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.once(event, handler);
  });
}

async function connected(socket: Socket): Promise<boolean> {
  if (socket.connected) return true;
  const result = await new Promise<boolean>(resolve => {
    const timer = setTimeout(() => resolve(false), 2000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(true);
    });
    socket.once('connect_error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
  return result;
}

/** A host socket with an open tunnel, ready to exchange messages. */
async function openTunnel(port: number, tunnelId: string, secret?: string): Promise<Socket> {
  const host = client(port);
  await connected(host);
  const timestamp = Date.now();
  host.emit(
    'register_tunnel',
    secret
      ? { tunnelId, timestamp, signature: signTunnelRegistration(tunnelId, timestamp, secret) }
      : tunnelId
  );
  await once(host, 'tunnel_registered');
  return host;
}

async function get(port: number, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return res.json();
}

async function main(): Promise<void> {
  // --- The authorisation decision, without a socket in sight ----------------
  describe('authorizeRegistration');
  {
    const now = 1_700_000_000_000;
    const opts = { secret: SECRET, now, timestampToleranceMs: 5 * 60 * 1000 };

    const good = authorizeRegistration(
      {
        tunnelId: 'ABC123',
        timestamp: now,
        signature: signTunnelRegistration('ABC123', now, SECRET)
      },
      opts
    );
    equal('a correctly signed registration is accepted', good, { ok: true, tunnelId: 'ABC123' });

    const wrongSig = authorizeRegistration(
      { tunnelId: 'ABC123', timestamp: now, signature: 'f'.repeat(64) },
      opts
    );
    equal(
      'a wrong signature is AUTH_FAILED',
      wrongSig.ok === false && wrongSig.code,
      'AUTH_FAILED'
    );

    const shortSig = authorizeRegistration(
      { tunnelId: 'ABC123', timestamp: now, signature: 'abc' },
      opts
    );
    check('a truncated signature is rejected without throwing', shortSig.ok === false);

    const otherSecret = authorizeRegistration(
      {
        tunnelId: 'ABC123',
        timestamp: now,
        signature: signTunnelRegistration('ABC123', now, 'other')
      },
      opts
    );
    check('a signature from another secret is rejected', otherSecret.ok === false);

    const otherTunnel = authorizeRegistration(
      {
        tunnelId: 'OTHER1',
        timestamp: now,
        signature: signTunnelRegistration('ABC123', now, SECRET)
      },
      opts
    );
    check('a signature bound to a different tunnel is rejected', otherTunnel.ok === false);

    const stale = authorizeRegistration(
      {
        tunnelId: 'ABC123',
        timestamp: now - 6 * 60 * 1000,
        signature: signTunnelRegistration('ABC123', now - 6 * 60 * 1000, SECRET)
      },
      opts
    );
    equal(
      'a replayed registration is refused on freshness',
      stale.ok === false && stale.code,
      'AUTH_FAILED'
    );

    const future = authorizeRegistration(
      {
        tunnelId: 'ABC123',
        timestamp: now + 6 * 60 * 1000,
        signature: signTunnelRegistration('ABC123', now + 6 * 60 * 1000, SECRET)
      },
      opts
    );
    check('and so is one from too far in the future', future.ok === false);

    const withinDrift = authorizeRegistration(
      {
        tunnelId: 'ABC123',
        timestamp: now - 4 * 60 * 1000,
        signature: signTunnelRegistration('ABC123', now - 4 * 60 * 1000, SECRET)
      },
      opts
    );
    check('clock drift inside the window is tolerated', withinDrift.ok === true);

    const bare = authorizeRegistration('ABC123', opts);
    equal(
      'an unsigned registration is refused when a secret is set',
      bare.ok === false && bare.code,
      'AUTH_FAILED'
    );

    const open = authorizeRegistration('ABC123', { now, timestampToleranceMs: 1000 });
    equal('but accepted when no secret is configured', open, { ok: true, tunnelId: 'ABC123' });

    for (const bad of ['', '   ', 'a'.repeat(65), 'has spaces', 'semi;colon', '../escape']) {
      const verdict = authorizeRegistration(bad, { now, timestampToleranceMs: 1000 });
      check(
        `an unusable tunnel id is rejected: ${JSON.stringify(bad)}`,
        verdict.ok === false && verdict.code === 'INVALID_TUNNEL'
      );
    }
    const missing = authorizeRegistration({} as never, { now, timestampToleranceMs: 1000 });
    check('as is a payload with no tunnel id at all', missing.ok === false);
  }

  // --- Development mode ------------------------------------------------------
  describe('a relay with no secret');
  {
    const relay = createRelayServer({});
    const port = await relay.listen(0, '127.0.0.1');
    try {
      const host = client(port);
      await connected(host);
      host.emit('register_tunnel', 'DEV001');
      const registered = await once(host, 'tunnel_registered');
      equal('accepts a bare tunnel id', registered, { success: true });

      const health = await get(port, '/health');
      equal('and says so on /health', health.authMode, 'development_open');
      equal('which counts the open tunnel', health.activeTunnels, 1);
    } finally {
      await relay.close();
    }
  }

  // --- Signed registration over a real socket --------------------------------
  describe('a relay with a secret');
  let relay: RelayServer;
  let port: number;
  {
    relay = createRelayServer({ secret: SECRET, maxConnectionsPerIp: 40, maxEventsPerMinute: 200 });
    port = await relay.listen(0, '127.0.0.1');

    const host = client(port);
    await connected(host);
    const timestamp = Date.now();
    host.emit('register_tunnel', {
      tunnelId: 'SIGNED',
      timestamp,
      signature: signTunnelRegistration('SIGNED', timestamp, SECRET)
    });
    equal('a signed registration opens the tunnel', await once(host, 'tunnel_registered'), {
      success: true
    });

    const impostor = client(port);
    await connected(impostor);
    impostor.emit('register_tunnel', {
      tunnelId: 'HIJACK',
      timestamp: Date.now(),
      signature: 'deadbeef'
    });
    const rejected = await once<{ code: string }>(impostor, 'tunnel_error');
    equal('an unsigned impostor is refused', rejected?.code, 'AUTH_FAILED');

    impostor.emit('register_tunnel', 'HIJACK');
    const bareRejected = await once<{ code: string }>(impostor, 'tunnel_error');
    equal('so is the legacy bare-string form', bareRejected?.code, 'AUTH_FAILED');

    const stale = Date.now() - 10 * 60 * 1000;
    impostor.emit('register_tunnel', {
      tunnelId: 'HIJACK',
      timestamp: stale,
      signature: signTunnelRegistration('HIJACK', stale, SECRET)
    });
    const staleRejected = await once<{ code: string }>(impostor, 'tunnel_error');
    equal('and a correctly signed but stale one', staleRejected?.code, 'AUTH_FAILED');

    check('the rejections are counted', relay.metrics().authRejections >= 3);
    equal('and no tunnel was opened for them', relay.metrics().activeTunnels, 1);
  }

  // --- Joining ---------------------------------------------------------------
  describe('joining a tunnel');
  {
    const host = await openTunnel(port, 'JOIN01', SECRET);
    const joined = once<{ clientId: string }>(host, 'client_joined');

    const mobile = client(port);
    await connected(mobile);
    mobile.emit('join_tunnel', 'JOIN01');
    const notice = await joined;
    check('the host is told a client arrived', Boolean(notice?.clientId));

    const stranger = client(port);
    await connected(stranger);
    stranger.emit('join_tunnel', 'NOSUCH');
    const err = await once<{ code: string; message: string }>(stranger, 'tunnel_error');
    equal('joining a tunnel that does not exist fails', err?.code, 'TUNNEL_NOT_FOUND');
    check(
      'with the message the existing clients expect',
      (err?.message || '').includes('Tunnel not found')
    );
  }

  // --- Forwarding ------------------------------------------------------------
  describe('forwarding');
  {
    const host = await openTunnel(port, 'FWD001', SECRET);
    const mobile = client(port);
    await connected(mobile);
    mobile.emit('join_tunnel', 'FWD001');
    await once(host, 'client_joined');

    // Opaque to the relay: it is E2E ciphertext in production.
    const ciphertext = { type: 'encrypted_payload', encrypted: 'YmFzZTY0LWNpcGhlcnRleHQ=' };
    const atHost = once(host, 'tunnel_message');
    mobile.emit('tunnel_message', { tunnelId: 'FWD001', payload: ciphertext });
    equal('a client payload reaches the host byte for byte', await atHost, ciphertext);

    const atMobile = once(mobile, 'tunnel_message');
    host.emit('tunnel_message', { tunnelId: 'FWD001', payload: { hello: 'back' } });
    equal('and the reply reaches the client', await atMobile, { hello: 'back' });

    const echo = await once(mobile, 'tunnel_message', 300);
    equal('the sender is not echoed its own message', echo, null);
  }

  describe('tunnel isolation');
  {
    const hostA = await openTunnel(port, 'ISOL_A', SECRET);
    const hostB = await openTunnel(port, 'ISOL_B', SECRET);

    const mobileA = client(port);
    await connected(mobileA);
    mobileA.emit('join_tunnel', 'ISOL_A');
    await once(hostA, 'client_joined');

    const leaked = once(hostB, 'tunnel_message', 400);
    const delivered = once(hostA, 'tunnel_message');
    mobileA.emit('tunnel_message', { tunnelId: 'ISOL_A', payload: { secret: 'for A only' } });

    equal('the message reaches its own tunnel', await delivered, { secret: 'for A only' });
    equal('and never reaches the other one', await leaked, null);

    // Knowing a tunnel id is not enough to broadcast into it.
    const outsider = client(port);
    await connected(outsider);
    const leakedToB = once(hostB, 'tunnel_message', 400);
    outsider.emit('tunnel_message', { tunnelId: 'ISOL_B', payload: { injected: true } });
    const refusal = await once<{ code: string }>(outsider, 'tunnel_error');
    equal('a non-member is refused', refusal?.code, 'NOT_IN_TUNNEL');
    equal('and nothing is forwarded', await leakedToB, null);
  }

  describe('disconnect cleanup');
  {
    const host = await openTunnel(port, 'BYE001', SECRET);
    const mobile = client(port);
    await connected(mobile);
    mobile.emit('join_tunnel', 'BYE001');
    await once(host, 'client_joined');

    const before = relay.metrics().activeTunnels;
    const closed = once(mobile, 'tunnel_closed');
    host.disconnect();
    check('the client is told the tunnel closed', (await closed) !== null);
    await wait(50);
    equal('and the tunnel is released', relay.metrics().activeTunnels, before - 1);

    const orphan = client(port);
    await connected(orphan);
    orphan.emit('join_tunnel', 'BYE001');
    const err = await once<{ code: string }>(orphan, 'tunnel_error');
    equal('so it can no longer be joined', err?.code, 'TUNNEL_NOT_FOUND');
  }

  // --- Telemetry -------------------------------------------------------------
  describe('/health and /metrics');
  {
    const health = await get(port, '/health');
    equal('health reports the service', health.service, 'asterim-relay');
    equal('and that authentication is on', health.authMode, 'hmac_enabled');
    equal('with a version', health.version, '0.1.0');
    check('an uptime', typeof health.uptime === 'number' && health.uptime >= 0);
    check('a tunnel count', typeof health.activeTunnels === 'number');
    check('and a socket count', typeof health.connectedSockets === 'number');

    const metrics = await get(port, '/metrics');
    check('metrics counts every connection ever made', Number(metrics.totalConnections) >= 8);
    check('the tunnels created', Number(metrics.totalTunnelsCreated) >= 5);
    check('the messages forwarded', Number(metrics.messagesForwarded) >= 3);
    check('and the authentication rejections', Number(metrics.authRejections) >= 3);

    const body = JSON.stringify(metrics) + JSON.stringify(health);
    for (const tunnelId of ['SIGNED', 'JOIN01', 'FWD001', 'ISOL_A', 'ISOL_B']) {
      check(`no tunnel id leaks through telemetry: ${tunnelId}`, !body.includes(tunnelId));
    }
  }

  await relay.close();

  // --- Rate limiting ---------------------------------------------------------
  describe('rate limiting');
  {
    const limited = createRelayServer({ maxEventsPerMinute: 3, maxConnectionsPerIp: 20 });
    const limitedPort = await limited.listen(0, '127.0.0.1');
    try {
      const socket = client(limitedPort);
      await connected(socket);

      const codes: (string | undefined)[] = [];
      for (let i = 0; i < 5; i++) {
        socket.emit('join_tunnel', 'NOSUCH');
        const err = await once<{ code: string }>(socket, 'tunnel_error');
        codes.push(err?.code);
      }
      equal('the budget is spent, then requests are throttled', codes, [
        'TUNNEL_NOT_FOUND',
        'TUNNEL_NOT_FOUND',
        'TUNNEL_NOT_FOUND',
        'RATE_LIMITED',
        'RATE_LIMITED'
      ]);
      check('and the throttling is counted', limited.metrics().rateLimitRejections >= 2);

      // Registration draws on the same per-address budget.
      socket.emit('register_tunnel', 'BLOCKED');
      const blocked = await once<{ code: string }>(socket, 'tunnel_error');
      equal('registration is throttled by the same budget', blocked?.code, 'RATE_LIMITED');
      equal('so no tunnel is opened', limited.metrics().activeTunnels, 0);
    } finally {
      await limited.close();
    }
  }

  describe('connection limiting');
  {
    const capped = createRelayServer({ maxConnectionsPerIp: 2, maxEventsPerMinute: 100 });
    const cappedPort = await capped.listen(0, '127.0.0.1');
    try {
      const first = client(cappedPort);
      const second = client(cappedPort);
      check('the first connection is accepted', await connected(first));
      check('and the second', await connected(second));

      // The refusal is sent the instant the socket connects, so the listener
      // has to be waiting before the handshake completes.
      const third = client(cappedPort);
      const refusal = once<{ code: string }>(third, 'tunnel_error', 2000);
      await connected(third);
      equal('the third is refused', (await refusal)?.code, 'RATE_LIMITED');
      await wait(100);
      check('and disconnected', !third.connected);

      first.disconnect();
      await wait(100);
      const afterRelease = client(cappedPort);
      await connected(afterRelease);
      const stillOk = await once(afterRelease, 'tunnel_error', 300);
      equal('a freed slot is reusable', stillOk, null);
    } finally {
      await capped.close();
    }
  }

  // --- The idle reaper -------------------------------------------------------
  describe('idle tunnel reaping');
  {
    let clock = 1_700_000_000_000;
    const reaping = createRelayServer({
      now: () => clock,
      idleTunnelMs: 15 * 60 * 1000,
      maxEventsPerMinute: 100,
      // Long enough that only the explicit sweeps below run.
      reapIntervalMs: 60 * 60 * 1000
    });
    const reapPort = await reaping.listen(0, '127.0.0.1');
    try {
      const host = await openTunnel(reapPort, 'IDLE01');
      const mobile = client(reapPort);
      await connected(mobile);
      mobile.emit('join_tunnel', 'IDLE01');
      await once(host, 'client_joined');

      clock += 10 * 60 * 1000;
      equal('a tunnel younger than the idle window survives', reaping.reapNow(), 0);

      // Traffic keeps it alive.
      const delivered = once(host, 'tunnel_message');
      mobile.emit('tunnel_message', { tunnelId: 'IDLE01', payload: { keep: 'alive' } });
      await delivered;

      clock += 10 * 60 * 1000;
      equal('and traffic resets the clock on it', reaping.reapNow(), 0);

      const closed = once(mobile, 'tunnel_closed');
      clock += 16 * 60 * 1000;
      equal('but silence past the window reaps it', reaping.reapNow(), 1);
      check('and the client is told', (await closed) !== null);
      equal('the tunnel is gone', reaping.metrics().activeTunnels, 0);
      equal('and the sweep is counted', reaping.metrics().tunnelsReaped, 1);

      // A tunnel whose host vanished is reaped even while it is "fresh".
      const doomed = await openTunnel(reapPort, 'IDLE02');
      equal('a second tunnel is open', reaping.metrics().activeTunnels, 1);
      doomed.disconnect();
      await wait(100);
      equal('a disconnected host closes its own tunnel', reaping.metrics().activeTunnels, 0);
    } finally {
      await reaping.close();
    }
  }
}

main()
  .catch(err => {
    failed++;
    console.error('\nUNCAUGHT ERROR:', err);
  })
  .finally(async () => {
    for (const socket of openSockets) socket.close();
    await wait(100);
    console.log(`\n${passed}/${passed + failed} assertions passed`);
    if (failures.length > 0) {
      console.log('Failed assertions:');
      for (const f of failures) console.log(`  - ${f}`);
    }
    process.exit(failed === 0 ? 0 : 1);
  });
