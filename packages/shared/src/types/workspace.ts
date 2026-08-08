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

export type EnvironmentPermission =
  | 'environment:read'
  | 'environment:write'
  | 'environment:admin'
  | 'member:invite'
  | 'member:remove'
  | 'member:role'
  | 'agent:spawn'
  | 'agent:approve'
  | 'project:share'
  | WorkspacePermission;

export interface Workspace {
  id: string;
  accountId: string;
  name: string;
  slug: string;
  preset?: EnvironmentPreset;
  executionProfileId?: string;
  avatarUrl?: string;
  isPersonal: boolean;
  projectCount?: number;
  createdAt: string;
  updatedAt: string;
}

export type Environment = Workspace;

export interface AgentProfile {
  id: string;
  environmentId: string;
  name: string;
  defaultModel: string;
  temperature: number;
  mcpVisibility: string[];
  skills: string[];
  promptTemplate?: string;
  approvalLevel?: 'standard' | 'strict' | 'relaxed';
}

export interface KnowledgeItem {
  id: string;
  environmentId: string;
  title: string;
  category: 'architecture' | 'convention' | 'glossary' | 'decision';
  content: string;
  createdAt: string;
}

export interface ExecutionProfile {
  id: string;
  name: string;
  autoApproveReadCommands: boolean;
  requireApprovalForShell: boolean;
  auditLoggingEnabled: boolean;
  filesystemScope: 'unrestricted' | 'restricted' | 'sandbox';
}

export interface EnvironmentManifest {
  $schema?: string;
  id: string;
  name: string;
  slug: string;
  preset: EnvironmentPreset;
  version: string;
  gitIdentity?: {
    name: string;
    email: string;
    signingKey?: string;
  };
  executionProfile: ExecutionProfile;
  attachedProjects: Array<{
    id: string;
    path: string;
    defaultBranch?: string;
  }>;
  agentProfiles: AgentProfile[];
  mcpServers: Array<{
    id: string;
    name: string;
    transport: 'stdio' | 'sse';
    command?: string;
    args?: string[];
    url?: string;
  }>;
  skills: string[];
  extensions: string[];
  knowledgeItems: string[];
  secrets: string[];
}

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
  executionProfileId?: string;
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

