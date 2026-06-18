import { Server as SocketIOServer, Socket } from 'socket.io';
import { FastifyInstance } from 'fastify';
import { eventBus } from '../services/EventBus';
import { AgentDeckEvent } from '@agentdeck/shared';

export class SocketManager {
  private io: SocketIOServer;

  constructor(fastify: FastifyInstance) {
    this.io = new SocketIOServer(fastify.server, {
      cors: {
        origin: '*', // For local MVP, allow all local network origins
        methods: ['GET', 'POST']
      }
    });

    this.setupListeners();
    this.setupEventBusBridge();
  }

  private setupListeners() {
    this.io.on('connection', (socket: Socket) => {
      console.log(`[Socket.IO] Client connected: ${socket.id}`);

      // Client joins a specific project room to get its isolated telemetry
      socket.on('join_project', (projectId: string) => {
        socket.join(projectId);
        console.log(`[Socket.IO] Client ${socket.id} joined project: ${projectId}`);
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

  /**
   * Bridges internal EventBus events out to connected WebSocket clients.
   */
  private setupEventBusBridge() {
    // In a real system, we'd subscribe to specific topics. For the MVP,
    // we listen to the catch-all and route based on payload properties.
    eventBus.subscribe('*', (event: AgentDeckEvent<any>) => {
      const projectId = (event.payload as any)?.projectId;
      
      if (projectId) {
        // Route strictly to the project room
        this.io.to(projectId).emit(event.type, event);
      } else {
        // Broadcast system-wide events
        this.io.emit(event.type, event);
      }
    });
  }
}
