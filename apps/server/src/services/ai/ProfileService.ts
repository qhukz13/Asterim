/**
 * Agent Profiles (P6-07).
 *
 * Owns the `agent_profiles` table and the rules around it: the six built-in
 * roles are seeded on startup and are immutable through the API, custom
 * profiles are ordinary rows, and both are scoped to a workspace or to the
 * whole workstation.
 *
 * The seeding is an upsert rather than an insert-if-absent so that improving a
 * built-in prompt in a release actually reaches existing workstations. That is
 * only safe because a built-in cannot be edited: there is never a user's own
 * text in one of those rows to overwrite. A user who wants their own version
 * clones it, and the clone is a custom profile the seeder never touches.
 *
 * Nothing here formats a prompt for an agent. Composing the session's opening
 * instructions is the caller's job (`composeSessionInstructions` below is the
 * pure function it uses), so a profile stays a record and the wording of a
 * session lives with the rest of the session's wording in McpToolPrompt.
 */

import crypto from 'crypto';
import {
  AgentProfile,
  BUILTIN_PROFILES,
  CreateProfileInput,
  SkillDefinition,
  UpdateProfileInput,
  isProfileCapabilityAllowed,
  skillToolName
} from '@asterim/shared';
import { dbService } from '../DatabaseService';

/** How a profile failure reads to a caller that has to answer over HTTP. */
export type ProfileErrorCode = 'NOT_FOUND' | 'INVALID_INPUT' | 'BUILTIN_IMMUTABLE';

export class ProfileError extends Error {
  constructor(
    public readonly code: ProfileErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'ProfileError';
  }
}

/** Longest values accepted, so one bad request cannot fill the database. */
export const MAX_NAME_CHARS = 120;
export const MAX_ROLE_CHARS = 120;
export const MAX_DESCRIPTION_CHARS = 1000;
export const MAX_SYSTEM_PROMPT_CHARS = 40000;
/** Most entries any one capability list may hold. */
export const MAX_LIST_ENTRIES = 200;

interface ProfileRow {
  id: string;
  name: string;
  role: string;
  description: string;
  system_prompt: string;
  model: string | null;
  temperature: number | null;
  enabled_mcp_servers: string | null;
  enabled_skills: string | null;
  auto_approval_rules: string | null;
  is_builtin: number;
  workspace_id: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * A stored capability list, back as it went in.
 *
 * `null` in the column means "unset", which is not the same as `[]` and must
 * not decay into it — an empty list is a profile that deliberately reaches
 * nothing, and turning that into `undefined` would hand it everything.
 */
function parseList(raw: string | null): string[] | undefined {
  if (raw === null || raw === undefined) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return undefined;
  }
}

/** The inverse of `parseList`: unset stays unset. */
function serializeList(list: string[] | undefined): string | null {
  return list === undefined ? null : JSON.stringify(list);
}

function rowToProfile(row: ProfileRow): AgentProfile {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    description: row.description,
    systemPrompt: row.system_prompt,
    model: row.model ?? undefined,
    temperature: row.temperature ?? undefined,
    enabledMcpServers: parseList(row.enabled_mcp_servers),
    enabledSkills: parseList(row.enabled_skills),
    autoApprovalRules: parseList(row.auto_approval_rules),
    isBuiltin: row.is_builtin === 1,
    workspaceId: row.workspace_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** A required string field, trimmed, or a 400 that names the field. */
function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProfileError('INVALID_INPUT', `${field} is required and must be a non-empty string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new ProfileError('INVALID_INPUT', `${field} must be at most ${max} characters.`);
  }
  return trimmed;
}

/** An optional string field. An empty string means "clear it". */
function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new ProfileError('INVALID_INPUT', `${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new ProfileError('INVALID_INPUT', `${field} must be at most ${max} characters.`);
  }
  return trimmed || undefined;
}

/**
 * Temperature, if one was given.
 *
 * Bounded at 0–2 because that is the range every provider Asterim can drive
 * accepts; a value outside it is a typo that would otherwise be stored and
 * only fail much later, at the adapter.
 */
function optionalTemperature(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProfileError('INVALID_INPUT', 'temperature must be a number.');
  }
  if (value < 0 || value > 2) {
    throw new ProfileError('INVALID_INPUT', 'temperature must be between 0 and 2.');
  }
  return value;
}

/** An optional list of names. Present-but-empty is preserved, not dropped. */
function optionalList(value: unknown, field: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new ProfileError('INVALID_INPUT', `${field} must be an array of strings.`);
  }
  if (value.length > MAX_LIST_ENTRIES) {
    throw new ProfileError('INVALID_INPUT', `${field} must hold at most ${MAX_LIST_ENTRIES} entries.`);
  }
  const entries: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      throw new ProfileError('INVALID_INPUT', `${field} must be an array of strings.`);
    }
    const trimmed = entry.trim();
    if (trimmed) entries.push(trimmed);
  }
  return entries;
}

/**
 * Whether a profile lets a tool through.
 *
 * Skills and MCP tools are both tools by the time a session sees them, and they
 * arrive in one list; which of the profile's two lists applies is decided by
 * the tool's `kind`. Anything whose kind is unknown is treated as MCP, which is
 * what it was before skills existed.
 */
export interface ProfileFilterableTool {
  name: string;
  serverId?: string;
  serverName?: string;
  toolName?: string;
  kind?: string;
}

export function isToolAllowedByProfile(
  tool: ProfileFilterableTool,
  profile: Pick<AgentProfile, 'enabledMcpServers' | 'enabledSkills'> | null | undefined
): boolean {
  if (!profile) return true;

  if (tool.kind === 'skill') {
    // A skill answers to its bare name, its namespaced tool name, and its
    // scoped id — the three forms it appears under in the dashboard, all of
    // which a user is liable to paste into a profile.
    const candidates = [tool.toolName, tool.name, tool.serverId].filter(
      (v): v is string => !!v
    );
    return isProfileCapabilityAllowed(profile.enabledSkills, candidates);
  }

  const candidates = [tool.serverName, tool.serverId].filter((v): v is string => !!v);
  // A tool with no server behind it cannot be matched by a server list; only a
  // wildcard or an unset list can admit it.
  return isProfileCapabilityAllowed(profile.enabledMcpServers, candidates);
}

/** The tools a profile leaves available, in the order they came. */
export function filterToolsForProfile<T extends ProfileFilterableTool>(
  tools: T[],
  profile: Pick<AgentProfile, 'enabledMcpServers' | 'enabledSkills'> | null | undefined
): T[] {
  if (!profile) return tools;
  return tools.filter(tool => isToolAllowedByProfile(tool, profile));
}

/**
 * The skills a profile leaves available, for the instruction listing.
 *
 * Accepts the same three name forms as the tool filter above, so a profile
 * cannot admit a skill's tool while its description is withheld — the agent
 * would then hold a callable it was never told about.
 */
export function filterSkillsForProfile(
  skills: SkillDefinition[],
  profile: Pick<AgentProfile, 'enabledSkills'> | null | undefined
): SkillDefinition[] {
  if (!profile) return skills;
  return skills.filter(skill =>
    isProfileCapabilityAllowed(profile.enabledSkills, [
      skill.name,
      skill.id,
      skillToolName(skill.name)
    ])
  );
}

/**
 * The session's opening instructions: the persona first, the catalogue after.
 *
 * That order is deliberate. The tool block is reference material an agent
 * consults; the persona is what it is doing, and an agent that reads the role
 * last has already spent the intervening lines being nobody in particular.
 */
export function composeSessionInstructions(
  profile: Pick<AgentProfile, 'name' | 'role' | 'systemPrompt'> | null | undefined,
  toolInstructions: string
): string {
  const blocks: string[] = [];
  if (profile) {
    const header = `You are operating as the "${profile.name}" agent profile (role: ${profile.role}).`;
    blocks.push([header, '', profile.systemPrompt.trim()].join('\n'));
  }
  if (toolInstructions && toolInstructions.trim() !== '') blocks.push(toolInstructions);
  return blocks.join('\n\n');
}

export class ProfileService {
  private seeded = false;

  private db() {
    return dbService.getDb();
  }

  /**
   * Writes the six shipped profiles, then leaves them alone.
   *
   * Idempotent and cheap enough to call on every startup. The guard is only so
   * that a service constructed twice in one process — which the tests do — does
   * not repeat the work.
   */
  public initBuiltinProfiles(force = false): void {
    if (this.seeded && !force) return;

    const now = Date.now();
    try {
      const upsert = this.db().prepare(`
        INSERT INTO agent_profiles (
          id, name, role, description, system_prompt, model, temperature,
          enabled_mcp_servers, enabled_skills, auto_approval_rules,
          is_builtin, workspace_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, 1, NULL, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          role = excluded.role,
          description = excluded.description,
          system_prompt = excluded.system_prompt,
          enabled_mcp_servers = excluded.enabled_mcp_servers,
          enabled_skills = excluded.enabled_skills,
          auto_approval_rules = excluded.auto_approval_rules,
          is_builtin = 1,
          updated_at = excluded.updated_at
      `);

      for (const seed of BUILTIN_PROFILES) {
        upsert.run(
          seed.id,
          seed.name,
          seed.role,
          seed.description,
          seed.systemPrompt,
          serializeList(seed.enabledMcpServers),
          serializeList(seed.enabledSkills),
          serializeList(seed.autoApprovalRules),
          now,
          now
        );
      }
      this.seeded = true;
    } catch (err) {
      // A workstation with an unreadable profiles table must still start; the
      // catalogue will simply be empty and every session runs unprofiled.
      console.error('[Profiles] Could not seed the built-in profiles:', err);
    }
  }

  /**
   * The profiles a workspace can choose from.
   *
   * Always the built-ins, plus the workstation-wide custom ones, plus the ones
   * belonging to this workspace. Asking without a workspace yields the
   * workstation's own view — built-ins and unscoped customs — rather than every
   * workspace's private profiles, which would leak one team's personas into
   * another's picker.
   */
  public listProfiles(workspaceId?: string): AgentProfile[] {
    this.initBuiltinProfiles();
    const rows = this.db()
      .prepare(
        `SELECT * FROM agent_profiles
         WHERE is_builtin = 1
            OR workspace_id IS NULL
            OR workspace_id = ?
         ORDER BY is_builtin DESC, name ASC`
      )
      .all(workspaceId ?? null) as unknown as ProfileRow[];
    return rows.map(rowToProfile);
  }

  /** One profile, or null. */
  public getProfile(id: string): AgentProfile | null {
    if (!id) return null;
    this.initBuiltinProfiles();
    const row = this.db().prepare('SELECT * FROM agent_profiles WHERE id = ?').get(id) as
      | unknown as ProfileRow
      | undefined;
    return row ? rowToProfile(row) : null;
  }

  /** One profile, or a NOT_FOUND a route can turn into a 404. */
  public requireProfile(id: string): AgentProfile {
    const profile = this.getProfile(id);
    if (!profile) throw new ProfileError('NOT_FOUND', `No agent profile with id ${id}.`);
    return profile;
  }

  public createProfile(input: CreateProfileInput): AgentProfile {
    this.initBuiltinProfiles();
    const body = (input || {}) as unknown as Record<string, unknown>;

    const now = Date.now();
    const profile: AgentProfile = {
      id: crypto.randomUUID(),
      name: requireText(body.name, 'name', MAX_NAME_CHARS),
      role: requireText(body.role, 'role', MAX_ROLE_CHARS),
      description: requireText(body.description, 'description', MAX_DESCRIPTION_CHARS),
      systemPrompt: requireText(body.systemPrompt, 'systemPrompt', MAX_SYSTEM_PROMPT_CHARS),
      model: optionalText(body.model, 'model', MAX_NAME_CHARS),
      temperature: optionalTemperature(body.temperature),
      enabledMcpServers: optionalList(body.enabledMcpServers, 'enabledMcpServers'),
      enabledSkills: optionalList(body.enabledSkills, 'enabledSkills'),
      autoApprovalRules: optionalList(body.autoApprovalRules, 'autoApprovalRules'),
      // Not taken from the request: a client cannot declare itself built-in and
      // become undeletable.
      isBuiltin: false,
      workspaceId: optionalText(body.workspaceId, 'workspaceId', MAX_NAME_CHARS),
      createdAt: now,
      updatedAt: now
    };

    this.db()
      .prepare(
        `INSERT INTO agent_profiles (
           id, name, role, description, system_prompt, model, temperature,
           enabled_mcp_servers, enabled_skills, auto_approval_rules,
           is_builtin, workspace_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`
      )
      .run(
        profile.id,
        profile.name,
        profile.role,
        profile.description,
        profile.systemPrompt,
        profile.model ?? null,
        profile.temperature ?? null,
        serializeList(profile.enabledMcpServers),
        serializeList(profile.enabledSkills),
        serializeList(profile.autoApprovalRules),
        profile.workspaceId ?? null,
        profile.createdAt,
        profile.updatedAt
      );

    return profile;
  }

  /**
   * Applies a partial update.
   *
   * An absent field is left as it was rather than cleared, so a client that
   * sends only the field it changed does not have to round-trip the rest.
   */
  public updateProfile(id: string, input: UpdateProfileInput): AgentProfile {
    const existing = this.requireProfile(id);
    if (existing.isBuiltin) {
      throw new ProfileError(
        'BUILTIN_IMMUTABLE',
        `'${existing.name}' is a built-in profile and cannot be edited. Clone it to make your own.`
      );
    }

    const body = (input || {}) as unknown as Record<string, unknown>;
    const has = (field: string) => Object.prototype.hasOwnProperty.call(body, field);

    const updated: AgentProfile = {
      ...existing,
      name: has('name') ? requireText(body.name, 'name', MAX_NAME_CHARS) : existing.name,
      role: has('role') ? requireText(body.role, 'role', MAX_ROLE_CHARS) : existing.role,
      description: has('description')
        ? requireText(body.description, 'description', MAX_DESCRIPTION_CHARS)
        : existing.description,
      systemPrompt: has('systemPrompt')
        ? requireText(body.systemPrompt, 'systemPrompt', MAX_SYSTEM_PROMPT_CHARS)
        : existing.systemPrompt,
      model: has('model') ? optionalText(body.model, 'model', MAX_NAME_CHARS) : existing.model,
      temperature: has('temperature') ? optionalTemperature(body.temperature) : existing.temperature,
      enabledMcpServers: has('enabledMcpServers')
        ? optionalList(body.enabledMcpServers, 'enabledMcpServers')
        : existing.enabledMcpServers,
      enabledSkills: has('enabledSkills')
        ? optionalList(body.enabledSkills, 'enabledSkills')
        : existing.enabledSkills,
      autoApprovalRules: has('autoApprovalRules')
        ? optionalList(body.autoApprovalRules, 'autoApprovalRules')
        : existing.autoApprovalRules,
      workspaceId: has('workspaceId')
        ? optionalText(body.workspaceId, 'workspaceId', MAX_NAME_CHARS)
        : existing.workspaceId,
      updatedAt: Date.now()
    };

    this.db()
      .prepare(
        `UPDATE agent_profiles SET
           name = ?, role = ?, description = ?, system_prompt = ?, model = ?, temperature = ?,
           enabled_mcp_servers = ?, enabled_skills = ?, auto_approval_rules = ?,
           workspace_id = ?, updated_at = ?
         WHERE id = ? AND is_builtin = 0`
      )
      .run(
        updated.name,
        updated.role,
        updated.description,
        updated.systemPrompt,
        updated.model ?? null,
        updated.temperature ?? null,
        serializeList(updated.enabledMcpServers),
        serializeList(updated.enabledSkills),
        serializeList(updated.autoApprovalRules),
        updated.workspaceId ?? null,
        updated.updatedAt,
        id
      );

    return updated;
  }

  /**
   * Removes a custom profile.
   *
   * Threads pointing at it are cleared rather than left holding a dangling id,
   * which would otherwise start their next session unprofiled without ever
   * saying why.
   */
  public deleteProfile(id: string): boolean {
    const existing = this.requireProfile(id);
    if (existing.isBuiltin) {
      throw new ProfileError(
        'BUILTIN_IMMUTABLE',
        `'${existing.name}' is a built-in profile and cannot be deleted.`
      );
    }

    this.db().prepare('DELETE FROM agent_profiles WHERE id = ? AND is_builtin = 0').run(id);
    try {
      this.db().prepare('UPDATE threads SET profile_id = NULL WHERE profile_id = ?').run(id);
    } catch (err) {
      console.warn(`[Profiles] Could not clear threads referencing ${id}:`, (err as Error).message);
    }
    return true;
  }

  /** Copies a profile, built-in or not, into an editable one of the user's own. */
  public cloneProfile(id: string, overrides: Partial<CreateProfileInput> = {}): AgentProfile {
    const source = this.requireProfile(id);
    return this.createProfile({
      name: overrides.name ?? `${source.name} (copy)`,
      role: overrides.role ?? source.role,
      description: overrides.description ?? source.description,
      systemPrompt: overrides.systemPrompt ?? source.systemPrompt,
      model: overrides.model ?? source.model,
      temperature: overrides.temperature ?? source.temperature,
      enabledMcpServers: overrides.enabledMcpServers ?? source.enabledMcpServers,
      enabledSkills: overrides.enabledSkills ?? source.enabledSkills,
      autoApprovalRules: overrides.autoApprovalRules ?? source.autoApprovalRules,
      workspaceId: overrides.workspaceId ?? source.workspaceId
    });
  }

  /**
   * The profile a thread runs under, if one is recorded.
   *
   * Separate from `getProfile` because a thread pointing at a profile that has
   * since been deleted is not an error: the session starts unprofiled, exactly
   * as it would have before anyone chose one.
   */
  public getThreadProfile(threadId: string): AgentProfile | null {
    if (!threadId) return null;
    try {
      const row = this.db()
        .prepare('SELECT profile_id FROM threads WHERE id = ?')
        .get(threadId) as { profile_id?: string | null } | undefined;
      return row?.profile_id ? this.getProfile(row.profile_id) : null;
    } catch (err) {
      console.warn(
        `[Profiles] Could not read the profile for thread ${threadId}:`,
        (err as Error).message
      );
      return null;
    }
  }

  /** Records which profile a thread's next session should start under. */
  public setThreadProfile(threadId: string, profileId: string | null): void {
    if (!threadId) return;
    try {
      this.db().prepare('UPDATE threads SET profile_id = ? WHERE id = ?').run(profileId, threadId);
    } catch (err) {
      console.warn(
        `[Profiles] Could not record the profile for thread ${threadId}:`,
        (err as Error).message
      );
    }
  }
}

export const profileService = new ProfileService();
