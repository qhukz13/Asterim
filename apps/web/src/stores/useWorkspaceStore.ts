import { create } from 'zustand';

interface WorkspaceState {
  activeWorkspaceId: string | null;
  projects: any[]; // To be strongly typed later
  workstations: any[]; // To be strongly typed later
  
  // Actions
  setActiveWorkspace: (id: string) => void;
  setProjects: (projects: any[]) => void;
  setWorkstations: (workstations: any[]) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activeWorkspaceId: null,
  projects: [],
  workstations: [],
  
  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
  setProjects: (projects) => set({ projects }),
  setWorkstations: (workstations) => set({ workstations }),
}));
