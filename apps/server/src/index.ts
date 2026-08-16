import { initLogger } from './utils/logger';
initLogger();

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { SocketManager, registerSocketManager } from './sockets/socketManager';
import projectRoutes from './routes/projects';
import './services/AgentService';
import { dbService } from './services/DatabaseService';
import { pruningService } from './services/PruningService';
import { authMiddleware } from './middleware/authMiddleware';

// Crash Reporting (Phase 6)
const logCrash = (error: Error, type: string) => {
  try {
    const crashDir = path.join(os.homedir(), '.asterim');
    if (!fs.existsSync(crashDir)) fs.mkdirSync(crashDir, { recursive: true });
    const logPath = path.join(crashDir, 'crash.log');
    const msg = `\n[${new Date().toISOString()}] ${type}: ${error.stack || error.message}\n`;
    fs.appendFileSync(logPath, msg);
    console.error(`[Asterim] ${type}:`, error);
  } catch (e) {
    console.error('Failed to write crash log', e);
  }
};

process.on('uncaughtException', err => {
  logCrash(err, 'uncaughtException');
  process.exit(1);
});
process.on('unhandledRejection', (err: any) => {
  logCrash(err, 'unhandledRejection');
});

const fastify = Fastify({ logger: true });

// Helper to verify if an origin is a local loopback or local network address
const isLocalOrigin = (origin: string): boolean => {
  try {
    const url = new URL(origin);
    const hostname = url.hostname;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname.endsWith('.local') ||
      /^192\.168\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      /^169\.254\./.test(hostname) ||
      /^26\./.test(hostname) // Radmin VPN / Hamachi
    );
  } catch (e) {
    return false;
  }
};

// P0-002: Restrict CORS
const relayUrl = process.env.ASTERIM_RELAY_URL || 'http://localhost:4000';
fastify.register(cors, {
  origin: (origin, cb) => {
    // Allow direct access (no origin), local dev, and the relay URL
    if (!origin || origin === 'null' || isLocalOrigin(origin) || origin.startsWith(relayUrl)) {
      cb(null, true);
      return;
    }
    cb(new Error('Not allowed'), false);
  }
});

// Register authentication middleware
fastify.register(authMiddleware);

// Setup Static File Serving for Production (Phase 6)
let webDistPath = path.join(__dirname, 'web');
if (!fs.existsSync(webDistPath)) {
  // Fallback for tsx watch where __dirname is src/
  webDistPath = path.join(__dirname, '..', '..', '..', 'apps', 'web', 'dist');
}

if (fs.existsSync(webDistPath)) {
  fastify.register(fastifyStatic, {
    root: webDistPath,
    prefix: '/'
  });

  // Catch-all to serve index.html for frontend routing (if not an API route)
  fastify.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api')) {
      reply.status(404).send({ error: 'Not Found' });
    } else {
      reply.sendFile('index.html');
    }
  });
}

dbService.getDb();
const socketManager = new SocketManager(fastify);
registerSocketManager(socketManager);

import './services/RelayClient';
import './services/PushService';
import './services/TerminalService';

fastify.get('/health', async () => {
  const { startupService } = await import('./services/StartupService');
  return {
    status: 'ok',
    service: 'asterim-server',
    binaries: startupService.getAgentBinariesStatus()
  };
});

import systemRoutes from './routes/system';
import authRoutes from './routes/auth';
import sessionRoutes from './routes/sessions';
import deviceRoutes from './routes/devices';
import apiKeyRoutes from './routes/apikeys';
import webhookRoutes from './routes/webhooks';
import billingRoutes from './routes/billing';
import mcpRoutes from './routes/mcp';
import skillRoutes from './routes/skills';
import profileRoutes from './routes/profiles';
import workspaceRoutes from './routes/workspaces';
import aiRoutes from './routes/ai';
import contextRoutes from './routes/context';
import gitRoutes from './routes/git';
import memoryRoutes from './routes/memory';
import internalRoutes from './routes/internal';
import { projectMemoryService } from './services/ProjectMemoryService';

const start = async () => {
  try {
    console.log('[DEBUG] Registering authRoutes');
    await fastify.register(authRoutes);
    console.log('[DEBUG] Registering sessionRoutes');
    await fastify.register(sessionRoutes);
    console.log('[DEBUG] Registering deviceRoutes');
    await fastify.register(deviceRoutes);
    console.log('[DEBUG] Registering apiKeyRoutes');
    await fastify.register(apiKeyRoutes);
    console.log('[DEBUG] Registering webhookRoutes');
    await fastify.register(webhookRoutes);
    console.log('[DEBUG] Registering billingRoutes');
    await fastify.register(billingRoutes);
    console.log('[DEBUG] Registering mcpRoutes');
    await fastify.register(mcpRoutes);
    console.log('[DEBUG] Registering skillRoutes');
    await fastify.register(skillRoutes);
    console.log('[DEBUG] Registering profileRoutes');
    await fastify.register(profileRoutes);
    console.log('[DEBUG] Registering workspaceRoutes');
    await fastify.register(workspaceRoutes);
    console.log('[DEBUG] Registering projectRoutes');
    await fastify.register(projectRoutes);
    console.log('[DEBUG] Registering gitRoutes');
    await fastify.register(gitRoutes);
    console.log('[DEBUG] Registering systemRoutes');
    await fastify.register(systemRoutes);
    console.log('[DEBUG] Registering aiRoutes');
    await fastify.register(aiRoutes);
    console.log('[DEBUG] Registering contextRoutes');
    await fastify.register(contextRoutes);
    console.log('[DEBUG] Registering memoryRoutes');
    await fastify.register(memoryRoutes);
    await fastify.register(internalRoutes);

    // Supervised MCP servers are child processes of this one. Closing the
    // server has to take them with it, or a restart leaves orphans holding
    // whatever the previous run left open.
    const { mcpProcessSupervisor } = await import('./services/mcp/McpProcessSupervisor');
    fastify.addHook('onClose', async () => {
      await mcpProcessSupervisor.shutdownAll();
    });

    // Project Memory Core: register EventBus subscriptions once, before the
    // server starts accepting requests that could publish memory events.
    projectMemoryService.initEventBusListeners();

    // The six shipped agent profiles. Seeded before the first request so the
    // catalogue is never briefly empty on a fresh workstation.
    const { profileService } = await import('./services/ai/ProfileService');
    profileService.initBuiltinProfiles();

    const port = parseInt(process.env.PORT || '3000', 10);
    // `::` accepts both IPv6 and IPv4 on every interface, which is what a LAN
    // workstation wants. A deployment that should not be reachable from the
    // network — or one behind a reverse proxy — overrides it with HOST.
    const host = process.env.HOST || '::';
    console.log('[DEBUG] fastify.listen...');
    await fastify.listen({ port, host });
    console.log(`[Server] Asterim server listening on port ${port}`);

    // Tell other Asterim processes on this machine how to reach us, so an MCP
    // memory write in a separate process can be relayed onto this EventBus
    // (DEC-026). Written after listen() so the descriptor never advertises a
    // port that is not yet accepting connections.
    const { serverRegistry } = await import('./services/ServerRegistry');
    serverRegistry.publish(port);
    console.log('[Server] Loopback relay descriptor written to', serverRegistry.filePath);

    // One owner for everything that has to happen when Asterim stops: the HTTP
    // server, the MCP children, the descriptor and the database, in that order.
    const { setupGracefulShutdown } = await import('./services/GracefulShutdown');
    setupGracefulShutdown(fastify);

    // Bring up the MCP servers the developer left enabled. Deliberately not
    // awaited: a slow or broken MCP server must not hold up a workstation, and
    // each one's status is visible through /api/v1/mcp/servers either way.
    void mcpProcessSupervisor.autostartEnabledServers();

    // Session and Approval Recovery (P0-004)
    const { agentService } = await import('./services/AgentService');
    const { approvalManager } = await import('./services/ApprovalManager');
    agentService.recoverSessions();
    approvalManager.recoverPendingApprovals();

    // Start event log pruning (runs immediately then every hour)
    pruningService.start();

    // Telemetry ping
    console.log('[Telemetry] Anonymous ping: Asterim Started');

    const { mdnsService } = await import('./services/mDNSService');
    mdnsService.start(port);

    // Onboarding Console Splash (P0-005)
    const { pairingService } = await import('./services/PairingService');
    const { relayClient } = await import('./services/RelayClient');
    const { startupService } = await import('./services/StartupService');
    startupService.checkFirstRun(port, pairingService.getPin(), relayClient.tunnelId);
    startupService.checkBinaries();

  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
