import { Server as SocketIOServer } from 'socket.io';
import { eventBus } from '../services/EventBus';
export class SocketManager {
    io;
    constructor(fastify) {
        this.io = new SocketIOServer(fastify.server, {
            cors: {
                origin: '*', // For local MVP, allow all local network origins
                methods: ['GET', 'POST']
            }
        });
        this.setupListeners();
        this.setupEventBusBridge();
    }
    setupListeners() {
        this.io.on('connection', (socket) => {
            console.log(`[Socket.IO] Client connected: ${socket.id}`);
            // Client joins a specific project room to get its isolated telemetry
            socket.on('join_project', (projectId) => {
                socket.join(projectId);
                console.log(`[Socket.IO] Client ${socket.id} joined project: ${projectId}`);
            });
            // Forward client commands and approvals to the internal EventBus
            socket.on('client_event', (event) => {
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
    setupEventBusBridge() {
        // In a real system, we'd subscribe to specific topics. For the MVP,
        // we listen to the catch-all and route based on payload properties.
        eventBus.subscribe('*', (event) => {
            const projectId = event.payload?.projectId;
            if (projectId) {
                // Route strictly to the project room
                this.io.to(projectId).emit(event.type, event);
            }
            else {
                // Broadcast system-wide events
                this.io.emit(event.type, event);
            }
        });
    }
}
