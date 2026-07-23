import { create } from 'zustand';

interface TerminalState {
  buffers: Record<string, string>; // threadId -> raw ANSI buffer
  
  appendBuffer: (threadId: string, data: string) => void;
  clearBuffer: (threadId: string) => void;
  getBuffer: (threadId: string) => string;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  buffers: {},
  
  appendBuffer: (threadId, data) => set((state) => {
    const newBuffer = (state.buffers[threadId] || '') + data;
    // Cap at 500k characters to avoid memory leak
    const MAX_BUFFER = 500000; 
    return {
      buffers: {
        ...state.buffers,
        [threadId]: newBuffer.length > MAX_BUFFER ? newBuffer.slice(-MAX_BUFFER) : newBuffer
      }
    };
  }),
  
  clearBuffer: (threadId) => set((state) => ({
    buffers: {
      ...state.buffers,
      [threadId]: ''
    }
  })),

  getBuffer: (threadId) => get().buffers[threadId] || ''
}));
