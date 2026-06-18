export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'backlog' | 'in_progress' | 'done';
}

export interface AgentState {
  status: 'idle' | 'working' | 'waiting_approval' | 'error';
  lastMessage?: string;
}

export interface ProjectState {
  id: string;
  name: string;
  path: string;
  activeBranch: string;
  agentState: AgentState;
  pendingApprovals: number;
}
