import { create } from 'zustand';

interface ChatState {
  drafts: Record<string, string>; // threadId -> input text
  
  setDraft: (threadId: string, draft: string) => void;
  getDraft: (threadId: string) => string;
}

export const useChatStore = create<ChatState>((set, get) => ({
  drafts: {},
  
  setDraft: (threadId, draft) => set((state) => ({
    drafts: {
      ...state.drafts,
      [threadId]: draft
    }
  })),

  getDraft: (threadId) => get().drafts[threadId] || ''
}));
