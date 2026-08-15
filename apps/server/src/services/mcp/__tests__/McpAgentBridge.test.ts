/**
 * Tests for the agent tool bridge, schema validation and per-server queueing
 * (P6-04).
 *
 * The queue is the part that cannot be faked. A stdio MCP server is one pipe,
 * and the failure this exists to prevent — two calls interleaved on it — only
 * appears against a real child process that reports what it saw. The mock
 * server below therefore records whether a second call ever arrived while the
 * first was still open, and the burst test asserts that it never did.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/mcp/__tests__/McpAgentBridge.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-mcp-bridge-'));
process.env.ASTERIM_DATA_DIR = tmpDir;

const { dbService } = require('../../DatabaseService');
const { McpProcessSupervisor } = require('../McpProcessSupervisor');
const { McpAgentBridge, namespaceToolName, flattenContent } = require('../McpAgentBridge');
const { validateToolArguments, MAX_SCHEMA_DEPTH } = require('../SchemaValidator');

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

const NODE = process.execPath;

// --- Mock servers -----------------------------------------------------------

const RPC_LOOP = `
  const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\\n');
  const respond = (id, result) => send({ jsonrpc: '2.0', id, result });
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
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        encoding: { type: 'string', enum: ['utf8', 'base64'] }
      },
      required: ['path']
    }
  },
  {
    name: 'count_lines',
    description: 'Count lines in a file',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, limit: { type: 'integer' } },
      required: ['path']
    }
  }
];

/**
 * Answers slowly, and reports whether another call arrived while it was still
 * working — the observable form of "the pipe was used by two calls at once".
 */
const SLOW_SERVER = `
  const TOOLS = ${JSON.stringify(TOOLS)};
  let inFlight = 0;
  let overlapped = false;
  let served = 0;
  function handle(msg) {
    if (msg.method === 'initialize') {
      respond(msg.id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'slow-mock', version: '1.0.0' },
        capabilities: { tools: {} }
      });
    } else if (msg.method === 'tools/list') {
      respond(msg.id, { tools: TOOLS });
    } else if (msg.method === 'tools/call') {
      const name = msg.params.name;
      if (name === 'read_file') {
        inFlight += 1;
        if (inFlight > 1) overlapped = true;
        const order = ++served;
        setTimeout(() => {
          inFlight -= 1;
          respond(msg.id, {
            content: [{ type: 'text', text: JSON.stringify({ order, overlapped, path: msg.params.arguments.path }) }],
            isError: false
          });
        }, 60);
      } else if (name === 'count_lines') {
        respond(msg.id, { content: [{ type: 'text', text: 'counted ' + JSON.stringify(msg.params.arguments) }], isError: false });
      }
    }
  }
  ${RPC_LOOP}
`;

/** A second server, to prove tools are aggregated and namespaced apart. */
const OTHER_SERVER = `
  function handle(msg) {
    if (msg.method === 'initialize') {
      respond(msg.id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'other-mock', version: '1.0.0' },
        capabilities: { tools: {} }
      });
    } else if (msg.method === 'tools/list') {
      respond(msg.id, { tools: [{ name: 'read_file', description: 'Read from the other place' }] });
    } else if (msg.method === 'tools/call') {
      respond(msg.id, { content: [{ type: 'text', text: 'other server answered' }], isError: false });
    }
  }
  ${RPC_LOOP}
`;

async function main(): Promise<void> {
  dbService.getDb();

  // --- SchemaValidator -------------------------------------------------------
  describe('validateToolArguments — the happy paths');
  {
    const schema = TOOLS[0].inputSchema;
    equal('valid arguments pass', validateToolArguments({ path: '/tmp/a' }, schema, 'read_file'), {
      valid: true
    });
    equal(
      'optional fields may be omitted',
      validateToolArguments({ path: '/tmp/a', encoding: 'utf8' }, schema, 'read_file').valid,
      true
    );
    equal(
      'a tool with no schema accepts anything',
      validateToolArguments({ anything: 1 }, undefined),
      {
        valid: true
      }
    );
    equal('and so does an empty schema', validateToolArguments({ a: 1 }, {}), { valid: true });
  }

  describe('validateToolArguments — what it catches');
  {
    const schema = TOOLS[0].inputSchema;

    const missing = validateToolArguments({}, schema, 'read_file');
    equal('a missing required field is invalid', missing.valid, false);
    equal('naming the field', missing.errors, ['read_file.path: required']);

    const wrongType = validateToolArguments({ path: 42 }, schema, 'read_file');
    equal('a wrong type is invalid', wrongType.valid, false);
    check(
      'saying what was expected',
      (wrongType.errors || [])[0].includes('expected string, received integer')
    );

    const badEnum = validateToolArguments({ path: '/a', encoding: 'rot13' }, schema, 'read_file');
    equal('a value outside an enum is invalid', badEnum.valid, false);
    check('listing the permitted values', (badEnum.errors || [])[0].includes('"utf8"'));

    const both = validateToolArguments({ encoding: 5 }, schema, 'read_file');
    equal('every problem is reported, not just the first', both.errors?.length, 2);

    const integer = validateToolArguments(
      { path: '/a', limit: 1.5 },
      TOOLS[1].inputSchema,
      'count_lines'
    );
    equal('a float where an integer is required is invalid', integer.valid, false);
    equal(
      'while an integer satisfies number',
      validateToolArguments({ n: 3 }, { type: 'object', properties: { n: { type: 'number' } } })
        .valid,
      true
    );

    const nested = validateToolArguments(
      { filter: { minSize: 'big' } },
      {
        type: 'object',
        properties: {
          filter: {
            type: 'object',
            properties: { minSize: { type: 'number' } },
            required: ['minSize']
          }
        }
      },
      'search'
    );
    equal('nested objects are checked', nested.valid, false);
    check('with a path to the field', (nested.errors || [])[0].includes('search.filter.minSize'));

    const array = validateToolArguments(
      { paths: ['/a', 7] },
      { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } } } },
      'read_many'
    );
    equal('array items are checked', array.valid, false);
    check('by index', (array.errors || [])[0].includes('paths[1]'));

    const nullArgs = validateToolArguments(undefined, schema, 'read_file');
    equal('no arguments at all is the same as {}', nullArgs.valid, false);
  }

  describe('validateToolArguments — it never throws');
  {
    // A schema that refers to itself: a plausible shape for a file tree, and a
    // guaranteed stack overflow for a naive walker.
    const cyclic: Record<string, unknown> = { type: 'object', properties: {} };
    (cyclic.properties as Record<string, unknown>).child = cyclic;
    const deep: Record<string, unknown> = { child: {} };
    let cursor = deep;
    for (let i = 0; i < MAX_SCHEMA_DEPTH + 5; i++) {
      cursor.child = { child: {} };
      cursor = cursor.child as Record<string, unknown>;
    }

    let threw = false;
    let result;
    try {
      result = validateToolArguments(deep, cyclic, 'tree');
    } catch {
      threw = true;
    }
    check('a self-referential schema does not throw', !threw);
    equal('and is treated as permissive', result?.valid, true);

    equal(
      'a schema that is not an object is ignored',
      validateToolArguments({ a: 1 }, 'not a schema' as unknown as Record<string, unknown>).valid,
      true
    );
    equal(
      'an unknown keyword is ignored rather than rejected',
      validateToolArguments({ a: 1 }, { type: 'object', oneOf: [{ required: ['b'] }] }).valid,
      true
    );
  }

  // --- The bridge ------------------------------------------------------------
  const supervisor = new McpProcessSupervisor({
    requestTimeoutMs: 3000,
    handshakeTimeoutMs: 5000,
    toolTimeoutMs: 2000
  });
  const bridge = new McpAgentBridge(supervisor);

  describe('namespaceToolName and flattenContent');
  equal(
    'a tool is namespaced by its server',
    namespaceToolName('filesystem', 'read_file'),
    'mcp__filesystem__read_file'
  );
  equal('empty content is described', flattenContent([]), '(the tool returned no content)');
  equal(
    'text parts are joined',
    flattenContent([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' }
    ]),
    'a\nb'
  );
  check(
    'binary content is described rather than dumped',
    flattenContent([{ type: 'image', data: 'aGk=', mimeType: 'image/png' }]).includes('image/png')
  );

  describe('getAvailableTools');
  let slowId: string;
  let otherId: string;
  {
    const slow = await supervisor.saveServer({
      name: 'slow-mock',
      command: NODE,
      args: ['-e', SLOW_SERVER],
      workspaceId: 'ws_alpha'
    });
    slowId = slow.id;
    const other = await supervisor.saveServer({
      name: 'other-mock',
      command: NODE,
      args: ['-e', OTHER_SERVER],
      isGlobal: true
    });
    otherId = other.id;

    equal('a stopped server offers nothing', bridge.getAvailableTools().length, 0);

    await supervisor.startServer(slowId);
    const afterOne = bridge.getAvailableTools();
    equal('a running server contributes its tools', afterOne.length, 2);
    equal('namespaced by server', afterOne[0].name, 'mcp__slow-mock__read_file');
    check(
      'with a description an agent can choose from',
      afterOne[0].description.includes('Read a file from disk')
    );
    check('naming the server it came from', afterOne[0].description.includes('slow-mock'));
    equal('and the schema it must satisfy', afterOne[0].inputSchema, TOOLS[0].inputSchema);

    await supervisor.startServer(otherId);
    const both = bridge.getAvailableTools();
    equal('tools from every running server are aggregated', both.length, 3);
    const sameName = both.filter((tool: { toolName: string }) => tool.toolName === 'read_file');
    equal('two servers may publish the same tool name', sameName.length, 2);
    equal(
      'kept apart by the namespace',
      sameName.map((tool: { name: string }) => tool.name).sort(),
      ['mcp__other-mock__read_file', 'mcp__slow-mock__read_file']
    );

    const scoped = bridge.getAvailableTools('ws_beta');
    equal('another workspace sees only the global server', scoped.length, 1);
    equal('which is the global one', scoped[0].name, 'mcp__other-mock__read_file');

    const alpha = bridge.getAvailableTools('ws_alpha');
    equal('its own workspace sees both', alpha.length, 3);
  }

  describe('executeTool');
  {
    const ok = await bridge.executeTool('mcp__slow-mock__count_lines', {
      path: '/tmp/a',
      limit: 5
    });
    equal('a successful call is not an error', ok.isError, false);
    check('and carries the tool’s text', ok.text.includes('counted'));
    check('with the arguments that were sent', ok.text.includes('/tmp/a'));
    equal('reported under the name that was called', ok.name, 'mcp__slow-mock__count_lines');

    const other = await bridge.executeTool('mcp__other-mock__read_file', {});
    equal('the namespace routes to the right server', other.text, 'other server answered');
  }

  describe('executeTool — failures come back as answers, not exceptions');
  {
    const badArgs = await bridge.executeTool('mcp__slow-mock__read_file', { path: 42 });
    equal('invalid arguments are an error result', badArgs.isError, true);
    check('explaining the problem', badArgs.text.includes('expected string'));
    check('and what to do about it', badArgs.text.includes('Correct the arguments'));

    const missing = await bridge.executeTool('mcp__slow-mock__read_file', {});
    equal('a missing required field is caught before the pipe', missing.isError, true);
    check('naming the field', missing.text.includes('path: required'));

    const unknownTool = await bridge.executeTool('mcp__slow-mock__no_such_tool', {});
    equal('an unknown tool is an error result', unknownTool.isError, true);
    check(
      'listing what is available instead',
      unknownTool.text.includes('mcp__slow-mock__read_file')
    );

    const notMcp = await bridge.executeTool('read_file', {});
    equal('a name that is not namespaced is refused', notMcp.isError, true);
    check('explaining the convention', notMcp.text.includes('mcp__<server>__<tool>'));

    await supervisor.stopServer(otherId);
    const stopped = await bridge.executeTool('mcp__other-mock__read_file', {});
    equal('a stopped server is an error result', stopped.isError, true);
    check('saying which server and why', stopped.text.includes("'other-mock' is stopped"));
    check('and what to do', stopped.text.includes('Start it'));
  }

  // --- The queue -------------------------------------------------------------
  describe('per-server queueing');
  {
    const burst = await Promise.all(
      ['/a', '/b', '/c', '/d', '/e'].map(target =>
        bridge.executeTool('mcp__slow-mock__read_file', { path: target })
      )
    );

    equal('all five calls succeed', burst.filter(result => !result.isError).length, 5);

    const answers = burst.map(result => JSON.parse(result.text));
    check(
      'the server never saw two calls at once',
      answers.every(answer => answer.overlapped === false)
    );
    equal(
      'and served them one at a time, in order',
      answers.map((answer: { order: number }) => answer.order),
      [1, 2, 3, 4, 5]
    );
    equal(
      'each call got its own arguments back',
      answers.map((answer: { path: string }) => answer.path),
      ['/a', '/b', '/c', '/d', '/e']
    );

    equal('the queue is empty afterwards', supervisor.queueDepth(slowId), 0);
  }

  describe('the queue releases its slot when a call fails');
  {
    // A call that times out must not wedge the server behind it.
    const impatient = new McpProcessSupervisor({
      requestTimeoutMs: 3000,
      handshakeTimeoutMs: 5000,
      toolTimeoutMs: 30
    });
    const config = await impatient.saveServer({
      name: 'timeout-mock',
      command: NODE,
      args: ['-e', SLOW_SERVER]
    });
    await impatient.startServer(config.id);

    let timedOut = '';
    try {
      await impatient.callTool(config.id, 'read_file', { path: '/slow' });
    } catch (err) {
      timedOut = (err as { code: string }).code;
    }
    equal('the slow call times out', timedOut, 'TOOL_TIMEOUT');
    equal('and leaves nothing queued', impatient.queueDepth(config.id), 0);

    // The proof that the slot was released: the next call still works.
    const after = await impatient.callTool(config.id, 'count_lines', { path: '/fast' });
    equal('the next call is served normally', after.isError, false);

    await impatient.stopServer(config.id);
    await impatient.deleteServer(config.id);
  }

  describe('the queue has a bottom');
  {
    const shallow = new McpProcessSupervisor({
      requestTimeoutMs: 3000,
      handshakeTimeoutMs: 5000,
      toolTimeoutMs: 4000,
      maxQueueDepth: 2
    });
    const config = await shallow.saveServer({
      name: 'shallow-mock',
      command: NODE,
      args: ['-e', SLOW_SERVER]
    });
    await shallow.startServer(config.id);

    // One running, two waiting, and the fourth has nowhere to go.
    const calls = [1, 2, 3, 4].map(index =>
      shallow.callTool(config.id, 'read_file', { path: `/burst-${index}` }).then(
        () => 'ok',
        (err: { code?: string }) => err.code || 'error'
      )
    );
    const outcomes = await Promise.all(calls);

    equal('three calls are accepted', outcomes.filter(outcome => outcome === 'ok').length, 3);
    equal(
      'and the fourth is refused',
      outcomes.filter(outcome => outcome === 'QUEUE_FULL').length,
      1
    );
    equal('leaving the queue empty', shallow.queueDepth(config.id), 0);

    // Refusal is not a wedge: the server still works afterwards.
    const after = await shallow.callTool(config.id, 'count_lines', { path: '/after' });
    equal('and the server is still usable', after.isError, false);

    await shallow.stopServer(config.id);
    await shallow.deleteServer(config.id);
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
