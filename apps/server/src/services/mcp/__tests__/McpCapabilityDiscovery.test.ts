/**
 * Tests for MCP capability discovery (P6-02).
 *
 * Two layers. `McpStdioClient` is driven over a pair of in-memory streams, which
 * is the only way to control framing precisely enough to prove the parts that
 * break in production: a message split across two chunks, two messages in one
 * chunk, a banner line a server should not have printed, answers arriving out of
 * order. The supervisor is then exercised against real child processes speaking
 * real JSON-RPC, because a handshake that works against a mock object and not
 * against a pipe is not a handshake.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/mcp/__tests__/McpCapabilityDiscovery.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-mcp-cap-'));
process.env.ASTERIM_DATA_DIR = tmpDir;

const Fastify = require('fastify');
const { dbService } = require('../../DatabaseService');
const { eventBus } = require('../../EventBus');
const { McpProcessSupervisor } = require('../McpProcessSupervisor');
const { McpStdioClient, MCP_PROTOCOL_VERSION } = require('../McpStdioClient');
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

// --- Mock MCP servers, as real child processes ------------------------------

/** The newline-delimited JSON-RPC loop every mock below shares. */
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

const TOOLS = [
  {
    name: 'read_file',
    description: 'Read a file from disk',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  },
  { name: 'write_file', description: 'Write a file to disk' }
];

const RESOURCES = [
  {
    uri: 'file:///workspace',
    name: 'workspace',
    description: 'Project root',
    mimeType: 'inode/directory'
  }
];

const PROMPTS = [
  {
    name: 'summarise',
    description: 'Summarise a file',
    arguments: [{ name: 'path', required: true }]
  }
];

/** Advertises and serves tools, resources and prompts. */
const FULL_SERVER = `
  const TOOLS = ${JSON.stringify(TOOLS)};
  const RESOURCES = ${JSON.stringify(RESOURCES)};
  const PROMPTS = ${JSON.stringify(PROMPTS)};
  let refreshed = false;
  function handle(msg) {
    if (msg.method === 'initialize') {
      respond(msg.id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'mock-full', version: '1.2.3' },
        capabilities: { tools: {}, resources: {}, prompts: {} }
      });
    } else if (msg.method === 'tools/list') {
      // A second discovery sees a changed tool list, which is what a refresh
      // exists to notice.
      respond(msg.id, { tools: refreshed ? TOOLS.concat([{ name: 'delete_file' }]) : TOOLS });
      refreshed = true;
    } else if (msg.method === 'resources/list') {
      respond(msg.id, { resources: RESOURCES });
    } else if (msg.method === 'prompts/list') {
      respond(msg.id, { prompts: PROMPTS });
    } else if (msg.id !== undefined) {
      fail(msg.id, -32601, 'Method not found: ' + msg.method);
    }
  }
  ${RPC_LOOP}
`;

/** Advertises tools only — asking it for prompts would be a client bug. */
const TOOLS_ONLY_SERVER = `
  function handle(msg) {
    if (msg.method === 'initialize') {
      respond(msg.id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'mock-tools', version: '0.1.0' },
        capabilities: { tools: {} }
      });
    } else if (msg.method === 'tools/list') {
      respond(msg.id, { tools: [{ name: 'ping' }] });
    } else if (msg.method === 'prompts/list' || msg.method === 'resources/list') {
      // Reached only if the client ignores what was advertised.
      process.stderr.write('client asked for an unadvertised list\\n');
      fail(msg.id, -32601, 'Method not found');
    } else if (msg.id !== undefined) {
      fail(msg.id, -32601, 'Method not found');
    }
  }
  ${RPC_LOOP}
`;

/** Advertises prompts, then denies knowing the method. */
const LYING_SERVER = `
  function handle(msg) {
    if (msg.method === 'initialize') {
      respond(msg.id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'mock-lying', version: '0.0.1' },
        capabilities: { tools: {}, prompts: {} }
      });
    } else if (msg.method === 'tools/list') {
      respond(msg.id, { tools: [{ name: 'only_tool' }] });
    } else if (msg.method === 'prompts/list') {
      fail(msg.id, -32601, 'Method not found');
    } else if (msg.id !== undefined) {
      fail(msg.id, -32601, 'Method not found');
    }
  }
  ${RPC_LOOP}
`;

/** Alive, speaks nothing. The handshake has to time out. */
const SILENT_SERVER = `
  process.stdin.resume();
  process.stderr.write('starting up, one moment\\n');
  setInterval(() => {}, 1000);
`;

/** Answers initialize with a JSON-RPC error. */
const REFUSING_SERVER = `
  function handle(msg) {
    if (msg.id !== undefined) fail(msg.id, -32000, 'initialization refused');
  }
  ${RPC_LOOP}
`;

// --- A stream-level stand-in for a server, for framing control ---------------

/** A JSON-RPC message as this suite reads it back. */
interface RpcMessage {
  [key: string]: unknown;
}

interface StreamPair {
  toServer: PassThrough;
  toClient: PassThrough;
  /** Everything the client has written, as parsed messages. */
  received: RpcMessage[];
  send(raw: string): void;
}

function streamPair(onMessage?: (msg: RpcMessage) => void): StreamPair {
  const toServer = new PassThrough();
  const toClient = new PassThrough();
  const received: RpcMessage[] = [];

  let buffer = '';
  toServer.on('data', chunk => {
    buffer += chunk.toString('utf8');
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        const parsed = JSON.parse(line);
        received.push(parsed);
        onMessage?.(parsed);
      }
      index = buffer.indexOf('\n');
    }
  });

  return {
    toServer,
    toClient,
    received,
    send: (raw: string) => toClient.write(raw)
  };
}

async function main(): Promise<void> {
  dbService.getDb();

  // --- Framing ---------------------------------------------------------------
  describe('McpStdioClient framing');
  {
    const pair = streamPair();
    const client = new McpStdioClient(pair.toServer, pair.toClient, { timeoutMs: 2000 });

    const pending = client.request('ping');
    await wait(20);
    equal('the request is written as one newline-terminated line', pair.received.length, 1);
    equal('with the JSON-RPC envelope', pair.received[0].jsonrpc, '2.0');
    equal('and the method', pair.received[0].method, 'ping');

    // Split the response across three writes, one of them mid-token.
    const response = JSON.stringify({
      jsonrpc: '2.0',
      id: pair.received[0].id,
      result: { ok: true }
    });
    pair.send(response.slice(0, 10));
    await wait(10);
    pair.send(response.slice(10, 25));
    await wait(10);
    pair.send(response.slice(25) + '\n');

    equal('a response split across chunks is reassembled', await pending, { ok: true });
    client.dispose();
  }

  {
    const pair = streamPair();
    const client = new McpStdioClient(pair.toServer, pair.toClient, { timeoutMs: 2000 });

    const first = client.request('one');
    const second = client.request('two');
    await wait(20);
    const [a, b] = pair.received;

    // Both answers in a single write, and the second request answered first.
    pair.send(
      JSON.stringify({ jsonrpc: '2.0', id: b.id, result: 'second' }) +
        '\n' +
        JSON.stringify({ jsonrpc: '2.0', id: a.id, result: 'first' }) +
        '\n'
    );

    equal('two messages in one chunk are both delivered', await second, 'second');
    equal('and answers are matched by id, not by arrival order', await first, 'first');
    client.dispose();
  }

  {
    const pair = streamPair();
    const client = new McpStdioClient(pair.toServer, pair.toClient, {
      timeoutMs: 2000,
      logger: () => undefined
    });

    const pending = client.request('ping');
    await wait(20);
    pair.send('Server listening on stdio!\n');
    pair.send(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: {} }) + '\n'
    );
    pair.send(JSON.stringify({ jsonrpc: '2.0', id: 999, result: 'for nobody' }) + '\n');
    pair.send(JSON.stringify({ jsonrpc: '2.0', id: pair.received[0].id, result: 'mine' }) + '\n');

    equal('a banner line, a notification and a stray id are all survived', await pending, 'mine');
    client.dispose();
  }

  {
    const pair = streamPair();
    const client = new McpStdioClient(pair.toServer, pair.toClient, { timeoutMs: 150 });
    let message = '';
    try {
      await client.request('never/answered');
    } catch (err) {
      message = (err as Error).message;
    }
    check('an unanswered request times out', message.includes('timed out'));
    check('naming the method', message.includes('never/answered'));
    client.dispose();
  }

  {
    const pair = streamPair();
    const client = new McpStdioClient(pair.toServer, pair.toClient, { timeoutMs: 2000 });
    const pending = client.request('in/flight');
    await wait(20);
    client.dispose();
    let message = '';
    try {
      await pending;
    } catch (err) {
      message = (err as Error).message;
    }
    check('disposing fails whatever was in flight', message.includes('disposed'));
  }

  // --- The handshake ---------------------------------------------------------
  describe('McpStdioClient.discover');
  {
    const pair = streamPair(msg => {
      if (msg.method === 'initialize') {
        pair.send(
          JSON.stringify({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: '2024-11-05',
              serverInfo: { name: 'inline', version: '9.9.9' },
              capabilities: { tools: {} }
            }
          }) + '\n'
        );
      } else if (msg.method === 'tools/list') {
        pair.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } }) + '\n');
      }
    });

    const client = new McpStdioClient(pair.toServer, pair.toClient, { timeoutMs: 2000 });
    const capabilities = await client.discover();

    equal('the negotiated protocol version comes back', capabilities.protocolVersion, '2024-11-05');
    equal('and the server identifies itself', capabilities.serverInfo, {
      name: 'inline',
      version: '9.9.9'
    });
    equal('tools are read', capabilities.tools.length, 2);
    equal('with their schemas intact', capabilities.tools[0].inputSchema, TOOLS[0].inputSchema);
    equal('unadvertised resources are empty, not requested', capabilities.resources, []);
    equal('and so are prompts', capabilities.prompts, []);
    check('the discovery is stamped', typeof capabilities.discoveredAt === 'number');

    const methods = pair.received.map(m => m.method);
    equal('the client sends initialize first', methods[0], 'initialize');
    check('then the initialized notification', methods.includes('notifications/initialized'));
    check('and never asks for prompts', !methods.includes('prompts/list'));
    equal(
      'the negotiated version is the one this client claims',
      MCP_PROTOCOL_VERSION,
      '2024-11-05'
    );
    const init = pair.received[0] as { params: { clientInfo: { name: string } } };
    equal('with its own identity', init.params.clientInfo.name, 'asterim-core');
    client.dispose();
  }

  // --- Discovery through the supervisor, against real processes ---------------
  const supervisor = new McpProcessSupervisor({ requestTimeoutMs: 2000, handshakeTimeoutMs: 4000 });

  describe('a full MCP server, supervised');
  let fullId: string;
  {
    const config = await supervisor.saveServer({
      name: 'mock-full',
      command: NODE,
      args: ['-e', FULL_SERVER]
    });
    fullId = config.id;

    const started = await supervisor.startServer(fullId);
    equal('it reaches RUNNING', started.status, 'RUNNING');
    check('with a pid', typeof started.pid === 'number');
    equal(
      'the handshake recorded the protocol version',
      started.capabilities.protocolVersion,
      '2024-11-05'
    );
    equal('and the server identity', started.capabilities.serverInfo.name, 'mock-full');
    equal('two tools were discovered', started.capabilities.tools.length, 2);
    equal(
      'named',
      started.capabilities.tools.map((t: { name: string }) => t.name),
      ['read_file', 'write_file']
    );
    equal('one resource', started.capabilities.resources.length, 1);
    equal('and one prompt', started.capabilities.prompts.length, 1);
    equal(
      'the tool schema survived the round trip',
      started.capabilities.tools[0].inputSchema,
      TOOLS[0].inputSchema
    );
    equal('and no error was recorded', started.lastError, null);
  }

  describe('refreshing capabilities');
  {
    const before = supervisor.getServerStatus(fullId).capabilities;
    const refreshed = await supervisor.refreshCapabilities(fullId);

    equal('the server stays RUNNING', refreshed.status, 'RUNNING');
    equal(
      'a tool added since the last handshake is picked up',
      refreshed.capabilities.tools.length,
      3
    );
    check('and the snapshot is newer', refreshed.capabilities.discoveredAt >= before.discoveredAt);
  }

  describe('a server that advertises only tools');
  {
    const config = await supervisor.saveServer({
      name: 'mock-tools',
      command: NODE,
      args: ['-e', TOOLS_ONLY_SERVER]
    });
    const started = await supervisor.startServer(config.id);

    equal('it reaches RUNNING', started.status, 'RUNNING');
    equal('its one tool is found', started.capabilities.tools.length, 1);
    equal('resources are empty', started.capabilities.resources, []);
    equal('prompts are empty', started.capabilities.prompts, []);
    check(
      'and the server never complained about an unadvertised request',
      !supervisor.getLogs(config.id).some((line: string) => line.includes('unadvertised'))
    );

    await supervisor.stopServer(config.id);
    await supervisor.deleteServer(config.id);
  }

  describe('a server that advertises what it does not implement');
  {
    const config = await supervisor.saveServer({
      name: 'mock-lying',
      command: NODE,
      args: ['-e', LYING_SERVER]
    });
    const started = await supervisor.startServer(config.id);

    equal('it is still usable', started.status, 'RUNNING');
    equal('its tools are read', started.capabilities.tools.length, 1);
    equal('and the missing method degrades to an empty list', started.capabilities.prompts, []);

    await supervisor.stopServer(config.id);
    await supervisor.deleteServer(config.id);
  }

  describe('a server that never answers');
  {
    const config = await supervisor.saveServer({
      name: 'mock-silent',
      command: NODE,
      args: ['-e', SILENT_SERVER]
    });
    const started = await supervisor.startServer(config.id);

    equal('the handshake timeout marks it ERROR', started.status, 'ERROR');
    check('with the reason recorded', (started.lastError || '').includes('Handshake failed'));
    // The per-request bound (2s here) is tighter than the whole-handshake bound
    // (4s), so it is the one that fires first.
    check('naming the timeout', (started.lastError || '').includes('timed out'));
    check('and the request that hit it', (started.lastError || '').includes('initialize'));
    equal('no capabilities are claimed', started.capabilities, null);
    equal('and the unusable process is not left running', started.pid, null);
    check(
      'its stderr is still available for diagnosis',
      supervisor.getLogs(config.id).some((line: string) => line.includes('starting up'))
    );

    await supervisor.deleteServer(config.id);
  }

  describe('a server that answers slowly enough to exhaust the handshake bound');
  {
    // Request timeout generous, whole-handshake bound tight: the outer bound is
    // what has to stop this one.
    const impatient = new McpProcessSupervisor({
      requestTimeoutMs: 5000,
      handshakeTimeoutMs: 400
    });
    const config = await impatient.saveServer({
      name: 'mock-slow',
      command: NODE,
      args: ['-e', SILENT_SERVER]
    });
    const started = await impatient.startServer(config.id);

    equal('it is ERROR', started.status, 'ERROR');
    check(
      'stopped by the whole-handshake bound',
      (started.lastError || '').includes('did not complete within 400ms')
    );
    equal('and nothing is left running', started.pid, null);

    await impatient.deleteServer(config.id);
  }

  describe('a server that refuses to initialize');
  {
    const config = await supervisor.saveServer({
      name: 'mock-refusing',
      command: NODE,
      args: ['-e', REFUSING_SERVER]
    });
    const started = await supervisor.startServer(config.id);

    equal('it is ERROR', started.status, 'ERROR');
    check(
      'with the server’s own message',
      (started.lastError || '').includes('initialization refused')
    );
    equal('and nothing is left running', started.pid, null);

    await supervisor.deleteServer(config.id);
  }

  // --- EventBus ---------------------------------------------------------------
  describe('EventBus emissions');
  {
    interface SeenEvent {
      type: string;
      payload: { server: McpServerRuntimeInfo };
    }
    const seen: SeenEvent[] = [];
    const record = (event: SeenEvent) => seen.push(event);
    for (const type of Object.values(MCP_EVENTS)) {
      eventBus.subscribe(type as string, record);
    }

    const config = await supervisor.saveServer({
      name: 'mock-events',
      command: NODE,
      args: ['-e', FULL_SERVER]
    });

    await supervisor.startServer(config.id);
    check(
      'starting emits mcp.server_started',
      seen.some(e => e.type === MCP_EVENTS.SERVER_STARTED)
    );
    check(
      'and mcp.capabilities_updated',
      seen.some(e => e.type === MCP_EVENTS.CAPABILITIES_UPDATED)
    );

    const startedEvent = seen.find(e => e.type === MCP_EVENTS.SERVER_STARTED) as SeenEvent;
    equal('the payload carries the server', startedEvent.payload.server.id, config.id);
    equal('with its status', startedEvent.payload.server.status, 'RUNNING');
    equal('and its capabilities', startedEvent.payload.server.capabilities?.tools.length, 2);
    check(
      'no projectId, so nothing persists it to the project log',
      !('projectId' in startedEvent.payload)
    );

    seen.length = 0;
    await supervisor.stopServer(config.id);
    check(
      'stopping emits mcp.server_stopped',
      await until(() => seen.some(e => e.type === MCP_EVENTS.SERVER_STOPPED))
    );
    equal(
      'reporting STOPPED',
      (seen.find(e => e.type === MCP_EVENTS.SERVER_STOPPED) as SeenEvent).payload.server.status,
      'STOPPED'
    );

    seen.length = 0;
    const crasher = await supervisor.saveServer({
      name: 'mock-crasher',
      command: NODE,
      args: ['-e', "process.stderr.write('bye\\n'); process.exit(4);"]
    });
    await supervisor.startServer(crasher.id);
    check(
      'a crash emits mcp.server_crashed',
      await until(() => seen.some(e => e.type === MCP_EVENTS.SERVER_CRASHED))
    );

    for (const type of Object.values(MCP_EVENTS)) {
      eventBus.unsubscribe(type as string, record);
    }
    await supervisor.deleteServer(config.id);
    await supervisor.deleteServer(crasher.id);
  }

  // --- Autostart ---------------------------------------------------------------
  describe('autostartEnabledServers');
  {
    // Start from a clean slate so only this block's servers are considered.
    for (const existing of supervisor.listConfigs()) {
      await supervisor.deleteServer(existing.id);
    }

    const enabledA = await supervisor.saveServer({
      name: 'auto-enabled-a',
      command: NODE,
      args: ['-e', FULL_SERVER]
    });
    const enabledB = await supervisor.saveServer({
      name: 'auto-enabled-b',
      command: NODE,
      args: ['-e', TOOLS_ONLY_SERVER]
    });
    const disabled = await supervisor.saveServer({
      name: 'auto-disabled',
      command: NODE,
      args: ['-e', FULL_SERVER],
      isEnabled: false
    });
    const broken = await supervisor.saveServer({
      name: 'auto-broken',
      command: '/nonexistent/mcp-binary',
      args: []
    });

    const results = await supervisor.autostartEnabledServers();

    equal('only enabled servers are considered', results.length, 3);
    equal('the good ones are RUNNING', supervisor.getServerStatus(enabledA.id).status, 'RUNNING');
    equal('both of them', supervisor.getServerStatus(enabledB.id).status, 'RUNNING');
    equal(
      'a disabled server is left alone',
      supervisor.getServerStatus(disabled.id).status,
      'STOPPED'
    );
    equal('a broken one is ERROR', supervisor.getServerStatus(broken.id).status, 'ERROR');
    check('and autostart itself did not throw', Array.isArray(results));
    equal(
      'capabilities are available immediately after boot',
      supervisor.getServerStatus(enabledA.id).capabilities.tools.length,
      2
    );

    await supervisor.shutdownAll();
    for (const existing of supervisor.listConfigs()) {
      await supervisor.deleteServer(existing.id);
    }
  }

  // --- REST --------------------------------------------------------------------
  describe('the capability routes');
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

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp/servers',
      payload: { name: 'http-capabilities', command: NODE, args: ['-e', FULL_SERVER] }
    });
    const id = created.json().server.id;

    const beforeStart = await app.inject({
      method: 'GET',
      url: `/api/v1/mcp/servers/${id}/capabilities`
    });
    equal('capabilities are 200 before any handshake', beforeStart.statusCode, 200);
    equal('with null rather than an invented answer', beforeStart.json().capabilities, null);
    equal('and the current status', beforeStart.json().status, 'STOPPED');

    const started = await app.inject({ method: 'POST', url: `/api/v1/mcp/servers/${id}/start` });
    equal('starting over HTTP reaches RUNNING', started.json().server.status, 'RUNNING');

    const capabilities = await app.inject({
      method: 'GET',
      url: `/api/v1/mcp/servers/${id}/capabilities`
    });
    equal('capabilities are then served', capabilities.statusCode, 200);
    equal('with the tools', capabilities.json().capabilities.tools.length, 2);
    equal('the resources', capabilities.json().capabilities.resources.length, 1);
    equal('and the prompts', capabilities.json().capabilities.prompts.length, 1);

    const refreshed = await app.inject({
      method: 'POST',
      url: `/api/v1/mcp/servers/${id}/refresh`
    });
    equal('refresh answers 200', refreshed.statusCode, 200);
    equal('with the updated tool list', refreshed.json().server.capabilities.tools.length, 3);

    await app.inject({ method: 'POST', url: `/api/v1/mcp/servers/${id}/stop` });
    const refreshStopped = await app.inject({
      method: 'POST',
      url: `/api/v1/mcp/servers/${id}/refresh`
    });
    equal('refreshing a stopped server is a 409', refreshStopped.statusCode, 409);
    equal('with SERVER_NOT_RUNNING', refreshStopped.json().code, 'SERVER_NOT_RUNNING');

    const stale = await app.inject({
      method: 'GET',
      url: `/api/v1/mcp/servers/${id}/capabilities`
    });
    equal('its last-known capabilities remain readable', stale.json().capabilities.tools.length, 3);
    equal('alongside the status that explains them', stale.json().status, 'STOPPED');

    const missing = await app.inject({
      method: 'GET',
      url: '/api/v1/mcp/servers/mcp_nope/capabilities'
    });
    equal('an unknown server is a 404', missing.statusCode, 404);
    const missingRefresh = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp/servers/mcp_nope/refresh'
    });
    equal('and so is refreshing one', missingRefresh.statusCode, 404);

    const anonymous = await app.inject({
      method: 'GET',
      url: `/api/v1/mcp/servers/${id}/capabilities`,
      headers: { 'x-test-anonymous': '1' }
    });
    equal('an unauthenticated caller is refused', anonymous.statusCode, 401);

    await app.inject({ method: 'DELETE', url: `/api/v1/mcp/servers/${id}` });
    await app.close();
  }

  await supervisor.shutdownAll();
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
