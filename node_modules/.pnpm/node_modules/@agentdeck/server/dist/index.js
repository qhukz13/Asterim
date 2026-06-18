import Fastify from 'fastify';
import { SocketManager } from './sockets/socketManager';
import projectRoutes from './routes/projects';
const fastify = Fastify({
    logger: true
});
// Initialize Socket.IO attached to Fastify's native server
const socketManager = new SocketManager(fastify);
// Health check endpoint
fastify.get('/health', async (request, reply) => {
    return { status: 'ok', service: 'agentdeck-server' };
});
const start = async () => {
    try {
        // Register routes
        await fastify.register(projectRoutes);
        const port = parseInt(process.env.PORT || '3000', 10);
        // Listen on 0.0.0.0 to allow local network discovery for mobile clients
        await fastify.listen({ port, host: '0.0.0.0' });
        console.log(`[Server] AgentDeck server listening on http://0.0.0.0:${port}`);
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
