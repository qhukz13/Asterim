import { eventBus } from './EventBus';
import { AgentDeckEvent, ClientApprovalResponsePayload } from '@agentdeck/shared';
import crypto from 'crypto';

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
      const pending = this.pendingApprovals.get(actionId);

      if (pending) {
        clearTimeout(pending.timeoutId);
        pending.resolve(approved);
        this.pendingApprovals.delete(actionId);
        console.log(`[ApprovalManager] Action ${actionId} resolved as ${approved ? 'APPROVED' : 'DENIED'}`);
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

    return new Promise((resolve, reject) => {
      // 1. Setup the timeout fallback
      const timeoutId = setTimeout(() => {
        if (this.pendingApprovals.has(actionId)) {
          this.pendingApprovals.delete(actionId);
          console.log(`[ApprovalManager] Action ${actionId} timed out.`);
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
}

export const approvalManager = new ApprovalManager();
