export type AuditAction =
  | 'workspace.created'
  | 'workspace.updated'
  | 'workspace.deleted'
  | 'member.invited'
  | 'member.joined'
  | 'member.removed'
  | 'member.role_changed'
  | 'agent.dispatched'
  | 'agent.completed'
  | 'agent.failed'
  | 'approval.requested'
  | 'approval.granted'
  | 'approval.denied'
  | 'apikey.created'
  | 'apikey.revoked'
  | 'project.shared'
  | 'project.unshared';

export interface AuditLogEntry {
  id: string;
  workspaceId: string;
  userId: string;
  userEmail: string;
  action: AuditAction | string;
  targetResource: string;
  metadataJson: string;
  timestamp: string;
}

export interface AuditLogQuery {
  workspaceId: string;
  limit?: number;
  offset?: number;
  actionFilter?: string;
}
