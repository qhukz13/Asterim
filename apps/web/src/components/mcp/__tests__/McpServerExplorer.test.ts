/**
 * Tests for the MCP Server Registry UI (P6-03).
 *
 * Three layers, matching the convention the memory suites established:
 *   1. Pure helpers — `statusTone`, `formatUptime`, `canStart`, `parseEnvText`,
 *      `renderToolContent` — called directly.
 *   2. `useMcpStore` against a recording `fetch`, so the exact URLs, methods and
 *      bodies are asserted. Getting an endpoint wrong is the kind of mistake a
 *      build cannot catch and a mock that merely returns data would hide.
 *   3. Real rendering through `react-dom/server`, driving the props-only views.
 *
 * What it does NOT cover: click handlers and the drawer's tool runner, which
 * need an event loop and a DOM the repository does not have.
 *
 * Run:  pnpm --filter @asterim/web exec tsx src/components/mcp/__tests__/McpServerExplorer.test.ts
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { McpServerRuntimeInfo, McpToolCallResult } from '@asterim/shared';

// --- Environment stubs, installed before the store loads ---

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

const requests: RecordedRequest[] = [];
let nextResponse: { status: number; body: unknown } = { status: 200, body: {} };

interface TestGlobals {
  localStorage?: unknown;
  fetch?: unknown;
  process?: { exit(code: number): void };
}
const testGlobals = globalThis as TestGlobals;

const memoryStorage = new Map<string, string>();
testGlobals.localStorage = {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => memoryStorage.set(key, value),
  removeItem: (key: string) => memoryStorage.delete(key)
};
localStorage.setItem('asterim_token', 'test-token');

testGlobals.fetch = async (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string }
) => {
  requests.push({
    url,
    method: init?.method || 'GET',
    headers: init?.headers || {},
    body: init?.body ? JSON.parse(init.body) : undefined
  });
  const { status, body } = nextResponse;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
};

// Imported inside main(), after the stubs above are in place: the store reads
// localStorage at call time but `fetch` must exist before anything runs.
type StoreModule = typeof import('../../../stores/useMcpStore');
type ExplorerModule = typeof import('../McpServerExplorer');
type ModalModule = typeof import('../McpServerModal');
type DrawerModule = typeof import('../McpServerDetailDrawer');

let storeMod: StoreModule;
let explorer: ExplorerModule;
let modal: ModalModule;
let drawer: DrawerModule;

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

// --- Fixtures ---

function server(overrides: Partial<McpServerRuntimeInfo> = {}): McpServerRuntimeInfo {
  return {
    id: 'mcp_1',
    workspaceId: null,
    name: 'filesystem',
    transport: 'stdio',
    command: '/usr/bin/node',
    args: ['-e', 'server'],
    env: {},
    isEnabled: true,
    isGlobal: false,
    createdAt: 1,
    updatedAt: 2,
    status: 'RUNNING',
    pid: 4242,
    uptimeSeconds: 125,
    recentStderrLogs: [],
    lastError: null,
    lastExitCode: null,
    startCount: 1,
    capabilities: {
      tools: [
        { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } },
        { name: 'write_file' }
      ],
      resources: [{ uri: 'file:///workspace', name: 'workspace', mimeType: 'inode/directory' }],
      prompts: [{ name: 'summarise', arguments: [{ name: 'path', required: true }] }],
      protocolVersion: '2024-11-05',
      serverInfo: { name: 'fs-server', version: '1.2.3' },
      discoveredAt: 10
    },
    ...overrides
  };
}

const noop = () => undefined;
const noCall = async (): Promise<McpToolCallResult> => ({ content: [], isError: false });

function renderExplorer(props: Partial<Parameters<typeof explorer.McpServerExplorerView>[0]> = {}) {
  return renderToStaticMarkup(
    React.createElement(explorer.McpServerExplorerView, {
      servers: [],
      isLoading: false,
      error: null,
      onStart: noop,
      onStop: noop,
      onRestart: noop,
      onRefresh: noop,
      onDelete: noop,
      onCreate: async () => undefined,
      onCallTool: noCall,
      ...props
    })
  );
}

async function main(): Promise<void> {
  storeMod = await import('../../../stores/useMcpStore');
  explorer = await import('../McpServerExplorer');
  modal = await import('../McpServerModal');
  drawer = await import('../McpServerDetailDrawer');
  const { useMcpStore, isMcpEvent } = storeMod;

  // --- Pure helpers ----------------------------------------------------------
  describe('statusTone');
  equal(
    'RUNNING is the emerald accent',
    explorer.statusTone('RUNNING').color,
    'var(--color-state-working)'
  );
  equal('and reads as Running', explorer.statusTone('RUNNING').label, 'Running');
  equal(
    'INITIALIZING is amber, not green — the handshake is not finished',
    explorer.statusTone('INITIALIZING').color,
    'var(--color-state-paused)'
  );
  equal(
    'STARTING is amber too',
    explorer.statusTone('STARTING').color,
    'var(--color-state-paused)'
  );
  equal('CRASHED is red', explorer.statusTone('CRASHED').color, 'var(--color-state-error)');
  equal('ERROR is red', explorer.statusTone('ERROR').color, 'var(--color-state-error)');
  equal('STOPPED is neutral', explorer.statusTone('STOPPED').label, 'Stopped');

  describe('formatUptime');
  equal('nothing yet', explorer.formatUptime(0), '—');
  equal('seconds', explorer.formatUptime(42), '42s');
  equal('minutes', explorer.formatUptime(125), '2m');
  equal('hours and minutes', explorer.formatUptime(3720), '1h 2m');
  equal('whole hours', explorer.formatUptime(7200), '2h');

  describe('canStart');
  check('a stopped server can start', explorer.canStart(server({ status: 'STOPPED' })));
  check('a crashed one can too', explorer.canStart(server({ status: 'CRASHED' })));
  check('a running one cannot', !explorer.canStart(server({ status: 'RUNNING' })));
  check('nor one still initializing', !explorer.canStart(server({ status: 'INITIALIZING' })));

  describe('the modal’s parsers');
  equal('arguments are one per line', modal.parseArgsText('-y\n  @scope/pkg  \n\n/path'), [
    '-y',
    '@scope/pkg',
    '/path'
  ]);
  equal('and round-trip', modal.argsToText(['-y', '/path']), '-y\n/path');
  equal('environment lines split on the first =', modal.parseEnvText('TOKEN=abc=def\nEMPTY='), {
    TOKEN: 'abc=def',
    EMPTY: ''
  });
  equal('comments and blanks are ignored', modal.parseEnvText('# note\n\nA=1'), { A: '1' });
  equal('lines without = are ignored', modal.parseEnvText('JUST_A_NAME'), {});
  equal('and round-trip', modal.envToText({ A: '1', B: '2' }), 'A=1\nB=2');

  describe('the drawer’s formatters');
  equal(
    'a tool without a schema says so',
    drawer.describeSchema({ name: 'x' }),
    'No input schema published.'
  );
  check(
    'a schema is pretty-printed',
    drawer
      .describeSchema({ name: 'x', inputSchema: { type: 'object' } })
      .includes('"type": "object"')
  );
  equal('no result renders nothing', drawer.renderToolContent(null), '');
  equal(
    'empty content says so rather than looking successful',
    drawer.renderToolContent({ content: [], isError: false }),
    '(no content returned)'
  );
  equal(
    'text parts are joined',
    drawer.renderToolContent({
      content: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' }
      ],
      isError: false
    }),
    'a\nb'
  );
  check(
    'binary parts are described, not dumped',
    drawer
      .renderToolContent({
        content: [{ type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }],
        isError: false
      })
      .includes('image/png')
  );

  // --- The store -------------------------------------------------------------
  describe('useMcpStore — loading');
  {
    requests.length = 0;
    nextResponse = { status: 200, body: { servers: [server()] } };
    await useMcpStore.getState().loadServers();

    equal('it asks the MCP endpoint', requests[0].url, '/api/v1/mcp/servers');
    equal('with a GET', requests[0].method, 'GET');
    equal('carrying the token', requests[0].headers.Authorization, 'Bearer test-token');
    equal('and the servers land in state', useMcpStore.getState().servers.length, 1);
    equal('loading is finished', useMcpStore.getState().isLoading, false);

    requests.length = 0;
    await useMcpStore.getState().loadServers('ws_alpha');
    equal(
      'a workspace filter is a query parameter',
      requests[0].url,
      '/api/v1/mcp/servers?workspaceId=ws_alpha'
    );
  }

  describe('useMcpStore — lifecycle actions');
  {
    const actions: [string, () => Promise<void>, string, string][] = [
      [
        'start',
        () => useMcpStore.getState().startServer('mcp_1'),
        '/api/v1/mcp/servers/mcp_1/start',
        'POST'
      ],
      [
        'stop',
        () => useMcpStore.getState().stopServer('mcp_1'),
        '/api/v1/mcp/servers/mcp_1/stop',
        'POST'
      ],
      [
        'restart',
        () => useMcpStore.getState().restartServer('mcp_1'),
        '/api/v1/mcp/servers/mcp_1/restart',
        'POST'
      ],
      [
        'refresh',
        () => useMcpStore.getState().refreshCapabilities('mcp_1'),
        '/api/v1/mcp/servers/mcp_1/refresh',
        'POST'
      ]
    ];

    for (const [name, run, url, method] of actions) {
      requests.length = 0;
      nextResponse = { status: 200, body: { server: server({ status: 'RUNNING', pid: 7 }) } };
      await run();
      equal(`${name} calls ${url}`, requests[0].url, url);
      equal(`${name} uses ${method}`, requests[0].method, method);
      equal(`${name} adopts the returned server`, useMcpStore.getState().servers[0].pid, 7);
      equal(`${name} leaves nothing pending`, useMcpStore.getState().pending.length, 0);
    }
  }

  describe('useMcpStore — creating, updating and deleting');
  {
    requests.length = 0;
    nextResponse = { status: 201, body: { server: server({ id: 'mcp_2', name: 'aardvark' }) } };
    await useMcpStore.getState().createServer({ name: 'aardvark', command: 'node' });
    equal('create POSTs the collection', requests[0].url, '/api/v1/mcp/servers');
    equal('with the configuration', (requests[0].body as { name: string }).name, 'aardvark');
    equal('the new server joins the list', useMcpStore.getState().servers.length, 2);
    equal('sorted by name', useMcpStore.getState().servers[0].name, 'aardvark');

    requests.length = 0;
    nextResponse = { status: 200, body: { server: server({ id: 'mcp_2', name: 'renamed' }) } };
    await useMcpStore.getState().updateServer('mcp_2', { name: 'renamed' });
    equal('update PATCHes the server', requests[0].method, 'PATCH');
    equal('at its own URL', requests[0].url, '/api/v1/mcp/servers/mcp_2');

    requests.length = 0;
    nextResponse = { status: 200, body: { deleted: true } };
    useMcpStore.setState({ activeServerId: 'mcp_2' });
    await useMcpStore.getState().deleteServer('mcp_2');
    equal('delete uses DELETE', requests[0].method, 'DELETE');
    equal(
      'the server is removed',
      useMcpStore.getState().servers.some(s => s.id === 'mcp_2'),
      false
    );
    equal('and its drawer closes', useMcpStore.getState().activeServerId, null);
  }

  describe('useMcpStore — calling a tool');
  {
    requests.length = 0;
    nextResponse = {
      status: 200,
      body: { result: { content: [{ type: 'text', text: 'ok' }], isError: false }, isError: false }
    };
    const result = await useMcpStore.getState().callTool('mcp_1', 'read_file', { path: '/tmp/a' });

    equal(
      'it posts to the tool endpoint',
      requests[0].url,
      '/api/v1/mcp/servers/mcp_1/tools/read_file'
    );
    equal('with the arguments wrapped', requests[0].body, { arguments: { path: '/tmp/a' } });
    equal('and returns the structured result', result.content[0].text, 'ok');

    // A tool name with a slash must not become a different path.
    requests.length = 0;
    await useMcpStore.getState().callTool('mcp_1', 'group/tool', {});
    equal(
      'tool names are encoded',
      requests[0].url,
      '/api/v1/mcp/servers/mcp_1/tools/group%2Ftool'
    );
  }

  describe('useMcpStore — failures surface the server’s message');
  {
    nextResponse = {
      status: 409,
      body: { error: 'filesystem is stopped; start it first.', code: 'SERVER_NOT_RUNNING' }
    };
    let message = '';
    try {
      await useMcpStore.getState().startServer('mcp_1');
    } catch (err) {
      message = (err as Error).message;
    }
    equal(
      'the thrown message is the server’s own',
      message,
      'filesystem is stopped; start it first.'
    );
    equal(
      'and it is recorded in state',
      useMcpStore.getState().error,
      'filesystem is stopped; start it first.'
    );
    equal('with nothing left pending', useMcpStore.getState().pending.length, 0);
  }

  describe('useMcpStore — socket events');
  {
    useMcpStore.setState({ servers: [server({ status: 'RUNNING' })], error: null });

    check('an mcp event is recognised', isMcpEvent({ type: 'mcp.server_crashed' }));
    check('a memory event is not', !isMcpEvent({ type: 'memory.decision_created' }));
    check('and neither is nothing', !isMcpEvent(null));

    useMcpStore.getState().handleMcpEvent({
      id: 'e1',
      timestamp: 1,
      source: 'system:mcp',
      type: 'mcp.server_crashed',
      payload: { server: server({ status: 'CRASHED', pid: null, lastError: 'exited with code 3' }) }
    });
    equal('a crash rewrites the row', useMcpStore.getState().servers[0].status, 'CRASHED');
    equal('carrying the reason', useMcpStore.getState().servers[0].lastError, 'exited with code 3');

    useMcpStore.getState().handleMcpEvent({
      id: 'e2',
      timestamp: 2,
      source: 'system:mcp',
      type: 'mcp.capabilities_updated',
      payload: {
        server: server({
          capabilities: { ...server().capabilities!, tools: [{ name: 'only_one' }] }
        })
      }
    });
    equal(
      'a capability update replaces the catalogue',
      useMcpStore.getState().servers[0].capabilities!.tools.length,
      1
    );

    useMcpStore.getState().handleMcpEvent({
      id: 'e3',
      timestamp: 3,
      source: 'system:mcp',
      type: 'mcp.server_started',
      payload: { server: server({ id: 'mcp_new', name: 'zebra' }) }
    });
    equal(
      'an unknown server is added rather than dropped',
      useMcpStore.getState().servers.length,
      2
    );

    const before = useMcpStore.getState().servers.length;
    useMcpStore.getState().handleMcpEvent({
      id: 'e4',
      timestamp: 4,
      source: 'system:memory',
      type: 'memory.decision_created',
      payload: { server: undefined as unknown as McpServerRuntimeInfo }
    });
    equal('an unrelated event changes nothing', useMcpStore.getState().servers.length, before);
  }

  // --- Rendering -------------------------------------------------------------
  describe('McpServerExplorerView renders');
  {
    const empty = renderExplorer();
    check(
      'the empty state explains what a server is for',
      empty.includes('No MCP servers registered yet')
    );
    check('and always offers the create action', empty.includes('+ New MCP Server'));

    const html = renderExplorer({ servers: [server()] });
    check('the server name', html.includes('filesystem'));
    check('its status', html.includes('Running'));
    check('the tool count', html.includes('2 tools'));
    check('the pid', html.includes('PID 4242'));
    check('the uptime', html.includes('up 2m'));
    check('the transport', html.includes('stdio'));
    check('and the command it runs', html.includes('/usr/bin/node'));

    const crashed = renderExplorer({
      servers: [server({ status: 'CRASHED', pid: null, lastError: 'Process exited with code 3' })]
    });
    check('a crashed server says so', crashed.includes('Crashed'));
    check('and shows why', crashed.includes('Process exited with code 3'));
    check(
      'offering Start rather than Stop',
      crashed.includes('>Start<') && !crashed.includes('>Stop<')
    );

    const running = renderExplorer({ servers: [server()] });
    check('a running server offers Stop', running.includes('>Stop<'));

    const initializing = renderExplorer({ servers: [server({ status: 'INITIALIZING' })] });
    check('an initializing server is not yet callable', initializing.includes('Initializing'));

    const failed = renderExplorer({ error: 'Could not reach the Core' });
    check('a load failure is shown', failed.includes('Could not reach the Core'));

    const creating = renderExplorer({ initialCreating: true });
    check('the create modal renders', creating.includes('New MCP Server'));
    check('with the command field', creating.includes('mcp-command'));
    check(
      'and the warning that Asterim passes no credentials',
      creating.includes('never passes its own credentials')
    );
  }

  describe('McpServerDetailDrawer renders');
  {
    const withTools = renderToStaticMarkup(
      React.createElement(drawer.McpServerDetailDrawer, {
        server: server(),
        onClose: noop,
        onCallTool: noCall,
        onRefresh: noop
      })
    );
    check('the tools tab lists a tool', withTools.includes('read_file'));
    check('with its description', withTools.includes('Read a file'));
    check('and a way to run it', withTools.includes('Try tool'));
    check('the server identity is shown', withTools.includes('fs-server v1.2.3'));
    check('and the tab counts', withTools.includes('Tools (2)'));

    const resources = renderToStaticMarkup(
      React.createElement(drawer.McpServerDetailDrawer, {
        server: server(),
        onClose: noop,
        onCallTool: noCall,
        onRefresh: noop,
        initialTab: 'resources'
      })
    );
    check('the resources tab lists a resource', resources.includes('file:///workspace'));
    check('and a prompt', resources.includes('summarise'));
    check('marking required arguments', resources.includes('path*'));

    const logs = renderToStaticMarkup(
      React.createElement(drawer.McpServerDetailDrawer, {
        server: server({ recentStderrLogs: ['listening on stdio', 'warn: slow query'] }),
        onClose: noop,
        onCallTool: noCall,
        onRefresh: noop,
        initialTab: 'logs'
      })
    );
    check('the logs tab shows stderr', logs.includes('warn: slow query'));
    check('with a copy action', logs.includes('Copy'));

    const quiet = renderToStaticMarkup(
      React.createElement(drawer.McpServerDetailDrawer, {
        server: server({ recentStderrLogs: [] }),
        onClose: noop,
        onCallTool: noCall,
        onRefresh: noop,
        initialTab: 'logs'
      })
    );
    check('an empty log says so plainly', quiet.includes('written nothing to stderr'));

    const stopped = renderToStaticMarkup(
      React.createElement(drawer.McpServerDetailDrawer, {
        server: server({ status: 'STOPPED', capabilities: null }),
        onClose: noop,
        onCallTool: noCall,
        onRefresh: noop
      })
    );
    check(
      'a stopped server explains why there are no tools',
      stopped.includes('Start the server to discover its tools')
    );
  }
}

main()
  .catch(err => {
    failed++;
    console.error('\nUNCAUGHT ERROR:', err);
  })
  .finally(() => {
    console.log(`\n${passed}/${passed + failed} assertions passed`);
    if (failures.length > 0) {
      console.log('Failed assertions:');
      for (const f of failures) console.log(`  - ${f}`);
    }
    testGlobals.process?.exit(failed === 0 ? 0 : 1);
  });
