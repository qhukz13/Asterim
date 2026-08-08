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
    isPersonal: boolean = false,
    preset: string = 'personal'
  ): Workspace {
    const db = dbService.getDb();
    const workspaceId = `ws_${randomUUID()}`;
    const generatedSlug = (slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).replace(/^-|-$/g, '') || 'workspace';
    const now = Date.now();

    // Ensure default dev account and user exist for foreign keys
    try {
      db.prepare(`
        INSERT OR IGNORE INTO users (id, email, password_hash, full_name, created_at, updated_at)
        VALUES (?, 'dev@asterim.local', 'hash', 'Developer', ?, ?)
      `).run(userId || 'usr_dev', now, now);

      db.prepare(`
        INSERT OR IGNORE INTO accounts (id, owner_user_id, account_name, created_at, updated_at)
        VALUES (?, ?, 'Personal Account', ?, ?)
      `).run(accountId || 'acc_dev', userId || 'usr_dev', now, now);
    } catch (e) {}

    db.prepare(`
      INSERT INTO workspaces (id, account_id, name, slug, preset, execution_profile_id, is_personal, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(workspaceId, accountId, name, generatedSlug, preset, 'exec_default', isPersonal ? 1 : 0, now, now);

    try {
      db.prepare(`
        INSERT INTO environments (id, account_id, name, slug, preset, execution_profile_id, is_personal, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(workspaceId, accountId, name, generatedSlug, preset, 'exec_default', isPersonal ? 1 : 0, now, now);
    } catch (e) {
      /* ignore if exists */
    }

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
      preset: preset as any,
      executionProfileId: 'exec_default',
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
      WHERE w.is_personal = 1 OR w.id = 'personal'
      LIMIT 1
    `).get() as any;

    if (existing) {
      return {
        id: existing.id,
        accountId: existing.account_id,
        name: existing.name,
        slug: existing.slug,
        avatarUrl: existing.avatar_url,
        preset: existing.preset || 'personal',
        executionProfileId: existing.execution_profile_id || 'exec_default',
        isPersonal: true,
        createdAt: new Date(existing.created_at).toISOString(),
        updatedAt: new Date(existing.updated_at).toISOString(),
      };
    }

    const now = Date.now();
    const workspaceId = 'personal';
    const wsName = 'Personal Environment';

    // Ensure default dev account and user exist for foreign keys
    try {
      db.prepare(`
        INSERT OR IGNORE INTO users (id, email, password_hash, full_name, created_at, updated_at)
        VALUES ('usr_dev', 'dev@asterim.local', 'hash', 'Developer', ?, ?)
      `).run(now, now);

      db.prepare(`
        INSERT OR IGNORE INTO accounts (id, owner_user_id, account_name, created_at, updated_at)
        VALUES ('acc_dev', 'usr_dev', 'Personal Account', ?, ?)
      `).run(now, now);
    } catch (e) {}

    db.prepare(`
      INSERT OR IGNORE INTO workspaces (id, account_id, name, slug, preset, execution_profile_id, is_personal, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(workspaceId, accountId, wsName, 'personal', 'personal', 'exec_default', 1, now, now);

    try {
      db.prepare(`
        INSERT OR IGNORE INTO environments (id, account_id, name, slug, preset, execution_profile_id, is_personal, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(workspaceId, accountId, wsName, 'personal', 'personal', 'exec_default', 1, now, now);
    } catch (e) {}

    const memberId = `wsm_${randomUUID()}`;
    try {
      db.prepare(`
        INSERT OR IGNORE INTO workspace_memberships (id, workspace_id, user_id, role, created_at)
        VALUES (?, ?, ?, 'owner', ?)
      `).run(memberId, workspaceId, userId, now);
    } catch (e) {}

    return {
      id: workspaceId,
      accountId,
      name: wsName,
      slug: 'personal',
      preset: 'personal',
      executionProfileId: 'exec_default',
      isPersonal: true,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };
  }

  /**
   * Get all workspaces the user is a member of.
   */
  public getUserWorkspaces(userId: string): Workspace[] {
    const db = dbService.getDb();
    this.ensurePersonalWorkspace('acc_dev', userId);

    const rows = db.prepare(`
      SELECT w.* FROM workspaces w
      ORDER BY w.is_personal DESC, w.name ASC
    `).all() as any[];

    return rows.map((r) => {
      let projectCount = 0;
      try {
        const isPersonal = Boolean(r.is_personal) || r.id === 'personal';
        const cntRow = db.prepare(`
          SELECT COUNT(DISTINCT p.id) as cnt
          FROM projects p
          LEFT JOIN environment_project_attachments epa ON p.id = epa.project_id
          WHERE p.workspace_id = ? OR epa.environment_id = ?
          ${isPersonal ? "OR p.workspace_id IS NULL OR p.workspace_id = ''" : ''}
        `).get(r.id, r.id) as any;
        projectCount = cntRow ? cntRow.cnt : 0;
      } catch (e) {}

      return {
        id: r.id,
        accountId: r.account_id,
        name: r.name,
        slug: r.slug,
        avatarUrl: r.avatar_url,
        preset: r.preset || (r.is_personal ? 'personal' : 'company'),
        executionProfileId: r.execution_profile_id || 'exec_default',
        isPersonal: Boolean(r.is_personal),
        projectCount,
        createdAt: new Date(r.created_at).toISOString(),
        updatedAt: new Date(r.updated_at).toISOString(),
      };
    });
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

  /**
   * Delete workspace / environment completely (personal workspace protected).
   */
  public deleteWorkspace(workspaceId: string): void {
    if (workspaceId === 'personal') {
      throw new Error('Personal Environment cannot be deleted');
    }

    const db = dbService.getDb();
    let ws: any;
    try {
      ws = db.prepare('SELECT is_personal FROM workspaces WHERE id = ?').get(workspaceId);
    } catch (e) {}
    if (!ws) {
      try {
        ws = db.prepare('SELECT is_personal FROM environments WHERE id = ?').get(workspaceId);
      } catch (e) {}
    }

    if (ws && (Boolean(ws.is_personal) || ws.is_personal === 1)) {
      throw new Error('Personal Environment cannot be deleted');
    }

    try {
      db.prepare('DELETE FROM workspace_memberships WHERE workspace_id = ?').run(workspaceId);
    } catch (e) {}
    try {
      db.prepare('DELETE FROM workspace_invitations WHERE workspace_id = ?').run(workspaceId);
    } catch (e) {}
    try {
      db.prepare('DELETE FROM environment_project_attachments WHERE environment_id = ?').run(workspaceId);
    } catch (e) {}
    try {
      db.prepare('DELETE FROM environments WHERE id = ?').run(workspaceId);
    } catch (e) {}
    try {
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId);
    } catch (e) {}
  }
}

export const workspaceService = new WorkspaceService();
