/**
 * How MCP tools are described to an agent.
 *
 * An agent CLI driven over a PTY has no tool API to register with, so the
 * catalogue reaches it the same way everything else does: as text it reads at
 * the start of a session. This turns the bridge's tool list into that text, and
 * into the plain descriptors carried in the session startup payload.
 *
 * The instructions are deliberately short. They are prepended to a session that
 * also carries the user's own prompt, and a page of ceremony about a filesystem
 * server the user may never invoke costs context that the actual work needs.
 */

import {
  AgentToolDescriptor,
  SkillDefinition,
  TOOL_CALL_PREFIX,
  TOOL_RESULT_PREFIX,
  skillToolName
} from '@asterim/shared';
import { AgentTool } from './McpAgentBridge';

/** How many characters of one tool's schema are worth showing. */
const MAX_SCHEMA_CHARS = 600;

/** How much of a skill's description survives into the summary. */
const MAX_SKILL_DESCRIPTION_CHARS = 160;

/** How many skills are named before the list is cut short. */
const MAX_LISTED_SKILLS = 40;

/** The bridge's tools, reduced to what an agent needs to choose between them. */
export function toToolDescriptors(tools: AgentTool[]): AgentToolDescriptor[] {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }));
}

/** One tool, as a line an agent can read and act on. */
function formatTool(tool: AgentToolDescriptor): string {
  let schema: string;
  try {
    schema = JSON.stringify(tool.inputSchema ?? {});
  } catch {
    schema = '{}';
  }
  if (schema.length > MAX_SCHEMA_CHARS) {
    schema = `${schema.slice(0, MAX_SCHEMA_CHARS)}… (truncated)`;
  }
  return `- ${tool.name}: ${tool.description}\n  arguments: ${schema}`;
}

/**
 * The block of instructions handed to an agent at session start.
 *
 * Returns an empty string when there are no tools: telling an agent about a
 * calling convention it can never use only invites it to try.
 */
export function formatToolInstructions(tools: AgentToolDescriptor[]): string {
  if (tools.length === 0) return '';

  return [
    'You have access to MCP tools provided by Asterim.',
    `To call one, write a single line on its own: ${TOOL_CALL_PREFIX} {"tool":"<name>","arguments":{…}}`,
    `Asterim replies on the next line with ${TOOL_RESULT_PREFIX} {"tool":"<name>","isError":<bool>,"text":"…"}. Wait for that line before continuing.`,
    'Some calls need the user to approve them first, so a reply may take a moment.',
    '',
    'Available tools:',
    ...tools.map(formatTool)
  ].join('\n');
}

/** A skill's description, shortened to one readable line. */
function formatSkill(skill: SkillDefinition): string {
  const description = skill.description.replace(/\s+/g, ' ').trim();
  const short =
    description.length > MAX_SKILL_DESCRIPTION_CHARS
      ? `${description.slice(0, MAX_SKILL_DESCRIPTION_CHARS - 1)}…`
      : description;
  const scope = skill.scope === 'workspace' ? 'workspace' : 'global';
  return `- ${skillToolName(skill.name)} [${scope}]: ${short}`;
}

/**
 * The skills half of the startup block.
 *
 * Separate from the tool listing above even though skills are also callable
 * tools, because the two answer different questions. The tool list tells an
 * agent what it may invoke; this tells it that a body of the user's own
 * instructions exists and is worth reading before improvising a procedure the
 * repository already documents.
 *
 * Empty when there are no skills, for the same reason as the tool block: naming
 * a convention an agent cannot use only invites it to try.
 */
export function formatSkillInstructions(skills: SkillDefinition[]): string {
  if (skills.length === 0) return '';

  const listed = skills.slice(0, MAX_LISTED_SKILLS);
  const lines = [
    'Reusable skills are available. A skill is a procedure the user has written down for this project.',
    `Calling ${skillToolName('<name>')} returns that skill's full instructions, which you should then follow.`,
    'Prefer a skill over inventing your own procedure when one covers the task.',
    '',
    'Available skills:',
    ...listed.map(formatSkill)
  ];

  if (skills.length > listed.length) {
    lines.push(`- …and ${skills.length - listed.length} more.`);
  }

  return lines.join('\n');
}

/**
 * The whole startup block: tools, then skills.
 *
 * Joined here rather than by each caller so a session and a test cannot end up
 * describing the agent's capabilities differently.
 */
export function formatSessionInstructions(
  tools: AgentToolDescriptor[],
  skills: SkillDefinition[]
): string {
  return [formatToolInstructions(tools), formatSkillInstructions(skills)]
    .filter(block => block !== '')
    .join('\n\n');
}
