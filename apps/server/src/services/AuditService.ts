import { randomUUID } from 'crypto';
import { AuditLogEntry, AuditAction } from '@asterim/shared';
import { dbService } from './DatabaseService';

export class AuditService {
  /**
   * Record a security or execution audit log entry.
   */
  public logAction(
    workspaceId: string,
    userId: string,
    userEmail: string,
    action: AuditAction | string,
    targetResource: string,
    metadata: Record<string, any> = {}
  ): AuditLogEntry {
    const db = dbService.getDb();
    const logId = `aud_${randomUUID()}`;
    const now = Date.now();
    const metadataJson = JSON.stringify(metadata);

    db.prepare(`
      INSERT INTO audit_logs (id, workspace_id, user_id, user_email, action, target_resource, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(logId, workspaceId, userId, userEmail, action, targetResource, metadataJson, now);

    return {
      id: logId,
      workspaceId,
      userId,
      userEmail,
      action,
      targetResource,
      metadataJson,
      timestamp: new Date(now).toISOString(),
    };
  }

  /**
   * Get workspace audit log stream.
   */
  public getWorkspaceAuditLogs(
    workspaceId: string,
    limit: number = 50,
    offset: number = 0
  ): AuditLogEntry[] {
    const db = dbService.getDb();
    const rows = db.prepare(`
      SELECT id, workspace_id, user_id, user_email, action, target_resource, metadata_json, created_at
      FROM audit_logs
      WHERE workspace_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(workspaceId, limit, offset) as any[];

    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      userId: r.user_id,
      userEmail: r.user_email,
      action: r.action,
      targetResource: r.target_resource,
      metadataJson: r.metadata_json,
      timestamp: new Date(r.created_at).toISOString(),
    }));
  }
}

export const auditService = new AuditService();
