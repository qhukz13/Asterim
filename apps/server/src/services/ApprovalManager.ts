import { eventBus } from './EventBus';
import { AsterimEvent, ClientApprovalResponsePayload } from '@asterim/shared';
import crypto from 'crypto';
import { dbService } from './DatabaseService';

interface PendingApproval {
  resolve: (value: boolean) => void;
  reject: (reason: any) => void;
  timeoutId: NodeJS.Timeout;
}

export interface CommandSecurityAnalysis {
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  isPathTraversal: boolean;
  warnings: string[];
  requiresExplicitHumanApproval: boolean;
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

    return {
      riskLevel,
      isPathTraversal,
      warnings,
      requiresExplicitHumanApproval,
    };
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
    timeoutMs: number = 300000 // 5 minutes default timeout for MVP
  ): Promise<boolean> {
    const actionId = crypto.randomUUID();

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
      this.pendingApprovals.set(actionId, { resolve, reject, timeoutId });

      // 3. Publish the request to the EventBus
      const security = this.evaluateCommandSecurity(command);
      console.log(`[ApprovalManager] Requesting approval for action ${actionId} (${description}) - Risk Level: ${security.riskLevel}`);
      eventBus.publish({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: 'system:approval_manager',
        type: 'agent.approval_request',
        payload: {
          projectId,
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
