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

import { AgentToolDescriptor, TOOL_CALL_PREFIX, TOOL_RESULT_PREFIX } from '@asterim/shared';
import { AgentTool } from './McpAgentBridge';

/** How many characters of one tool's schema are worth showing. */
const MAX_SCHEMA_CHARS = 600;

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
