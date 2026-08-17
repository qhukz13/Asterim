import { WorkspaceRole, WorkspacePermission } from '@asterim/shared';
import { dbService } from './DatabaseService';

export class RbacService {
  private rolePermissions: Record<WorkspaceRole, Set<WorkspacePermission>> = {
    owner: new Set<WorkspacePermission>([
      'workspace:read',
      'workspace:write',
      'workspace:admin',
      'member:invite',
      'member:remove',
      'member:role',
      'agent:spawn',
      'agent:approve',
      'project:share',
    ]),
    admin: new Set<WorkspacePermission>([
      'workspace:read',
      'workspace:write',
      'member:invite',
      'member:remove',
      'member:role',
      'agent:spawn',
      'agent:approve',
      'project:share',
    ]),
    member: new Set<WorkspacePermission>([
      'workspace:read',
      'workspace:write',
      'member:invite',
      'agent:spawn',
      'agent:approve',
      'project:share',
    ]),
    viewer: new Set<WorkspacePermission>([
      'workspace:read',
    ]),
  };

  /**
   * Check if a given role possesses a specific permission.
   */
  public hasPermission(role: WorkspaceRole, permission: WorkspacePermission): boolean {
    const permissions = this.rolePermissions[role];
    return permissions ? permissions.has(permission) : false;
  }

  /**
   * Get user role within a specific workspace.
   */
  public getUserRole(workspaceId: string, userId: string): WorkspaceRole | null {
    const db = dbService.getDb();
    const row = db
      .prepare(`SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?`)
      .get(workspaceId, userId) as { role: string } | undefined;

    return row ? (row.role as WorkspaceRole) : null;
  }

  /**
   * How many members a workspace has.
   *
   * Distinguishes "this user is not a member" from "this workspace has no
   * members at all" — the second is what a workspace written before
   * `workspace_memberships` existed looks like, and a caller enforcing
   * membership needs to be able to tell the two apart rather than locking the
   * local user out of their own environment (P9-02).
   */
  public getWorkspaceMemberCount(workspaceId: string): number {
    try {
      const row = dbService
        .getDb()
        .prepare(`SELECT COUNT(*) AS count FROM workspace_memberships WHERE workspace_id = ?`)
        .get(workspaceId) as { count: number } | undefined;
      return row?.count ?? 0;
    } catch {
      // No memberships table: every workspace in this database is unmanaged.
      return 0;
    }
  }

  /**
   * Check if a user has a permission in a specific workspace.
   */
  public userHasPermission(
    workspaceId: string,
    userId: string,
    permission: WorkspacePermission
  ): boolean {
    const role = this.getUserRole(workspaceId, userId);
    if (!role) return false;
    return this.hasPermission(role, permission);
  }
}

export const rbacService = new RbacService();
