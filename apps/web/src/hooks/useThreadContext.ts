import { useState, useEffect, useCallback, useRef } from 'react';
import type { ContextEntry, ContextEntryType, ContextEntryCreator } from '@asterim/shared';
import { Socket } from 'socket.io-client';

interface UseThreadContextOptions {
  socket: Socket | null;
  threadId: string | null;
  projectId: string | null;
  activeBackendUrl?: string;
}

interface UseThreadContextReturn {
  /** All context entries for the current thread, ordered by position. */
  entries: ContextEntry[];
  /** Whether the initial fetch is in progress. */
  isLoading: boolean;
  /** Last error from a context operation. */
  error: string | null;
  /** Add a new entry to the thread's context. */
  addEntry: (input: {
    entryType: ContextEntryType;
    path?: string;
    label?: string;
    content?: string;
    status?: 'pinned' | 'active' | 'suggestion';
    createdBy?: ContextEntryCreator;
    position?: number;
  }) => Promise<ContextEntry | null>;
  /** Remove an entry by ID. */
  removeEntry: (entryId: string) => Promise<boolean>;
  /** Update an entry's mutable fields. */
  updateEntry: (
    entryId: string,
    updates: Partial<Pick<ContextEntry, 'status' | 'label' | 'content' | 'position'>>
  ) => Promise<ContextEntry | null>;
  /** Clear all entries for this thread's context. */
  clearEntries: () => Promise<void>;
}

function getBaseUrl(activeBackendUrl?: string): string {
  return activeBackendUrl || `${window.location.protocol}//${window.location.hostname}:3000`;
}

function getAuthHeaders(activeBackendUrl?: string): Record<string, string> {
  const tokenKey = activeBackendUrl ? `asterim_token_${activeBackendUrl}` : 'asterim_token';
  const token = localStorage.getItem(tokenKey) || '';
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

/**
 * Hook that manages the Context domain aggregate for the active thread.
 * Fetches from REST and stays in sync via WebSocket events.
 * Named `useThreadContext` to avoid collision with React's `useContext`.
 */
export function useThreadContext({
  socket,
  threadId,
  projectId,
  activeBackendUrl
}: UseThreadContextOptions): UseThreadContextReturn {
  const [entries, setEntries] = useState<ContextEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep refs to avoid stale closures in socket handlers
  const threadIdRef = useRef(threadId);
  const projectIdRef = useRef(projectId);
  useEffect(() => {
    threadIdRef.current = threadId;
    projectIdRef.current = projectId;
  }, [threadId, projectId]);

  // Fetch entries when threadId changes
  useEffect(() => {
    if (!threadId) {
      setEntries([]);
      return;
    }

    let cancelled = false;
    const fetchEntries = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const baseUrl = getBaseUrl(activeBackendUrl);
        const res = await fetch(`${baseUrl}/api/v1/threads/${threadId}/context`, {
          headers: getAuthHeaders(activeBackendUrl)
        });
        if (!res.ok) throw new Error(`Failed to fetch context: ${res.statusText}`);
        const data = await res.json();
        if (!cancelled) {
          setEntries(data.entries || []);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Failed to fetch context');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchEntries();
    return () => { cancelled = true; };
  }, [threadId, activeBackendUrl]);

  // Listen for real-time context updates via WebSocket
  useEffect(() => {
    if (!socket) return;

    const handleContextUpdated = (event: any) => {
      const payload = event.payload || event;
      if (payload.threadId === threadIdRef.current) {
        setEntries(payload.entries || []);
      }
    };

    const handleContextCleared = (event: any) => {
      const payload = event.payload || event;
      if (payload.threadId === threadIdRef.current) {
        setEntries([]);
      }
    };

    socket.on('context.updated', handleContextUpdated);
    socket.on('context.cleared', handleContextCleared);

    return () => {
      socket.off('context.updated', handleContextUpdated);
      socket.off('context.cleared', handleContextCleared);
    };
  }, [socket]);

  const addEntry = useCallback(
    async (input: {
      entryType: ContextEntryType;
      path?: string;
      label?: string;
      content?: string;
      status?: 'pinned' | 'active' | 'suggestion';
      createdBy?: ContextEntryCreator;
      position?: number;
    }): Promise<ContextEntry | null> => {
      if (!threadIdRef.current || !projectIdRef.current) return null;
      setError(null);
      try {
        const baseUrl = getBaseUrl(activeBackendUrl);
        const res = await fetch(
          `${baseUrl}/api/v1/threads/${threadIdRef.current}/context`,
          {
            method: 'POST',
            headers: getAuthHeaders(activeBackendUrl),
            body: JSON.stringify({
              projectId: projectIdRef.current,
              ...input
            })
          }
        );
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to add context entry');
        }
        const data = await res.json();
        return data.entry;
      } catch (err: any) {
        setError(err.message);
        return null;
      }
    },
    [activeBackendUrl]
  );

  const removeEntry = useCallback(
    async (entryId: string): Promise<boolean> => {
      setError(null);
      try {
        const baseUrl = getBaseUrl(activeBackendUrl);
        const res = await fetch(`${baseUrl}/api/v1/context/${entryId}`, {
          method: 'DELETE',
          headers: getAuthHeaders(activeBackendUrl)
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to remove context entry');
        }
        return true;
      } catch (err: any) {
        setError(err.message);
        return false;
      }
    },
    [activeBackendUrl]
  );

  const updateEntry = useCallback(
    async (
      entryId: string,
      updates: Partial<Pick<ContextEntry, 'status' | 'label' | 'content' | 'position'>>
    ): Promise<ContextEntry | null> => {
      setError(null);
      try {
        const baseUrl = getBaseUrl(activeBackendUrl);
        const res = await fetch(`${baseUrl}/api/v1/context/${entryId}`, {
          method: 'PATCH',
          headers: getAuthHeaders(activeBackendUrl),
          body: JSON.stringify(updates)
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to update context entry');
        }
        const data = await res.json();
        return data.entry;
      } catch (err: any) {
        setError(err.message);
        return null;
      }
    },
    [activeBackendUrl]
  );

  const clearEntries = useCallback(async (): Promise<void> => {
    if (!threadIdRef.current || !projectIdRef.current) return;
    setError(null);
    try {
      const baseUrl = getBaseUrl(activeBackendUrl);
      const res = await fetch(
        `${baseUrl}/api/v1/threads/${threadIdRef.current}/context`,
        {
          method: 'DELETE',
          headers: getAuthHeaders(activeBackendUrl),
          body: JSON.stringify({ projectId: projectIdRef.current })
        }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to clear context');
      }
    } catch (err: any) {
      setError(err.message);
    }
  }, [activeBackendUrl]);

  return {
    entries,
    isLoading,
    error,
    addEntry,
    removeEntry,
    updateEntry,
    clearEntries
  };
}
