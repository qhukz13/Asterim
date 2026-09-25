import React from 'react';
import type { ApprovalRequestPayload } from '@asterim/shared';
import { ApprovalCard } from '../components/approvals/ApprovalCard';

export interface ApprovalOverlayProps {
  approvalRequest: (ApprovalRequestPayload & { timestamp?: number }) | null;
  autoApproval: 'ask' | 'approve' | 'deny';
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  onSwitchToTerminal: (id: string) => void;
}

export function ApprovalOverlay({
  approvalRequest,
  autoApproval,
  onApprove,
  onDeny,
  onSwitchToTerminal
}: ApprovalOverlayProps) {
  if (!approvalRequest || autoApproval !== 'ask') {
    return null;
  }

  return (
    <ApprovalCard
      // A fresh subtree per request: two consecutive approvals must not
      // share DOM, so a click aimed at one can never land on the next.
      key={approvalRequest.actionId}
      request={approvalRequest}
      onApprove={onApprove}
      onDeny={onDeny}
      onSwitchToTerminal={onSwitchToTerminal}
    />
  );
}
