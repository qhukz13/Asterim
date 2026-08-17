/**
 * Tests for the [DEV-CHANNEL] header badge (P7-01, DEC-029).
 *
 * Three layers, matching the convention the desktop, environment and delegation
 * suites established:
 *   1. The pure predicate and tooltip — `shouldShowChannelBadge` and
 *      `channelBadgeTitle` — called directly. The predicate is the whole
 *      feature: a badge that shows on stable is noise nobody reads by the second
 *      day, and a badge that fails to show on dev is the operator typing into
 *      the wrong Asterim.
 *   2. Real rendering through `react-dom/server`, so what actually reaches the
 *      DOM is asserted rather than the props that were passed in.
 *   3. The real `TopBar`, rendered the same way — because a badge component that
 *      nothing puts on screen would satisfy every assertion in layers 1 and 2.
 *
 * `useChannel` itself is not covered here: it is a `useEffect` around one
 * `fetch`, and driving a hook needs a renderer this repository does not have.
 * Its contract — the URL it reads and the shape it stores — is the server
 * suite's `GET /api/v1/system/channel` assertions.
 *
 * Run:  pnpm --filter @asterim/web exec tsx src/components/__tests__/ChannelBadge.test.ts
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChannelInfo } from '@asterim/shared';
import { DEV_CHANNEL_BADGE_LABEL } from '@asterim/shared';
import { ChannelBadge, channelBadgeTitle, shouldShowChannelBadge } from '../ChannelBadge';

// `@types/node` is not in the dashboard's tsconfig — this is browser code — so
// the exit code is set through the same declared global the other web suites use.
// `localStorage` and `fetch` are stubbed for the same reason the desktop suite
// stubs them: `TopBar` is imported dynamically below and its stores read both at
// module scope.
interface TestGlobals {
  process?: { exit(code: number): void };
  localStorage?: unknown;
  fetch?: unknown;
}
const testGlobals = globalThis as TestGlobals;

const memoryStorage = new Map<string, string>();
testGlobals.localStorage = {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => memoryStorage.set(key, value),
  removeItem: (key: string) => memoryStorage.delete(key)
};
testGlobals.fetch = async () =>
  ({ ok: true, status: 200, json: async () => ({}) }) as Response;

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

const devChannel: ChannelInfo = {
  channel: 'dev',
  dataDir: '/home/dev/.asterim-dev',
  port: 3001,
  isDev: true,
  version: '0.1.0'
};

const stableChannel: ChannelInfo = {
  channel: 'stable',
  dataDir: '/home/dev/.asterim',
  port: 3000,
  isDev: false,
  version: '0.1.0'
};

function render(channel: ChannelInfo | null): string {
  return renderToStaticMarkup(React.createElement(ChannelBadge, { channel }));
}

async function main(): Promise<void> {
  describe('shouldShowChannelBadge');

  equal('a development Core is badged', shouldShowChannelBadge(devChannel), true);
  equal('a stable Core is not', shouldShowChannelBadge(stableChannel), false);
  equal('and neither is a Core that has not answered yet', shouldShowChannelBadge(null), false);
  equal('nor an undefined prop', shouldShowChannelBadge(undefined), false);

  describe('channelBadgeTitle names the directory the operator is about to write to');

  const title = channelBadgeTitle(devChannel);
  check('it carries the data directory', title.includes('/home/dev/.asterim-dev'), title);
  check('and the port', title.includes('3001'), title);
  check('and the version', title.includes('0.1.0'), title);
  check(
    'and says the stable data is untouched, which is the reassurance being offered',
    title.toLowerCase().includes('untouched'),
    title
  );

  describe('rendering');

  const devMarkup = render(devChannel);
  check('the dev badge renders', devMarkup.length > 0, devMarkup);
  check(
    `it reads [${DEV_CHANNEL_BADGE_LABEL}]`,
    devMarkup.includes(`[${DEV_CHANNEL_BADGE_LABEL}]`),
    devMarkup
  );
  check('it is findable in a screenshot check', devMarkup.includes('data-testid="channel-badge"'));
  check(
    'it uses the paused/amber token rather than a hardcoded colour',
    devMarkup.includes('var(--color-state-paused)') && !/#f59e0b/i.test(devMarkup),
    devMarkup
  );
  check('and it explains itself on hover', devMarkup.includes('title='), devMarkup);

  equal('a stable Core renders nothing at all', render(stableChannel), '');
  equal('and so does a Core that has not answered', render(null), '');

  // --- The header itself ----------------------------------------------------
  // Exporting a badge nobody renders would satisfy every assertion above, so the
  // real `TopBar` is rendered here. Imported dynamically, after the globals its
  // stores read at module scope are in place.
  describe('TopBar puts the badge in the header');

  const { TopBar } = await import('../TopBar');
  const header = (channel: ChannelInfo | null) =>
    renderToStaticMarkup(
      React.createElement(TopBar, { projectName: 'Asterim', channelInfo: channel })
    );

  const devHeader = header(devChannel);
  check(
    `the dev header carries [${DEV_CHANNEL_BADGE_LABEL}]`,
    devHeader.includes(`[${DEV_CHANNEL_BADGE_LABEL}]`),
    devHeader.slice(0, 300)
  );
  check(
    'and it is inside the <header>, where an operator will actually see it',
    /<header[^>]*>[\s\S]*\[DEV-CHANNEL\][\s\S]*<\/header>/.test(devHeader)
  );
  check(
    'a stable header carries no badge',
    !header(stableChannel).includes(DEV_CHANNEL_BADGE_LABEL)
  );
  check(
    'and neither does one rendered before the Core answered',
    !header(null).includes(DEV_CHANNEL_BADGE_LABEL)
  );
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
