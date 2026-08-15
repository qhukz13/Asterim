import { FastifyInstance, FastifyReply } from 'fastify';
import { AuthErrorCode, McpServerInput } from '@asterim/shared';
import { McpError, McpErrorCode, mcpProcessSupervisor } from '../services/mcp/McpProcessSupervisor';

/** How a supervisor failure reads over HTTP. */
const STATUS_BY_CODE: Record<McpErrorCode, number> = {
  NOT_FOUND: 404,
  INVALID_CONFIG: 400,
  SERVER_DISABLED: 409,
  UNSUPPORTED_TRANSPORT: 400,
  SPAWN_FAILED: 500,
  SERVER_NOT_RUNNING: 409,
  TOOL_NOT_FOUND: 404,
  // The tool was reached and simply took too long: a gateway timeout, not a
  // failure of this server.
  TOOL_TIMEOUT: 504
};

function sendMcpError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof McpError) {
    return reply.status(STATUS_BY_CODE[err.code]).send({ error: err.message, code: err.code });
  }
  console.error('[MCP] Unexpected failure', err);
  return reply.status(500).send({ error: 'MCP request failed' });
}

export default async function mcpRoutes(fastify: FastifyInstance) {
  /** Every route here is account-scoped; none of them is public. */
  const requireUser = (request: { user?: unknown }, reply: FastifyReply): boolean => {
    if (request.user) return true;
    reply.status(401).send({ error: 'Unauthorized', code: AuthErrorCode.UNAUTHORIZED });
    return false;
  };

  // GET /api/v1/mcp/servers — configurations with live process state
  fastify.get('/api/v1/mcp/servers', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { workspaceId } = (request.query as { workspaceId?: string }) || {};
    try {
      return reply.send({ servers: mcpProcessSupervisor.listServers(workspaceId) });
    } catch (err) {
      return sendMcpError(reply, err);
    }
  });

  // POST /api/v1/mcp/servers — register a server
  fastify.post('/api/v1/mcp/servers', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    try {
      const config = await mcpProcessSupervisor.saveServer((request.body as McpServerInput) || {});
      return reply.status(201).send({ server: mcpProcessSupervisor.getServerStatus(config.id) });
    } catch (err) {
      return sendMcpError(reply, err);
    }
  });

  // GET /api/v1/mcp/servers/:id
  fastify.get('/api/v1/mcp/servers/:id', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    const server = mcpProcessSupervisor.getServerStatus(id);
    if (!server) {
      return reply.status(404).send({ error: `No MCP server with id ${id}.`, code: 'NOT_FOUND' });
    }
    return reply.send({ server });
  });

  // PATCH /api/v1/mcp/servers/:id
  fastify.patch('/api/v1/mcp/servers/:id', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    try {
      await mcpProcessSupervisor.saveServer((request.body as McpServerInput) || {}, id);
      return reply.send({ server: mcpProcessSupervisor.getServerStatus(id) });
    } catch (err) {
      return sendMcpError(reply, err);
    }
  });

  // DELETE /api/v1/mcp/servers/:id — stops the process, then forgets it
  fastify.delete('/api/v1/mcp/servers/:id', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    try {
      const deleted = await mcpProcessSupervisor.deleteServer(id);
      if (!deleted) {
        return reply.status(404).send({ error: `No MCP server with id ${id}.`, code: 'NOT_FOUND' });
      }
      return reply.send({ deleted: true });
    } catch (err) {
      return sendMcpError(reply, err);
    }
  });

  for (const action of ['start', 'stop', 'restart'] as const) {
    fastify.post(`/api/v1/mcp/servers/:id/${action}`, async (request, reply) => {
      if (!requireUser(request, reply)) return reply;

      const { id } = request.params as { id: string };
      try {
        const server =
          action === 'start'
            ? await mcpProcessSupervisor.startServer(id)
            : action === 'stop'
              ? await mcpProcessSupervisor.stopServer(id)
              : await mcpProcessSupervisor.restartServer(id);
        return reply.send({ server });
      } catch (err) {
        return sendMcpError(reply, err);
      }
    });
  }

  // GET /api/v1/mcp/servers/:id/capabilities — what the last handshake found
  fastify.get('/api/v1/mcp/servers/:id/capabilities', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    const server = mcpProcessSupervisor.getServerStatus(id);
    if (!server) {
      return reply.status(404).send({ error: `No MCP server with id ${id}.`, code: 'NOT_FOUND' });
    }
    // Null rather than 404 when a server has never completed a handshake: the
    // server exists, its capabilities are simply not known yet.
    return reply.send({ capabilities: server.capabilities ?? null, status: server.status });
  });

  // POST /api/v1/mcp/servers/:id/refresh — re-run discovery against a live server
  fastify.post('/api/v1/mcp/servers/:id/refresh', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    try {
      const server = await mcpProcessSupervisor.refreshCapabilities(id);
      return reply.send({ server });
    } catch (err) {
      return sendMcpError(reply, err);
    }
  });

  // POST /api/v1/mcp/servers/:id/tools/:toolName — invoke a discovered tool
  fastify.post('/api/v1/mcp/servers/:id/tools/:toolName', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id, toolName } = request.params as { id: string; toolName: string };
    const body = (request.body as { arguments?: Record<string, unknown> }) || {};

    if (
      body.arguments !== undefined &&
      (typeof body.arguments !== 'object' ||
        body.arguments === null ||
        Array.isArray(body.arguments))
    ) {
      return reply
        .status(400)
        .send({ error: 'arguments must be an object.', code: 'INVALID_CONFIG' });
    }

    try {
      const result = await mcpProcessSupervisor.callTool(id, toolName, body.arguments);
      // A tool reporting failure is a 200 with isError: the call succeeded, the
      // tool said no. Only the transport failing is an HTTP error.
      return reply.send({ result, isError: result.isError });
    } catch (err) {
      return sendMcpError(reply, err);
    }
  });

  // GET /api/v1/mcp/servers/:id/logs — the rolling stderr tail
  fastify.get('/api/v1/mcp/servers/:id/logs', async (request, reply) => {
    if (!requireUser(request, reply)) return reply;

    const { id } = request.params as { id: string };
    if (!mcpProcessSupervisor.getConfig(id)) {
      return reply.status(404).send({ error: `No MCP server with id ${id}.`, code: 'NOT_FOUND' });
    }
    return reply.send({ logs: mcpProcessSupervisor.getLogs(id) });
  });
}
