import { create } from 'zustand';

interface ExecutionState {
  activeExecutionId: string | null;
  executions: any[]; // Executions for the active Thread
  runtimeStatus: Record<string, string>; // Maps execution ID to status
  logs: Record<string, string[]>; // Maps execution ID to array of log lines
  
  // Actions
  setActiveExecution: (id: string | null) => void;
  setExecutions: (executions: any[]) => void;
  updateRuntimeStatus: (id: string, status: string) => void;
  appendLog: (id: string, logLine: string) => void;
}

export const useExecutionStore = create<ExecutionState>((set) => ({
  activeExecutionId: null,
  executions: [],
  runtimeStatus: {},
  logs: {},
  
  setActiveExecution: (id) => set({ activeExecutionId: id }),
  setExecutions: (executions) => set({ executions }),
  updateRuntimeStatus: (id, status) => set((state) => ({
    runtimeStatus: { ...state.runtimeStatus, [id]: status }
  })),
  appendLog: (id, logLine) => set((state) => ({
    logs: { ...state.logs, [id]: [...(state.logs[id] || []), logLine] }
  })),
}));
