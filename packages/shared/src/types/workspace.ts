export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';
export type EnvironmentRole = WorkspaceRole;

export type EnvironmentPreset = 'personal' | 'company' | 'client' | 'experimental';

export type WorkspacePermission =
  | 'workspace:read'
  | 'workspace:write'
  | 'workspace:admin'
  | 'member:invite'
  | 'member:remove'
  | 'member:role'
  | 'agent:spawn'
  | 'agent:approve'
  | 'project:share';

export type EnvironmentPermission = WorkspacePermission;

export interface Workspace {
  id: string;
  accountId: string;
  name: string;
  slug: string;
  avatarUrl?: string;
  isPersonal: boolean;
  preset?: EnvironmentPreset;
  createdAt: string;
  updatedAt: string;
}

export type Environment = Workspace;

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  email: string;
  fullName: string;
  avatarUrl?: string;
  joinedAt: string;
}

export type EnvironmentMember = WorkspaceMember;

export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  token: string;
  expiresAt: string;
  createdAt: string;
}

export type EnvironmentInvitation = WorkspaceInvitation;

export interface CreateWorkspaceRequest {
  name: string;
  slug?: string;
  preset?: EnvironmentPreset;
  avatarUrl?: string;
}

export type CreateEnvironmentRequest = CreateWorkspaceRequest;

export interface InviteMemberRequest {
  email: string;
  role: WorkspaceRole;
}

export interface JoinWorkspaceRequest {
  token: string;
}

export interface UpdateMemberRoleRequest {
  role: WorkspaceRole;
}
