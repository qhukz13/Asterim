import { McpToolCallResult, McpToolDefinition } from '@asterim/shared';
import { McpError, mcpProcessSupervisor, McpProcessSupervisor } from './McpProcessSupervisor';

/**
 * What an agent sees of the MCP subsystem.
 *
 * An agent does not know about servers, sessions or pipes. It knows a flat list
 * of tools with names it can call, so this flattens every running server's
 * catalogue into one namespace and routes calls back to the right session.
 *
 * The namespace is `mcp__<server>__<tool>`, the convention the agent CLIs
 * already use for MCP tools. Two servers may both publish `read_file`; the
 * server name is what keeps them apart.
 */

/** Separator between the prefix, the server name and the tool name. */
const SEPARATOR = '__';
const PREFIX = `mcp${SEPARATOR}`;

/** A tool as an agent sees it: one flat name, one description, one schema. */
export interface AgentTool {
  /** `mcp__<server>__<tool>` */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
  serverName: string;
  toolName: string;
}

/**
 * The answer to one tool call, in the form an agent consumes.
 *
 * `text` is always populated — an agent needs something to read whether the
 * call succeeded, the tool refused, or Asterim never let it through — and
 * `isError` says which of those happened.
 */
export interface AgentToolResult {
  name: string;
  isError: boolean;
  text: string;
  /** The raw MCP content, for callers that want more than the flattened text. */
  content?: McpToolCallResult['content'];
}

/** Namespaced name for one tool on one server. */
export function namespaceToolName(serverName: string, toolName: string): string {
  return `${PREFIX}${serverName}${SEPARATOR}${toolName}`;
}

/** Flattens MCP content into the single string an agent reads. */
export function flattenContent(content: McpToolCallResult['content']): string {
  if (!content || content.length === 0) return '(the tool returned no content)';
  return content
    .map(part => {
      if (typeof part.text === 'string') return part.text;
      if (part.data)
        return `[${part.mimeType || part.type}: ${part.data.length} base64 characters]`;
      return `[${part.type}]`;
    })
    .join('\n');
}

export class McpAgentBridge {
  constructor(private readonly supervisor: McpProcessSupervisor = mcpProcessSupervisor) {}

  /**
   * Every tool an agent may call right now.
   *
   * Only `RUNNING` servers contribute: a tool on a stopped server is not a tool
   * an agent can use, and offering it would produce a failure the agent cannot
   * do anything about. Scoping by workspace follows the supervisor's own rule —
   * that workspace's servers plus the workstation-wide ones.
   */
  public getAvailableTools(workspaceId?: string): AgentTool[] {
    const tools: AgentTool[] = [];

    for (const server of this.supervisor.listServers(workspaceId)) {
      if (server.status !== 'RUNNING' || !server.capabilities) continue;

      for (const tool of server.capabilities.tools) {
        tools.push({
          name: namespaceToolName(server.name, tool.name),
          description: describeTool(server.name, tool),
          inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
          serverId: server.id,
          serverName: server.name,
          toolName: tool.name
        });
      }
    }

    return tools;
  }

  /**
   * Resolves a namespaced name back to the tool it refers to.
   *
   * Matched against the live catalogue rather than by splitting on `__`,
   * because a server or tool name may itself contain the separator and there is
   * no way to split that unambiguously. Exposed for the error paths and tests.
   */
  public resolveTool(namespacedName: string, workspaceId?: string): AgentTool | null {
    return this.getAvailableTools(workspaceId).find(tool => tool.name === namespacedName) ?? null;
  }

  /**
   * Runs a tool on behalf of an agent.
   *
   * Never throws. Everything that can go wrong — an unknown tool, a stopped
   * server, bad arguments, a timeout, a full queue — comes back as
   * `isError: true` with text the agent can act on, because an exception in
   * this path would surface to the model as a dead session rather than as an
   * answer it can correct.
   */
  public async executeTool(
    namespacedName: string,
    args: Record<string, unknown> = {},
    workspaceId?: string
  ): Promise<AgentToolResult> {
    const tool = this.resolveTool(namespacedName, workspaceId);

    if (!tool) {
      return {
        name: namespacedName,
        isError: true,
        text: this.explainUnknownTool(namespacedName, workspaceId)
      };
    }

    try {
      const result = await this.supervisor.callTool(tool.serverId, tool.toolName, args);
      return {
        name: namespacedName,
        isError: result.isError,
        text: flattenContent(result.content),
        content: result.content
      };
    } catch (err) {
      return {
        name: namespacedName,
        isError: true,
        text: formatFailure(namespacedName, err)
      };
    }
  }

  /**
   * Says why a name did not resolve, in the most useful way available: whether
   * the server exists but is not running, whether the tool is unknown to a
   * server that is, or whether the name was never MCP's to begin with.
   */
  private explainUnknownTool(namespacedName: string, workspaceId?: string): string {
    if (!namespacedName.startsWith(PREFIX)) {
      return `'${namespacedName}' is not an MCP tool name; MCP tools are called as ${PREFIX}<server>${SEPARATOR}<tool>.`;
    }

    const remainder = namespacedName.slice(PREFIX.length);
    const stopped = this.supervisor
      .listServers(workspaceId)
      .find(
        server => remainder.startsWith(`${server.name}${SEPARATOR}`) && server.status !== 'RUNNING'
      );

    if (stopped) {
      return `The MCP server '${stopped.name}' is ${stopped.status.toLowerCase()}, so '${namespacedName}' is unavailable. Start it and try again.`;
    }

    const available = this.getAvailableTools(workspaceId).map(tool => tool.name);
    return available.length === 0
      ? `No MCP tools are available: no MCP server is running.`
      : `'${namespacedName}' is not an available MCP tool. Available: ${available.join(', ')}.`;
  }
}

/** A description an agent can choose from, with the server named for context. */
function describeTool(serverName: string, tool: McpToolDefinition): string {
  return tool.description
    ? `${tool.description} (via the ${serverName} MCP server)`
    : `The ${tool.name} tool, provided by the ${serverName} MCP server.`;
}

/** Turns a supervisor failure into a sentence an agent can act on. */
function formatFailure(namespacedName: string, err: unknown): string {
  if (err instanceof McpError) {
    switch (err.code) {
      case 'INVALID_ARGUMENTS':
        return `${err.message} Correct the arguments and call ${namespacedName} again.`;
      case 'QUEUE_FULL':
        return `${err.message} The server accepts one call at a time.`;
      case 'TOOL_TIMEOUT':
        return `${err.message} The call was abandoned; the server may still be working.`;
      default:
        return err.message;
    }
  }
  return `Calling ${namespacedName} failed: ${(err as Error).message}`;
}

export const mcpAgentBridge = new McpAgentBridge();
