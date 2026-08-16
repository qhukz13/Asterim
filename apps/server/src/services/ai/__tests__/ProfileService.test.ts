/**
 * Tests for the Agent Profiles subsystem (P6-07).
 *
 * The repository has no test runner (docs/p5.0-01-verification-report.md § 3), so this
 * is a standalone script with its own assertion harness, matching the MCP,
 * skills and memory suites.
 *
 * Everything runs against a real SQLite file in a temp directory rather than a
 * mocked database. Most of what is worth asserting here *is* storage behaviour
 * — a capability list that is empty rather than absent, a built-in row that an
 * upsert refreshes without duplicating, a legacy table of the same name that
 * has to be retired before the new one can be created — and a mock answering
 * whatever the test asks would prove only that the test agrees with itself.
 *
 * `ASTERIM_DATA_DIR` is pointed at that temp directory before the service
 * modules load, and the legacy table is planted in the database file first, so
 * the migration path is the one this suite actually exercises.
 *
 * Run:  pnpm --filter asterim exec tsx src/services/ai/__tests__/ProfileService.test.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterim-profiles-'));
process.env.ASTERIM_DATA_DIR = tmpDir;

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

/**
 * Plants the pre-P6-07 `agent_profiles` table.
 *
 * Written straight into the database file before DatabaseService is loaded, so
 * that `init()` meets exactly what an upgrading workstation's database holds:
 * a table of the right name and the wrong shape.
 */
function plantLegacyTable(): void {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(tmpDir, 'asterim.db'));
  db.exec(`
    CREATE TABLE agent_profiles (
      id TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      name TEXT NOT NULL,
      default_model TEXT NOT NULL,
      temperature REAL NOT NULL DEFAULT 0.2,
      mcp_visibility TEXT NOT NULL DEFAULT '[]',
      skills TEXT NOT NULL DEFAULT '[]',
      prompt_template TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  db.close();
}

plantLegacyTable();

// DatabaseService exports a singleton constructed at import time, so `require`
// is used instead of `import`, whose bindings would hoist above the assignment.
const { dbService } = require('../../DatabaseService');
const {
  ProfileService,
  ProfileError,
  composeSessionInstructions,
  filterSkillsForProfile,
  filterToolsForProfile,
  isToolAllowedByProfile,
  profileService,
  MAX_LIST_ENTRIES
} = require('../ProfileService');
const { BUILTIN_PROFILES, isProfileCapabilityAllowed } = require('@asterim/shared');
const Fastify = require('fastify');
const profileRoutes = require('../../../routes/profiles').default;

type AnyProfile = {
  id: string;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
  enabledMcpServers?: string[];
  enabledSkills?: string[];
  autoApprovalRules?: string[];
  isBuiltin: boolean;
  workspaceId?: string;
  createdAt: number;
  updatedAt: number;
};

/** A well-formed creation body, with whatever the caller wants changed. */
function draft(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Release Manager',
    role: 'Release Manager',
    description: 'Cuts releases and writes the notes.',
    systemPrompt: 'You cut releases. Check the changelog before the tag.',
    ...overrides
  };
}

/** Which error a call threw, or null when it did not throw. */
function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    const thrown = err as { code?: string; message?: string };
    return err instanceof ProfileError ? String(thrown.code) : `UNEXPECTED:${thrown.message}`;
  }
}

async function main(): Promise<void> {
  // --- The legacy table -------------------------------------------------------
  describe('the legacy agent_profiles table is retired, not left in the way');
  {
    const columns = (
      dbService.getDb().prepare('PRAGMA table_info(agent_profiles)').all() as Array<{ name: string }>
    ).map(column => column.name);

    check('the P6-07 columns are there', columns.includes('system_prompt') && columns.includes('role'));
    check('the legacy shape is gone', !columns.includes('environment_id'));

    const indexes = (
      dbService
        .getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_agent_profiles%'")
        .all() as Array<{ name: string }>
    ).map(row => row.name);
    check('its index went with it', !indexes.includes('idx_agent_profiles_env'));
    check('and the new ones are in place', indexes.includes('idx_agent_profiles_workspace'));

    const tables = (
      dbService
        .getDb()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'agent_profiles%'")
        .all() as Array<{ name: string }>
    ).map(row => row.name);
    equal('exactly one agent_profiles table remains', tables, ['agent_profiles']);

    const threadColumns = (
      dbService.getDb().prepare('PRAGMA table_info(threads)').all() as Array<{ name: string }>
    ).map(column => column.name);
    check('threads carry the profile they run under', threadColumns.includes('profile_id'));
  }

  // --- Seeding ----------------------------------------------------------------
  describe('initBuiltinProfiles');
  {
    profileService.initBuiltinProfiles();
    const builtins = profileService.listProfiles().filter((p: AnyProfile) => p.isBuiltin);

    equal('all six roles are seeded', builtins.length, 6);
    equal(
      'and they are the ones the contract names',
      builtins.map((p: AnyProfile) => p.name).sort(),
      [
        'DevOps Engineer',
        'Frontend Reviewer',
        'QA Engineer',
        'Security Auditor',
        'Senior Backend Engineer',
        'Tech Lead'
      ]
    );

    const auditor = builtins.find((p: AnyProfile) => p.name === 'Security Auditor') as AnyProfile;
    check('a built-in carries a substantial prompt', auditor.systemPrompt.length > 600);
    check('that is domain-specific rather than generic', auditor.systemPrompt.includes('traversal'));
    check('and it is marked built-in', auditor.isBuiltin === true);
    equal(
      'the auditor reaches no skills by choice, not by omission',
      auditor.enabledSkills,
      []
    );

    // Re-seeding is what a restart does, and what an upgrade relies on.
    profileService.initBuiltinProfiles(true);
    profileService.initBuiltinProfiles(true);
    equal(
      'seeding again does not duplicate them',
      profileService.listProfiles().filter((p: AnyProfile) => p.isBuiltin).length,
      6
    );

    // An upgrade that improves a prompt has to reach an existing workstation.
    dbService
      .getDb()
      .prepare('UPDATE agent_profiles SET system_prompt = ? WHERE id = ?')
      .run('stale', BUILTIN_PROFILES[0].id);
    profileService.initBuiltinProfiles(true);
    equal(
      'and it refreshes a built-in whose text has moved on',
      profileService.getProfile(BUILTIN_PROFILES[0].id).systemPrompt,
      BUILTIN_PROFILES[0].systemPrompt
    );
  }

  // --- Create -----------------------------------------------------------------
  describe('createProfile');
  let custom: AnyProfile;
  {
    custom = profileService.createProfile(
      draft({
        model: 'claude-opus-5',
        temperature: 0.3,
        enabledMcpServers: ['filesystem'],
        enabledSkills: [],
        autoApprovalRules: ['git status']
      })
    );

    check('it gets an id', typeof custom.id === 'string' && custom.id.length > 0);
    equal('it is not built-in', custom.isBuiltin, false);
    equal('the model round-trips', custom.model, 'claude-opus-5');
    equal('the temperature round-trips', custom.temperature, 0.3);
    equal('a named server list round-trips', custom.enabledMcpServers, ['filesystem']);
    equal('an empty skill list survives as empty, not absent', custom.enabledSkills, []);
    equal('the approval rules round-trip', custom.autoApprovalRules, ['git status']);
    check('timestamps are set', custom.createdAt > 0 && custom.updatedAt > 0);

    const reread = profileService.getProfile(custom.id) as AnyProfile;
    equal('and it reads back the same from storage', reread.enabledSkills, []);
    equal('with the server list intact', reread.enabledMcpServers, ['filesystem']);

    const bare = profileService.createProfile(draft({ name: 'Bare' })) as AnyProfile;
    equal('an unset server list stays unset', bare.enabledMcpServers, undefined);
    equal('and so does an unset skill list', bare.enabledSkills, undefined);

    equal(
      'a client cannot declare itself built-in',
      (profileService.createProfile(draft({ name: 'Impostor', isBuiltin: true })) as AnyProfile)
        .isBuiltin,
      false
    );
  }

  describe('createProfile — validation');
  {
    equal('a missing name is refused', codeOf(() => profileService.createProfile(draft({ name: '' }))), 'INVALID_INPUT');
    equal('whitespace is not a name', codeOf(() => profileService.createProfile(draft({ name: '   ' }))), 'INVALID_INPUT');
    equal('a missing role is refused', codeOf(() => profileService.createProfile(draft({ role: undefined }))), 'INVALID_INPUT');
    equal(
      'a missing description is refused',
      codeOf(() => profileService.createProfile(draft({ description: undefined }))),
      'INVALID_INPUT'
    );
    equal(
      'a missing system prompt is refused',
      codeOf(() => profileService.createProfile(draft({ systemPrompt: '' }))),
      'INVALID_INPUT'
    );
    equal(
      'a non-string name is refused',
      codeOf(() => profileService.createProfile(draft({ name: 42 }))),
      'INVALID_INPUT'
    );
    equal(
      'a temperature above the range is refused',
      codeOf(() => profileService.createProfile(draft({ temperature: 3 }))),
      'INVALID_INPUT'
    );
    equal(
      'a negative temperature is refused',
      codeOf(() => profileService.createProfile(draft({ temperature: -0.1 }))),
      'INVALID_INPUT'
    );
    equal(
      'a non-numeric temperature is refused',
      codeOf(() => profileService.createProfile(draft({ temperature: '0.4' }))),
      'INVALID_INPUT'
    );
    equal(
      'a capability list that is not an array is refused',
      codeOf(() => profileService.createProfile(draft({ enabledSkills: 'all' }))),
      'INVALID_INPUT'
    );
    equal(
      'a list holding a non-string is refused',
      codeOf(() => profileService.createProfile(draft({ enabledSkills: ['ok', 7] }))),
      'INVALID_INPUT'
    );
    equal(
      'an absurdly long list is refused',
      codeOf(() =>
        profileService.createProfile(
          draft({ enabledSkills: Array.from({ length: MAX_LIST_ENTRIES + 1 }, (_, i) => `s${i}`) })
        )
      ),
      'INVALID_INPUT'
    );
    equal(
      'an over-long name is refused',
      codeOf(() => profileService.createProfile(draft({ name: 'x'.repeat(200) }))),
      'INVALID_INPUT'
    );
  }

  // --- Update & delete ---------------------------------------------------------
  describe('updateProfile');
  {
    const updated = profileService.updateProfile(custom.id, { name: 'Release Captain' }) as AnyProfile;
    equal('the changed field is applied', updated.name, 'Release Captain');
    equal('an absent field is left alone', updated.systemPrompt, custom.systemPrompt);
    equal('and so are the capability lists', updated.enabledSkills, []);
    check('updatedAt moves forward', updated.updatedAt >= custom.updatedAt);

    const cleared = profileService.updateProfile(custom.id, { enabledMcpServers: [] }) as AnyProfile;
    equal('a list can be emptied deliberately', cleared.enabledMcpServers, []);
    const opened = profileService.updateProfile(custom.id, { enabledMcpServers: ['*'] }) as AnyProfile;
    equal('and opened again with a wildcard', opened.enabledMcpServers, ['*']);

    equal(
      'an update to an unknown profile is a 404',
      codeOf(() => profileService.updateProfile('no-such-profile', { name: 'x' })),
      'NOT_FOUND'
    );
    equal(
      'an invalid update is refused',
      codeOf(() => profileService.updateProfile(custom.id, { name: '' })),
      'INVALID_INPUT'
    );
    equal(
      'and the invalid update did not land',
      (profileService.getProfile(custom.id) as AnyProfile).name,
      'Release Captain'
    );
  }

  describe('built-in profiles are immutable');
  {
    const builtinId = BUILTIN_PROFILES[0].id;
    equal(
      'editing one is refused',
      codeOf(() => profileService.updateProfile(builtinId, { name: 'Mine now' })),
      'BUILTIN_IMMUTABLE'
    );
    equal(
      'deleting one is refused',
      codeOf(() => profileService.deleteProfile(builtinId)),
      'BUILTIN_IMMUTABLE'
    );
    equal(
      'and it is untouched',
      (profileService.getProfile(builtinId) as AnyProfile).name,
      BUILTIN_PROFILES[0].name
    );
    equal(
      'it is still in the catalogue',
      profileService.listProfiles().filter((p: AnyProfile) => p.isBuiltin).length,
      6
    );
  }

  describe('cloneProfile');
  {
    const clone = profileService.cloneProfile(BUILTIN_PROFILES[3].id) as AnyProfile;
    equal('a clone is editable', clone.isBuiltin, false);
    equal('it carries the source prompt', clone.systemPrompt, BUILTIN_PROFILES[3].systemPrompt);
    check('and is named as a copy', clone.name.includes('copy'));
    equal(
      'the source is unchanged',
      (profileService.getProfile(BUILTIN_PROFILES[3].id) as AnyProfile).isBuiltin,
      true
    );

    const renamed = profileService.cloneProfile(BUILTIN_PROFILES[3].id, {
      name: 'House Auditor'
    }) as AnyProfile;
    equal('an override wins', renamed.name, 'House Auditor');
    equal('and the rest still comes from the source', renamed.role, BUILTIN_PROFILES[3].role);

    profileService.deleteProfile(clone.id);
    profileService.deleteProfile(renamed.id);
  }

  describe('deleteProfile');
  {
    const doomed = profileService.createProfile(draft({ name: 'Temporary' })) as AnyProfile;
    dbService
      .getDb()
      .prepare('INSERT INTO projects (id, name, path) VALUES (?, ?, ?)')
      .run('profile-project', 'Profiles', '/tmp/profiles');
    dbService
      .getDb()
      .prepare('INSERT INTO threads (id, project_id, name, profile_id) VALUES (?, ?, ?, ?)')
      .run('profile-thread', 'profile-project', 'Main', doomed.id);

    equal('it deletes', profileService.deleteProfile(doomed.id), true);
    equal('and is gone', profileService.getProfile(doomed.id), null);
    equal(
      'a thread pointing at it is released rather than left dangling',
      profileService.getThreadProfile('profile-thread'),
      null
    );
    equal(
      'deleting it twice is a 404, not a silent success',
      codeOf(() => profileService.deleteProfile(doomed.id)),
      'NOT_FOUND'
    );
  }

  describe('thread assignment');
  {
    profileService.setThreadProfile('profile-thread', custom.id);
    equal(
      'a thread remembers its profile',
      (profileService.getThreadProfile('profile-thread') as AnyProfile).id,
      custom.id
    );
    equal('an unknown thread has none', profileService.getThreadProfile('no-such-thread'), null);
    profileService.setThreadProfile('profile-thread', null);
    equal('and it can be cleared', profileService.getThreadProfile('profile-thread'), null);
  }

  describe('listProfiles — workspace scoping');
  {
    const mine = profileService.createProfile(
      draft({ name: 'Team A Reviewer', workspaceId: 'ws-a' })
    ) as AnyProfile;
    const theirs = profileService.createProfile(
      draft({ name: 'Team B Reviewer', workspaceId: 'ws-b' })
    ) as AnyProfile;

    const listedForA = profileService.listProfiles('ws-a').map((p: AnyProfile) => p.id);
    check('a workspace sees its own', listedForA.includes(mine.id));
    check('and not another workspace’s', !listedForA.includes(theirs.id));
    check('but always the built-ins', listedForA.includes(BUILTIN_PROFILES[0].id));
    check('and the workstation-wide customs', listedForA.includes(custom.id));

    const unscoped = profileService.listProfiles().map((p: AnyProfile) => p.id);
    check('asking with no workspace does not leak one', !unscoped.includes(mine.id));
    check('nor the other', !unscoped.includes(theirs.id));

    const order = profileService.listProfiles('ws-a') as AnyProfile[];
    check('built-ins are listed first', order[0].isBuiltin === true);

    profileService.deleteProfile(mine.id);
    profileService.deleteProfile(theirs.id);
  }

  // --- Session application -----------------------------------------------------
  describe('isProfileCapabilityAllowed');
  {
    equal('an unset list admits everything', isProfileCapabilityAllowed(undefined, ['a']), true);
    equal('a wildcard admits everything', isProfileCapabilityAllowed(['*'], ['a']), true);
    equal('an empty list admits nothing', isProfileCapabilityAllowed([], ['a']), false);
    equal('a named entry admits its own', isProfileCapabilityAllowed(['a'], ['a']), true);
    equal('and refuses the rest', isProfileCapabilityAllowed(['a'], ['b']), false);
    equal('matching is case-insensitive', isProfileCapabilityAllowed(['FileSystem'], ['filesystem']), true);
    equal('and ignores stray whitespace', isProfileCapabilityAllowed([' memory '], ['memory']), true);
    equal('any one of several names is enough', isProfileCapabilityAllowed(['srv-1'], ['memory', 'srv-1']), true);
  }

  describe('filterToolsForProfile');
  {
    const tools = [
      { name: 'mcp__filesystem__read', serverId: 'srv-fs', serverName: 'filesystem', toolName: 'read', kind: 'mcp' },
      { name: 'mcp__memory__write', serverId: 'srv-mem', serverName: 'memory', toolName: 'write', kind: 'mcp' },
      // A skill tool as McpAgentBridge.toSkillTool builds it: its serverId is
      // the skill's scoped id, not a server.
      { name: 'skill__review-diff', serverId: 'workspace:review-diff', serverName: 'skills', toolName: 'review-diff', kind: 'skill' }
    ];

    equal('no profile leaves the catalogue alone', filterToolsForProfile(tools, null).length, 3);
    equal(
      'an unrestricted profile leaves it alone too',
      filterToolsForProfile(tools, { enabledMcpServers: undefined, enabledSkills: undefined }).length,
      3
    );
    equal(
      'a named server list keeps only that server',
      filterToolsForProfile(tools, { enabledMcpServers: ['filesystem'], enabledSkills: [] }).map(
        (t: { name: string }) => t.name
      ),
      ['mcp__filesystem__read']
    );
    equal(
      'the server list does not silently drop skills',
      filterToolsForProfile(tools, { enabledMcpServers: ['filesystem'] }).map((t: { name: string }) => t.name),
      ['mcp__filesystem__read', 'skill__review-diff']
    );
    equal(
      'an empty skill list removes every skill',
      filterToolsForProfile(tools, { enabledSkills: [] }).map((t: { name: string }) => t.name),
      ['mcp__filesystem__read', 'mcp__memory__write']
    );
    equal(
      'a server can be named by id as well as by name',
      filterToolsForProfile(tools, { enabledMcpServers: ['srv-mem'] }).map((t: { name: string }) => t.name),
      ['mcp__memory__write', 'skill__review-diff']
    );
    equal(
      'an empty server list removes every MCP tool',
      filterToolsForProfile(tools, { enabledMcpServers: [], enabledSkills: ['*'] }).map(
        (t: { name: string }) => t.name
      ),
      ['skill__review-diff']
    );
    equal(
      'a skill answers to its namespaced name too',
      isToolAllowedByProfile(tools[2], { enabledSkills: ['skill__review-diff'] }),
      true
    );
    equal(
      'and to its scoped id',
      isToolAllowedByProfile(tools[2], { enabledSkills: ['workspace:review-diff'] }),
      true
    );
    equal(
      'but not to a name it does not answer to',
      isToolAllowedByProfile(tools[2], { enabledSkills: ['scratchpad'] }),
      false
    );

    // The tool filter and the skill filter must agree on every name form, or a
    // session would hold a callable skill it was never told about.
    const skillDefs = [
      { id: 'workspace:review-diff', name: 'review-diff', description: 'd', scope: 'workspace', path: '/p', instructions: 'i' }
    ];
    for (const form of ['review-diff', 'skill__review-diff', 'workspace:review-diff']) {
      equal(
        `naming a skill as '${form}' admits both its tool and its description`,
        [
          filterToolsForProfile(tools, { enabledSkills: [form] }).some(
            (t: { kind?: string }) => t.kind === 'skill'
          ),
          filterSkillsForProfile(skillDefs, { enabledSkills: [form] }).length === 1
        ],
        [true, true]
      );
    }
  }

  describe('filterSkillsForProfile');
  {
    const skills = [
      { id: 'workspace:review-diff', name: 'review-diff', description: 'd', scope: 'workspace', path: '/p', instructions: 'i' },
      { id: 'global:scratchpad', name: 'scratchpad', description: 'd', scope: 'global', path: '/g', instructions: 'i' }
    ];
    equal('no profile keeps them all', filterSkillsForProfile(skills, null).length, 2);
    equal('an unset list keeps them all', filterSkillsForProfile(skills, {}).length, 2);
    equal('an empty list keeps none', filterSkillsForProfile(skills, { enabledSkills: [] }).length, 0);
    equal(
      'a named skill is kept',
      filterSkillsForProfile(skills, { enabledSkills: ['review-diff'] }).map(
        (s: { name: string }) => s.name
      ),
      ['review-diff']
    );
    equal(
      'and it can be named by id',
      filterSkillsForProfile(skills, { enabledSkills: ['global:scratchpad'] }).map(
        (s: { name: string }) => s.name
      ),
      ['scratchpad']
    );
  }

  describe('composeSessionInstructions');
  {
    const profile = { name: 'House Auditor', role: 'Security Auditor', systemPrompt: 'Find the traversal.' };

    const both = composeSessionInstructions(profile, 'Available tools:\n- mcp__x__y: does y');
    check('the persona is named', both.includes('House Auditor'));
    check('with its role', both.includes('Security Auditor'));
    check('the prompt itself is carried', both.includes('Find the traversal.'));
    check('and so is the tool block', both.includes('mcp__x__y'));
    check(
      'the persona comes before the catalogue',
      both.indexOf('Find the traversal.') < both.indexOf('mcp__x__y')
    );

    equal(
      'no profile means the tool block alone',
      composeSessionInstructions(null, 'tools here'),
      'tools here'
    );
    equal('and no tools means neither', composeSessionInstructions(null, ''), '');
    check(
      'a profile with no tools still opens with its persona',
      composeSessionInstructions(profile, '').includes('Find the traversal.')
    );
    check(
      'and does not trail an empty block',
      !composeSessionInstructions(profile, '').endsWith('\n\n')
    );
  }

  describe('a second service instance shares the same table');
  {
    const other = new ProfileService();
    equal(
      'it sees what the first one wrote',
      (other.getProfile(custom.id) as AnyProfile).name,
      'Release Captain'
    );
  }

  // --- REST -------------------------------------------------------------------
  describe('the REST surface');
  {
    const app = Fastify();
    // Stands in for authMiddleware, which is registered globally in index.ts:
    // an anonymous request carries no `user`, and the routes must refuse it.
    app.addHook('onRequest', async (request: { headers: Record<string, string>; user?: unknown }) => {
      if (request.headers['x-anonymous'] !== 'yes') request.user = { id: 'test-user' };
    });
    await app.register(profileRoutes);
    await app.ready();

    const anonymous = await app.inject({
      method: 'GET',
      url: '/api/v1/profiles',
      headers: { 'x-anonymous': 'yes' }
    });
    equal('an anonymous list is 401', anonymous.statusCode, 401);

    const listed = await app.inject({ method: 'GET', url: '/api/v1/profiles' });
    equal('listing is 200', listed.statusCode, 200);
    check('the built-ins are there', listed.json().profiles.length >= 6);
    equal(
      'content-type is JSON',
      listed.headers['content-type']?.includes('application/json'),
      true
    );

    const one = await app.inject({ method: 'GET', url: `/api/v1/profiles/${BUILTIN_PROFILES[0].id}` });
    equal('fetching one is 200', one.statusCode, 200);
    equal('and it carries the full prompt', one.json().profile.systemPrompt, BUILTIN_PROFILES[0].systemPrompt);

    const missing = await app.inject({ method: 'GET', url: '/api/v1/profiles/nope' });
    equal('an unknown profile is 404', missing.statusCode, 404);
    equal('with a code a client can branch on', missing.json().code, 'NOT_FOUND');

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: draft({ name: 'REST Profile', enabledSkills: [] })
    });
    equal('creating is 201', created.statusCode, 201);
    equal('and the profile comes back', created.json().profile.name, 'REST Profile');
    equal('with the empty list preserved', created.json().profile.enabledSkills, []);
    const restId = created.json().profile.id;

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: { name: 'Only a name' }
    });
    equal('an incomplete body is 400', invalid.statusCode, 400);
    check('the 400 names the missing field', /role/.test(invalid.json().error));

    const noBody = await app.inject({ method: 'POST', url: '/api/v1/profiles' });
    equal('an empty body is 400', noBody.statusCode, 400);

    const cloned = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: { cloneOf: BUILTIN_PROFILES[1].id, name: 'My Reviewer' }
    });
    equal('cloning is 201', cloned.statusCode, 201);
    equal('the clone is editable', cloned.json().profile.isBuiltin, false);
    equal(
      'and inherits the prompt it never had to send',
      cloned.json().profile.systemPrompt,
      BUILTIN_PROFILES[1].systemPrompt
    );

    const put = await app.inject({
      method: 'PUT',
      url: `/api/v1/profiles/${restId}`,
      payload: { description: 'Updated over HTTP.' }
    });
    equal('updating is 200', put.statusCode, 200);
    equal('the change lands', put.json().profile.description, 'Updated over HTTP.');
    equal('and the untouched fields survive', put.json().profile.name, 'REST Profile');

    const putBuiltin = await app.inject({
      method: 'PUT',
      url: `/api/v1/profiles/${BUILTIN_PROFILES[0].id}`,
      payload: { name: 'Hijacked' }
    });
    equal('updating a built-in is 409', putBuiltin.statusCode, 409);
    equal('with the immutability code', putBuiltin.json().code, 'BUILTIN_IMMUTABLE');

    const deleteBuiltin = await app.inject({
      method: 'DELETE',
      url: `/api/v1/profiles/${BUILTIN_PROFILES[0].id}`
    });
    equal('deleting a built-in is 409', deleteBuiltin.statusCode, 409);

    const putMissing = await app.inject({
      method: 'PUT',
      url: '/api/v1/profiles/nope',
      payload: { name: 'x' }
    });
    equal('updating an unknown profile is 404', putMissing.statusCode, 404);

    const badTemperature = await app.inject({
      method: 'PUT',
      url: `/api/v1/profiles/${restId}`,
      payload: { temperature: 9 }
    });
    equal('an out-of-range temperature is 400', badTemperature.statusCode, 400);

    const removed = await app.inject({ method: 'DELETE', url: `/api/v1/profiles/${restId}` });
    equal('deleting a custom profile is 200', removed.statusCode, 200);
    equal('and says so', removed.json().deleted, true);
    equal(
      'a second delete is 404',
      (await app.inject({ method: 'DELETE', url: `/api/v1/profiles/${restId}` })).statusCode,
      404
    );

    const anonymousWrite = await app.inject({
      method: 'POST',
      url: '/api/v1/profiles',
      payload: draft(),
      headers: { 'x-anonymous': 'yes' }
    });
    equal('an anonymous create is 401', anonymousWrite.statusCode, 401);

    await app.close();
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
