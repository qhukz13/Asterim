import { create } from 'zustand';
import { Workspace, WorkspaceMember } from '@asterim/shared';

interface WorkspaceState {
  workspaces: Workspace[];
  activeWorkspace: Workspace | null;
  activeWorkspaceId: string | null;
  members: WorkspaceMember[];
  projects: any[];
  workstations: any[];
  loading: boolean;
  
  // Actions
  fetchWorkspaces: () => Promise<void>;
  setActiveWorkspace: (id: string) => void;
  fetchMembers: (workspaceId: string) => Promise<void>;
  setProjects: (projects: any[]) => void;
  setWorkstations: (workstations: any[]) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeWorkspace: null,
  activeWorkspaceId: null,
  members: [],
  projects: [],
  workstations: [],
  loading: false,

  fetchWorkspaces: async () => {
    set({ loading: true });
    try {
      const res = await fetch('/api/v1/workspaces');
      if (res.ok) {
        const data = await res.json();
        const workspaces: Workspace[] = data.workspaces || [];
        const currentActive = get().activeWorkspace;
        
        let newActive = currentActive;
        const currentId = newActive ? newActive.id : '';
        if (!newActive || !workspaces.some(w => w.id === currentId)) {
          newActive = workspaces.find(w => w.isPersonal) || workspaces[0] || null;
        }

        set({
          workspaces,
          activeWorkspace: newActive,
          activeWorkspaceId: newActive ? newActive.id : null,
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

  setActiveWorkspace: (id: string) => {
    const ws = get().workspaces.find(w => w.id === id) || null;
    set({ activeWorkspace: ws, activeWorkspaceId: id });
    if (ws) {
      get().fetchMembers(ws.id);
    }
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

  setProjects: (projects: any[]) => set({ projects }),
  setWorkstations: (workstations: any[]) => set({ workstations }),
}));
