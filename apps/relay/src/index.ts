import { createRelayServer, RELAY_DEFAULTS } from './relayServer';

/** Reads a positive integer from the environment, or keeps the default. */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const relay = createRelayServer({
  secret: process.env.RELAY_SECRET,
  maxConnectionsPerIp: envInt('RELAY_MAX_CONNECTIONS_PER_IP', RELAY_DEFAULTS.maxConnectionsPerIp),
  maxEventsPerMinute: envInt('RELAY_MAX_EVENTS_PER_MINUTE', RELAY_DEFAULTS.maxEventsPerMinute),
  idleTunnelMs: envInt('RELAY_IDLE_TUNNEL_MS', RELAY_DEFAULTS.idleTunnelMs)
});

const start = async () => {
  try {
    const port = envInt('PORT', 4000);
    await relay.listen(port);
    console.log(
      `[Relay] Asterim Cloud Relay listening on port ${port} (auth: ${relay.authMode()})`
    );
  } catch (err) {
    console.error('[Relay] Failed to start', err);
    process.exit(1);
  }
};

start();
