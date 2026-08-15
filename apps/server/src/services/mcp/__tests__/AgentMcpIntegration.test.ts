/**
 * End-to-end tests for agent ↔ MCP tool integration (P6-05).
 *
 * The thing that cannot be faked here is the round trip. A tool call leaves an
 * agent as a line of text on a pseudo-terminal, is picked out of a stream that
 * also carries prose and escape sequences, is judged, possibly put in front of
 * a human, run against a real MCP server over a real pipe, and written back
 * onto the agent's stdin. Every one of those hops has its own way of losing a
 * message, so the tests below use real processes on both ends: a child process
 * speaking MCP over stdio, and a child process on a PTY standing in for the
 * agent. The PTY agent re-emits what it receives with an `AGENT_SAW` marker,
 * which is the only way to distinguish "Asterim wrote the answer" from "the
 * agent actually got it".
 *
 * The security assertions are written as negative controls wherever possible:
 * a denial is proved not by the message the agent receives but by the MCP
 * server's own call counter failing to advance.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/mcp/__tests__/AgentMcpIntegration.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import Fastify from 'fastify';

import {
  BaseAdapter,
  AdapterCapabilities,
  IParser,
  AgentToolExecutor,
  globalProviderRegistry,
  MAX_TOOL_RESULT_CHARS
} from '@asterim/adapters';
import {
  AsterimEvent,
  AgentToolDescriptor,
  TOOL_CALL_PREFIX,
  TOOL_RESULT_PREFIX,
  parseAgentToolCall,
  formatAgentToolResponse
} from '@asterim/shared';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-agent-mcp-'));
process.env.ASTERIM_DATA_DIR = tmpDir;
delete process.env.ASTERIM_MCP_SECURITY_MODE;
delete process.env.ASTERIM_MCP_APPROVAL_TIMEOUT_MS;

const { dbService } = require('../../DatabaseService');
const { eventBus } = require('../../EventBus');
const { mcpProcessSupervisor } = require('../McpProcessSupervisor');
const { McpAgentBridge, mcpAgentBridge } = require('../McpAgentBridge');
const { McpToolGateway, describeCall } = require('../McpToolGateway');
const { toToolDescriptors, formatToolInstructions } = require('../McpToolPrompt');
const { ApprovalManager } = require('../../ApprovalManager');
const { SocketManager } = require('../../../sockets/socketManager');

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

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Polls until a condition holds, so tests never depend on a fixed sleep. */
async function waitUntil(predicate: () => boolean, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await delay(10);
  }
  return predicate();
}

const NODE = process.execPath;

// --- The MCP server under the bridge ----------------------------------------

const TOOLS = [
  {
    name: 'read_file',
    description: 'Read a file from disk',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path']
    }
  },
  {
    name: 'write_file',
    description: 'Write a file to disk',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content']
    }
  },
  {
    name: 'ponder',
    description: 'Consider a topic',
    inputSchema: { type: 'object', properties: { topic: { type: 'string' } } }
  },
  {
    name: 'explode',
    description: 'Always reports failure',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'emit_bulk',
    description: 'Return a great deal of text',
    inputSchema: {
      type: 'object',
      properties: { size: { type: 'integer' } },
      required: ['size']
    }
  }
];

/**
 * A real MCP server. Every answer carries that tool's running call count, which
 * is what lets a test prove a refused call never reached it.
 */
const TOOLBOX_SERVER = `
  const TOOLS = ${JSON.stringify(TOOLS)};
  const calls = {};
  function handle(msg) {
    if (msg.method === 'initialize') {
      respond(msg.id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'toolbox', version: '1.0.0' },
        capabilities: { tools: {} }
      });
    } else if (msg.method === 'tools/list') {
      respond(msg.id, { tools: TOOLS });
    } else if (msg.method === 'tools/call') {
      const name = msg.params.name;
      const args = msg.params.arguments || {};
      calls[name] = (calls[name] || 0) + 1;
      if (name === 'explode') {
        respond(msg.id, { content: [{ type: 'text', text: 'the tool failed on purpose' }], isError: true });
      } else if (name === 'emit_bulk') {
        respond(msg.id, { content: [{ type: 'text', text: 'x'.repeat(args.size) }], isError: false });
      } else {
        respond(msg.id, {
          content: [{ type: 'text', text: name + ' ok ' + JSON.stringify(args) + ' calls=' + calls[name] }],
          isError: false
        });
      }
    }
  }
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

/** A second server, in another workspace, to prove the catalogue is scoped. */
const PRIVATE_SERVER = `
  function handle(msg) {
    if (msg.method === 'initialize') {
      respond(msg.id, {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'private', version: '1.0.0' },
        capabilities: { tools: {} }
      });
    } else if (msg.method === 'tools/list') {
      respond(msg.id, { tools: [{ name: 'read_secret', description: 'Read a secret' }] });
    } else if (msg.method === 'tools/call') {
      respond(msg.id, { content: [{ type: 'text', text: 'private answered' }], isError: false });
    }
  }
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

// --- The agent on the other end ---------------------------------------------

/**
 * Stands in for an agent CLI on a PTY.
 *
 * Raw mode, because that is what the TUI agents Asterim drives actually do, and
 * because a canonical-mode terminal caps an input line at a few kilobytes —
 * which a large tool result would silently lose. It answers instructions from
 * the test over stdin and reports everything Asterim writes back to it with an
 * `AGENT_SAW` prefix.
 */
const AGENT_SCRIPT = `
  const CALL = ${JSON.stringify(TOOL_CALL_PREFIX)};
  const RESULT = ${JSON.stringify(TOOL_RESULT_PREFIX)};
  const out = (s) => process.stdout.write(s + '\\n');
  if (process.stdin.setRawMode) process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  let buf = '';
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\\n')) !== -1) {
      const line = buf.slice(0, i).replace(/\\r$/, '');
      buf = buf.slice(i + 1);
      handle(line);
    }
  });
  function handle(line) {
    if (line.indexOf(RESULT) === 0) {
      out('AGENT_SAW ' + line.slice(RESULT.length).trim());
      return;
    }
    if (line.indexOf('CALL ') === 0) { out(CALL + ' ' + line.slice(5)); return; }
    if (line.indexOf('TWICE ') === 0) {
      const payload = CALL + ' ' + line.slice(6);
      out(payload);
      out(payload);
      return;
    }
    if (line.indexOf('SPLIT ') === 0) {
      const payload = CALL + ' ' + line.slice(6);
      const cut = Math.floor(payload.length / 2);
      process.stdout.write(payload.slice(0, cut));
      setTimeout(() => process.stdout.write(payload.slice(cut) + '\\n'), 40);
      return;
    }
    if (line.indexOf('ANSI ') === 0) {
      out('\\u001b[32m' + CALL + ' ' + line.slice(5) + '\\u001b[0m');
      return;
    }
    if (line === 'PING') { out('PONG'); return; }
    if (line === 'NOISE') {
      out('I would use ' + CALL + ' here, but this line is prose.');
      out(CALL + ' this is not json');
      out(CALL + ' {"arguments":{"a":1}}');
      out('NOISE_DONE');
      return;
    }
    out('AGENT_LINE ' + line);
  }
  out('READY');
  setInterval(() => {}, 1000);
`;

/** Every harness adapter built during the run, so the tests can reach them. */
const harnesses = new Map<string, HarnessAdapter>();

class HarnessAdapter extends BaseAdapter {
  public readonly id = 'harness';
  public readonly capabilities: AdapterCapabilities = {
    supportsDiff: false,
    supportsTerminal: true,
    supportsInterrupt: true,
    supportsResume: false,
    supportsVision: false,
    supportsApproval: true,
    supportsNotifications: false,
    supportsContextFiles: false,
    supportsMultiSession: true,
    supportsRemoteExecution: false,
    supportsStreaming: true
  };

  public output = '';
  public sessionEvents: AsterimEvent[] = [];

  constructor(sessionId: string) {
    super(sessionId);
    harnesses.set(sessionId, this);
    this.getEventBus().subscribe(event => this.sessionEvents.push(event));
  }

  public getLaunchCommand(): { cmd: string; args: string[]; env?: Record<string, string> } {
    return { cmd: NODE, args: ['-e', AGENT_SCRIPT], env: {} };
  }

  public createParser(onEvent: (event: AsterimEvent) => void): IParser {
    return {
      processOutput: (chunk: string) => {
        this.output += chunk;
        // The command queue only drains on idle. A harness agent is idle as
        // soon as it has finished speaking, which keeps queued work moving.
        onEvent({
          id: `harness-status-${this.output.length}`,
          timestamp: Date.now(),
          source: 'adapter:harness',
          type: 'agent.status',
          payload: { status: 'idle' }
        });
      }
    };
  }

  /** Everything the agent reported receiving from Asterim. */
  public sawLines(): string[] {
    return this.output
      .split('\n')
      .map(line => line.replace(/\r$/, '').trim())
      .filter(line => line.startsWith('AGENT_SAW '))
      .map(line => line.slice('AGENT_SAW '.length));
  }

  /** The parsed results the agent received, in order. */
  public sawResults(): { tool: string; isError: boolean; text: string }[] {
    const results: { tool: string; isError: boolean; text: string }[] = [];
    for (const line of this.sawLines()) {
      try {
        results.push(JSON.parse(line));
      } catch {
        // A result split across chunks is picked up on a later poll.
      }
    }
    return results;
  }

  public resultsFor(tool: string) {
    return this.sawResults().filter(result => result.tool === tool);
  }
}

globalProviderRegistry.registerProvider(
  'harness',
  (sessionId: string) => new HarnessAdapter(sessionId)
);

/** Spawns a harness adapter wired to an executor, and waits for it to be ready. */
async function launchHarness(
  executor: AgentToolExecutor | null,
  instructions = ''
): Promise<HarnessAdapter> {
  const adapter = new HarnessAdapter(`direct-${Math.random().toString(36).slice(2, 9)}`);
  adapter.registerToolExecutor(executor);
  await adapter.start({ workspace: tmpDir, mcpToolInstructions: instructions });
  await waitUntil(() => adapter.output.includes('READY'));
  return adapter;
}

async function main(): Promise<void> {
  dbService.getDb();

  // =========================================================================
  describe('the wire protocol — reading a call out of a stream');
  // =========================================================================
  {
    equal('an ordinary line is not a call', parseAgentToolCall('Let me read that file.'), null);
    equal('nor is an empty line', parseAgentToolCall(''), null);

    const plain = parseAgentToolCall(`${TOOL_CALL_PREFIX} {"tool":"mcp__t__read","arguments":{"a":1}}`);
    equal('a well-formed line is a call', plain, {
      tool: 'mcp__t__read',
      arguments: { a: 1 }
    });

    const prefixed = parseAgentToolCall(
      `agent> ${TOOL_CALL_PREFIX} {"tool":"mcp__t__read","arguments":{}}`
    );
    check('a call is found after a prompt, not only at the start', prefixed?.tool === 'mcp__t__read');

    equal(
      'a sentinel with nothing after it is not a call',
      parseAgentToolCall(TOOL_CALL_PREFIX),
      null
    );
    equal(
      'a sentinel with broken JSON is not a call',
      parseAgentToolCall(`${TOOL_CALL_PREFIX} {"tool":`),
      null
    );
    equal(
      'a call with no tool name is not a call',
      parseAgentToolCall(`${TOOL_CALL_PREFIX} {"arguments":{"a":1}}`),
      null
    );
    equal(
      'a call with an empty tool name is not a call',
      parseAgentToolCall(`${TOOL_CALL_PREFIX} {"tool":""}`),
      null
    );
    equal(
      'missing arguments become an empty object',
      parseAgentToolCall(`${TOOL_CALL_PREFIX} {"tool":"mcp__t__read"}`)?.arguments,
      {}
    );
    equal(
      'and so do arguments that are not an object',
      parseAgentToolCall(`${TOOL_CALL_PREFIX} {"tool":"mcp__t__read","arguments":[1,2]}`)?.arguments,
      {}
    );

    const response = formatAgentToolResponse({ tool: 'mcp__t__read', isError: false, text: 'ok' });
    check('a response line carries the result sentinel', response.startsWith(TOOL_RESULT_PREFIX));
    equal(
      'and a response is never mistaken for another call',
      parseAgentToolCall(response),
      null
    );

    const multiline = formatAgentToolResponse({
      tool: 'mcp__t__read',
      isError: false,
      text: 'line one\nline two'
    });
    equal('a result spanning lines is still written as one line', multiline.split('\n').length, 1);
  }

  // =========================================================================
  describe('describing tools to an agent');
  // =========================================================================
  {
    equal('no tools means no instructions at all', formatToolInstructions([]), '');

    const descriptors: AgentToolDescriptor[] = [
      {
        name: 'mcp__toolbox__read_file',
        description: 'Read a file from disk',
        inputSchema: TOOLS[0].inputSchema
      },
      {
        name: 'mcp__toolbox__write_file',
        description: 'Write a file to disk',
        inputSchema: TOOLS[1].inputSchema
      }
    ];
    const instructions: string = formatToolInstructions(descriptors);

    check('every tool is named', descriptors.every(tool => instructions.includes(tool.name)));
    check('the calling convention is stated', instructions.includes(TOOL_CALL_PREFIX));
    check('and so is the shape of the answer', instructions.includes(TOOL_RESULT_PREFIX));
    check('the agent is told to wait for it', instructions.toLowerCase().includes('wait'));
    check('and warned that approval may be needed', instructions.toLowerCase().includes('approve'));
    check('the schema is included', instructions.includes('"required":["path"]'));

    // The block is written into a terminal, and a terminal echoes. If any line
    // of it parsed as a call, telling an agent about tools would itself invoke
    // one — so this is a property of the text, not an accident of it.
    const selfTriggering = instructions
      .split('\n')
      .filter(line => parseAgentToolCall(line) !== null);
    equal('no line of the instructions is itself a callable tool call', selfTriggering, []);

    const huge: string = formatToolInstructions([
      {
        name: 'mcp__toolbox__vast',
        description: 'A tool with an enormous schema',
        inputSchema: {
          type: 'object',
          properties: Object.fromEntries(
            Array.from({ length: 400 }, (_, i) => [`field_${i}`, { type: 'string' }])
          )
        }
      }
    ]);
    check('an enormous schema is truncated rather than pasted whole', huge.includes('(truncated)'));
    check('and stays a manageable size', huge.length < 1200, `length ${huge.length}`);
  }

  // =========================================================================
  describe('the MCP catalogue, scoped to a workspace');
  // =========================================================================
  const toolbox = await mcpProcessSupervisor.saveServer({
    name: 'toolbox',
    command: NODE,
    args: ['-e', TOOLBOX_SERVER],
    workspaceId: 'ws_e2e'
  });
  const secret = await mcpProcessSupervisor.saveServer({
    name: 'private',
    command: NODE,
    args: ['-e', PRIVATE_SERVER],
    workspaceId: 'ws_other'
  });
  {
    equal('a stopped server offers nothing', mcpAgentBridge.getAvailableTools('ws_e2e').length, 0);

    await mcpProcessSupervisor.startServer(toolbox.id);
    await mcpProcessSupervisor.startServer(secret.id);

    const tools = mcpAgentBridge.getAvailableTools('ws_e2e');
    equal('a running server contributes every tool it publishes', tools.length, TOOLS.length);
    check(
      'namespaced by the server they came from',
      tools.every((tool: { name: string }) => tool.name.startsWith('mcp__toolbox__'))
    );
    check(
      "another workspace's server is not offered",
      !tools.some((tool: { name: string }) => tool.name.includes('private'))
    );

    const descriptors = toToolDescriptors(tools);
    equal('a descriptor keeps the name', descriptors[0].name, tools[0].name);
    equal('and the schema', descriptors[0].inputSchema, TOOLS[0].inputSchema);
    equal(
      'and carries nothing else an agent has no use for',
      Object.keys(descriptors[0]).sort(),
      ['description', 'inputSchema', 'name']
    );
  }

  // =========================================================================
  describe('the security policy — what a tool name implies');
  // =========================================================================
  const approvals = new ApprovalManager();
  {
    const risk = (name: string, args: Record<string, unknown> = {}) =>
      approvals.evaluateToolSecurity(name, args);

    equal('reading is low risk', risk('mcp__toolbox__read_file', { path: 'a.txt' }).riskLevel, 'low');
    equal(
      'and needs nobody',
      risk('mcp__toolbox__read_file', { path: 'a.txt' }).requiresExplicitHumanApproval,
      false
    );

    const write = risk('mcp__toolbox__write_file', { path: 'a.txt', content: 'x' });
    equal('writing is high risk', write.riskLevel, 'high');
    equal('and needs a human', write.requiresExplicitHumanApproval, true);
    check(
      'and says why',
      write.warnings.some((w: string) => w.includes('modifies state'))
    );

    equal('deleting is high risk', risk('mcp__toolbox__delete_path', { path: 'a' }).riskLevel, 'high');
    equal(
      'running a command is critical',
      risk('mcp__shell__exec', { cmd: 'ls' }).riskLevel,
      'critical'
    );
    equal(
      'reaching the network is high risk',
      risk('mcp__web__fetch', { url: 'https://example.com' }).riskLevel,
      'high'
    );

    const unknown = risk('mcp__toolbox__ponder', { topic: 'x' });
    equal('a name that says nothing is not treated as safe', unknown.riskLevel, 'medium');
    check(
      'and is called out as unproven',
      unknown.warnings.some((w: string) => w.includes('unproven'))
    );
    equal('though it does not stop the agent by default', unknown.requiresExplicitHumanApproval, false);

    // The important case: the name is innocent, the arguments are not.
    const traversal = risk('mcp__toolbox__read_file', { path: '../../etc/shadow' });
    equal('a read pointed out of the workspace is high risk', traversal.riskLevel, 'high');
    equal('and is flagged as traversal', traversal.isPathTraversal, true);
    equal('and needs a human despite the harmless name', traversal.requiresExplicitHumanApproval, true);

    const creds = risk('mcp__toolbox__read_file', { path: 'config/api_key.json' });
    equal('an argument naming credentials is high risk', creds.riskLevel, 'high');
    equal('and needs a human', creds.requiresExplicitHumanApproval, true);

    const nested = risk('mcp__toolbox__ponder', { plan: { step: 'rm -rf /' } });
    equal('a destructive string buried in an object is still seen', nested.riskLevel, 'critical');

    equal(
      'warnings are not repeated',
      new Set(traversal.warnings).size,
      traversal.warnings.length
    );
  }

  describe('the security policy — the mode changes the threshold, not the reading');
  {
    const args = { topic: 'x' };

    process.env.ASTERIM_MCP_SECURITY_MODE = 'strict';
    const strict = approvals.evaluateToolSecurity('mcp__toolbox__ponder', args);
    equal('under strict, an unproven tool needs a human', strict.requiresExplicitHumanApproval, true);
    equal(
      'while a plainly read-only one still does not',
      approvals.evaluateToolSecurity('mcp__toolbox__read_file', { path: 'a.txt' })
        .requiresExplicitHumanApproval,
      false
    );

    process.env.ASTERIM_MCP_SECURITY_MODE = 'permissive';
    const permissive = approvals.evaluateToolSecurity('mcp__toolbox__write_file', {
      path: 'a',
      content: 'b'
    });
    equal('under permissive, nothing is gated', permissive.requiresExplicitHumanApproval, false);
    equal('but the risk is still reported honestly', permissive.riskLevel, 'high');
    check(
      'and the warnings are still raised',
      permissive.warnings.some((w: string) => w.includes('modifies state'))
    );

    process.env.ASTERIM_MCP_SECURITY_MODE = 'nonsense';
    equal(
      'an unrecognised mode falls back to gating, not to permitting',
      approvals.evaluateToolSecurity('mcp__toolbox__write_file', { path: 'a', content: 'b' })
        .requiresExplicitHumanApproval,
      true
    );

    delete process.env.ASTERIM_MCP_SECURITY_MODE;
    equal(
      'and so does no mode at all',
      approvals.evaluateToolSecurity('mcp__toolbox__write_file', { path: 'a', content: 'b' })
        .requiresExplicitHumanApproval,
      true
    );
  }

  // =========================================================================
  describe('the gateway — running a tool for an agent');
  // =========================================================================
  const gateway = new McpToolGateway(mcpAgentBridge, approvals);
  const context = {
    projectId: 'proj_gateway',
    threadId: 'thread_gateway',
    workspaceId: 'ws_e2e',
    workspacePath: tmpDir
  };

  /** Approves or denies the next approval request, once. */
  function answerNextApproval(approve: boolean, onSeen?: (payload: any) => void) {
    const handler = (event: AsterimEvent) => {
      eventBus.unsubscribe('agent.approval_request', handler);
      onSeen?.(event.payload);
      eventBus.publish({
        id: `resp-${event.payload.actionId}`,
        timestamp: Date.now(),
        source: 'client:test',
        type: 'client.approval_response',
        payload: { actionId: event.payload.actionId, approved: approve }
      });
    };
    eventBus.subscribe('agent.approval_request', handler);
    return () => eventBus.unsubscribe('agent.approval_request', handler);
  }

  {
    let requested = false;
    const stop = answerNextApproval(true, () => {
      requested = true;
    });
    const read = await gateway.executeForAgent(context, 'mcp__toolbox__read_file', {
      path: 'notes.txt'
    });
    stop();

    equal('a low-risk call succeeds', read.isError, false);
    check('and returns what the server said', read.text.includes('read_file ok'));
    equal('without asking anyone', requested, false);

    const unknown = await gateway.executeForAgent(context, 'mcp__toolbox__nope', {});
    equal('an unknown tool is an error, not an exception', unknown.isError, true);
    check('listing what does exist', unknown.text.includes('mcp__toolbox__read_file'));

    const badArgs = await gateway.executeForAgent(context, 'mcp__toolbox__read_file', { path: 7 });
    equal('invalid arguments are refused before the pipe', badArgs.isError, true);
    check('explaining the type that was wanted', badArgs.text.includes('expected string'));

    const missing = await gateway.executeForAgent(context, 'mcp__toolbox__read_file', {});
    equal('a missing required argument is refused', missing.isError, true);
    check('naming the argument', missing.text.includes('path: required'));

    const failing = await gateway.executeForAgent(context, 'mcp__toolbox__explode', {});
    equal("a tool's own failure is reported as an error", failing.isError, true);
    check('with the text the tool gave', failing.text.includes('failed on purpose'));
  }

  describe('the gateway — the approval gate');
  {
    let seen: any = null;
    const stop = answerNextApproval(true, payload => {
      seen = payload;
    });
    const approved = await gateway.executeForAgent(context, 'mcp__toolbox__write_file', {
      path: 'out.txt',
      content: 'hello'
    });
    stop();

    equal('an approved write succeeds', approved.isError, false);
    check('and reaches the server exactly once', approved.text.includes('calls=1'));

    check('the request named the thread it belongs to', seen?.threadId === context.threadId);
    check('and the project', seen?.projectId === context.projectId);
    check(
      'and carried the analysis rather than a re-reading of it',
      seen?.securityAnalysis?.riskLevel === 'high'
    );
    check(
      'and described the call in a way a human can judge',
      typeof seen?.command === 'string' && seen.command.includes('out.txt')
    );
    check(
      'naming the tool in the description',
      typeof seen?.description === 'string' && seen.description.includes('write_file')
    );
  }

  describe('the gateway — a refusal actually stops the call');
  {
    const stop = answerNextApproval(false);
    const denied = await gateway.executeForAgent(context, 'mcp__toolbox__write_file', {
      path: 'denied.txt',
      content: 'nope'
    });
    stop();

    equal('a denied call is an error result', denied.isError, true);
    check('saying the user declined', denied.text.includes('did not approve'));
    check('and telling the agent not to retry it', denied.text.includes('Do not retry'));

    // The proof is not the message — it is the server's counter. If the denial
    // had leaked through, this would read calls=3.
    const stopAgain = answerNextApproval(true);
    const after = await gateway.executeForAgent(context, 'mcp__toolbox__write_file', {
      path: 'after.txt',
      content: 'yes'
    });
    stopAgain();
    check(
      'and the tool was never run: the server still counts only the approved calls',
      after.text.includes('calls=2'),
      after.text
    );
  }

  describe('the gateway — silence is a refusal');
  {
    process.env.ASTERIM_MCP_APPROVAL_TIMEOUT_MS = '150';
    const started = Date.now();
    const timedOut = await gateway.executeForAgent(context, 'mcp__toolbox__write_file', {
      path: 'timeout.txt',
      content: 'x'
    });
    const elapsed = Date.now() - started;

    equal('a call nobody answers is denied', timedOut.isError, true);
    check('rather than hanging forever', elapsed < 5000, `took ${elapsed}ms`);
    check('and it waited for the human first', elapsed >= 140, `took ${elapsed}ms`);

    const stop = answerNextApproval(true);
    const after = await gateway.executeForAgent(context, 'mcp__toolbox__write_file', {
      path: 'after-timeout.txt',
      content: 'x'
    });
    stop();
    check('the timed-out call never ran', after.text.includes('calls=3'), after.text);
    delete process.env.ASTERIM_MCP_APPROVAL_TIMEOUT_MS;
  }

  describe('the gateway — a stopped thread takes its questions with it');
  {
    const pending = gateway.executeForAgent(context, 'mcp__toolbox__write_file', {
      path: 'orphan.txt',
      content: 'x'
    });

    const raised = await waitUntil(
      () => approvals.getPendingActionIds(context.threadId).length === 1
    );
    check('the call is waiting on a human', raised);

    const cancelledEvents: AsterimEvent[] = [];
    const listener = (event: AsterimEvent) => cancelledEvents.push(event);
    eventBus.subscribe('agent.approval_cancelled', listener);

    const cancelled = gateway.cancelPendingForThread(context.threadId, 'the user stopped it');
    equal('cancelling the thread cancels its request', cancelled, 1);

    const result = await pending;
    equal('and the waiting call resolves as denied', result.isError, true);
    equal(
      'leaving nothing pending',
      approvals.getPendingActionIds(context.threadId).length,
      0
    );
    equal('the cancellation is announced', cancelledEvents.length, 1);
    check(
      'naming the thread it belonged to',
      cancelledEvents[0]?.payload?.threadId === context.threadId
    );
    eventBus.unsubscribe('agent.approval_cancelled', listener);

    const cancelledId = cancelledEvents[0]?.payload?.actionId;
    const row =
      typeof cancelledId === 'string'
        ? (dbService
            .getDb()
            .prepare('SELECT status FROM approvals WHERE action_id = ?')
            .get(cancelledId) as { status: string } | undefined)
        : undefined;
    equal('and the record says so', row?.status, 'cancelled');

    equal(
      'cancelling a thread with nothing pending is not an error',
      gateway.cancelPendingForThread('thread_that_never_asked'),
      0
    );
  }

  describe('the gateway — it fails closed, not open');
  {
    // A policy that cannot decide must not become a way past the policy.
    let asked = false;
    const brokenPolicy = new McpToolGateway(mcpAgentBridge, {
      evaluateToolSecurity() {
        throw new Error('the policy could not be evaluated');
      },
      async requestApproval() {
        asked = true;
        return false;
      },
      cancelApprovalsForThread: () => 0
    } as any);

    const result = await brokenPolicy.executeForAgent(context, 'mcp__toolbox__read_file', {
      path: 'a.txt'
    });
    check('a broken policy still puts the call in front of a human', asked);
    equal('and the call does not proceed unasked', result.isError, true);

    // And a bridge that breaks its own contract still produces an answer.
    const brokenBridge = new McpToolGateway(
      {
        async executeTool() {
          throw new Error('the bridge threw');
        }
      } as any,
      approvals
    );
    let threw = false;
    let bridgeResult: any;
    try {
      bridgeResult = await brokenBridge.executeForAgent(context, 'mcp__toolbox__read_file', {
        path: 'a.txt'
      });
    } catch {
      threw = true;
    }
    check('a bridge that throws does not throw at the agent', !threw);
    equal('it becomes an error result', bridgeResult?.isError, true);
    check('carrying the reason', String(bridgeResult?.text || '').includes('the bridge threw'));
  }

  describe('describeCall');
  {
    check(
      'a call is rendered with its arguments',
      describeCall('mcp__toolbox__read_file', { path: 'a.txt' }).includes('"path":"a.txt"')
    );
    const long = describeCall('mcp__toolbox__write_file', { content: 'y'.repeat(5000) });
    check('a huge argument list is trimmed', long.length < 400, `length ${long.length}`);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let threw = false;
    try {
      describeCall('mcp__toolbox__read_file', cyclic);
    } catch {
      threw = true;
    }
    check('and an argument object that cannot be serialised does not throw', !threw);
  }

  // =========================================================================
  describe('the round trip — a real agent on a real terminal');
  // =========================================================================
  {
    const executor = gateway.createExecutor({
      projectId: 'proj_pty',
      threadId: 'thread_pty',
      workspaceId: 'ws_e2e',
      workspacePath: tmpDir
    });
    const agent = await launchHarness(executor);
    check('the agent started', agent.output.includes('READY'));

    agent.writeStdin('CALL {"tool":"mcp__toolbox__read_file","arguments":{"path":"a.txt"}}\r\n');
    const got = await waitUntil(() => agent.resultsFor('mcp__toolbox__read_file').length === 1);
    check('a tool call written by the agent is intercepted and answered', got);

    const result = agent.resultsFor('mcp__toolbox__read_file')[0];
    equal('the answer is not an error', result?.isError, false);
    check('and carries what the MCP server returned', String(result?.text).includes('read_file ok'));
    check('with the arguments the agent sent', String(result?.text).includes('a.txt'));

    // The events are what the transcript and the dashboard are built from.
    const callEvents = agent.sessionEvents.filter(e => e.type === 'agent.tool_call');
    const resultEvents = agent.sessionEvents.filter(e => e.type === 'agent.tool_result');
    equal('the call is announced on the session bus', callEvents.length, 1);
    equal('naming the tool', callEvents[0]?.payload?.tool, 'mcp__toolbox__read_file');
    equal('with the arguments', callEvents[0]?.payload?.arguments, { path: 'a.txt' });
    equal('and the result is announced too', resultEvents.length, 1);
    equal('with its outcome', resultEvents[0]?.payload?.isError, false);

    agent.writeStdin('PING\r\n');
    check('and the agent is still alive', await waitUntil(() => agent.output.includes('PONG')));

    await agent.stop();
  }

  describe('the round trip — failures reach the agent, and it survives them');
  {
    const executor = gateway.createExecutor({
      projectId: 'proj_fail',
      threadId: 'thread_fail',
      workspaceId: 'ws_e2e',
      workspacePath: tmpDir
    });
    const agent = await launchHarness(executor);

    agent.writeStdin('CALL {"tool":"mcp__toolbox__explode","arguments":{}}\r\n');
    check(
      'a tool that fails still answers the agent',
      await waitUntil(() => agent.resultsFor('mcp__toolbox__explode').length === 1)
    );
    equal(
      'and is marked as an error',
      agent.resultsFor('mcp__toolbox__explode')[0]?.isError,
      true
    );

    agent.writeStdin('CALL {"tool":"mcp__toolbox__ghost","arguments":{}}\r\n');
    check(
      'an unknown tool answers the agent',
      await waitUntil(() => agent.resultsFor('mcp__toolbox__ghost').length === 1)
    );
    check(
      'telling it what it could have called',
      String(agent.resultsFor('mcp__toolbox__ghost')[0]?.text).includes('mcp__toolbox__read_file')
    );

    agent.writeStdin('CALL {"tool":"mcp__toolbox__read_file","arguments":{"path":42}}\r\n');
    check(
      'invalid parameters answer the agent',
      await waitUntil(() => agent.resultsFor('mcp__toolbox__read_file').length === 1)
    );
    check(
      'with something it can correct',
      String(agent.resultsFor('mcp__toolbox__read_file')[0]?.text).includes('Correct the arguments')
    );

    agent.writeStdin('PING\r\n');
    check(
      'and after three failures the agent is still running',
      await waitUntil(() => agent.output.includes('PONG'))
    );
    check('the process was never killed', typeof agent.getPid() === 'number');

    await agent.stop();
  }

  describe('the round trip — reading calls out of a noisy stream');
  {
    let invocations = 0;
    const counting: AgentToolExecutor = async (toolName, args) => {
      invocations++;
      return { isError: false, text: `ran ${toolName} with ${JSON.stringify(args)}` };
    };
    const agent = await launchHarness(counting);

    agent.writeStdin('NOISE\r\n');
    await waitUntil(() => agent.output.includes('NOISE_DONE'));
    await delay(150);
    equal('prose and malformed lines invoke nothing', invocations, 0);

    agent.writeStdin('ANSI {"tool":"mcp__toolbox__read_file","arguments":{"path":"ansi.txt"}}\r\n');
    check(
      'a call wrapped in colour codes is still found',
      await waitUntil(() => invocations === 1)
    );
    check(
      'and answered',
      await waitUntil(() => agent.resultsFor('mcp__toolbox__read_file').length === 1)
    );

    agent.writeStdin('SPLIT {"tool":"mcp__toolbox__ponder","arguments":{"topic":"split"}}\r\n');
    check(
      'a call split across two chunks is reassembled',
      await waitUntil(() => invocations === 2)
    );
    check(
      'and answered',
      await waitUntil(() => agent.resultsFor('mcp__toolbox__ponder').length === 1)
    );
    check(
      'having been read correctly once whole',
      String(agent.resultsFor('mcp__toolbox__ponder')[0]?.text).includes('"topic":"split"')
    );

    agent.writeStdin('TWICE {"tool":"mcp__toolbox__ponder","arguments":{"topic":"echo"}}\r\n');
    check('a repeated call still runs', await waitUntil(() => invocations >= 3));
    // Long enough that a second invocation would have landed by now.
    await delay(400);
    equal('but only once, not twice', invocations, 3);

    await agent.stop();
  }

  describe('the round trip — an agent with nothing to run its tools');
  {
    let invoked = 0;
    const recording: AgentToolExecutor = async () => {
      invoked++;
      return { isError: false, text: 'ran' };
    };
    const agent = await launchHarness(recording);

    // The executor is proved to work before it is taken away, so that the
    // "nothing happened" below means the executor was gone rather than the
    // harness being broken — which is the only way this can be evidence.
    agent.writeStdin('CALL {"tool":"mcp__toolbox__read_file","arguments":{"path":"before.txt"}}\r\n');
    check('with an executor, the call runs', await waitUntil(() => invoked === 1));

    agent.registerToolExecutor(null);
    agent.writeStdin('CALL {"tool":"mcp__toolbox__read_file","arguments":{"path":"after.txt"}}\r\n');
    await delay(300);
    equal('once nothing can run it, a call is ignored', invoked, 1);
    equal('and the agent is told nothing further', agent.sawLines().length, 1);

    agent.writeStdin('PING\r\n');
    check('the session carries on', await waitUntil(() => agent.output.includes('PONG')));
    await agent.stop();
  }

  describe('the round trip — a result too large for a terminal');
  {
    const executor = gateway.createExecutor({
      projectId: 'proj_bulk',
      threadId: 'thread_bulk',
      workspaceId: 'ws_e2e',
      workspacePath: tmpDir
    });
    const agent = await launchHarness(executor);

    const oversize = MAX_TOOL_RESULT_CHARS + 4000;
    agent.writeStdin(
      `CALL {"tool":"mcp__toolbox__emit_bulk","arguments":{"size":${oversize}}}\r\n`
    );
    check(
      'the agent is answered',
      await waitUntil(() => agent.resultsFor('mcp__toolbox__emit_bulk').length === 1, 15000)
    );

    const bulk = agent.resultsFor('mcp__toolbox__emit_bulk')[0];
    check(
      'the result was cut down before being written',
      String(bulk?.text).length < oversize,
      `length ${String(bulk?.text).length}`
    );
    check('and says how much was dropped', String(bulk?.text).includes('truncated'));
    check(
      'keeping the beginning, which is the part with the answer in it',
      String(bulk?.text).startsWith('x'.repeat(100))
    );

    agent.writeStdin('PING\r\n');
    check(
      'and a huge result does not wedge the session',
      await waitUntil(() => agent.output.includes('PONG'))
    );
    await agent.stop();
  }

  // =========================================================================
  describe('the whole path — AgentService starting a session');
  // =========================================================================
  const projectId = 'proj_e2e';
  const threadId = 'thread_e2e';
  {
    // `node:sqlite` enforces foreign keys by default, so the project needs the
    // ownership chain above it to exist before it can name a workspace.
    const db = dbService.getDb();
    const now = Date.now();
    db.prepare(
      'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?,?,?,?,?)'
    ).run('user_e2e', 'e2e@example.test', 'x', now, now);
    db.prepare(
      'INSERT INTO accounts (id, owner_user_id, account_name, created_at, updated_at) VALUES (?,?,?,?,?)'
    ).run('acct_e2e', 'user_e2e', 'E2E', now, now);
    db.prepare(
      'INSERT INTO workspaces (id, account_id, name, slug, created_at, updated_at) VALUES (?,?,?,?,?,?)'
    ).run('ws_e2e', 'acct_e2e', 'E2E', 'e2e', now, now);
    db.prepare(
      'INSERT INTO projects (id, workspace_id, name, path, visibility) VALUES (?,?,?,?,?)'
    ).run(projectId, 'ws_e2e', 'E2E', tmpDir, 'private');

    // Requiring it here, after the data directory is set, is deliberate: the
    // service resolves the database at import time.
    require('../../AgentService');

    const announced: AsterimEvent[] = [];
    const onAnnounce = (event: AsterimEvent) => announced.push(event);
    eventBus.subscribe('agent.tools_available', onAnnounce);

    eventBus.publish({
      id: 'start-1',
      timestamp: Date.now(),
      source: 'client:test',
      type: 'client.command',
      payload: { command: 'start', projectId, threadId, agentType: 'harness' }
    });

    const started = await waitUntil(() => harnesses.has(threadId));
    check('the session starts', started);
    const agent = harnesses.get(threadId)!;
    check('and the agent process comes up', await waitUntil(() => agent.output.includes('READY')));

    check('the tools it may use are announced', await waitUntil(() => announced.length === 1));
    const payload = announced[0]?.payload as any;
    equal('for the right project', payload?.projectId, projectId);
    equal('and thread', payload?.threadId, threadId);
    equal('listing what MCP is offering', payload?.tools?.length, TOOLS.length);
    check(
      "scoped to the project's workspace",
      (payload?.tools || []).every((tool: { name: string }) => tool.name.startsWith('mcp__toolbox__'))
    );

    equal('the adapter knows its catalogue', agent.getAvailableTools().length, TOOLS.length);
    check('and has something that can run a tool', agent.hasToolExecutor());

    // The instructions are queued as the first thing the agent is told, ahead
    // of any user prompt: a tool it has not been told about is a tool it will
    // never call.
    check(
      'the agent is told how to call them',
      await waitUntil(() => agent.output.includes(TOOL_CALL_PREFIX))
    );
    check(
      'and which ones exist',
      agent.output.includes('mcp__toolbox__read_file'),
      agent.output.slice(0, 400)
    );

    eventBus.unsubscribe('agent.tools_available', onAnnounce);
  }

  describe('the whole path — a tool call from a session AgentService started');
  {
    const agent = harnesses.get(threadId)!;
    const forwarded: AsterimEvent[] = [];
    const onTool = (event: AsterimEvent) => forwarded.push(event);
    eventBus.subscribe('agent.tool_result', onTool);

    agent.writeStdin('CALL {"tool":"mcp__toolbox__read_file","arguments":{"path":"e2e.txt"}}\r\n');
    check(
      'the call runs and the agent gets its answer',
      await waitUntil(() => agent.resultsFor('mcp__toolbox__read_file').length === 1)
    );
    check(
      'with the MCP server’s output in it',
      String(agent.resultsFor('mcp__toolbox__read_file')[0]?.text).includes('e2e.txt')
    );

    check('and the Core saw the result', await waitUntil(() => forwarded.length >= 1));
    equal('tagged with the project it belongs to', forwarded[0]?.payload?.projectId, projectId);
    equal('and the thread', forwarded[0]?.payload?.threadId, threadId);
    eventBus.unsubscribe('agent.tool_result', onTool);
  }

  describe('the whole path — approval, from the agent to the dashboard and back');
  {
    const agent = harnesses.get(threadId)!;
    let seen: any = null;
    const stop = answerNextApproval(true, payload => {
      seen = payload;
    });

    agent.writeStdin(
      'CALL {"tool":"mcp__toolbox__write_file","arguments":{"path":"gated.txt","content":"x"}}\r\n'
    );
    check(
      'a sensitive call reaches the human',
      await waitUntil(() => seen !== null)
    );
    equal('carrying the thread it can be cancelled by', seen?.threadId, threadId);
    check(
      'and the approval lets it through to the agent',
      await waitUntil(() => agent.resultsFor('mcp__toolbox__write_file').length === 1)
    );
    equal(
      'as a success',
      agent.resultsFor('mcp__toolbox__write_file')[0]?.isError,
      false
    );
    stop();
  }

  describe('the whole path — stopping the thread releases what it was waiting on');
  {
    const agent = harnesses.get(threadId)!;
    const before = agent.resultsFor('mcp__toolbox__write_file').length;

    agent.writeStdin(
      'CALL {"tool":"mcp__toolbox__write_file","arguments":{"path":"stopped.txt","content":"x"}}\r\n'
    );

    const { approvalManager } = require('../../ApprovalManager');
    check(
      'the call is waiting on a human',
      await waitUntil(() => approvalManager.getPendingActionIds(threadId).length === 1)
    );

    eventBus.publish({
      id: 'stop-1',
      timestamp: Date.now(),
      source: 'client:test',
      type: 'client.command',
      payload: { command: 'stop', projectId, threadId }
    });

    check(
      'stopping the thread clears its pending approval',
      await waitUntil(() => approvalManager.getPendingActionIds(threadId).length === 0)
    );
    equal(
      'and the tool was never run',
      agent.resultsFor('mcp__toolbox__write_file').length,
      before
    );
  }

  // =========================================================================
  describe('the transcript');
  // =========================================================================
  {
    // The real bridge from the EventBus into the events table. Socket.IO binds
    // to the Fastify server's http.Server, which exists without listening.
    const fastify = Fastify();
    new SocketManager(fastify as any);

    eventBus.publish({
      id: 'transcript-call',
      timestamp: Date.now(),
      source: 'adapter:harness',
      type: 'agent.tool_call',
      payload: { projectId, threadId, tool: 'mcp__toolbox__read_file', arguments: { path: 'a' } }
    });
    eventBus.publish({
      id: 'transcript-result',
      timestamp: Date.now(),
      source: 'adapter:harness',
      type: 'agent.tool_result',
      payload: { projectId, threadId, tool: 'mcp__toolbox__read_file', isError: false, text: 'ok' }
    });

    const rows = dbService
      .getDb()
      .prepare("SELECT type, thread_id, payload_json FROM events WHERE project_id = ? AND type LIKE 'agent.tool%' ORDER BY type")
      .all(projectId) as { type: string; thread_id: string; payload_json: string }[];

    equal('both the call and its result are kept', rows.length, 2);
    equal(
      'as the transcript of that thread',
      rows.map(row => row.thread_id),
      [threadId, threadId]
    );
    equal(
      'under their own types',
      rows.map(row => row.type),
      ['agent.tool_call', 'agent.tool_result']
    );
    const stored = JSON.parse(rows[1].payload_json);
    equal('with the text the agent was given', stored.payload.text, 'ok');

    await fastify.close();
  }

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
