import { create } from 'zustand';
import { Workspace, WorkspaceMember, Environment, EnvironmentMember } from '@asterim/shared';

interface WorkspaceState {
  workspaces: Workspace[];
  environments: Environment[];
  activeWorkspace: Workspace | null;
  activeEnvironment: Environment | null;
  activeWorkspaceId: string | null;
  activeEnvironmentId: string | null;
  members: WorkspaceMember[];
  projects: any[];
  workstations: any[];
  loading: boolean;
  
  // Actions
  fetchWorkspaces: () => Promise<void>;
  fetchEnvironments: () => Promise<void>;
  setActiveWorkspace: (id: string) => void;
  setActiveEnvironment: (id: string) => void;
  fetchMembers: (workspaceId: string) => Promise<void>;
  setProjects: (projects: any[]) => void;
  setWorkstations: (workstations: any[]) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  environments: [],
  activeWorkspace: null,
  activeEnvironment: null,
  activeWorkspaceId: null,
  activeEnvironmentId: null,
  members: [],
  projects: [],
  workstations: [],
  loading: false,

  fetchWorkspaces: async () => {
    set({ loading: true });
    try {
      const tokenKey = 'asterim_token';
      const token = localStorage.getItem(tokenKey) || '';
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/v1/environments', { headers });
      if (res.ok) {
        const data = await res.json();
        const list: Workspace[] = data.environments || data.workspaces || [];
        const savedEnvId = localStorage.getItem('asterim_active_environment_id');
        const currentActive = get().activeEnvironment || get().activeWorkspace;
        
        let newActive = currentActive;
        const currentId = newActive ? newActive.id : (savedEnvId || '');
        if (!newActive || !list.some(w => w.id === currentId)) {
          newActive = list.find(w => w.id === savedEnvId) || list.find(w => w.isPersonal) || list[0] || null;
        }

        if (newActive) {
          localStorage.setItem('asterim_active_environment_id', newActive.id);
        }

        set({
          workspaces: list,
          environments: list,
          activeWorkspace: newActive,
          activeEnvironment: newActive,
          activeWorkspaceId: newActive ? newActive.id : null,
          activeEnvironmentId: newActive ? newActive.id : null,
          loading: false
        });

        if (newActive) {
          get().fetchMembers(newActive.id);
        }
      }
    } catch (e) {
      set({ loading: false });
    }
  },

  fetchEnvironments: async () => {
    return get().fetchWorkspaces();
  },

  setActiveWorkspace: (id: string) => {
    const ws = get().workspaces.find(w => w.id === id) || null;
    if (ws) {
      localStorage.setItem('asterim_active_environment_id', ws.id);
    }
    set({
      activeWorkspace: ws,
      activeEnvironment: ws,
      activeWorkspaceId: id,
      activeEnvironmentId: id
    });
    if (ws) {
      get().fetchMembers(ws.id);
    }
  },

  setActiveEnvironment: (id: string) => {
    get().setActiveWorkspace(id);
  },

  fetchMembers: async (workspaceId: string) => {
    try {
      const res = await fetch(`/api/v1/workspaces/${workspaceId}/members`);
      if (res.ok) {
        const data = await res.json();
        set({ members: data.members || [] });
      }
    } catch (e) {}
  },

  setProjects: (newProjects: any[]) => {
    const current = get().projects;
    if (
      current.length === newProjects.length &&
      current.every((p, i) => p.id === newProjects[i]?.id)
    ) {
      return;
    }
    set({ projects: newProjects });
  },
  setWorkstations: (workstations: any[]) => set({ workstations }),
}));

export const useEnvironmentStore = useWorkspaceStore;

