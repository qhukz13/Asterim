import { create } from 'zustand';

interface CommandPaletteState {
  isOpen: boolean;
  searchQuery: string;
  
  // Actions
  setIsOpen: (isOpen: boolean) => void;
  toggle: () => void;
  setSearchQuery: (query: string) => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
  isOpen: false,
  searchQuery: '',
  
  setIsOpen: (isOpen) => set({ isOpen }),
  toggle: () => set((state) => ({ isOpen: !state.isOpen })),
  setSearchQuery: (query) => set({ searchQuery: query }),
}));
