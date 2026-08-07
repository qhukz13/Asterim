import { randomUUID, randomBytes } from 'crypto';
import {
  Workspace,
  WorkspaceMember,
  WorkspaceInvitation,
  WorkspaceRole,
} from '@asterim/shared';
import { dbService } from './DatabaseService';

export class WorkspaceService {
  /**
   * Create a new workspace and assign the creator as owner.
   */
  public createWorkspace(
    accountId: string,
    userId: string,
    name: string,
    slug?: string,
    isPersonal: boolean = false
  ): Workspace {
    const db = dbService.getDb();
    const workspaceId = `ws_${randomUUID()}`;
    const generatedSlug = (slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).replace(/^-|-$/g, '') || 'workspace';
    const now = Date.now();

    db.prepare(`
      INSERT INTO workspaces (id, account_id, name, slug, is_personal, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(workspaceId, accountId, name, generatedSlug, isPersonal ? 1 : 0, now, now);

    // Assign creator as owner
    const memberId = `wsm_${randomUUID()}`;
    db.prepare(`
      INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at)
      VALUES (?, ?, ?, 'owner', ?)
    `).run(memberId, workspaceId, userId, now);

    return {
      id: workspaceId,
      accountId,
      name,
      slug: generatedSlug,
      isPersonal,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };
  }

  /**
   * Ensure user has at least a personal workspace created.
   */
  public ensurePersonalWorkspace(accountId: string, userId: string, fullName?: string): Workspace {
    const db = dbService.getDb();
    const existing = db.prepare(`
      SELECT w.* FROM workspaces w
      JOIN workspace_memberships wm ON w.id = wm.workspace_id
      WHERE wm.user_id = ? AND w.is_personal = 1
      LIMIT 1
    `).get(userId) as any;

    if (existing) {
      return {
        id: existing.id,
        accountId: existing.account_id,
        name: existing.name,
        slug: existing.slug,
        avatarUrl: existing.avatar_url,
        isPersonal: Boolean(existing.is_personal),
        createdAt: new Date(existing.created_at).toISOString(),
        updatedAt: new Date(existing.updated_at).toISOString(),
      };
    }

    const wsName = fullName ? `${fullName}'s Workspace` : 'Personal Workspace';
    return this.createWorkspace(accountId, userId, wsName, 'personal', true);
  }

  /**
   * Get all workspaces the user is a member of.
   */
  public getUserWorkspaces(userId: string): Workspace[] {
    const db = dbService.getDb();
    const rows = db.prepare(`
      SELECT w.* FROM workspaces w
      JOIN workspace_memberships wm ON w.id = wm.workspace_id
      WHERE wm.user_id = ?
      ORDER BY w.is_personal DESC, w.name ASC
    `).all(userId) as any[];

    return rows.map((r) => ({
      id: r.id,
      accountId: r.account_id,
      name: r.name,
      slug: r.slug,
      avatarUrl: r.avatar_url,
      isPersonal: Boolean(r.is_personal),
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }

  /**
   * Get workspace members.
   */
  public getWorkspaceMembers(workspaceId: string): WorkspaceMember[] {
    const db = dbService.getDb();
    const rows = db.prepare(`
      SELECT wm.id, wm.workspace_id, wm.user_id, wm.role, wm.created_at,
             u.email, u.full_name, u.avatar_url
      FROM workspace_memberships wm
      JOIN users u ON wm.user_id = u.id
      WHERE wm.workspace_id = ?
      ORDER BY wm.created_at ASC
    `).all(workspaceId) as any[];

    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspace_id,
      userId: r.user_id,
      role: r.role as WorkspaceRole,
      email: r.email,
      fullName: r.full_name || r.email,
      avatarUrl: r.avatar_url,
      joinedAt: new Date(r.created_at).toISOString(),
    }));
  }

  /**
   * Invite a new member by email.
   */
  public inviteMember(workspaceId: string, email: string, role: WorkspaceRole): WorkspaceInvitation {
    const db = dbService.getDb();
    const invitationId = `wsi_${randomUUID()}`;
    const token = `ast_inv_${randomBytes(24).toString('hex')}`;
    const now = Date.now();
    const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 days

    db.prepare(`
      INSERT INTO workspace_invitations (id, workspace_id, email, role, token, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(invitationId, workspaceId, email, role, token, expiresAt, now);

    return {
      id: invitationId,
      workspaceId,
      email,
      role,
      token,
      expiresAt: new Date(expiresAt).toISOString(),
      createdAt: new Date(now).toISOString(),
    };
  }

  /**
   * Join workspace using an invitation token.
   */
  public joinWorkspace(token: string, userId: string): WorkspaceMember {
    const db = dbService.getDb();
    const invitation = db.prepare(`
      SELECT * FROM workspace_invitations WHERE token = ? AND expires_at > ?
    `).get(token, Date.now()) as any;

    if (!invitation) {
      throw new Error('Invalid or expired invitation token');
    }

    const memberId = `wsm_${randomUUID()}`;
    const now = Date.now();

    db.prepare(`
      INSERT OR REPLACE INTO workspace_memberships (id, workspace_id, user_id, role, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(memberId, invitation.workspace_id, userId, invitation.role, now);

    // Delete token once redeemed
    db.prepare(`DELETE FROM workspace_invitations WHERE id = ?`).run(invitation.id);

    const user = db.prepare(`SELECT email, full_name, avatar_url FROM users WHERE id = ?`).get(userId) as any;

    return {
      id: memberId,
      workspaceId: invitation.workspace_id,
      userId,
      role: invitation.role as WorkspaceRole,
      email: user.email,
      fullName: user.full_name || user.email,
      avatarUrl: user.avatar_url,
      joinedAt: new Date(now).toISOString(),
    };
  }

  /**
   * Update member role.
   */
  public updateMemberRole(workspaceId: string, targetUserId: string, newRole: WorkspaceRole): void {
    const db = dbService.getDb();
    db.prepare(`
      UPDATE workspace_memberships SET role = ? WHERE workspace_id = ? AND user_id = ?
    `).run(newRole, workspaceId, targetUserId);
  }

  /**
   * Remove member from workspace.
   */
  public removeMember(workspaceId: string, targetUserId: string): void {
    const db = dbService.getDb();
    db.prepare(`
      DELETE FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?
    `).run(workspaceId, targetUserId);
  }
}

export const workspaceService = new WorkspaceService();
