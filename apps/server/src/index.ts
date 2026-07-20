import { initLogger } from './utils/logger';
initLogger();

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { SocketManager } from './sockets/socketManager';
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
import aiRoutes from './routes/ai';
import contextRoutes from './routes/context';

const start = async () => {
  try {
    await fastify.register(authRoutes);
    await fastify.register(projectRoutes);
    await fastify.register(systemRoutes);
    await fastify.register(aiRoutes);
    await fastify.register(contextRoutes);

    const port = parseInt(process.env.PORT || '3000', 10);
    await fastify.listen({ port, host: '::' });
    console.log(`[Server] Asterim server listening on port ${port}`);

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
