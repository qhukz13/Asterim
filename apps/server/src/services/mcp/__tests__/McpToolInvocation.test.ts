/**
 * Tests for MCP tool invocation (P6-03).
 *
 * The servers here are real child processes that answer `tools/call` — one that
 * echoes its arguments, one that reports tool-level failure, one that never
 * answers, and one that changes its tool list mid-session and announces it. The
 * last is the only way to prove the notification path: a cached catalogue going
 * stale is invisible until a server actually says so.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/mcp/__tests__/McpToolInvocation.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-mcp-tools-'));
process.env.ASTERIM_DATA_DIR = tmpDir;
// The routes use the shared supervisor, whose budgets come from the environment.
// A one-second tool budget keeps the 504 case from costing thirty.
process.env.ASTERIM_MCP_TOOL_TIMEOUT_MS = '1000';
process.env.ASTERIM_MCP_REQUEST_TIMEOUT_MS = '2000';
process.env.ASTERIM_MCP_HANDSHAKE_TIMEOUT_MS = '4000';

const Fastify = require('fastify');
const { dbService } = require('../../DatabaseService');
const { eventBus } = require('../../EventBus');
const { McpProcessSupervisor } = require('../McpProcessSupervisor');
const mcpRoutes = require('../../../routes/mcp').default;
const { MCP_EVENTS } = require('@asterim/shared');

import type { McpServerRuntimeInfo } from '@asterim/shared';

// --- Assertion harness ---

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? `  — ${detail}` : ''}`);
  }
}

function equal(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  check(
    label,
    ok,
    ok ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

function describe(name: string): void {
  console.log(`\n${name}`);
}

function cleanup(): void {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log(`\n[cleanup] removed ${tmpDir}`);
  } catch (err) {
    console.error(`[cleanup] failed to remove ${tmpDir}:`, (err as Error).message);
  }
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const NODE = process.execPath;

async function until(predicate: () => boolean, timeoutMs = 4000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await wait(25);
  }
  return predicate();
}

// --- Mock servers -----------------------------------------------------------

const RPC_LOOP = `
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n');
  const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
  let buffer = '';
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\\n')) !== -1) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (line) handle(JSON.parse(line));
    }
  });
  setInterval(() => {}, 1000);
`;

const INIT_RESULT = `{
  protocolVersion: '2024-11-05',
  serverInfo: { name: 'tool-mock', version: '1.0.0' },
  capabilities: { tools: {} }
}`;

/** Echoes arguments, reports tool failure on demand, and can hang. */
const TOOL_SERVER = `
  function handle(msg) {
    if (msg.method === 'initialize') {
      respond(msg.id, ${INIT_RESULT});
    } else if (msg.method === 'tools/list') {
      respond(msg.id, { tools: [
        { name: 'echo', description: 'Echoes its arguments', inputSchema: { type: 'object' } },
        { name: 'boom', description: 'Always reports failure' },
        { name: 'hang', description: 'Never answers' },
        { name: 'rpc_error', description: 'Answers with a JSON-RPC error' },
        { name: 'multipart', description: 'Answers with more than one content part' }
      ]});
    } else if (msg.method === 'tools/call') {
      const name = msg.params && msg.params.name;
      const args = (msg.params && msg.params.arguments) || {};
      if (name === 'echo') {
        respond(msg.id, { content: [{ type: 'text', text: JSON.stringify(args) }], isError: false });
      } else if (name === 'boom') {
        respond(msg.id, { content: [{ type: 'text', text: 'the tool refused: no such file' }], isError: true });
      } else if (name === 'multipart') {
        respond(msg.id, { content: [
          { type: 'text', text: 'here is an image' },
          { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }
        ], isError: false });
      } else if (name === 'rpc_error') {
        fail(msg.id, -32602, 'Invalid params: expected { path }');
      } else if (name === 'hang') {
        // Deliberately no answer.
      } else {
        fail(msg.id, -32601, 'Unknown tool ' + name);
      }
    } else if (msg.id !== undefined) {
      fail(msg.id, -32601, 'Method not found');
    }
  }
  ${RPC_LOOP}
`;

/**
 * Starts with one tool, gains a second, and announces the change — the shape a
 * filesystem server takes when a new root is mounted.
 */
const CHANGING_SERVER = `
  let extended = false;
  function handle(msg) {
    if (msg.method === 'initialize') {
      respond(msg.id, ${INIT_RESULT});
    } else if (msg.method === 'tools/list') {
      respond(msg.id, { tools: extended
        ? [{ name: 'first' }, { name: 'second' }]
        : [{ name: 'first' }] });
    } else if (msg.method === 'tools/call' && msg.params.name === 'first') {
      // Calling the first tool "mounts" something new, then announces it.
      if (!extended) {
        extended = true;
        respond(msg.id, { content: [{ type: 'text', text: 'mounted' }], isError: false });
        setTimeout(() => send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }), 30);
      } else {
        respond(msg.id, { content: [{ type: 'text', text: 'already mounted' }], isError: false });
      }
    } else if (msg.id !== undefined) {
      fail(msg.id, -32601, 'Method not found');
    }
  }
  ${RPC_LOOP}
`;

async function main(): Promise<void> {
  dbService.getDb();
  // A short tool budget so the hanging case does not cost 30 seconds.
  const supervisor = new McpProcessSupervisor({
    requestTimeoutMs: 2000,
    handshakeTimeoutMs: 4000,
    toolTimeoutMs: 1000
  });

  // --- Calling a tool --------------------------------------------------------
  describe('callTool');
  let toolServerId: string;
  {
    const config = await supervisor.saveServer({
      name: 'tool-mock',
      command: NODE,
      args: ['-e', TOOL_SERVER]
    });
    toolServerId = config.id;
    const started = await supervisor.startServer(toolServerId);
    equal('the server is RUNNING', started.status, 'RUNNING');
    equal('with five tools discovered', started.capabilities.tools.length, 5);

    const echoed = await supervisor.callTool(toolServerId, 'echo', { path: '/tmp/x', depth: 2 });
    equal('arguments reach the tool intact', JSON.parse(echoed.content[0].text), {
      path: '/tmp/x',
      depth: 2
    });
    equal('a successful call is not an error', echoed.isError, false);
    equal('and the content type comes back', echoed.content[0].type, 'text');

    const noArgs = await supervisor.callTool(toolServerId, 'echo');
    equal('a call with no arguments sends an empty object', JSON.parse(noArgs.content[0].text), {});

    const multipart = await supervisor.callTool(toolServerId, 'multipart');
    equal('multi-part content is preserved', multipart.content.length, 2);
    equal('including the image part', multipart.content[1].mimeType, 'image/png');
    equal('with its payload', multipart.content[1].data, 'aGVsbG8=');
  }

  describe('a tool that reports failure');
  {
    const result = await supervisor.callTool(toolServerId, 'boom');
    equal('the call resolves rather than throwing', result.isError, true);
    check('and the reason is readable', result.content[0].text.includes('the tool refused'));
  }

  describe('failures that are not the tool saying no');
  {
    let code = '';
    try {
      await supervisor.callTool(toolServerId, 'no_such_tool');
    } catch (err) {
      code = (err as { code: string }).code;
    }
    equal('an unknown tool is TOOL_NOT_FOUND', code, 'TOOL_NOT_FOUND');

    let rpcMessage = '';
    try {
      await supervisor.callTool(toolServerId, 'rpc_error');
    } catch (err) {
      rpcMessage = (err as Error).message;
    }
    check('a JSON-RPC error propagates', rpcMessage.includes('Invalid params'));

    const before = Date.now();
    let timeoutCode = '';
    try {
      await supervisor.callTool(toolServerId, 'hang');
    } catch (err) {
      timeoutCode = (err as { code: string }).code;
    }
    const elapsed = Date.now() - before;
    equal('a tool that never answers is TOOL_TIMEOUT', timeoutCode, 'TOOL_TIMEOUT');
    check(`bounded by the configured budget (took ${elapsed}ms)`, elapsed >= 900 && elapsed < 3000);

    // The session must survive a timed-out call.
    const after = await supervisor.callTool(toolServerId, 'echo', { still: 'here' });
    equal('and the session still works afterwards', JSON.parse(after.content[0].text), {
      still: 'here'
    });
  }

  describe('a server that is not running');
  {
    await supervisor.stopServer(toolServerId);
    let code = '';
    try {
      await supervisor.callTool(toolServerId, 'echo');
    } catch (err) {
      code = (err as { code: string }).code;
    }
    equal('calling a stopped server is SERVER_NOT_RUNNING', code, 'SERVER_NOT_RUNNING');

    let unknown = '';
    try {
      await supervisor.callTool('mcp_nope', 'echo');
    } catch (err) {
      unknown = (err as { code: string }).code;
    }
    equal('and an unknown server is NOT_FOUND', unknown, 'NOT_FOUND');

    await supervisor.startServer(toolServerId);
  }

  // --- Dynamic capability invalidation ---------------------------------------
  describe('notifications/tools/list_changed');
  {
    const seen: { type: string; payload: { server: McpServerRuntimeInfo } }[] = [];
    const record = (event: { type: string; payload: { server: McpServerRuntimeInfo } }) =>
      seen.push(event);
    eventBus.subscribe(MCP_EVENTS.CAPABILITIES_UPDATED, record);

    const config = await supervisor.saveServer({
      name: 'changing',
      command: NODE,
      args: ['-e', CHANGING_SERVER]
    });
    const started = await supervisor.startServer(config.id);
    equal('it starts with one tool', started.capabilities.tools.length, 1);
    seen.length = 0;

    // Calling the tool makes the server change its list and announce it.
    await supervisor.callTool(config.id, 'first');

    check(
      'the announcement re-reads the catalogue',
      await until(() => supervisor.getServerStatus(config.id).capabilities.tools.length === 2)
    );
    const refreshed = supervisor.getServerStatus(config.id);
    equal('the new tool is present', refreshed.capabilities.tools[1].name, 'second');
    equal('and the server is still RUNNING', refreshed.status, 'RUNNING');

    check(
      'mcp.capabilities_updated is emitted',
      await until(() => seen.some(e => e.type === MCP_EVENTS.CAPABILITIES_UPDATED))
    );
    const event = seen.find(e => e.type === MCP_EVENTS.CAPABILITIES_UPDATED);
    equal('carrying the updated server', event!.payload.server.id, config.id);
    equal('with both tools', event!.payload.server.capabilities!.tools.length, 2);

    // The newly announced tool is callable without an explicit refresh.
    const second = await supervisor.callTool(config.id, 'first');
    equal('and the session is unaffected', second.isError, false);

    eventBus.unsubscribe(MCP_EVENTS.CAPABILITIES_UPDATED, record);
    await supervisor.stopServer(config.id);
    await supervisor.deleteServer(config.id);
  }

  // --- The REST surface --------------------------------------------------------
  describe('POST /api/v1/mcp/servers/:id/tools/:toolName');
  {
    const app = Fastify();
    app.addHook(
      'preHandler',
      async (request: { headers: Record<string, unknown>; user?: unknown }) => {
        if (request.headers['x-test-anonymous']) return;
        request.user = { acc: 'acc_dev', sub: 'usr_dev' };
      }
    );
    await app.register(mcpRoutes);
    await app.ready();

    // Created and started through the routes: they speak to the shared
    // supervisor, which has its own runtime state and knows nothing about the
    // instance the unit cases above used.
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp/servers',
      payload: { name: 'tool-http', command: NODE, args: ['-e', TOOL_SERVER] }
    });
    const httpId = created.json().server.id;
    const startedOverHttp = await app.inject({
      method: 'POST',
      url: `/api/v1/mcp/servers/${httpId}/start`
    });
    equal('the server starts over HTTP', startedOverHttp.json().server.status, 'RUNNING');

    const called = await app.inject({
      method: 'POST',
      url: `/api/v1/mcp/servers/${httpId}/tools/echo`,
      payload: { arguments: { hello: 'world' } }
    });
    equal('a successful call is a 200', called.statusCode, 200);
    equal('reporting no error', called.json().isError, false);
    equal('and returning the content', JSON.parse(called.json().result.content[0].text), {
      hello: 'world'
    });

    const noBody = await app.inject({
      method: 'POST',
      url: `/api/v1/mcp/servers/${httpId}/tools/echo`
    });
    equal('a call with no body still works', noBody.statusCode, 200);

    const toolFailed = await app.inject({
      method: 'POST',
      url: `/api/v1/mcp/servers/${httpId}/tools/boom`,
      payload: { arguments: {} }
    });
    equal('a tool reporting failure is still a 200', toolFailed.statusCode, 200);
    equal('flagged as an error', toolFailed.json().isError, true);
    check(
      'with the tool’s own explanation',
      toolFailed.json().result.content[0].text.includes('refused')
    );

    const badArgs = await app.inject({
      method: 'POST',
      url: `/api/v1/mcp/servers/${httpId}/tools/echo`,
      payload: { arguments: 'not an object' }
    });
    equal('non-object arguments are a 400', badArgs.statusCode, 400);

    const missing = await app.inject({
      method: 'POST',
      url: `/api/v1/mcp/servers/${httpId}/tools/nope`,
      payload: { arguments: {} }
    });
    equal('an unknown tool is a 404', missing.statusCode, 404);
    equal('with TOOL_NOT_FOUND', missing.json().code, 'TOOL_NOT_FOUND');

    const slow = await app.inject({
      method: 'POST',
      url: `/api/v1/mcp/servers/${httpId}/tools/hang`,
      payload: { arguments: {} }
    });
    equal('a tool that never answers is a 504', slow.statusCode, 504);
    equal('with TOOL_TIMEOUT', slow.json().code, 'TOOL_TIMEOUT');

    const anonymous = await app.inject({
      method: 'POST',
      url: `/api/v1/mcp/servers/${httpId}/tools/echo`,
      headers: { 'x-test-anonymous': '1' },
      payload: { arguments: {} }
    });
    equal('an unauthenticated caller is refused', anonymous.statusCode, 401);

    await app.inject({ method: 'POST', url: `/api/v1/mcp/servers/${httpId}/stop` });
    const stopped = await app.inject({
      method: 'POST',
      url: `/api/v1/mcp/servers/${httpId}/tools/echo`,
      payload: { arguments: {} }
    });
    equal('calling a stopped server is a 409', stopped.statusCode, 409);
    equal('with SERVER_NOT_RUNNING', stopped.json().code, 'SERVER_NOT_RUNNING');

    const unknownServer = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp/servers/mcp_nope/tools/echo',
      payload: { arguments: {} }
    });
    equal('an unknown server is a 404', unknownServer.statusCode, 404);

    await app.inject({ method: 'DELETE', url: `/api/v1/mcp/servers/${httpId}` });
    await app.close();
  }

  await supervisor.shutdownAll();
  const { mcpProcessSupervisor } = require('../McpProcessSupervisor');
  await mcpProcessSupervisor.shutdownAll();
}

main()
  .catch(err => {
    failed++;
    console.error('\nUNCAUGHT ERROR:', err);
  })
  .finally(() => {
    cleanup();
    console.log(`\n${passed}/${passed + failed} assertions passed`);
    if (failures.length > 0) {
      console.log('Failed assertions:');
      for (const f of failures) console.log(`  - ${f}`);
    }
    process.exit(failed === 0 ? 0 : 1);
  });
