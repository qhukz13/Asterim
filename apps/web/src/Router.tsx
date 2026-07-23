import React, { useEffect } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useProjectStore } from './stores/useProjectStore';
import { useThreadStore } from './stores/useThreadStore';
import { useViewStore, ViewType } from './stores/useViewStore';
import { useDebugLifecycle, Debug } from './utils/debug';

const ROUTE_PATTERN = '/workspace/project/:projectId/thread/:threadId/view/:viewId';
const PROJECT_ROUTE_PATTERN = '/workspace/project/:projectId';

export function RouterSync() {
  const [matchFull, paramsFull] = useRoute(ROUTE_PATTERN);
  const [matchProject, paramsProject] = useRoute(PROJECT_ROUTE_PATTERN);
  const [, setLocation] = useLocation();

  useDebugLifecycle('RouterSync', { matchFull, matchProject, paramsFull, paramsProject });

  const setActiveProject = useProjectStore(s => s.setActiveProject);
  const setActiveThread = useThreadStore(s => s.setActiveThread);
  const setActiveView = useViewStore(s => s.setActiveView);
  
  const activeProjectId = useProjectStore(s => s.activeProjectId);
  const activeThreadId = useThreadStore(s => s.activeThreadId);
  const activeView = useViewStore(s => s.activeView);

  // Sync URL to State (Single Source of Truth)
  useEffect(() => {
    // If we have a full match (Project + Thread + View)
    if (matchFull && paramsFull) {
      if (activeProjectId !== paramsFull.projectId) setActiveProject(paramsFull.projectId);
      if (activeThreadId !== paramsFull.threadId) setActiveThread(paramsFull.threadId);
      if (activeView !== paramsFull.viewId) setActiveView(paramsFull.viewId as ViewType);
    } 
    // If we only have a project match, clear thread state
    else if (matchProject && paramsProject) {
      if (activeProjectId !== paramsProject.projectId) setActiveProject(paramsProject.projectId);
      if (activeThreadId !== null) setActiveThread(null);
    }
    // No route match (e.g., root `/`) — clear all navigational state
    else {
      if (activeProjectId !== null) setActiveProject(null);
      if (activeThreadId !== null) setActiveThread(null);
    }
  }, [matchFull, paramsFull, matchProject, paramsProject]);

  return null;
}
