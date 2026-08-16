/**
 * Reusable Agent Skills contract (Phase 6).
 *
 * A skill is a directory the developer owns, holding a `SKILL.md` whose YAML
 * frontmatter names it and whose markdown body is the instruction an agent
 * follows. Asterim discovers them and describes them; it does not run them and
 * does not own them — the skill is the user's prompt, versioned in their repo.
 *
 * Two scopes exist and they mean different things. A `workspace` skill lives in
 * the project being worked on (`.agents/skills/`), so it travels with the
 * repository and is shared with whoever clones it. A `global` skill lives under
 * the Asterim data directory and belongs to the workstation alone.
 */

/** Where a skill was found, and therefore who it belongs to. */
export type SkillScope = 'workspace' | 'global';

/** One discovered skill, parsed from its `SKILL.md`. */
export interface SkillDefinition {
  /** `<scope>:<name>` — unique across both scopes. */
  id: string;
  /** The name an agent calls it by, as `skill__<name>`. */
  name: string;
  description: string;
  scope: SkillScope;
  /** Absolute path of the skill directory on this workstation. */
  path: string;
  /** JSON Schema for the skill's inputs, when the frontmatter declares one. */
  parametersSchema?: Record<string, unknown>;
  /** The markdown body: what the agent is told to do. */
  instructions: string;
  /** Entry scripts shipped with the skill, relative to `path`. */
  scripts?: string[];
  /** Reference files shipped with the skill, relative to `path`. */
  references?: string[];
}

/**
 * The prefix that makes a skill callable in the same namespace as MCP tools.
 *
 * `skill__` rather than `mcp__` on purpose: a skill is not served by a server
 * and has no process behind it, so a name that claimed otherwise would send an
 * agent looking for something to restart when a skill is missing.
 */
export const SKILL_TOOL_PREFIX = 'skill__';

/** Namespaced tool name for a skill. */
export function skillToolName(name: string): string {
  return `${SKILL_TOOL_PREFIX}${name}`;
}

/** True when a tool name refers to a skill rather than an MCP tool. */
export function isSkillToolName(toolName: string): boolean {
  return toolName.startsWith(SKILL_TOOL_PREFIX);
}

/**
 * What `executeSkill` hands back.
 *
 * A skill "executes" by being read: the payload is the instruction text the
 * agent then follows. `isError` covers the two ways that can fail — an unknown
 * skill, or parameters that do not satisfy the declared schema — and both come
 * back as text rather than as a thrown error, because the agent is mid-turn.
 */
export interface SkillExecutionResult {
  /** The skill that was asked for, as it was named. */
  name: string;
  isError: boolean;
  /** The instruction payload, or the reason there is none. */
  text: string;
  skill?: SkillDefinition;
}
