import React, { useEffect } from 'react';
import { useProjectStore } from './stores/useProjectStore';
import { useThreadStore } from './stores/useThreadStore';
import { useInspectorStore } from './stores/useInspectorStore';
import { useViewStore } from './stores/useViewStore';

/**
 * The InteractionEngine observes state changes in the Domain Stores
 * and propagates focus and selection rules downwards.
 * It does not render any UI.
 */
export function InteractionEngine() {
  const activeProjectId = useProjectStore(s => s.activeProjectId);
  const activeThreadId = useThreadStore(s => s.activeThreadId);
  const clearSelection = useInspectorStore(s => s.clearSelection);
  const perThreadViewState = useViewStore(s => s.perThreadViewState);
  const setActiveView = useViewStore(s => s.setActiveView);
  const setThreads = useProjectStore(s => s.setThreads);
  const resetDelegation = useProjectStore(s => s.resetDelegation);

  // Rule: Changing project clears stale thread data
  useEffect(() => {
    // Clear the thread list so the previous project's threads
    // don't bleed into the new project's workspace while
    // SessionSidebar re-fetches.
    setThreads([]);
    // The delegation maps are keyed by thread id and belong to the same list,
    // so they go with it — a waiting state left behind would otherwise be
    // attributed to whichever thread of the new project happened to match.
    resetDelegation();
  }, [activeProjectId, setThreads, resetDelegation]);

  // Rule: Changing thread clears inspector selection
  useEffect(() => {
    clearSelection();
  }, [activeThreadId, clearSelection]);

  return null;
}
