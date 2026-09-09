/**
 * The approval consequence builder.
 *
 * These assertions are the product requirement written down: a person must be
 * able to see what approving does. In particular, creating a file and
 * overwriting one are different decisions and must not render the same.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/approvals/__tests__/consequence.test.ts
 */

import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  PREVIEW_MAX_LINES,
  buildConsequence,
  displayPath,
  makePreview,
  summarise
} from '../consequence';

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name} — ${(err as Error).message}`);
  }
}
function describe(name: string) {
  console.log(`\n${name}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-consequence-'));
const existing = path.join(tmp, 'existing.ts');
fs.writeFileSync(existing, 'export const version = 1;\n');
const absent = path.join(tmp, 'nested', 'new.ts');

// --- Previews ----------------------------------------------------------------

describe('makePreview');
{
  check('short text is shown whole with nothing omitted', () => {
    const p = makePreview('one\ntwo');
    assert.strictEqual(p.text, 'one\ntwo');
    assert.strictEqual(p.lines, 2);
    assert.strictEqual(p.omittedLines, 0);
    assert.strictEqual(p.bytes, 7);
  });

  check('long text is cut by line and reports what was dropped', () => {
    const source = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    const p = makePreview(source);
    assert.strictEqual(p.lines, PREVIEW_MAX_LINES);
    assert.strictEqual(p.omittedLines, 100 - PREVIEW_MAX_LINES);
    assert.ok(p.bytes > Buffer.byteLength(p.text, 'utf8'));
    assert.ok(p.text.startsWith('line 0'));
  });

  check('a single enormous line is cut by bytes, not left to blow up the event', () => {
    const p = makePreview('x'.repeat(50_000));
    assert.ok(Buffer.byteLength(p.text, 'utf8') <= 8000);
    assert.strictEqual(p.bytes, 50_000);
  });

  check('empty content is a valid preview', () => {
    const p = makePreview('');
    assert.strictEqual(p.text, '');
    assert.strictEqual(p.bytes, 0);
  });
}

// --- The decision that matters ------------------------------------------------

describe('Write: creating and overwriting are different decisions');
{
  const create = buildConsequence({
    toolName: 'Write',
    input: { file_path: absent, content: 'hello\nworld\n' }
  });
  const overwrite = buildConsequence({
    toolName: 'Write',
    input: { file_path: existing, content: 'export const version = 2;\n' }
  });

  check('a new path reads as create', () => {
    assert.strictEqual(create.kind, 'create');
    assert.strictEqual(create.pathExists, false);
    assert.ok(/create a new file/i.test(create.headline));
  });

  check('an existing path reads as overwrite, and says so', () => {
    assert.strictEqual(overwrite.kind, 'overwrite');
    assert.strictEqual(overwrite.pathExists, true);
    assert.ok(/replace the entire contents/i.test(overwrite.headline));
  });

  check('the content that will be written is on the card', () => {
    assert.strictEqual(create.content?.text, 'hello\nworld\n');
    assert.strictEqual(create.mutates, true);
  });
}

describe('Edit');
{
  const edit = buildConsequence({
    toolName: 'Edit',
    input: { file_path: existing, old_string: 'version = 1', new_string: 'version = 2' }
  });
  const editAll = buildConsequence({
    toolName: 'Edit',
    input: { file_path: existing, old_string: 'a', new_string: 'b', replace_all: true }
  });

  check('both sides of the replacement are shown', () => {
    assert.strictEqual(edit.kind, 'edit');
    assert.strictEqual(edit.edit?.before.text, 'version = 1');
    assert.strictEqual(edit.edit?.after.text, 'version = 2');
    assert.strictEqual(edit.edit?.occurrences, 1);
  });

  check('replace_all is called out in the headline', () => {
    assert.ok(/every occurrence/i.test(editAll.headline));
    assert.strictEqual(editAll.edit?.occurrences, undefined);
  });
}

describe('Bash');
{
  const run = buildConsequence({
    toolName: 'Bash',
    input: { command: 'pnpm run build', description: 'Build the project' },
    intent: 'Build the project'
  });
  const destroy = buildConsequence({ toolName: 'Bash', input: { command: 'rm -rf ./build' } });

  check('the command is carried verbatim', () => {
    assert.strictEqual(run.kind, 'shell');
    assert.strictEqual(run.command, 'pnpm run build');
    assert.strictEqual(run.intent, 'Build the project');
    assert.strictEqual(run.mutates, true);
  });

  check('a removing command is classified as a deletion', () => {
    assert.strictEqual(destroy.kind, 'delete');
    assert.ok(/removes files or data/i.test(destroy.headline));
  });

  check('an empty command still renders something', () => {
    const empty = buildConsequence({ toolName: 'Bash', input: {} });
    assert.strictEqual(empty.command, '(empty command)');
  });
}

describe('read-only and network tools');
{
  const read = buildConsequence({ toolName: 'Read', input: { file_path: existing } });
  const fetch = buildConsequence({ toolName: 'WebFetch', input: { url: 'https://example.com' } });

  check('a read is marked as changing nothing', () => {
    assert.strictEqual(read.kind, 'read');
    assert.strictEqual(read.mutates, false);
  });

  check('a fetch carries its url', () => {
    assert.strictEqual(fetch.kind, 'fetch');
    assert.strictEqual(fetch.url, 'https://example.com');
  });
}

describe('unrecognised tools are not guessed at');
{
  const unknown = buildConsequence({
    toolName: 'mcp__acme__do_thing',
    input: { target: 'production', force: true }
  });

  check('it says plainly that the tool is unrecognised', () => {
    assert.strictEqual(unknown.kind, 'other');
    assert.ok(/does not recognise/i.test(unknown.headline));
  });

  check('the arguments are shown so the person can judge for themselves', () => {
    assert.ok(unknown.raw?.text.includes('production'));
    assert.strictEqual(unknown.mutates, true);
  });

  check('arguments that cannot be serialised do not throw', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const c = buildConsequence({ toolName: 'weird', input: circular });
    assert.ok(c.raw);
  });
}

describe('paths and summaries');
{
  check('a path inside the project is shortened for reading', () => {
    assert.strictEqual(displayPath(existing, tmp), 'existing.ts');
  });

  check('a path outside the project stays absolute, because that is the point', () => {
    const outside = path.join(os.tmpdir(), 'elsewhere.ts');
    assert.strictEqual(displayPath(outside, path.join(tmp, 'sub')), outside);
  });

  check('the stored summary names the command for a shell action', () => {
    const c = buildConsequence({ toolName: 'Bash', input: { command: 'git status' } });
    assert.strictEqual(summarise(c), 'Bash: git status');
  });

  check('and the path for a file action', () => {
    const c = buildConsequence({ toolName: 'Write', input: { file_path: existing }, projectPath: tmp });
    assert.strictEqual(summarise(c), 'Write: existing.ts');
  });
}

describe('nothing here throws on hostile input');
{
  check('missing input object', () => {
    const c = buildConsequence({ toolName: 'Write', input: undefined as never });
    assert.ok(c.headline);
  });
  check('wrong types where strings are expected', () => {
    const c = buildConsequence({ toolName: 'Write', input: { file_path: 42, content: null } as never });
    assert.strictEqual(c.path, undefined);
    assert.strictEqual(c.content?.text, '');
  });
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed}/${passed + failed} assertions passed`);
if (failed > 0) process.exit(1);
