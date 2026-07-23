import { create } from 'zustand';

export type SelectionType = 'file' | 'thread' | 'execution' | 'none';

export interface DomainSelection {
  type: SelectionType;
  id: string | null;
  metadata?: any;
}

interface InspectorState {
  currentSelection: DomainSelection;
  isCollapsed: boolean;
  
  // Actions
  setSelection: (selection: DomainSelection) => void;
  clearSelection: () => void;
  toggleCollapse: () => void;
}

export const useInspectorStore = create<InspectorState>((set) => ({
  currentSelection: { type: 'none', id: null },
  isCollapsed: false,
  
  setSelection: (selection) => set({ currentSelection: selection }),
  clearSelection: () => set({ currentSelection: { type: 'none', id: null } }),
  toggleCollapse: () => set((state) => ({ isCollapsed: !state.isCollapsed })),
}));
