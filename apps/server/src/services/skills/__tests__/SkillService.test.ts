/**
 * Tests for the reusable skills subsystem (P6-06).
 *
 * The repository has no test runner (docs/p5.0-01-verification-report.md § 3), so this
 * is a standalone script with its own assertion harness, matching the MCP and
 * memory suites.
 *
 * Everything runs against real files in a temp directory rather than a mocked
 * `fs`. Discovery is almost entirely filesystem behaviour — a `SKILL.md` that is
 * a directory, a skill folder with no `SKILL.md` in it, a file too large to be
 * an instruction — and a mock that answers whatever the test asks would prove
 * only that the test agrees with itself.
 *
 * `ASTERIM_DATA_DIR` is pointed at that temp directory before the service
 * modules load, so the "global" scope is the temp tree and the developer's own
 * `~/.asterim/skills` is never read.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/skills/__tests__/SkillService.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-skills-'));
process.env.ASTERIM_DATA_DIR = tmpDir;

const { dbService } = require('../../DatabaseService');
const {
  SkillService,
  parseSkillMarkdown,
  normalizeParametersSchema,
  formatSkillPayload,
  globalSkillsDir,
  workspaceSkillsDir,
  MAX_SKILL_FILE_BYTES
} = require('../SkillService');
const { parseFrontmatter, parseScalar, parseYaml, stripComment } = require('../SkillFrontmatter');
const { McpAgentBridge, toSkillTool } = require('../../mcp/McpAgentBridge');
const { McpProcessSupervisor } = require('../../mcp/McpProcessSupervisor');
const { formatSkillInstructions, formatSessionInstructions } = require('../../mcp/McpToolPrompt');
const { skillToolName, isSkillToolName } = require('@asterim/shared');

type SkillDefinition = {
  id: string;
  name: string;
  description: string;
  scope: 'workspace' | 'global';
  path: string;
  parametersSchema?: Record<string, unknown>;
  instructions: string;
  scripts?: string[];
  references?: string[];
};

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

// --- Fixtures ---------------------------------------------------------------

const workspacePath = path.join(tmpDir, 'project');
const workspaceSkills = path.join(workspacePath, '.agents', 'skills');
const globalSkills = path.join(tmpDir, 'skills');

/** Writes one skill directory, creating whatever is missing above it. */
function writeSkill(root: string, dirName: string, contents: string, file = 'SKILL.md'): string {
  const dir = path.join(root, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), contents);
  return dir;
}

const REVIEW_SKILL = `---
name: review-diff
description: Reviews a git diff against the repository's own conventions.
parameters:
  path:
    type: string
    description: The file to review.
    required: true
  depth:
    type: string
    enum: ["quick", "thorough"]
scripts:
  - scripts/collect.sh
references: [references/checklist.md]
---

# Review a diff

1. Read the diff.
2. Compare it against \`blueprint/\`.
3. Report what disagrees.
`;

const RELEASE_SKILL = `---
name: cut-release
description: |
  Cuts a release.
  Tags it, then writes the notes.
parametersSchema: {"type":"object","properties":{"version":{"type":"string"}},"required":["version"]}
---

Run the release checklist.
`;

const GLOBAL_ONLY_SKILL = `---
name: scratchpad
description: A workstation-wide scratchpad procedure.
---

Write it down before you forget it.
`;

/** Shadowed by the workspace copy below; its body is what proves which won. */
const GLOBAL_REVIEW_SKILL = `---
name: review-diff
description: The workstation's own, older review skill.
---

This is the global copy.
`;

const NO_FRONTMATTER_SKILL = `# Summarise a thread

Read the thread and write three sentences.
`;

const CORRUPT_SKILL = `---
name: "unterminated
description: [1, 2
  : : :
---
Body survives anyway.
`;

async function main(): Promise<void> {
  dbService.getDb();

  fs.mkdirSync(workspaceSkills, { recursive: true });
  fs.mkdirSync(globalSkills, { recursive: true });

  writeSkill(workspaceSkills, 'review-diff', REVIEW_SKILL);
  fs.mkdirSync(path.join(workspaceSkills, 'review-diff', 'scripts'), { recursive: true });
  writeSkill(workspaceSkills, 'cut-release', RELEASE_SKILL);
  writeSkill(workspaceSkills, 'summarise', NO_FRONTMATTER_SKILL);
  writeSkill(globalSkills, 'scratchpad', GLOBAL_ONLY_SKILL);
  writeSkill(globalSkills, 'review-diff', GLOBAL_REVIEW_SKILL);

  // Cache disabled: this suite writes files between calls, and a cached answer
  // would be testing the cache rather than discovery.
  const skills = new SkillService(0);

  // =========================================================================
  describe('stripComment and parseScalar');
  // =========================================================================
  {
    equal('a trailing comment is removed', stripComment('value # note').trim(), 'value');
    equal('a # inside quotes is not a comment', stripComment('"a # b"'), '"a # b"');
    equal('a # without leading space is part of the value', stripComment('tag#1'), 'tag#1');

    equal('a plain string stays a string', parseScalar('hello world'), 'hello world');
    equal('a double-quoted string is unquoted', parseScalar('"hi: there"'), 'hi: there');
    equal("a single-quoted string too", parseScalar("'it''s here'"), "it's here");
    equal('an integer is a number', parseScalar('42'), 42);
    equal('a float is a number', parseScalar('1.5'), 1.5);
    equal('true is a boolean', parseScalar('true'), true);
    equal('null is null', parseScalar('null'), null);
    equal('a JSON object is parsed', parseScalar('{"a":1}'), { a: 1 });
    equal('a YAML flow list is parsed', parseScalar('[a, b, c]'), ['a', 'b', 'c']);
    equal('a YAML flow mapping is parsed', parseScalar('{type: string}'), { type: 'string' });
    equal('an empty flow list is empty', parseScalar('[]'), []);
    equal('a version-looking string is not mangled', parseScalar('1.2.3'), '1.2.3');
  }

  // =========================================================================
  describe('parseYaml — the supported subset');
  // =========================================================================
  {
    const parsed = parseYaml(
      [
        'name: demo',
        '# a comment line',
        'nested:',
        '  type: object',
        '  properties:',
        '    path:',
        '      type: string',
        'list:',
        '  - one',
        '  - two',
        'inline: [a, b]',
        'block: |',
        '  first',
        '  second',
        'folded: >',
        '  wrapped',
        '  together'
      ].join('\n')
    );

    equal('a scalar key', parsed.name, 'demo');
    equal('a nested mapping', (parsed.nested as any).properties.path.type, 'string');
    equal('a block sequence', parsed.list, ['one', 'two']);
    equal('a flow sequence', parsed.inline, ['a', 'b']);
    equal('a literal block keeps its newlines', parsed.block, 'first\nsecond\n');
    equal('a folded block joins its lines', parsed.folded, 'wrapped together\n');
    check('a comment line produces no key', !('# a comment line' in parsed));
  }

  // =========================================================================
  describe('parseYaml — what is and is not a key');
  // =========================================================================
  {
    equal('a quoted key is unquoted', parseYaml('"a key": 1')['a key'], 1);
    equal('a single-quoted key too', parseYaml("'it''s': 1")["it's"], 1);
    equal(
      'a colon with no space after it is a scalar, not a mapping',
      parseYaml('url: http://example.com/x').url,
      'http://example.com/x'
    );
    equal('a value may itself contain colons', parseYaml('at: 12:30').at, '12:30');
    equal('a line with no colon declares nothing', Object.keys(parseYaml('just some prose')), []);
    equal('and neither does a comment', Object.keys(parseYaml('# name: not a key')), []);

    // The parser reads a file a stranger may have written. A long line with no
    // colon in it is the shape that makes a naive `([^:#]+?)\s*:` regex
    // backtrack quadratically, so this asserts the scan stayed linear rather
    // than merely that the answer was right.
    const started = Date.now();
    const hostile = parseYaml(`${'a '.repeat(200000)}\nname: survived`);
    check('a very long keyless line does not hang the parser', Date.now() - started < 2000);
    equal('and the keys after it are still read', hostile.name, 'survived');
  }

  // =========================================================================
  describe('parseFrontmatter');
  // =========================================================================
  {
    const withFence = parseFrontmatter('---\nname: a\n---\nBody here.');
    equal('the fence is recognised', withFence.hasFrontmatter, true);
    equal('the mapping is parsed', withFence.data.name, 'a');
    equal('and the body is what follows it', withFence.body, 'Body here.');

    const none = parseFrontmatter(NO_FRONTMATTER_SKILL);
    equal('a file with no fence has no frontmatter', none.hasFrontmatter, false);
    check('and the whole file is the body', none.body.startsWith('# Summarise a thread'));

    const unterminated = parseFrontmatter('---\nname: a\nstill going');
    equal('an unclosed fence is not frontmatter', unterminated.hasFrontmatter, false);
    check('and nothing is invented from it', Object.keys(unterminated.data).length === 0);

    equal('an empty file parses to nothing', parseFrontmatter('').body, '');
    equal('CRLF line endings are handled', parseFrontmatter('---\r\nname: a\r\n---\r\nB').data.name, 'a');
  }

  // =========================================================================
  describe('normalizeParametersSchema');
  // =========================================================================
  {
    equal(
      'a full JSON Schema is taken as written',
      normalizeParametersSchema({ type: 'object', properties: { a: { type: 'string' } } }),
      { type: 'object', properties: { a: { type: 'string' } } }
    );

    const shorthand = normalizeParametersSchema({
      path: { type: 'string', description: 'A file', required: true },
      depth: { type: 'string' }
    });
    equal('shorthand becomes an object schema', (shorthand as any).type, 'object');
    equal('required markers are lifted into the array', (shorthand as any).required, ['path']);
    check('and are not left on the property', !('required' in (shorthand as any).properties.path));
    equal(
      'the rest of the descriptor survives',
      (shorthand as any).properties.path.description,
      'A file'
    );

    equal(
      'a bare type is a shorthand too',
      normalizeParametersSchema({ path: 'string' }),
      { type: 'object', properties: { path: { type: 'string' } } }
    );
    equal('an empty mapping declares nothing', normalizeParametersSchema({}), undefined);
    equal('a list is not a schema', normalizeParametersSchema(['a']), undefined);
    equal('and neither is a string', normalizeParametersSchema('nope'), undefined);
  }

  // =========================================================================
  describe('parseSkillMarkdown');
  // =========================================================================
  {
    const skill = parseSkillMarkdown(REVIEW_SKILL, '/tmp/skills/review-diff', 'workspace');
    equal('the declared name is used', skill.name, 'review-diff');
    equal('the id carries the scope', skill.id, 'workspace:review-diff');
    equal('the scope is recorded', skill.scope, 'workspace');
    equal('the path is recorded', skill.path, '/tmp/skills/review-diff');
    check('the description is the declared one', skill.description.startsWith('Reviews a git diff'));
    check('the body becomes the instructions', skill.instructions.includes('Compare it against'));
    check('and the frontmatter is not in them', !skill.instructions.includes('description:'));
    equal('the parameter schema is normalized', skill.parametersSchema?.type, 'object');
    equal('with required lifted', skill.parametersSchema?.required, ['path']);
    equal(
      'and the enum preserved',
      (skill.parametersSchema?.properties as any).depth.enum,
      ['quick', 'thorough']
    );
    equal('declared scripts are kept', skill.scripts, ['scripts/collect.sh']);
    equal('a flow list of references too', skill.references, ['references/checklist.md']);

    const release = parseSkillMarkdown(RELEASE_SKILL, '/tmp/skills/cut-release', 'global');
    check('a block-scalar description is joined', release.description.includes('Tags it'));
    equal('an inline JSON schema is taken whole', release.parametersSchema?.required, ['version']);

    const bare = parseSkillMarkdown(NO_FRONTMATTER_SKILL, '/tmp/skills/summarise', 'workspace');
    equal('with no frontmatter the directory names the skill', bare.name, 'summarise');
    check(
      'and the first paragraph becomes the description',
      bare.description.includes('Read the thread')
    );
    equal('no schema is invented', bare.parametersSchema, undefined);

    const corrupt = parseSkillMarkdown(CORRUPT_SKILL, '/tmp/skills/broken-one', 'workspace');
    check('a corrupt frontmatter still yields a skill', corrupt !== null);
    check('whose body survived it', corrupt.instructions.includes('Body survives anyway'));
    check('and whose name is callable whatever was salvaged', /^[A-Za-z0-9][\w.-]*$/.test(corrupt.name));

    const unnamed = parseSkillMarkdown(
      '---\ndescription: No name here.\n---\nDo the thing.',
      '/tmp/skills/broken-one',
      'workspace'
    );
    equal('a frontmatter with no name falls back to the directory', unnamed.name, 'broken-one');

    const unnameable = parseSkillMarkdown('---\nname: "  "\n---\nx', '/tmp/skills/!!!', 'global');
    equal('a directory with no usable name yields nothing', unnameable, null);

    const spaced = parseSkillMarkdown('---\nname: My Skill\n---\nx', '/tmp/skills/whatever', 'global');
    equal('a name with spaces is slugified into a callable one', spaced.name, 'My-Skill');
  }

  // =========================================================================
  describe('discoverSkills — both scopes');
  // =========================================================================
  {
    equal('the global directory follows ASTERIM_DATA_DIR', globalSkillsDir(), globalSkills);
    equal(
      'and the workspace one is .agents/skills',
      workspaceSkillsDir(workspacePath),
      workspaceSkills
    );

    const globalOnly: SkillDefinition[] = skills.discoverSkills();
    equal('with no workspace only the global scope is read', globalOnly.length, 2);
    check(
      'and every one of them is global',
      globalOnly.every(skill => skill.scope === 'global')
    );

    const all: SkillDefinition[] = skills.discoverSkills(workspacePath);
    equal(
      'a workspace adds its own, deduplicated by name',
      all.map(skill => skill.name),
      ['cut-release', 'review-diff', 'scratchpad', 'summarise']
    );
    equal('sorted by name', all[0].name, 'cut-release');

    const review = all.find(skill => skill.name === 'review-diff')!;
    equal('a name in both scopes resolves to the workspace copy', review.scope, 'workspace');
    check('proved by its instructions', !review.instructions.includes('This is the global copy'));
    equal('and its path', review.path, path.join(workspaceSkills, 'review-diff'));

    const scratchpad = all.find(skill => skill.name === 'scratchpad')!;
    equal('a global-only skill is still offered', scratchpad.scope, 'global');

    // An empty `scripts/` directory exists under review-diff; the declared list
    // must still win over what is on disk.
    equal('declared scripts are not overwritten by the filesystem', review.scripts, [
      'scripts/collect.sh'
    ]);
  }

  // =========================================================================
  describe('discoverSkills — it survives what it finds');
  // =========================================================================
  {
    // Everything below is a directory that is not a usable skill. None of them
    // may reduce what discovery returns.
    const before = skills.discoverSkills(workspacePath).length;

    fs.mkdirSync(path.join(workspaceSkills, 'no-skill-file'), { recursive: true });
    fs.writeFileSync(path.join(workspaceSkills, 'loose-file.md'), '# not a skill directory');
    fs.mkdirSync(path.join(workspaceSkills, 'directory-instead', 'SKILL.md'), { recursive: true });
    writeSkill(workspaceSkills, 'wrong-file', 'nothing', 'README.md');
    writeSkill(workspaceSkills, 'binary', '  not text at all');
    writeSkill(workspaceSkills, 'too-big', 'x'.repeat(MAX_SKILL_FILE_BYTES + 1));

    const after: SkillDefinition[] = skills.discoverSkills(workspacePath);
    equal('a directory with no SKILL.md is skipped', after.length, before + 1);
    check('a loose file is not a skill', !after.some(skill => skill.name === 'loose-file.md'));
    check(
      'a SKILL.md that is a directory is skipped',
      !after.some(skill => skill.name === 'directory-instead')
    );
    check('so is a directory holding some other file', !after.some(skill => skill.name === 'wrong-file'));
    check('an oversized file is refused', !after.some(skill => skill.name === 'too-big'));
    check('and unreadable bytes still parse to something', after.some(skill => skill.name === 'binary'));

    // The one skill that was added above is the binary one; the count check
    // above already asserts nothing else got through.
    const missingWorkspace: SkillDefinition[] = skills.discoverSkills(
      path.join(tmpDir, 'does-not-exist')
    );
    equal('a workspace with no .agents/skills is not an error', missingWorkspace.length, 2);

    fs.rmSync(path.join(workspaceSkills, 'no-skill-file'), { recursive: true, force: true });
    fs.rmSync(path.join(workspaceSkills, 'directory-instead'), { recursive: true, force: true });
    fs.rmSync(path.join(workspaceSkills, 'wrong-file'), { recursive: true, force: true });
    fs.rmSync(path.join(workspaceSkills, 'binary'), { recursive: true, force: true });
    fs.rmSync(path.join(workspaceSkills, 'too-big'), { recursive: true, force: true });
    fs.rmSync(path.join(workspaceSkills, 'loose-file.md'), { force: true });
  }

  // =========================================================================
  describe('the discovery cache');
  // =========================================================================
  {
    const cached = new SkillService(60000);
    equal('the first call reads the filesystem', cached.discoverSkills(workspacePath).length, 4);

    writeSkill(workspaceSkills, 'brand-new', '---\nname: brand-new\ndescription: New.\n---\nDo it.');
    equal('a skill added afterwards is not seen yet', cached.discoverSkills(workspacePath).length, 4);

    cached.invalidate(workspacePath);
    equal('until the cache is dropped', cached.discoverSkills(workspacePath).length, 5);

    fs.rmSync(path.join(workspaceSkills, 'brand-new'), { recursive: true, force: true });
    cached.invalidate();
    equal('invalidating everything works too', cached.discoverSkills(workspacePath).length, 4);
  }

  // =========================================================================
  describe('getSkill');
  // =========================================================================
  {
    equal('by name', skills.getSkill('review-diff', workspacePath)?.scope, 'workspace');
    equal('by id', skills.getSkill('global:scratchpad', workspacePath)?.name, 'scratchpad');
    equal('by namespaced tool name', skills.getSkill('skill__cut-release', workspacePath)?.name, 'cut-release');
    equal('case-insensitively', skills.getSkill('REVIEW-DIFF', workspacePath)?.name, 'review-diff');
    equal('an unknown name is null, not an error', skills.getSkill('nope', workspacePath), null);
    equal('and so is an empty one', skills.getSkill('', workspacePath), null);
    equal(
      'a workspace skill is invisible without the workspace',
      skills.getSkill('cut-release'),
      null
    );
  }

  // =========================================================================
  describe('executeSkill');
  // =========================================================================
  {
    const ok = skills.executeSkill('review-diff', { path: 'src/a.ts' }, workspacePath);
    equal('valid parameters are not an error', ok.isError, false);
    check('the payload names the skill', ok.text.includes('Skill: review-diff (workspace)'));
    check('echoes the parameters', ok.text.includes('"path":"src/a.ts"'));
    check('and carries the instructions', ok.text.includes('Compare it against'));
    check('listing the scripts it ships with', ok.text.includes('scripts/collect.sh'));

    const missing = skills.executeSkill('review-diff', {}, workspacePath);
    equal('a missing required parameter is an error', missing.isError, true);
    check('naming the parameter', missing.text.includes('review-diff.path: required'));
    check('and what to do about it', missing.text.includes('skill__review-diff again'));

    const badEnum = skills.executeSkill(
      'review-diff',
      { path: 'a.ts', depth: 'sideways' },
      workspacePath
    );
    equal('a value outside an enum is an error', badEnum.isError, true);
    check('listing the permitted values', badEnum.text.includes('thorough'));

    const unknown = skills.executeSkill('does-not-exist', {}, workspacePath);
    equal('an unknown skill is an error result, not a throw', unknown.isError, true);
    check('listing what is available instead', unknown.text.includes('review-diff'));

    const noSchema = skills.executeSkill('scratchpad', { anything: 1 }, workspacePath);
    equal('a skill with no schema accepts anything', noSchema.isError, false);

    equal(
      'no parameters means no parameter line',
      formatSkillPayload(skills.getSkill('scratchpad', workspacePath)!).includes('Parameters:'),
      false
    );
  }

  // =========================================================================
  describe('the agent bridge exposes skills as skill__<name>');
  // =========================================================================
  {
    const supervisor = new McpProcessSupervisor({
      requestTimeoutMs: 3000,
      handshakeTimeoutMs: 5000,
      toolTimeoutMs: 2000
    });
    const bridge = new McpAgentBridge(supervisor, skills);

    equal('skillToolName is the namespace', skillToolName('review-diff'), 'skill__review-diff');
    check('and it is recognisable', isSkillToolName('skill__review-diff'));
    check('while an MCP name is not a skill', !isSkillToolName('mcp__fs__read_file'));

    const withoutWorkspace = bridge.getAvailableTools();
    equal('with no workspace only global skills are offered', withoutWorkspace.length, 2);

    const tools = bridge.getAvailableTools(undefined, workspacePath);
    equal('no MCP server is running, so every tool is a skill', tools.length, 4);
    check(
      'each one namespaced',
      tools.every((tool: { name: string }) => tool.name.startsWith('skill__'))
    );
    check(
      'and marked as a skill rather than an MCP tool',
      tools.every((tool: { kind: string }) => tool.kind === 'skill')
    );

    const review = tools.find((tool: { name: string }) => tool.name === 'skill__review-diff');
    equal('the schema an agent must satisfy comes with it', review.inputSchema.required, ['path']);
    check('the description says what it does', review.description.includes('Reviews a git diff'));
    check('and where it came from', review.description.includes('this workspace'));

    const scratchpad = tools.find((tool: { name: string }) => tool.name === 'skill__scratchpad');
    check('a global skill says so', scratchpad.description.includes('this workstation'));
    equal(
      'a skill with no schema still offers an empty object',
      scratchpad.inputSchema,
      { type: 'object', properties: {} }
    );

    equal('resolveTool finds a skill', bridge.resolveTool('skill__review-diff', undefined, workspacePath)?.toolName, 'review-diff');

    const executed = await bridge.executeTool(
      'skill__review-diff',
      { path: 'a.ts' },
      undefined,
      workspacePath
    );
    equal('executing one is not an error', executed.isError, false);
    equal('reported under the name that was called', executed.name, 'skill__review-diff');
    check('and returns the instructions', executed.text.includes('Compare it against'));

    const invalid = await bridge.executeTool('skill__review-diff', {}, undefined, workspacePath);
    equal('bad parameters come back as an error result', invalid.isError, true);
    check('explaining what is wrong', invalid.text.includes('path: required'));

    const unknown = await bridge.executeTool('skill__nope', {}, undefined, workspacePath);
    equal('an unknown skill is an error result', unknown.isError, true);
    check('listing what exists', unknown.text.includes('review-diff'));

    const notNamespaced = await bridge.executeTool('review-diff', {}, undefined, workspacePath);
    equal('an un-namespaced name is refused', notNamespaced.isError, true);
    check('explaining both conventions', notNamespaced.text.includes('skill__<name>'));

    equal(
      'toSkillTool is the shape used everywhere',
      toSkillTool(skills.getSkill('scratchpad', workspacePath)!).serverName,
      'skills'
    );

    await supervisor.shutdownAll();
  }

  // =========================================================================
  describe('the session startup instructions');
  // =========================================================================
  {
    const discovered = skills.discoverSkills(workspacePath);

    equal('no skills means no skills block', formatSkillInstructions([]), '');

    const block: string = formatSkillInstructions(discovered);
    check(
      'every skill is named by its callable name',
      discovered.every((skill: SkillDefinition) => block.includes(`skill__${skill.name}`))
    );
    check('the workspace scope is marked', block.includes('[workspace]'));
    check('and the global one', block.includes('[global]'));
    check('the agent is told what calling one returns', block.includes("returns that skill's full instructions"));
    check('and told to prefer one over improvising', block.toLowerCase().includes('prefer a skill'));

    const both: string = formatSessionInstructions(
      [{ name: 'mcp__fs__read', description: 'Read a file', inputSchema: { type: 'object' } }],
      discovered
    );
    check('the combined block keeps the tools', both.includes('mcp__fs__read'));
    check('and the skills', both.includes('skill__review-diff'));

    equal('with neither, there is nothing to say', formatSessionInstructions([], []), '');
    equal(
      'tools alone do not mention skills',
      formatSessionInstructions(
        [{ name: 'mcp__fs__read', description: 'Read a file', inputSchema: {} }],
        []
      ).includes('Available skills'),
      false
    );
  }

  // =========================================================================
  describe('GET /api/v1/skills');
  // =========================================================================
  {
    const Fastify = require('fastify');
    const skillRoutes = require('../../../routes/skills').default;

    dbService
      .getDb()
      .prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)')
      .run('skills-project', 'Skills Project', workspacePath);

    // The real authMiddleware is a separate plugin; the routes only ever ask
    // whether `request.user` is set, so setting it is what an authorised
    // request looks like from here.
    const app = Fastify();
    app.addHook('onRequest', async (request: { user?: unknown }) => {
      request.user = { id: 'user_1' };
    });
    await app.register(skillRoutes);
    await app.ready();

    const anonymous = Fastify();
    await anonymous.register(skillRoutes);
    await anonymous.ready();

    const get = (url: string) => app.inject({ method: 'GET', url });

    const unauthorized = await anonymous.inject({ method: 'GET', url: '/api/v1/skills' });
    equal('an unauthenticated request is refused', unauthorized.statusCode, 401);

    const globalList = await get('/api/v1/skills');
    equal('listing without a workspace succeeds', globalList.statusCode, 200);
    equal('and returns the global skills', globalList.json().skills.length, 2);

    const scoped = await get(`/api/v1/skills?workspacePath=${encodeURIComponent(workspacePath)}`);
    equal('a registered workspace is accepted', scoped.statusCode, 200);
    equal('and adds its own skills', scoped.json().skills.length, 4);
    const listed = scoped.json().skills.find((skill: SkillDefinition) => skill.name === 'review-diff');
    equal('the scope is reported', listed.scope, 'workspace');
    equal('the schema is reported', listed.parametersSchema.required, ['path']);
    check('and so are the instructions', listed.instructions.includes('Compare it against'));

    const unregistered = await get('/api/v1/skills?workspacePath=%2Fetc');
    equal('an unregistered path is refused rather than scanned', unregistered.statusCode, 400);
    check('naming the reason', unregistered.json().error.includes('registered'));

    const traversal = await get(
      `/api/v1/skills?workspacePath=${encodeURIComponent(`${workspacePath}/../..`)}`
    );
    equal('and so is a traversal out of one', traversal.statusCode, 400);

    // =======================================================================
    describe('GET /api/v1/skills/:name');
    // =======================================================================
    const one = await get(
      `/api/v1/skills/review-diff?workspacePath=${encodeURIComponent(workspacePath)}`
    );
    equal('one skill is returned', one.statusCode, 200);
    equal('by name', one.json().skill.name, 'review-diff');
    check('with its full markdown', one.json().skill.instructions.includes('# Review a diff'));
    equal('and its parameter schema', one.json().skill.parametersSchema.required, ['path']);
    equal('content-type is JSON', one.headers['content-type']?.includes('application/json'), true);

    const byId = await get(
      `/api/v1/skills/${encodeURIComponent('global:scratchpad')}?workspacePath=${encodeURIComponent(workspacePath)}`
    );
    equal('an id works as well as a name', byId.statusCode, 200);
    equal('resolving to the right skill', byId.json().skill.name, 'scratchpad');

    const outOfScope = await get('/api/v1/skills/cut-release');
    equal('a workspace skill is 404 without its workspace', outOfScope.statusCode, 404);

    const missing = await get('/api/v1/skills/no-such-skill');
    equal('an unknown skill is 404', missing.statusCode, 404);
    check('saying which one', missing.json().error.includes('no-such-skill'));

    const anonymousOne = await anonymous.inject({ method: 'GET', url: '/api/v1/skills/review-diff' });
    equal('and the detail route needs a user too', anonymousOne.statusCode, 401);

    await app.close();
    await anonymous.close();
  }
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
