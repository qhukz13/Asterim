import { create } from 'zustand';

export type ViewType =
  | 'chat'
  | 'terminal'
  | 'changes'
  | 'memory'
  | 'mcp'
  | 'skills'
  /** Shared team agents and their collaborative threads (P8-02). */
  | 'team'
  /** Declarative multi-agent pipelines and their runs (P9-03). */
  | 'pipelines'
  | 'settings'
  | 'workspace'
  | 'environment';

/**
 * Every view the URL may name.
 *
 * The URL is the single source of truth for navigation, which means a view id
 * arriving from it is user input: `/view/nonsense` would otherwise be set as the
 * active view and leave the workspace showing nothing at all.
 */
export const VIEW_TYPES: readonly ViewType[] = [
  'chat',
  'terminal',
  'changes',
  'memory',
  'mcp',
  'skills',
  'team',
  'pipelines',
  'settings',
  'workspace',
  'environment'
];

/** Whether a string from the URL names a view this dashboard has. */
export function isViewType(value: string | undefined | null): value is ViewType {
  return !!value && (VIEW_TYPES as readonly string[]).includes(value);
}

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
  availableViews: ['chat', 'terminal', 'changes', 'memory', 'skills', 'team', 'pipelines', 'settings', 'workspace', 'environment'],
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
