import { Server as SocketIOServer, Socket } from 'socket.io';
import { FastifyInstance } from 'fastify';
import { eventBus } from '../services/EventBus';
import { AgentDeckEvent } from '@agentdeck/shared';
import { dbService } from '../services/DatabaseService';
import { pairingService } from '../services/PairingService';
import crypto from 'crypto';

export class SocketManager {
  private io: SocketIOServer;
  private recentLogs = new Map<string, AgentDeckEvent<any>[]>();

  constructor(fastify: FastifyInstance) {
    this.io = new SocketIOServer(fastify.server, {
      cors: {
        origin: '*', // For local MVP, allow all local network origins
        methods: ['GET', 'POST']
      }
    });

    this.setupMiddleware();
    this.setupListeners();
    this.setupEventBusBridge();
  }

  private setupMiddleware() {
    this.io.use((socket: Socket, next) => {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error('unauthorized'));
      }
      if (!pairingService.validateToken(token)) {
        return next(new Error('unauthorized'));
      }
      next();
    });
  }

  private setupListeners() {
    this.io.on('connection', (socket: Socket) => {
      console.log(`[Socket.IO] Client connected: ${socket.id}`);

      // Client joins a specific project room to get its isolated telemetry
      socket.on('join_project', (projectId: string) => {
        socket.join(projectId);
        console.log(`[Socket.IO] Client ${socket.id} joined project: ${projectId}`);

        // Sync history for this project
        this.syncHistory(socket, projectId);

        // Send system status (binaries)
        const { startupService } = require('../services/StartupService');
        socket.emit('server.system_status', {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          source: 'server',
          type: 'server.system_status',
          payload: { binaries: startupService.getAgentBinariesStatus() }
        });
      });

      // Forward client commands and approvals to the internal EventBus
      socket.on('client_event', (event: AgentDeckEvent<any>) => {
        event.source = event.source || `client:${socket.id}`;
        eventBus.publish(event);
      });

      socket.on('disconnect', () => {
        console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
      });
    });
  }

  private syncHistory(socket: Socket, projectId: string) {
    try {
      const db = dbService.getDb();
      // Fetch the last 1000 events
      const query = db.prepare('SELECT payload_json FROM events WHERE project_id = ? ORDER BY timestamp DESC LIMIT 1000');
      const rows = query.all(projectId) as { payload_json: string }[];
      
      // Rows are descending, we need ascending for correct playback
      const historyEvents = rows.reverse().map(row => JSON.parse(row.payload_json));
      
      const recentLogs = this.recentLogs.get(projectId) || [];
      const combinedHistory = [...historyEvents, ...recentLogs].sort((a, b) => a.timestamp - b.timestamp);
      
      socket.emit('session.history', combinedHistory);
    } catch (err) {
      console.error('[Socket.IO] Failed to sync history:', err);
    }
  }

  /**
   * Bridges internal EventBus events out to connected WebSocket clients and persists them.
   */
  private setupEventBusBridge() {
    // In a real system, we'd subscribe to specific topics. For the MVP,
    // we listen to the catch-all and route based on payload properties.
    eventBus.subscribe('*', (event: AgentDeckEvent<any>) => {
      const projectId = (event.payload as any)?.projectId;
      
      if (projectId) {
        // Route strictly to the project room
        this.io.to(projectId).emit(event.type, event);

        // Buffer agent.log in memory instead of persisting to DB to save space
        if (event.type === 'agent.log') {
          const logs = this.recentLogs.get(projectId) || [];
          logs.push(event);
          if (logs.length > 500) logs.shift();
          this.recentLogs.set(projectId, logs);
          return;
        }

        // Persist event to Database
        try {
          const db = dbService.getDb();
          const insert = db.prepare('INSERT INTO events (id, project_id, timestamp, source, type, payload_json) VALUES (?, ?, ?, ?, ?, ?)');
          insert.run(
            crypto.randomUUID(),
            projectId,
            event.timestamp || Date.now(),
            event.source,
            event.type,
            JSON.stringify(event)
          );
        } catch (err) {
          console.error('[Database] Failed to persist event:', err);
        }

      } else {
        // Broadcast system-wide events
        this.io.emit(event.type, event);
      }
    });
  }
}
