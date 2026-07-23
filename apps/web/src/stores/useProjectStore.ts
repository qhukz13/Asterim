import { create } from 'zustand';

interface ProjectState {
  activeProjectId: string | null;
  threads: any[];
  gitStatus: any | null; // Represents repository status
  
  // Actions
  setActiveProject: (id: string | null) => void;
  setThreads: (threads: any[]) => void;
  setGitStatus: (status: any) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  activeProjectId: null,
  threads: [],
  gitStatus: null,
  
  setActiveProject: (id) => set({ activeProjectId: id }),
  setThreads: (threads) => set({ threads }),
  setGitStatus: (status) => set({ gitStatus: status }),
}));
