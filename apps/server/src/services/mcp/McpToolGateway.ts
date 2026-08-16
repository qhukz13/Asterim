/**
 * The one path an agent's tool call takes through the Core.
 *
 * `McpAgentBridge` knows how to run a tool; it does not know, and should not,
 * whether a human has agreed to it. The bridge is also what the dashboard calls
 * when a user clicks "run" in the MCP panel — there the human is already
 * present, and asking again would be theatre. So the gate lives here, on the
 * agent path only:
 *
 *     agent output → adapter → gateway → [security policy] → [approval] → bridge
 *
 * Nothing on this path throws. A refusal, a timeout and a crashed server all
 * come back as a result the agent can read, because the agent is mid-turn
 * waiting on a line and an exception would strand the session (P6-05 §6).
 */

import { AgentToolExecutor } from '@asterim/adapters';
import { isSkillToolName } from '@asterim/shared';
import { approvalManager, ApprovalManager, CommandSecurityAnalysis } from '../ApprovalManager';
import { AgentToolResult, McpAgentBridge, mcpAgentBridge } from './McpAgentBridge';

/** Which session a call belongs to. */
export interface AgentToolContext {
  projectId: string;
  threadId: string;
  /** Scopes the tool catalogue, as `McpAgentBridge.getAvailableTools` does. */
  workspaceId?: string;
  /** The project's directory on disk, used to judge path arguments. */
  workspacePath?: string;
}

/** How long a tool call may wait on a human before it is refused. */
function approvalTimeoutMs(): number {
  const raw = Number(process.env.ASTERIM_MCP_APPROVAL_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 300000;
}

/** A short, readable rendering of a call, for the approval card. */
export function describeCall(toolName: string, args: Record<string, unknown>): string {
  let serialised: string;
  try {
    serialised = JSON.stringify(args ?? {});
  } catch {
    serialised = '{…}';
  }
  if (serialised.length > 300) serialised = `${serialised.slice(0, 300)}…`;
  return `${toolName} ${serialised}`;
}

export class McpToolGateway {
  constructor(
    private readonly bridge: McpAgentBridge = mcpAgentBridge,
    private readonly approvals: ApprovalManager = approvalManager
  ) {}

  /**
   * An executor bound to one session, ready to hand to an adapter.
   *
   * Bound rather than passed per call because the adapter sees only a tool name
   * and arguments — which project and thread it belongs to is the Core's
   * knowledge, and letting the agent supply it would let the agent choose whose
   * approval policy it runs under.
   */
  public createExecutor(context: AgentToolContext): AgentToolExecutor {
    return (toolName: string, args: Record<string, unknown>) =>
      this.executeForAgent(context, toolName, args);
  }

  /**
   * Runs one call: judge it, ask if it needs asking, then execute.
   */
  public async executeForAgent(
    context: AgentToolContext,
    toolName: string,
    args: Record<string, unknown> = {}
  ): Promise<AgentToolResult> {
    let analysis: CommandSecurityAnalysis;
    try {
      analysis = this.approvals.evaluateToolSecurity(toolName, args, {
        projectPath: context.workspacePath
      });
    } catch (err) {
      // A policy that cannot make up its mind must not become a way through it.
      console.error(`[MCP] Could not evaluate '${toolName}':`, err);
      analysis = {
        riskLevel: 'high',
        isPathTraversal: false,
        warnings: ['The call could not be assessed.'],
        requiresExplicitHumanApproval: true
      };
    }

    if (analysis.requiresExplicitHumanApproval) {
      const permitted = await this.askHuman(context, toolName, args, analysis);
      if (!permitted) {
        return {
          name: toolName,
          isError: true,
          text:
            `The user did not approve calling ${toolName}. ` +
            `Do not retry it; continue without that tool, or explain what you need and why.`
        };
      }
    }

    try {
      return await this.bridge.executeTool(
        toolName,
        args,
        context.workspaceId,
        context.workspacePath
      );
    } catch (err) {
      // `executeTool` is documented not to throw. If that ever stops being
      // true, the agent still gets an answer rather than silence.
      return {
        name: toolName,
        isError: true,
        text: `Calling ${toolName} failed: ${(err as Error)?.message || String(err)}`
      };
    }
  }

  /**
   * Puts one call in front of the user and waits.
   *
   * Denial is the answer to everything that is not an explicit yes: a refusal,
   * a timeout, a thread the user stopped while the card was still on screen.
   */
  private async askHuman(
    context: AgentToolContext,
    toolName: string,
    args: Record<string, unknown>,
    analysis: CommandSecurityAnalysis
  ): Promise<boolean> {
    // A skill is not an MCP tool and calling it spawns nothing, so the card
    // must not describe it as one — a person deciding whether to allow this is
    // owed an accurate account of what they are allowing.
    const kind = isSkillToolName(toolName) ? 'skill' : 'MCP tool';
    const description =
      analysis.warnings.length > 0
        ? `The agent wants to call the ${kind} '${toolName}'. ${analysis.warnings.join(' ')}`
        : `The agent wants to call the ${kind} '${toolName}'.`;

    try {
      return await this.approvals.requestApproval(
        context.projectId,
        description,
        describeCall(toolName, args),
        approvalTimeoutMs(),
        { threadId: context.threadId, securityAnalysis: analysis }
      );
    } catch (err) {
      console.error(`[MCP] Approval for '${toolName}' failed:`, err);
      return false;
    }
  }

  /**
   * Refuses everything this thread is still waiting on.
   *
   * Called when a thread stops. Without it a stopped session leaves an approval
   * card on screen for a call no one is waiting for any more (P6-05 §10).
   */
  public cancelPendingForThread(threadId: string, reason?: string): number {
    return this.approvals.cancelApprovalsForThread(
      threadId,
      reason ?? `Thread ${threadId} was stopped.`
    );
  }
}

export const mcpToolGateway = new McpToolGateway();
