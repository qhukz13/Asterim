import {
  AgentProfile,
  DELEGATION_TOOL_DEFINITIONS,
  McpToolCallResult,
  McpToolDefinition,
  SkillDefinition,
  SKILL_TOOL_PREFIX,
  canProfileDelegate,
  isDelegationToolName,
  isSkillToolName,
  skillToolName
} from '@asterim/shared';
import { McpError, mcpProcessSupervisor, McpProcessSupervisor } from './McpProcessSupervisor';
import { SkillService, skillService } from '../skills/SkillService';

/**
 * What an agent sees of the MCP subsystem and of the skills library.
 *
 * An agent does not know about servers, sessions or pipes. It knows a flat list
 * of tools with names it can call, so this flattens every running server's
 * catalogue into one namespace and routes calls back to the right session.
 *
 * The namespace is `mcp__<server>__<tool>`, the convention the agent CLIs
 * already use for MCP tools. Two servers may both publish `read_file`; the
 * server name is what keeps them apart.
 *
 * Reusable skills join the same list under `skill__<name>` (P6-06). They are
 * not MCP and have no process behind them — calling one returns the skill's own
 * instructions — but an agent choosing what to do next should see one list of
 * everything it can invoke, not two catalogues it has to reconcile.
 */

/** Separator between the prefix, the server name and the tool name. */
const SEPARATOR = '__';
const PREFIX = `mcp${SEPARATOR}`;

/** Where an offered tool comes from. Absent means MCP, which came first. */
export type AgentToolKind = 'mcp' | 'skill' | 'delegation';

/** A tool as an agent sees it: one flat name, one description, one schema. */
export interface AgentTool {
  /** `mcp__<server>__<tool>`, or `skill__<name>` for a skill. */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
  serverName: string;
  toolName: string;
  /** `'skill'` for a skill; omitted or `'mcp'` for an MCP tool. */
  kind?: AgentToolKind;
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
  constructor(
    private readonly supervisor: McpProcessSupervisor = mcpProcessSupervisor,
    private readonly skills: SkillService = skillService
  ) {}

  /**
   * Every tool an agent may call right now.
   *
   * Only `RUNNING` servers contribute: a tool on a stopped server is not a tool
   * an agent can use, and offering it would produce a failure the agent cannot
   * do anything about. Scoping by workspace follows the supervisor's own rule —
   * that workspace's servers plus the workstation-wide ones.
   *
   * `workspacePath` is what scopes skills, and it is a different key from
   * `workspaceId` on purpose: an MCP server is a database row, a skill is a
   * directory on disk. Omitting the path yields the global skills alone.
   */
  public getAvailableTools(workspaceId?: string, workspacePath?: string): AgentTool[] {
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
          toolName: tool.name,
          kind: 'mcp'
        });
      }
    }

    for (const skill of this.discoverSkills(workspacePath)) {
      tools.push(toSkillTool(skill));
    }

    return tools;
  }

  /**
   * The delegation meta-tools, when the session's persona is one that delegates
   * (P7-01).
   *
   * Kept out of `getAvailableTools` deliberately. Everything in that list is
   * something a workstation is running or a user has written, and both are
   * filtered by the profile's capability lists; these two are neither. They are
   * part of Asterim itself, and whether a session gets them is decided by what
   * the persona is for — `canProfileDelegate` — not by whether a server name
   * appears in a list. A session with no persona gets neither of them, so a
   * catalogue that was correct before P7-01 is unchanged by it.
   */
  public getDelegationTools(
    profile: Pick<AgentProfile, 'role' | 'name'> | null | undefined
  ): AgentTool[] {
    if (!canProfileDelegate(profile)) return [];
    return DELEGATION_TOOL_DEFINITIONS.map(definition => ({
      name: definition.name,
      description: definition.description,
      inputSchema: definition.inputSchema,
      // No process and no server behind it: this is the Core answering itself.
      serverId: 'asterim',
      serverName: 'asterim',
      toolName: definition.name,
      kind: 'delegation' as const
    }));
  }

  /** The skills offered to a session. Never fatal: no skills is a session. */
  public discoverSkills(workspacePath?: string): SkillDefinition[] {
    try {
      return this.skills.discoverSkills(workspacePath);
    } catch (err) {
      console.error('[Skills] Discovery failed:', err);
      return [];
    }
  }

  /**
   * Resolves a namespaced name back to the tool it refers to.
   *
   * Matched against the live catalogue rather than by splitting on `__`,
   * because a server or tool name may itself contain the separator and there is
   * no way to split that unambiguously. Exposed for the error paths and tests.
   */
  public resolveTool(
    namespacedName: string,
    workspaceId?: string,
    workspacePath?: string
  ): AgentTool | null {
    return (
      this.getAvailableTools(workspaceId, workspacePath).find(
        tool => tool.name === namespacedName
      ) ?? null
    );
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
    workspaceId?: string,
    workspacePath?: string,
    context?: { projectId?: string; threadId?: string }
  ): Promise<AgentToolResult> {
    // A delegation is not a tool on a server either, and it is the one call
    // whose answer depends on *which* session made it — a thread can only
    // delegate from itself. The context comes from the gateway, never from the
    // agent's own arguments.
    if (isDelegationToolName(namespacedName)) {
      return this.executeDelegation(namespacedName, args, context);
    }

    // A skill never reaches a server, so it is answered before the catalogue is
    // consulted for one: the payload is the skill's own instructions.
    if (isSkillToolName(namespacedName)) {
      return this.executeSkill(namespacedName, args, workspacePath);
    }

    const tool = this.resolveTool(namespacedName, workspaceId, workspacePath);

    if (!tool) {
      return {
        name: namespacedName,
        isError: true,
        text: this.explainUnknownTool(namespacedName, workspaceId, workspacePath)
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
   * Hands one delegation to the service that owns it.
   *
   * Imported on the call rather than at the top of the file: the delegation
   * service reaches back into sessions and profiles, and a session that never
   * delegates has no reason to load any of it. Never throws, like every other
   * branch here.
   */
  private async executeDelegation(
    toolName: string,
    args: Record<string, unknown>,
    context?: { projectId?: string; threadId?: string }
  ): Promise<AgentToolResult> {
    if (!context?.threadId) {
      return {
        name: toolName,
        isError: true,
        text: `'${toolName}' can only be called from inside a thread.`
      };
    }

    try {
      const { agentDelegationService } = await import('../ai/AgentDelegationService');
      const result = await agentDelegationService.executeDelegationTool(toolName, args, {
        threadId: context.threadId
      });
      return { name: result.name, isError: result.isError, text: result.text };
    } catch (err) {
      return {
        name: toolName,
        isError: true,
        text: `Delegating through '${toolName}' failed: ${(err as Error).message}`
      };
    }
  }

  /**
   * Reads one skill and hands back its instructions.
   *
   * Never throws, for the same reason `executeTool` does not: the agent is
   * mid-turn waiting on a line, and an exception here would look to it like a
   * dead session rather than an answer it can correct.
   */
  private executeSkill(
    namespacedName: string,
    args: Record<string, unknown>,
    workspacePath?: string
  ): AgentToolResult {
    try {
      const result = this.skills.executeSkill(
        namespacedName.slice(SKILL_TOOL_PREFIX.length),
        args,
        workspacePath
      );
      return { name: namespacedName, isError: result.isError, text: result.text };
    } catch (err) {
      return {
        name: namespacedName,
        isError: true,
        text: `Reading the skill '${namespacedName}' failed: ${(err as Error).message}`
      };
    }
  }

  /**
   * Says why a name did not resolve, in the most useful way available: whether
   * the server exists but is not running, whether the tool is unknown to a
   * server that is, or whether the name was never MCP's to begin with.
   */
  private explainUnknownTool(
    namespacedName: string,
    workspaceId?: string,
    workspacePath?: string
  ): string {
    if (!namespacedName.startsWith(PREFIX)) {
      return `'${namespacedName}' is not an MCP tool name; MCP tools are called as ${PREFIX}<server>${SEPARATOR}<tool>, and skills as ${SKILL_TOOL_PREFIX}<name>.`;
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

    const available = this.getAvailableTools(workspaceId, workspacePath).map(tool => tool.name);
    return available.length === 0
      ? `No MCP tools are available: no MCP server is running.`
      : `'${namespacedName}' is not an available MCP tool. Available: ${available.join(', ')}.`;
  }
}

/**
 * One skill, in the shape the rest of the tool path already understands.
 *
 * `serverName` is the literal `skills` rather than a process, so a reader of an
 * approval card or a log line can tell at a glance that nothing was spawned.
 */
export function toSkillTool(skill: SkillDefinition): AgentTool {
  return {
    name: skillToolName(skill.name),
    description: describeSkill(skill),
    inputSchema: skill.parametersSchema ?? { type: 'object', properties: {} },
    serverId: skill.id,
    serverName: 'skills',
    toolName: skill.name,
    kind: 'skill'
  };
}

/** A description that says what the skill does and where it came from. */
function describeSkill(skill: SkillDefinition): string {
  const origin = skill.scope === 'workspace' ? 'this workspace' : 'this workstation';
  return `${skill.description} (a reusable skill from ${origin}; calling it returns its instructions to follow)`;
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
