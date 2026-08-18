import React, { useEffect } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useProjectStore } from './stores/useProjectStore';
import { useThreadStore } from './stores/useThreadStore';
import { isViewType, useViewStore } from './stores/useViewStore';
import { useWorkspaceStore } from './stores/useWorkspaceStore';
import { useDebugLifecycle, Debug } from './utils/debug';

const ROUTE_PATTERN = '/workspace/project/:projectId/thread/:threadId/view/:viewId';
const VIEW_ROUTE_PATTERN = '/workspace/project/:projectId/view/:viewId';
const PROJECT_ROUTE_PATTERN = '/workspace/project/:projectId';

export function RouterSync() {
  const [matchFull, paramsFull] = useRoute(ROUTE_PATTERN);
  const [matchView, paramsView] = useRoute(VIEW_ROUTE_PATTERN);
  const [matchProject, paramsProject] = useRoute(PROJECT_ROUTE_PATTERN);
  const [, setLocation] = useLocation();

  useDebugLifecycle('RouterSync', { matchFull, matchView, matchProject, paramsFull, paramsView, paramsProject });

  const setActiveProject = useProjectStore((s: any) => s.setActiveProject);
  const setActiveThread = useThreadStore((s: any) => s.setActiveThread);
  const setActiveView = useViewStore((s: any) => s.setActiveView);
  
  const activeProjectId = useProjectStore((s: any) => s.activeProjectId);
  const activeThreadId = useThreadStore((s: any) => s.activeThreadId);
  const activeView = useViewStore((s: any) => s.activeView);
  const projects = useWorkspaceStore((s: any) => s.projects);

  // Sync URL to State (Single Source of Truth)
  useEffect(() => {
    const targetProjectId = matchFull
      ? paramsFull?.projectId
      : matchView
      ? paramsView?.projectId
      : matchProject
      ? paramsProject?.projectId
      : null;

    if (targetProjectId && projects.length >= 0) {
      const existsInEnv = projects.some((p: any) => p.id === targetProjectId);
      if (!existsInEnv) {
        // Project in URL is not attached to current active Environment. Clear state and redirect to /.
        if (activeProjectId !== null) setActiveProject(null);
        if (activeThreadId !== null) setActiveThread(null);
        setLocation('/');
        return;
      }
    }

    // If we have a full match (Project + Thread + View)
    if (matchFull && paramsFull) {
      if (activeProjectId !== paramsFull.projectId) setActiveProject(paramsFull.projectId);
      if (activeThreadId !== paramsFull.threadId) setActiveThread(paramsFull.threadId);
      // A view id from the URL is user input: an unknown one is ignored rather
      // than set, which leaves the workspace on the view it was already showing
      // instead of on nothing at all.
      if (isViewType(paramsFull.viewId) && activeView !== paramsFull.viewId) {
        setActiveView(paramsFull.viewId);
      }
    }
    // If we have a project + view match without explicit thread
    else if (matchView && paramsView) {
      if (activeProjectId !== paramsView.projectId) setActiveProject(paramsView.projectId);
      if (isViewType(paramsView.viewId) && activeView !== paramsView.viewId) {
        setActiveView(paramsView.viewId);
      }
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
  }, [matchFull, matchView, matchProject, paramsFull, paramsView, paramsProject, projects]);

  return null;
}
