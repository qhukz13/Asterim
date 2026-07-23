import { create } from 'zustand';

export type ViewType = 'chat' | 'terminal' | 'changes' | 'settings';

interface ViewState {
  activeView: ViewType;
  availableViews: ViewType[];
  viewHistory: ViewType[]; // Optional, for Back button
  perThreadViewState: Record<string, ViewType>; // Remembers the last view per thread
  
  // Actions
  setActiveView: (view: ViewType, threadId?: string) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  activeView: 'chat',
  availableViews: ['chat', 'terminal', 'changes', 'settings'],
  viewHistory: [],
  perThreadViewState: {},
  
  setActiveView: (view, threadId) => set((state) => {
    const newState: Partial<ViewState> = {
      activeView: view,
      viewHistory: [...state.viewHistory, state.activeView]
    };
    if (threadId) {
      newState.perThreadViewState = { ...state.perThreadViewState, [threadId]: view };
    }
    return newState;
  }),
}));
