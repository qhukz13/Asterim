import { create } from 'zustand';
import { getAuthHeaders } from '../utils/auth';
import type {
  AsterimEvent,
  McpServerEventPayload,
  McpServerInput,
  McpServerRuntimeInfo,
  McpToolCallResult
} from '@asterim/shared';

/**
 * MCP Server Registry state.
 *
 * Workstation-scoped, not project-scoped: an MCP server belongs to the machine
 * (or to a workspace), so unlike `useMemoryStore` there is nothing to discard on
 * a project change. The server list is authoritative on the Core; every action
 * here writes through the API and then adopts what came back, and `mcp.*` socket
 * events keep the list live while a process starts, crashes or re-reads its
 * tools without anybody asking.
 */

export const MCP_EVENT_TYPES = [
  'mcp.server_started',
  'mcp.server_stopped',
  'mcp.server_crashed',
  'mcp.capabilities_updated'
] as const;

/** True for the socket events this store knows how to apply. */
export function isMcpEvent(event: { type?: string } | null | undefined): boolean {
  return !!event?.type && (MCP_EVENT_TYPES as readonly string[]).includes(event.type);
}

interface McpState {
  servers: McpServerRuntimeInfo[];
  /** The server whose detail drawer is open, if any. */
  activeServerId: string | null;
  isLoading: boolean;
  error: string | null;
  /** Ids with a request in flight, so a row can show its own spinner. */
  pending: string[];

  loadServers: (workspaceId?: string) => Promise<void>;
  createServer: (input: McpServerInput) => Promise<McpServerRuntimeInfo>;
  updateServer: (id: string, input: McpServerInput) => Promise<McpServerRuntimeInfo>;
  startServer: (id: string) => Promise<void>;
  stopServer: (id: string) => Promise<void>;
  restartServer: (id: string) => Promise<void>;
  refreshCapabilities: (id: string) => Promise<void>;
  deleteServer: (id: string) => Promise<void>;
  callTool: (
    id: string,
    toolName: string,
    args?: Record<string, unknown>
  ) => Promise<McpToolCallResult>;

  setActiveServer: (id: string | null) => void;
  /** Applies an `mcp.*` socket event to the local list. */
  handleMcpEvent: (event: AsterimEvent<McpServerEventPayload>) => void;
}

const BASE = '/api/v1/mcp/servers';

/** Delegates to the shared helper so a remote workstation gets its own token. */
function authHeaders(json = false): Record<string, string> {
  return getAuthHeaders({ json });
}

/**
 * Reads a response, throwing the server's own message on failure.
 *
 * The MCP routes answer errors as `{ error, code }`, and the message is what a
 * developer needs: "does not expose a tool named 'x'" beats "404".
 */
async function readJson<T>(res: Response, what: string): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* a non-JSON body is handled below */
  }
  if (!res.ok) {
    const message = (body as { error?: string } | null)?.error;
    throw new Error(message || `${what} failed (${res.status})`);
  }
  return body as T;
}

/** Replaces a server in the list, or appends it if it is new. */
function upsert(
  servers: McpServerRuntimeInfo[],
  server: McpServerRuntimeInfo
): McpServerRuntimeInfo[] {
  const index = servers.findIndex(s => s.id === server.id);
  if (index === -1) return [...servers, server].sort((a, b) => a.name.localeCompare(b.name));
  const next = [...servers];
  next[index] = server;
  return next;
}

export const useMcpStore = create<McpState>(set => {
  /** Runs an action for one server, tracking it as pending and adopting the result. */
  const act = async (id: string, what: string, run: () => Promise<Response>): Promise<void> => {
    set(state => ({ pending: [...state.pending, id], error: null }));
    try {
      const body = await readJson<{ server: McpServerRuntimeInfo }>(await run(), what);
      set(state => ({ servers: upsert(state.servers, body.server) }));
    } catch (err) {
      set({ error: (err as Error).message });
      throw err;
    } finally {
      set(state => ({ pending: state.pending.filter(pendingId => pendingId !== id) }));
    }
  };

  return {
    servers: [],
    activeServerId: null,
    isLoading: false,
    error: null,
    pending: [],

    loadServers: async (workspaceId?: string) => {
      set({ isLoading: true, error: null });
      try {
        const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
        const body = await readJson<{ servers: McpServerRuntimeInfo[] }>(
          await fetch(`${BASE}${query}`, { headers: authHeaders() }),
          'Loading MCP servers'
        );
        set({ servers: body.servers || [], isLoading: false });
      } catch (err) {
        set({ error: (err as Error).message, isLoading: false });
      }
    },

    createServer: async (input: McpServerInput) => {
      const body = await readJson<{ server: McpServerRuntimeInfo }>(
        await fetch(BASE, {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify(input)
        }),
        'Creating the MCP server'
      );
      set(state => ({ servers: upsert(state.servers, body.server) }));
      return body.server;
    },

    updateServer: async (id: string, input: McpServerInput) => {
      const body = await readJson<{ server: McpServerRuntimeInfo }>(
        await fetch(`${BASE}/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: authHeaders(true),
          body: JSON.stringify(input)
        }),
        'Updating the MCP server'
      );
      set(state => ({ servers: upsert(state.servers, body.server) }));
      return body.server;
    },

    startServer: (id: string) =>
      act(id, 'Starting the MCP server', () =>
        fetch(`${BASE}/${encodeURIComponent(id)}/start`, { method: 'POST', headers: authHeaders() })
      ),

    stopServer: (id: string) =>
      act(id, 'Stopping the MCP server', () =>
        fetch(`${BASE}/${encodeURIComponent(id)}/stop`, { method: 'POST', headers: authHeaders() })
      ),

    restartServer: (id: string) =>
      act(id, 'Restarting the MCP server', () =>
        fetch(`${BASE}/${encodeURIComponent(id)}/restart`, {
          method: 'POST',
          headers: authHeaders()
        })
      ),

    refreshCapabilities: (id: string) =>
      act(id, 'Refreshing capabilities', () =>
        fetch(`${BASE}/${encodeURIComponent(id)}/refresh`, {
          method: 'POST',
          headers: authHeaders()
        })
      ),

    deleteServer: async (id: string) => {
      set(state => ({ pending: [...state.pending, id], error: null }));
      try {
        await readJson<{ deleted: boolean }>(
          await fetch(`${BASE}/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: authHeaders()
          }),
          'Deleting the MCP server'
        );
        set(state => ({
          servers: state.servers.filter(server => server.id !== id),
          activeServerId: state.activeServerId === id ? null : state.activeServerId
        }));
      } catch (err) {
        set({ error: (err as Error).message });
        throw err;
      } finally {
        set(state => ({ pending: state.pending.filter(pendingId => pendingId !== id) }));
      }
    },

    callTool: async (id: string, toolName: string, args?: Record<string, unknown>) => {
      const body = await readJson<{ result: McpToolCallResult }>(
        await fetch(`${BASE}/${encodeURIComponent(id)}/tools/${encodeURIComponent(toolName)}`, {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({ arguments: args ?? {} })
        }),
        `Calling ${toolName}`
      );
      return body.result;
    },

    setActiveServer: (id: string | null) => set({ activeServerId: id }),

    handleMcpEvent: (event: AsterimEvent<McpServerEventPayload>) => {
      const server = event?.payload?.server;
      if (!isMcpEvent(event) || !server?.id) return;
      set(state => ({ servers: upsert(state.servers, server) }));
    }
  };
});
