/**
 * The Core's boot sequence.
 *
 * This file used to be `src/index.ts`. It was split out for P7-03 because the
 * entrypoint now has to decide, before anything else happens, whether this
 * process is a server or a one-shot command. ES module imports are hoisted and
 * evaluated before any statement in the file that declares them, so a check at
 * the top of a module that imports Fastify, the socket manager and the database
 * singleton runs *after* all three have already been constructed — and
 * `initLogger()` on line one would already have redirected the CLI's stdout
 * into `server.log`. Keeping the boot path in its own module means `index.ts`
 * can require it lazily, and `asterim db:status` loads none of it.
 *
 * Nothing else about this file changed.
 */

import { initLogger } from './utils/logger';
initLogger();

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { describeChannel, resolveDataDir, resolvePort } from './utils/channel';
import { SocketManager, registerSocketManager } from './sockets/socketManager';
import projectRoutes from './routes/projects';
import './services/AgentService';
import { dbService } from './services/DatabaseService';
import { pruningService } from './services/PruningService';
import { authMiddleware } from './middleware/authMiddleware';

// Crash Reporting (Phase 6)
const logCrash = (error: Error, type: string) => {
  try {
    // The channel's directory, so a development crash is not filed among the
    // stable Core's crashes (DEC-029).
    const crashDir = resolveDataDir();
    if (!fs.existsSync(crashDir)) fs.mkdirSync(crashDir, { recursive: true, mode: 0o700 });
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
import delegationRoutes from './routes/delegation';
import teamAgentRoutes from './routes/teamAgents';
import pipelineRoutes from './routes/pipelines';
import worktreeRoutes from './routes/worktrees';
import workspaceRoutes from './routes/workspaces';
import aiRoutes from './routes/ai';
import contextRoutes from './routes/context';
import gitRoutes from './routes/git';
import memoryRoutes from './routes/memory';
import internalRoutes from './routes/internal';
import securityRoutes from './routes/security';
import environmentSecretRoutes from './routes/environmentSecrets';
import desktopRoutes from './routes/desktop';
import { desktopNotificationService } from './services/desktop/DesktopNotificationService';
import { secretVault } from './services/security/SecretVaultService';
import { environmentSecretService } from './services/security/EnvironmentSecretService';
import { projectMemoryService } from './services/ProjectMemoryService';

const start = async () => {
  try {
    // Encrypt anything the vault owns that is still plaintext (P9-01), before
    // the first request can read it. Services that mint their own secret —
    // TokenService, PairingService, PushService — have already upgraded their
    // own row by now through `getSecret`; this sweep covers the ones nothing
    // reads until it is needed, `ai_api_key` and `stripe_secret_key`.
    const settingsSweep = secretVault.migrateLegacyPlaintext();

    // The same sweep over workspace credentials (P9-02). Separate from the one
    // above because these rows are not keyed by name — the whole table is
    // scanned — and nothing reads them until an agent session starts, so a
    // database that has been in use since before this existed would otherwise
    // keep its environment tokens in cleartext indefinitely.
    const environmentSweep = environmentSecretService.migrateLegacyPlaintext();

    // Encrypting a row in place does not remove what it used to say: SQLite
    // frees the old page rather than overwriting it, so the cleartext stays
    // readable in the file until it is rebuilt. Only after a sweep that actually
    // moved something, because a rebuild costs a pass over the whole database
    // and there is nothing to remove otherwise.
    if (settingsSweep.migrated.length > 0 || environmentSweep.migrated > 0) {
      const compacted = dbService.compact();
      console.log(
        compacted
          ? '[Startup] Rebuilt the database so the migrated cleartext is gone from its freed pages.'
          : '[Startup] Migrated credentials are encrypted, but the database could not be rebuilt; superseded cleartext may remain in freed pages until it is.'
      );
    }

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
    console.log('[DEBUG] Registering delegationRoutes');
    await fastify.register(delegationRoutes);
    console.log('[DEBUG] Registering teamAgentRoutes');
    await fastify.register(teamAgentRoutes);
    console.log('[DEBUG] Registering pipelineRoutes');
    await fastify.register(pipelineRoutes);
    console.log('[DEBUG] Registering worktreeRoutes');
    await fastify.register(worktreeRoutes);
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
    console.log('[DEBUG] Registering securityRoutes');
    await fastify.register(securityRoutes);
    console.log('[DEBUG] Registering environmentSecretRoutes');
    await fastify.register(environmentSecretRoutes);
    console.log('[DEBUG] Registering desktopRoutes');
    await fastify.register(desktopRoutes);
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

    // Native desktop toasts for the moments that block or surprise a human
    // (P10-01). Registered alongside the other bus subscriptions and before the
    // first request, so an approval raised during session recovery is not the
    // one notification that is silently missed. Each handler dispatches without
    // awaiting, and skips itself entirely on a headless host.
    desktopNotificationService.initEventBusListeners();

    // The six shipped agent profiles. Seeded before the first request so the
    // catalogue is never briefly empty on a fresh workstation.
    const { profileService } = await import('./services/ai/ProfileService');
    profileService.initBuiltinProfiles();

    // The channel supplies the default port, so a stable Core on 3000 and a
    // development Core on 3001 can be up at the same time (DEC-029). An explicit
    // PORT still wins.
    const channelInfo = describeChannel();
    console.log(
      `[Server] Release channel: ${channelInfo.channel} · data directory: ${channelInfo.dataDir} · port: ${channelInfo.port}`
    );
    const port = resolvePort(channelInfo.channel);
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

    // Delegated children the previous run stopped on top of (P7-02). No session
    // survived the restart, so a child still marked running is over; settling it
    // here is what stops the dashboard showing it live forever.
    const { agentDelegationService } = await import('./services/ai/AgentDelegationService');
    agentDelegationService.recoverDelegations();

    // And the worktree sandboxes those children left behind (P8-02). After the
    // recovery pass, because that is what decides which of them are over, and
    // deliberately not awaited: reclaiming disk is not a thing a workstation
    // should wait to finish booting for. It removes nothing that still exists on
    // disk, so a delegation whose diff has not been reviewed yet survives.
    void agentDelegationService.pruneOrphanSandboxes();

    // Shared team turns the previous run stopped on top of (P8-01). No turn
    // lock survives a restart, so a queue row still claiming PROCESSING is a
    // turn nothing is generating for — and a shared thread left showing itself
    // busy is one the whole team is blocked behind.
    const { teamAgentService } = await import('./services/ai/TeamAgentService');
    teamAgentService.recoverTurns();

    // And the pipeline runs it stopped in the middle of (P9-01). Every step of
    // a run is a delegated session, none of which survived the restart, so a
    // row still claiming RUNNING describes something that ended when the Core
    // did — and a run left showing itself live is one nothing will ever move.
    const { pipelineEngine } = await import('./services/pipeline/PipelineEngine');
    pipelineEngine.recoverRuns();

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
