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

  // Rule: Changing project clears thread
  useEffect(() => {
    // When project changes, the active thread might become invalid.
    // In a full implementation, we validate if the thread belongs to the project.
  }, [activeProjectId]);

  // Rule: Changing thread clears inspector selection
  useEffect(() => {
    clearSelection();
  }, [activeThreadId, clearSelection]);

  return null;
}
