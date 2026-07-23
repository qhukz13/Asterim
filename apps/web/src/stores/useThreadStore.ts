import { create } from 'zustand';

interface ThreadState {
  activeThreadId: string | null;
  events: any[]; // Timeline of events
  context: any; // Active context for the thread
  
  // Actions
  setActiveThread: (id: string | null) => void;
  setEvents: (events: any[]) => void;
  setContext: (context: any) => void;
  addEvent: (event: any) => void;
}

export const useThreadStore = create<ThreadState>((set) => ({
  activeThreadId: null,
  events: [],
  context: null,
  
  setActiveThread: (id) => set({ activeThreadId: id }),
  setEvents: (events) => set({ events }),
  setContext: (context) => set({ context }),
  addEvent: (event) => set((state) => ({ events: [...state.events, event] })),
}));
