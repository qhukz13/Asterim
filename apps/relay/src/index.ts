import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server as SocketIOServer, Socket } from 'socket.io';

const fastify = Fastify({
  logger: true
});

fastify.register(cors, {
  origin: '*'
});

const io = new SocketIOServer(fastify.server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Basic health check
fastify.get('/health', async () => {
  return { status: 'ok', service: 'agentdeck-relay' };
});

// Mapping of tunnelId -> localServer socket ID
const tunnelMap = new Map<string, string>();

io.on('connection', (socket: Socket) => {
  console.log(`[Relay] Client connected: ${socket.id}`);

  // Local server registers its tunnel
  socket.on('register_tunnel', (tunnelId: string) => {
    tunnelMap.set(tunnelId, socket.id);
    socket.join(`tunnel_${tunnelId}`);
    console.log(`[Relay] Registered tunnel ${tunnelId} for socket ${socket.id}`);
    socket.emit('tunnel_registered', { success: true });
  });

  // Mobile client joins an existing tunnel
  socket.on('join_tunnel', (tunnelId: string) => {
    if (!tunnelMap.has(tunnelId)) {
      socket.emit('tunnel_error', { message: 'Tunnel not found or local server disconnected' });
      return;
    }
    socket.join(`tunnel_${tunnelId}`);
    console.log(`[Relay] Mobile client ${socket.id} joined tunnel ${tunnelId}`);
    
    // Notify local server that a client joined
    const serverSocketId = tunnelMap.get(tunnelId);
    if (serverSocketId) {
      io.to(serverSocketId).emit('client_joined', { clientId: socket.id });
    }
  });

  // Generic message forwarder within a tunnel
  // Both local server and mobile client use this to exchange E2E encrypted payloads
  socket.on('tunnel_message', ({ tunnelId, payload }: { tunnelId: string, payload: any }) => {
    // Broadcast to everyone else in the tunnel
    socket.to(`tunnel_${tunnelId}`).emit('tunnel_message', payload);
  });

  socket.on('disconnect', () => {
    console.log(`[Relay] Client disconnected: ${socket.id}`);
    
    // Clean up tunnel if it was a local server
    for (const [tunnelId, serverSocketId] of tunnelMap.entries()) {
      if (serverSocketId === socket.id) {
        tunnelMap.delete(tunnelId);
        console.log(`[Relay] Removed tunnel ${tunnelId}`);
        // Notify any mobile clients that the server is gone
        io.to(`tunnel_${tunnelId}`).emit('tunnel_closed');
        break;
      }
    }
  });
});

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '4000', 10);
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`[Relay] AgentDeck Cloud Relay listening on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
