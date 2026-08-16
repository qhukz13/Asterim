/**
 * Discovery of reusable Agent Skills.
 *
 * A skill is a directory holding a `SKILL.md`. Asterim reads it and describes
 * it to an agent; it never runs anything the directory contains. That is the
 * whole security posture of this file: discovery is `readdir`, `stat` and
 * `readFile`, with no code path that spawns, imports or evaluates a discovered
 * file, and the frontmatter goes through `SkillFrontmatter`'s subset parser
 * rather than a YAML engine that could be talked into constructing objects.
 *
 * Two scopes are scanned, and a name found in both resolves to the workspace
 * copy. A skill reaches the agent as one flat name, `skill__<name>`, and two
 * skills answering to the same name would leave the agent choosing between
 * them; the repository's own copy is the one the developer is looking at, so it
 * is the one that wins.
 *
 * Nothing here throws for bad input. A corrupt file, an unreadable directory or
 * a `SKILL.md` that is a directory is logged and skipped, because one broken
 * skill must not take the other skills — or the session that wanted them — with
 * it.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { SkillDefinition, SkillExecutionResult, SkillScope, isSkillToolName, SKILL_TOOL_PREFIX } from '@asterim/shared';
import { parseFrontmatter, YamlMapping, YamlValue } from './SkillFrontmatter';
import { validateToolArguments } from '../mcp/SchemaValidator';

/** The one file that makes a directory a skill. */
export const SKILL_FILE = 'SKILL.md';

/** Where a repository keeps the skills it ships with itself. */
export const WORKSPACE_SKILLS_DIR = path.join('.agents', 'skills');

/** A `SKILL.md` larger than this is not an instruction, it is an accident. */
export const MAX_SKILL_FILE_BYTES = 512 * 1024;

/** An upper bound per scope, so a directory of thousands cannot stall a session. */
export const MAX_SKILLS_PER_SCOPE = 200;

/** How many files one skill lists from `scripts/` or `references/`. */
const MAX_LISTED_FILES = 50;

/**
 * How long a discovery is reused.
 *
 * Discovery is called once per session start and once per tool resolution, and
 * a filesystem walk on every agent tool call would be paid for by the user in
 * latency. Short enough that a skill added by hand shows up in the next few
 * seconds without anybody restarting anything.
 */
export const DISCOVERY_CACHE_MS = 5000;

/**
 * Frontmatter keys that carry a parameter schema.
 *
 * More than one because the open Agent Skill layout has not settled on a single
 * spelling, and rejecting a skill over which of these its author picked would be
 * a pointless failure.
 */
const SCHEMA_KEYS = [
  'parametersSchema',
  'parameters_schema',
  'parameters',
  'inputSchema',
  'input_schema',
  'arguments',
  'schema'
];

/**
 * What a skill may be called.
 *
 * The name becomes `skill__<name>` in the same flat namespace as MCP tools, so
 * it has to survive being written on one line of agent output and read back:
 * no whitespace, no quotes, nothing that would end the token early.
 */
const VALID_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Where the Asterim data directory lives — the same rule the database uses. */
function resolveDataDir(): string {
  const envDir = process.env.ASTERIM_DATA_DIR;
  return envDir ? path.resolve(envDir) : path.join(os.homedir(), '.asterim');
}

/** The workstation-wide skills directory, `~/.asterim/skills` by default. */
export function globalSkillsDir(): string {
  return path.join(resolveDataDir(), 'skills');
}

/** The skills a project ships with itself. */
export function workspaceSkillsDir(workspacePath: string): string {
  return path.join(path.resolve(workspacePath), WORKSPACE_SKILLS_DIR);
}

function asString(value: YamlValue | undefined): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/** A frontmatter list, accepting both a sequence and a comma-separated string. */
function asStringList(value: YamlValue | undefined): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value.map(item => asString(item)).filter((item): item is string => !!item);
    return items.length > 0 ? items.slice(0, MAX_LISTED_FILES) : undefined;
  }
  const single = asString(value);
  if (!single) return undefined;
  const items = single
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items.slice(0, MAX_LISTED_FILES) : undefined;
}

function isMapping(value: YamlValue | undefined): value is YamlMapping {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Turns whatever the author wrote under `parameters:` into a JSON Schema.
 *
 * Two shapes are common and both are honoured. A full schema — anything with
 * `type`, `properties` or `$schema` — is taken as written. The shorthand, a
 * mapping of parameter name to `{type, description, required}`, is lifted into
 * one: the `required: true` markers become the schema's `required` array, which
 * is what `validateToolArguments` reads.
 */
export function normalizeParametersSchema(raw: YamlValue | undefined): Record<string, unknown> | undefined {
  if (!isMapping(raw)) return undefined;
  if (Object.keys(raw).length === 0) return undefined;

  if ('properties' in raw || 'type' in raw || '$schema' in raw) {
    return raw as Record<string, unknown>;
  }

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [name, descriptor] of Object.entries(raw)) {
    if (!isMapping(descriptor)) {
      // `path: string` — the type on its own is a legitimate shorthand.
      const type = asString(descriptor);
      properties[name] = type ? { type } : {};
      continue;
    }
    const { required: isRequired, ...rest } = descriptor;
    if (isRequired === true) required.push(name);
    properties[name] = rest;
  }

  const schema: Record<string, unknown> = { type: 'object', properties };
  if (required.length > 0) schema.required = required;
  return schema;
}

/** A directory name reduced to something that can be a tool name. */
function slugify(value: string): string {
  const slug = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  return VALID_NAME.test(slug) ? slug : '';
}

/** The first prose paragraph of a body, used when no description was declared. */
function firstParagraph(body: string): string | undefined {
  for (const block of body.split(/\n\s*\n/)) {
    const text = block
      .split('\n')
      .filter(line => !line.trim().startsWith('#'))
      .join(' ')
      .trim();
    if (text) return text.length > 300 ? `${text.slice(0, 297)}…` : text;
  }
  return undefined;
}

/** Files directly under `<skill>/<subdir>`, for skills that ship code or notes. */
function listFiles(skillPath: string, subdir: string): string[] | undefined {
  const dir = path.join(skillPath, subdir);
  try {
    if (!fs.statSync(dir).isDirectory()) return undefined;
    const names = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => path.posix.join(subdir, entry.name))
      .sort();
    return names.length > 0 ? names.slice(0, MAX_LISTED_FILES) : undefined;
  } catch {
    // A missing or unreadable subdirectory simply means the skill has none.
    return undefined;
  }
}

/**
 * Parses one `SKILL.md` into a definition.
 *
 * Exported so the frontmatter rules can be tested without a filesystem. Returns
 * null only when there is no usable name at all — every other missing field has
 * a defensible fallback, and a skill with no description is still a skill.
 */
export function parseSkillMarkdown(
  source: string,
  skillPath: string,
  scope: SkillScope
): SkillDefinition | null {
  const { data, body } = parseFrontmatter(source);

  const declared = asString(data.name);
  const name = (declared && slugify(declared)) || slugify(path.basename(skillPath));
  if (!name) return null;

  const schemaKey = SCHEMA_KEYS.find(key => key in data);
  const parametersSchema = schemaKey ? normalizeParametersSchema(data[schemaKey]) : undefined;

  const scripts = asStringList(data.scripts) ?? listFiles(skillPath, 'scripts');
  const references = asStringList(data.references) ?? listFiles(skillPath, 'references');

  const definition: SkillDefinition = {
    id: `${scope}:${name}`,
    name,
    description: asString(data.description) ?? firstParagraph(body) ?? `The ${name} skill.`,
    scope,
    path: skillPath,
    instructions: body,
    ...(parametersSchema ? { parametersSchema } : {}),
    ...(scripts ? { scripts } : {}),
    ...(references ? { references } : {})
  };

  return definition;
}

/** One scope's directory, read defensively. */
function scanScope(dir: string, scope: SkillScope): SkillDefinition[] {
  const found: SkillDefinition[] = [];

  let entries: fs.Dirent[];
  try {
    if (!fs.statSync(dir).isDirectory()) return found;
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // A workstation with no skills directory is the normal case, not a fault.
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      console.warn(`[Skills] Could not read ${dir}: ${(err as Error).message}`);
    }
    return found;
  }

  for (const entry of entries) {
    if (found.length >= MAX_SKILLS_PER_SCOPE) {
      console.warn(`[Skills] More than ${MAX_SKILLS_PER_SCOPE} skills in ${dir}; the rest are ignored.`);
      break;
    }

    const skillPath = path.join(dir, entry.name);
    try {
      // `isDirectory()` is false for a symlink, so the link is followed once
      // here rather than skipped — a skills directory of symlinks into a
      // dotfiles repository is a reasonable thing for a developer to have.
      if (!fs.statSync(skillPath).isDirectory()) continue;

      const file = path.join(skillPath, SKILL_FILE);
      const stat = fs.statSync(file);
      if (!stat.isFile()) continue;
      if (stat.size > MAX_SKILL_FILE_BYTES) {
        console.warn(`[Skills] ${file} is ${stat.size} bytes; skipped.`);
        continue;
      }

      const skill = parseSkillMarkdown(fs.readFileSync(file, 'utf8'), skillPath, scope);
      if (skill) found.push(skill);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        console.warn(`[Skills] Skipped ${skillPath}: ${(err as Error).message}`);
      }
    }
  }

  return found;
}

interface CacheEntry {
  at: number;
  skills: SkillDefinition[];
}

export class SkillService {
  private cache = new Map<string, CacheEntry>();

  constructor(private readonly cacheMs: number = DISCOVERY_CACHE_MS) {}

  /**
   * Every skill available to a session, workspace copies shadowing global ones.
   *
   * `workspacePath` is the project's directory. Omitting it is legitimate — the
   * dashboard asks for the global set before a project is open — and yields the
   * workstation-wide skills alone.
   */
  public discoverSkills(workspacePath?: string): SkillDefinition[] {
    const key = workspacePath ? path.resolve(workspacePath) : '';
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.cacheMs) return cached.skills;

    const byName = new Map<string, SkillDefinition>();
    for (const skill of scanScope(globalSkillsDir(), 'global')) {
      byName.set(skill.name, skill);
    }
    if (key) {
      for (const skill of scanScope(workspaceSkillsDir(key), 'workspace')) {
        byName.set(skill.name, skill);
      }
    }

    const skills = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    this.cache.set(key, { at: Date.now(), skills });
    return skills;
  }

  /**
   * One skill by id, name or `skill__name`.
   *
   * Case-insensitive on the name because the agent is copying it out of a
   * prompt and a capital letter is not a reason to say the skill does not exist.
   */
  public getSkill(nameOrId: string, workspacePath?: string): SkillDefinition | null {
    if (!nameOrId) return null;
    const wanted = (isSkillToolName(nameOrId) ? nameOrId.slice(SKILL_TOOL_PREFIX.length) : nameOrId).trim();
    if (!wanted) return null;

    const skills = this.discoverSkills(workspacePath);
    const lowered = wanted.toLowerCase();
    return (
      skills.find(skill => skill.id === wanted) ??
      skills.find(skill => skill.name === wanted) ??
      skills.find(skill => skill.name.toLowerCase() === lowered) ??
      skills.find(skill => skill.id.toLowerCase() === lowered) ??
      null
    );
  }

  /**
   * Resolves a skill and returns the instructions an agent should follow.
   *
   * "Execution" is delivery of text: Asterim does not run the skill's scripts,
   * and a skill that wants one run says so in its instructions, where it goes
   * through the same approval path as any other command the agent proposes.
   */
  public executeSkill(
    name: string,
    params: Record<string, unknown> = {},
    workspacePath?: string
  ): SkillExecutionResult {
    const skill = this.getSkill(name, workspacePath);
    if (!skill) {
      const available = this.discoverSkills(workspacePath).map(candidate => candidate.name);
      return {
        name,
        isError: true,
        text:
          available.length === 0
            ? `No skill named '${name}' is available; this workspace publishes none.`
            : `No skill named '${name}' is available. Available skills: ${available.join(', ')}.`
      };
    }

    if (skill.parametersSchema) {
      const validation = validateToolArguments(params, skill.parametersSchema, skill.name);
      if (!validation.valid) {
        return {
          name: skill.name,
          isError: true,
          skill,
          text: `The parameters for '${skill.name}' are not valid: ${(validation.errors || []).join('; ')}. Correct them and call ${SKILL_TOOL_PREFIX}${skill.name} again.`
        };
      }
    }

    return { name: skill.name, isError: false, skill, text: formatSkillPayload(skill, params) };
  }

  /** Drops the cached discovery, so the next call reads the filesystem again. */
  public invalidate(workspacePath?: string): void {
    if (workspacePath === undefined) this.cache.clear();
    else this.cache.delete(path.resolve(workspacePath));
  }
}

/**
 * The instruction payload one skill hands back.
 *
 * The parameters are echoed above the body rather than substituted into it: a
 * skill's markdown is the author's text, and rewriting it here would make the
 * instruction the agent follows differ from the file the developer reads.
 */
export function formatSkillPayload(skill: SkillDefinition, params: Record<string, unknown> = {}): string {
  const lines = [`Skill: ${skill.name} (${skill.scope})`, skill.description];

  const supplied = Object.keys(params || {});
  if (supplied.length > 0) {
    let serialised: string;
    try {
      serialised = JSON.stringify(params);
    } catch {
      serialised = '{…}';
    }
    lines.push(`Parameters: ${serialised}`);
  }

  if (skill.scripts?.length) lines.push(`Scripts in ${skill.path}: ${skill.scripts.join(', ')}`);
  if (skill.references?.length) lines.push(`References in ${skill.path}: ${skill.references.join(', ')}`);

  lines.push('', '--- instructions ---', skill.instructions);
  return lines.join('\n');
}

export const skillService = new SkillService();
