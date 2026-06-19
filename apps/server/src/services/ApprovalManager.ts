import { eventBus } from './EventBus';
import { AgentDeckEvent, ClientApprovalResponsePayload } from '@agentdeck/shared';
import crypto from 'crypto';
import { dbService } from './DatabaseService';

interface PendingApproval {
  resolve: (value: boolean) => void;
  reject: (reason: any) => void;
  timeoutId: NodeJS.Timeout;
}

export class ApprovalManager {
  private pendingApprovals = new Map<string, PendingApproval>();

  constructor() {
    this.listenForResponses();
  }

  private listenForResponses() {
    eventBus.subscribe<ClientApprovalResponsePayload>('client.approval_response', (event) => {
      const { actionId, approved } = event.payload;

      try {
        const db = dbService.getDb();
        const update = db.prepare('UPDATE approvals SET status = ? WHERE action_id = ? AND status = ?');
        update.run(approved ? 'approved' : 'denied', actionId, 'pending');
      } catch (dbErr) {
        console.error('[ApprovalManager] Failed to update approval response in database:', dbErr);
      }

      const pending = this.pendingApprovals.get(actionId);

      if (pending) {
        clearTimeout(pending.timeoutId);
        pending.resolve(approved);
        this.pendingApprovals.delete(actionId);
        console.log(`[ApprovalManager] Action ${actionId} resolved as ${approved ? 'APPROVED' : 'DENIED'}`);
      } else {
        console.log(`[ApprovalManager] Action ${actionId} resolved via EventBus as ${approved ? 'APPROVED' : 'DENIED'} (no active process resolver)`);
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
      const insert = db.prepare('INSERT INTO approvals (id, project_id, action_id, description, command, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      insert.run(crypto.randomUUID(), projectId, actionId, description, command, 'pending', Date.now());
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
            const update = db.prepare("UPDATE approvals SET status = 'expired' WHERE action_id = ? AND status = 'pending'");
            update.run(actionId);
          } catch (dbErr) {
            console.error('[ApprovalManager] Failed to update approval timeout in database:', dbErr);
          }
          
          resolve(false); // Default to deny on timeout for safety
        }
      }, timeoutMs);

      // 2. Store the resolvers
      this.pendingApprovals.set(actionId, { resolve, reject, timeoutId });

      // 3. Publish the request to the EventBus
      console.log(`[ApprovalManager] Requesting approval for action ${actionId} (${description})`);
      eventBus.publish({
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        source: 'system:approval_manager',
        type: 'agent.approval_request',
        payload: {
          projectId,
          actionId,
          description,
          command
        }
      });
    });
  }

  public recoverPendingApprovals() {
    try {
      const db = dbService.getDb();
      const query = db.prepare("SELECT * FROM approvals WHERE status = 'pending'");
      const rows = query.all() as { project_id: string, action_id: string, description: string, command: string }[];
      
      if (rows.length === 0) return;

      for (const row of rows) {
        console.log(`[ApprovalManager] Recovering pending approval ${row.action_id} for project ${row.project_id}`);
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
