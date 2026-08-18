import { eventBus } from './EventBus';
import { AsterimEvent, ClientApprovalResponsePayload } from '@asterim/shared';
import crypto from 'crypto';
import { dbService } from './DatabaseService';
import { fleetPolicyService } from './enterprise/FleetPolicyService';

interface PendingApproval {
  resolve: (value: boolean) => void;
  reject: (reason: any) => void;
  timeoutId: NodeJS.Timeout;
  /** Thread the request belongs to, so it can be cancelled when that ends. */
  threadId?: string;
}

export interface CommandSecurityAnalysis {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  isPathTraversal: boolean;
  warnings: string[];
  requiresExplicitHumanApproval: boolean;
}

/** Extra context a caller can attach to one approval request. */
export interface ApprovalRequestOptions {
  /** Thread this request belongs to. Cancelled with the thread if it ends. */
  threadId?: string;
  /** An analysis the caller has already done, published instead of a re-run. */
  securityAnalysis?: CommandSecurityAnalysis;
  /** Called with the action id before the request goes out. */
  onActionId?: (actionId: string) => void;
}

/**
 * How much scrutiny MCP tool calls get.
 *
 * - `strict` — anything above a plainly read-only call needs a human.
 * - `standard` — high and critical calls need a human. The default.
 * - `permissive` — nothing is gated; the analysis is still published.
 *
 * Set with `ASTERIM_MCP_SECURITY_MODE`. The default is deliberately not
 * `permissive`: an agent that can reach a filesystem or shell MCP server can do
 * as much damage as one running commands directly.
 */
export type McpSecurityMode = 'strict' | 'standard' | 'permissive';

const RISK_ORDER: Record<CommandSecurityAnalysis['riskLevel'], number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3
};

/** Tool-name fragments and what calling such a tool means. */
const TOOL_NAME_POLICY: {
  patterns: RegExp;
  risk: CommandSecurityAnalysis['riskLevel'];
  warning: string;
}[] = [
  {
    patterns: /(^|_)(exec|execute|shell|bash|sh|run_command|command|spawn|terminal|process|eval)(_|$)/,
    risk: 'critical',
    warning: 'The tool runs commands on this machine.'
  },
  {
    patterns: /(^|_)(delete|remove|rm|destroy|drop|truncate|purge|wipe|kill|reset|revert|uninstall)(_|$)/,
    risk: 'high',
    warning: 'The tool destroys data that may not be recoverable.'
  },
  {
    patterns: /(^|_)(write|create|update|edit|patch|append|overwrite|move|rename|copy|upload|save|commit|push|deploy|publish|install)(_|$)/,
    risk: 'high',
    warning: 'The tool modifies state outside the conversation.'
  },
  {
    patterns: /(^|_)(fetch|download|post|put|send|email|mail|sms|notify|webhook|browse|navigate|request|http|https|curl)(_|$)/,
    risk: 'high',
    warning: 'The tool reaches an external network service.'
  },
  {
    patterns: /(^|_)(read|get|list|search|find|query|describe|show|status|stat|info|head|inspect|resolve|lookup|count)(_|$)/,
    risk: 'low',
    warning: ''
  }
];

/** Argument values that suggest a call is reaching outside the workspace. */
const SENSITIVE_VALUE_PATTERNS: { pattern: RegExp; warning: string }[] = [
  { pattern: /\.\.[\\/]/, warning: 'An argument walks up out of its directory.' },
  {
    pattern: /(^|["'\s=])(\/etc\/|\/var\/root|\/root\/|\/proc\/|\/sys\/|~\/\.ssh|\/\.ssh\/)/,
    warning: 'An argument names a protected system location.'
  },
  {
    pattern: /(secret|password|passwd|token|api[_-]?key|credential|private[_-]?key)/i,
    warning: 'An argument names credentials.'
  }
];

/** The configured mode, read per call so tests and settings can change it. */
export function currentMcpSecurityMode(): McpSecurityMode {
  const raw = (process.env.ASTERIM_MCP_SECURITY_MODE || '').toLowerCase();
  if (raw === 'strict' || raw === 'standard' || raw === 'permissive') return raw;
  return 'standard';
}

export class ApprovalManager {
  private pendingApprovals = new Map<string, PendingApproval>();

  constructor() {
    this.listenForResponses();
  }

  /**
   * Evaluates command syntax, destructive flags, and path traversal attempts.
   */
  public evaluateCommandSecurity(command: string, projectPath?: string): CommandSecurityAnalysis {
    const warnings: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';
    let isPathTraversal = false;
    let requiresExplicitHumanApproval = false;

    const cmdLower = command.toLowerCase().trim();

    // 1. Critical risk destructive commands
    const CRITICAL_PATTERNS = [
      /rm\s+-rf?\s+(\/|~|\*|\.\.)/,
      /mkfs/,
      /dd\s+if=/,
      /chmod\s+(-R\s+)?777\s+(\/|~)/,
      /:(){ :|:& };:/,
      /shutdown/,
      /reboot/,
      /(curl|wget)\s+.*\|\s*(bash|sh|zsh)/,
    ];

    for (const pattern of CRITICAL_PATTERNS) {
      if (pattern.test(cmdLower)) {
        riskLevel = 'critical';
        requiresExplicitHumanApproval = true;
        warnings.push(`Critical destructive system command detected matching pattern: ${pattern.source}`);
        break;
      }
    }

    // 2. High risk commands (force push, hard reset, broad deletion)
    if (riskLevel !== 'critical') {
      if (cmdLower.includes('git reset --hard') || cmdLower.includes('git push --force') || cmdLower.includes('git push -f')) {
        riskLevel = 'high';
        requiresExplicitHumanApproval = true;
        warnings.push('Potentially destructive Git operation (hard reset or force push).');
      } else if (cmdLower.includes('rm -rf') || cmdLower.includes('rm -r')) {
        riskLevel = 'high';
        warnings.push('Recursive file deletion requested.');
      } else if (cmdLower.includes('drop database') || cmdLower.includes('drop table')) {
        riskLevel = 'high';
        requiresExplicitHumanApproval = true;
        warnings.push('Database drop statement detected.');
      }
    }

    // 3. Path Traversal Guard
    if (cmdLower.includes('../..') || cmdLower.includes('/etc/') || cmdLower.includes('/var/root')) {
      isPathTraversal = true;
      warnings.push('Path traversal attempt detected outside active workspace bounds.');
      if (riskLevel !== 'critical') {
        riskLevel = 'high';
      }
      requiresExplicitHumanApproval = true;
    }

    if (projectPath && (cmdLower.includes('cd /') || cmdLower.includes('cd ~'))) {
      if (!cmdLower.includes(projectPath.toLowerCase())) {
        isPathTraversal = true;
        warnings.push('Navigation outside project root path detected.');
        if (riskLevel !== 'critical') riskLevel = 'high';
      }
    }

    // 4. Medium risk commands (installations/modifications)
    if (riskLevel === 'low') {
      if (cmdLower.includes('npm install') || cmdLower.includes('pnpm add') || cmdLower.includes('pip install') || cmdLower.includes('cargo add')) {
        riskLevel = 'medium';
      }
    }

    // 5. Fleet governance (P10-01).
    //
    // Two rules an organization may have stated override what the heuristics
    // above concluded, and both only ever tighten: a command the fleet policy
    // forbids is critical whatever it looked like, and a configured policy that
    // mandates approval at or below this risk level takes the decision away from
    // the heuristic. Neither can lower a risk level or clear a flag — a policy is
    // there to add scrutiny, and one that could remove it would be a way to
    // disable the security analysis by configuration.
    const policyVerdict = fleetPolicyService.validateCommand(command);
    if (!policyVerdict.allowed) {
      riskLevel = 'critical';
      requiresExplicitHumanApproval = true;
      warnings.push(
        policyVerdict.violationReason ?? 'The command is forbidden by the active fleet policy.'
      );
    } else if (fleetPolicyService.isManaged() && fleetPolicyService.requiresApproval(riskLevel)) {
      requiresExplicitHumanApproval = true;
    }

    return {
      riskLevel,
      isPathTraversal,
      warnings,
      requiresExplicitHumanApproval,
    };
  }

  /**
   * Decides what one MCP tool call is allowed to do without a human.
   *
   * Two things are looked at, because either alone misses cases: the tool's
   * name, which is the only description of intent MCP guarantees, and the
   * arguments, where a read-only-sounding tool can still be pointed at
   * `/etc/shadow` or an exec tool handed `rm -rf /`. The argument pass reuses
   * `evaluateCommandSecurity` so both paths agree about what "destructive"
   * means.
   *
   * Errs towards asking. A tool whose name says nothing recognisable is treated
   * as `medium`, not `low`: an unknown verb from a third-party server is not
   * evidence of safety.
   */
  public evaluateToolSecurity(
    toolName: string,
    args: Record<string, unknown> = {},
    options: { projectPath?: string; mode?: McpSecurityMode } = {}
  ): CommandSecurityAnalysis {
    const mode = options.mode ?? currentMcpSecurityMode();
    const warnings: string[] = [];
    let riskLevel: CommandSecurityAnalysis['riskLevel'] = 'medium';
    let matchedName = false;

    // The bare tool name, without the `mcp__<server>__` namespace.
    const bare = toolName.replace(/^mcp__/, '').split('__').slice(1).join('__') || toolName;
    const normalised = bare.toLowerCase().replace(/[-\s]+/g, '_');

    for (const policy of TOOL_NAME_POLICY) {
      if (!policy.patterns.test(normalised)) continue;
      matchedName = true;
      if (RISK_ORDER[policy.risk] > RISK_ORDER[riskLevel] || riskLevel === 'medium') {
        riskLevel = policy.risk;
      }
      if (policy.warning) warnings.push(policy.warning);
      if (policy.risk === 'critical') break;
    }

    if (!matchedName) {
      warnings.push(`'${bare}' does not describe what it does; treating it as unproven.`);
    }

    // The arguments, as one string, judged by the same rules as a command line.
    let serialisedArgs: string;
    try {
      serialisedArgs = JSON.stringify(args ?? {});
    } catch {
      serialisedArgs = '';
      warnings.push('The arguments could not be inspected.');
      riskLevel = RISK_ORDER[riskLevel] > RISK_ORDER.high ? riskLevel : 'high';
    }

    const commandAnalysis = this.evaluateCommandSecurity(
      `${bare} ${serialisedArgs}`,
      options.projectPath
    );
    if (RISK_ORDER[commandAnalysis.riskLevel] > RISK_ORDER[riskLevel]) {
      riskLevel = commandAnalysis.riskLevel;
    }
    warnings.push(...commandAnalysis.warnings);

    let isPathTraversal = commandAnalysis.isPathTraversal;
    for (const { pattern, warning } of SENSITIVE_VALUE_PATTERNS) {
      if (!pattern.test(serialisedArgs)) continue;
      warnings.push(warning);
      isPathTraversal = true;
      if (RISK_ORDER[riskLevel] < RISK_ORDER.high) riskLevel = 'high';
    }

    const requiresExplicitHumanApproval =
      mode === 'permissive'
        ? false
        : commandAnalysis.requiresExplicitHumanApproval ||
          isPathTraversal ||
          (mode === 'strict'
            ? RISK_ORDER[riskLevel] > RISK_ORDER.low
            : RISK_ORDER[riskLevel] >= RISK_ORDER.high);

    return {
      riskLevel,
      isPathTraversal,
      warnings: [...new Set(warnings)],
      requiresExplicitHumanApproval
    };
  }

  /**
   * Resolves one waiting request as denied.
   *
   * Used when the thing that asked has gone: a thread the user stopped, a
   * session that crashed. Denial rather than silence, so the caller's promise
   * settles and nothing is left holding a turn open (P6-05 §10).
   */
  public cancelApproval(actionId: string, reason = 'The request was cancelled.'): boolean {
    const pending = this.pendingApprovals.get(actionId);
    if (!pending) return false;

    clearTimeout(pending.timeoutId);
    this.pendingApprovals.delete(actionId);

    try {
      const db = dbService.getDb();
      db.prepare(
        "UPDATE approvals SET status = 'cancelled' WHERE action_id = ? AND status = 'pending'"
      ).run(actionId);
    } catch (dbErr) {
      console.error('[ApprovalManager] Failed to mark approval cancelled:', dbErr);
    }

    console.log(`[ApprovalManager] Action ${actionId} cancelled: ${reason}`);
    eventBus.publish({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      source: 'system:approval_manager',
      type: 'agent.approval_cancelled',
      payload: { actionId, threadId: pending.threadId, reason }
    });

    pending.resolve(false);
    return true;
  }

  /** Cancels every request raised for one thread. Returns how many there were. */
  public cancelApprovalsForThread(threadId: string, reason?: string): number {
    const actionIds = [...this.pendingApprovals.entries()]
      .filter(([, pending]) => pending.threadId === threadId)
      .map(([actionId]) => actionId);

    for (const actionId of actionIds) {
      this.cancelApproval(actionId, reason ?? `Thread ${threadId} ended.`);
    }
    return actionIds.length;
  }

  /** Action ids still waiting on a human. Exposed for diagnostics and tests. */
  public getPendingActionIds(threadId?: string): string[] {
    return [...this.pendingApprovals.entries()]
      .filter(([, pending]) => !threadId || pending.threadId === threadId)
      .map(([actionId]) => actionId);
  }

  private listenForResponses() {
    eventBus.subscribe<ClientApprovalResponsePayload>('client.approval_response', event => {
      const { actionId, approved } = event.payload;

      try {
        const db = dbService.getDb();
        const update = db.prepare(
          'UPDATE approvals SET status = ? WHERE action_id = ? AND status = ?'
        );
        update.run(approved ? 'approved' : 'denied', actionId, 'pending');
      } catch (dbErr) {
        console.error('[ApprovalManager] Failed to update approval response in database:', dbErr);
      }

      const pending = this.pendingApprovals.get(actionId);

      if (pending) {
        clearTimeout(pending.timeoutId);
        pending.resolve(approved);
        this.pendingApprovals.delete(actionId);
        console.log(
          `[ApprovalManager] Action ${actionId} resolved as ${approved ? 'APPROVED' : 'DENIED'}`
        );
      } else {
        console.log(
          `[ApprovalManager] Action ${actionId} resolved via EventBus as ${approved ? 'APPROVED' : 'DENIED'} (no active process resolver)`
        );
      }
    });
  }

  /**
   * Suspends execution and requests user approval via the EventBus.
   * @returns A promise that resolves to true if approved, false if denied or timed out.
   */
  public requestApproval(
    projectId: string,
    description: string,
    command: string,
    timeoutMs: number = 300000, // 5 minutes default timeout for MVP
    options: ApprovalRequestOptions = {}
  ): Promise<boolean> {
    const actionId = crypto.randomUUID();
    options.onActionId?.(actionId);

    try {
      const db = dbService.getDb();
      const insert = db.prepare(
        'INSERT INTO approvals (id, project_id, action_id, description, command, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      insert.run(
        crypto.randomUUID(),
        projectId,
        actionId,
        description,
        command,
        'pending',
        Date.now()
      );
    } catch (dbErr) {
      console.error('[ApprovalManager] Failed to write pending approval to database:', dbErr);
    }

    return new Promise((resolve, reject) => {
      // 1. Setup the timeout fallback
      const timeoutId = setTimeout(() => {
        if (this.pendingApprovals.has(actionId)) {
          this.pendingApprovals.delete(actionId);
          console.log(`[ApprovalManager] Action ${actionId} timed out.`);

          try {
            const db = dbService.getDb();
            const update = db.prepare(
              "UPDATE approvals SET status = 'expired' WHERE action_id = ? AND status = 'pending'"
            );
            update.run(actionId);
          } catch (dbErr) {
            console.error(
              '[ApprovalManager] Failed to update approval timeout in database:',
              dbErr
            );
          }

          resolve(false); // Default to deny on timeout for safety
        }
      }, timeoutMs);

      // 2. Store the resolvers
      this.pendingApprovals.set(actionId, {
        resolve,
        reject,
        timeoutId,
        threadId: options.threadId
      });

      // 3. Publish the request to the EventBus
      const security = options.securityAnalysis ?? this.evaluateCommandSecurity(command);
      console.log(`[ApprovalManager] Requesting approval for action ${actionId} (${description}) - Risk Level: ${security.riskLevel}`);
      eventBus.publish({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: 'system:approval_manager',
        type: 'agent.approval_request',
        payload: {
          projectId,
          threadId: options.threadId,
          actionId,
          description,
          command,
          securityAnalysis: security
        }
      });
    });
  }

  public recoverPendingApprovals() {
    try {
      const db = dbService.getDb();
      const query = db.prepare("SELECT * FROM approvals WHERE status = 'pending'");
      const rows = query.all() as {
        project_id: string;
        action_id: string;
        description: string;
        command: string;
      }[];

      if (rows.length === 0) return;

      for (const row of rows) {
        console.log(
          `[ApprovalManager] Recovering pending approval ${row.action_id} for project ${row.project_id}`
        );
        eventBus.publish({
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          source: 'system:approval_manager',
          type: 'agent.approval_request',
          payload: {
            projectId: row.project_id,
            actionId: row.action_id,
            description: row.description,
            command: row.command
          }
        });
      }
    } catch (err) {
      console.error('[ApprovalManager] Failed to recover pending approvals:', err);
    }
  }
}

export const approvalManager = new ApprovalManager();
