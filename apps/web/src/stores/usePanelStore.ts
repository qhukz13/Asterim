import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PanelState {
  leftSidebarWidth: number;
  isLeftSidebarCollapsed: boolean;
  
  centerSidebarWidth: number;
  isCenterSidebarCollapsed: boolean;
  
  inspectorWidth: number;
  isInspectorCollapsed: boolean;
  
  // Actions
  setPanelWidth: (panel: 'left' | 'center' | 'inspector', width: number) => void;
  togglePanel: (panel: 'left' | 'center' | 'inspector') => void;
}

export const usePanelStore = create<PanelState>()(
  persist(
    (set) => ({
      leftSidebarWidth: 250,
      isLeftSidebarCollapsed: false,
      
      centerSidebarWidth: 300,
      isCenterSidebarCollapsed: false,
      
      inspectorWidth: 320,
      isInspectorCollapsed: false,
      
      setPanelWidth: (panel, width) => set((state) => ({
        [`${panel}SidebarWidth`]: width,
        [`${panel}Width`]: width, // fallback for inspector
      })),
      togglePanel: (panel) => set((state) => {
        if (panel === 'inspector') {
          return { isInspectorCollapsed: !state.isInspectorCollapsed };
        }
        const key = `is${panel.charAt(0).toUpperCase() + panel.slice(1)}SidebarCollapsed` as keyof PanelState;
        return { [key]: !state[key] };
      }),
    }),
    {
      name: 'asterim-panel-storage', // name of the item in the storage
    }
  )
);
