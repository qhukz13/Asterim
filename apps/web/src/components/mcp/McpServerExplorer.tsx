import React, { useEffect, useState } from 'react';
import type {
  McpServerInput,
  McpServerRuntimeInfo,
  McpServerStatus,
  McpToolCallResult
} from '@asterim/shared';
import { useMcpStore } from '../../stores/useMcpStore';
import { McpServerModal } from './McpServerModal';
import { McpServerDetailDrawer } from './McpServerDetailDrawer';

/**
 * The MCP Server Registry.
 *
 * One row per registered server, showing the two things a developer actually
 * needs at a glance — is it up, and what does it give me — with the lifecycle
 * controls next to them. Live: every `mcp.*` socket event rewrites the row it
 * belongs to, so a server that crashes in the background turns red without a
 * reload.
 */

export interface StatusTone {
  color: string;
  background: string;
  label: string;
}

/**
 * How a status is shown.
 *
 * `INITIALIZING` is amber rather than green on purpose: the process exists but
 * the handshake has not finished, and a developer who reads that as "ready"
 * would call a tool that is not there yet.
 */
export function statusTone(status: McpServerStatus): StatusTone {
  switch (status) {
    case 'RUNNING':
      return {
        color: 'var(--color-state-working)',
        background: 'var(--color-state-working-bg)',
        label: 'Running'
      };
    case 'STARTING':
    case 'INITIALIZING':
      return {
        color: 'var(--color-state-paused)',
        background: 'var(--color-state-paused-bg)',
        label: status === 'STARTING' ? 'Starting' : 'Initializing'
      };
    case 'CRASHED':
      return {
        color: 'var(--color-state-error)',
        background: 'var(--color-state-error-bg)',
        label: 'Crashed'
      };
    case 'ERROR':
      return {
        color: 'var(--color-state-error)',
        background: 'var(--color-state-error-bg)',
        label: 'Error'
      };
    default:
      return {
        color: 'var(--color-text-secondary)',
        background: 'rgba(148, 163, 184, 0.12)',
        label: 'Stopped'
      };
  }
}

/** Compact uptime: a number a person can read at a glance. */
export function formatUptime(seconds: number | undefined): string {
  if (!seconds || seconds < 1) return '—';
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** A server is worth starting when it is not already up. */
export function canStart(server: McpServerRuntimeInfo): boolean {
  return (
    server.status !== 'RUNNING' && server.status !== 'STARTING' && server.status !== 'INITIALIZING'
  );
}

const chip: React.CSSProperties = {
  padding: '2px 8px',
  borderRadius: '999px',
  fontSize: 'var(--font-size-xs, 12px)',
  background: 'var(--color-surface-3)',
  color: 'var(--color-text-secondary)',
  whiteSpace: 'nowrap'
};

const action: React.CSSProperties = {
  padding: '6px 11px',
  background: 'transparent',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '6px',
  color: 'var(--color-text-secondary)',
  cursor: 'pointer',
  fontSize: '0.8rem'
};

export interface McpServerExplorerViewProps {
  servers: McpServerRuntimeInfo[];
  isLoading: boolean;
  error: string | null;
  pending?: string[];
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onRefresh: (id: string) => void;
  onDelete: (id: string) => void;
  onCreate: (input: McpServerInput) => Promise<void>;
  onCallTool: (
    id: string,
    toolName: string,
    args: Record<string, unknown>
  ) => Promise<McpToolCallResult>;
  /** Which server's drawer is open. Exposed so a render test can reach it. */
  openServerId?: string | null;
  onOpenServer?: (id: string | null) => void;
  /** Starts the view with the create modal open — for tests and deep links. */
  initialCreating?: boolean;
}

/**
 * The registry's presentation, driven entirely by props.
 *
 * Separated from the store-connected container for the same reason as the
 * Decision Explorer: zustand v5 serves its initial state as the server snapshot,
 * so a store-reading component renders empty under `react-dom/server` and could
 * not be tested at all.
 */
export function McpServerExplorerView({
  servers,
  isLoading,
  error,
  pending = [],
  onStart,
  onStop,
  onRestart,
  onRefresh,
  onDelete,
  onCreate,
  onCallTool,
  openServerId = null,
  onOpenServer,
  initialCreating = false
}: McpServerExplorerViewProps) {
  const [creating, setCreating] = useState(initialCreating);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = servers.find(server => server.id === openServerId) || null;

  const submit = async (input: McpServerInput) => {
    setBusy(true);
    setFormError(null);
    try {
      await onCreate(input);
      setCreating(false);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: '16px',
        gap: '14px'
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px'
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-text-primary)' }}>
            MCP Servers
          </h1>
          <p
            style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}
          >
            Tool providers Asterim supervises on this workstation.
          </p>
        </div>
        <button
          onClick={() => {
            setFormError(null);
            setCreating(true);
          }}
          style={{
            padding: '8px 14px',
            background: 'var(--color-accent-primary)',
            border: 'none',
            borderRadius: '6px',
            color: '#042114',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          + New MCP Server
        </button>
      </header>

      {error && (
        <p
          role="alert"
          style={{ margin: 0, color: 'var(--color-state-error)', fontSize: '0.85rem' }}
        >
          {error}
        </p>
      )}

      {isLoading && servers.length === 0 && (
        <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>Loading MCP servers…</p>
      )}

      {!isLoading && servers.length === 0 && (
        <div
          style={{
            border: '1px dashed rgba(255,255,255,0.12)',
            borderRadius: '8px',
            padding: '28px',
            textAlign: 'center',
            color: 'var(--color-text-secondary)'
          }}
        >
          <p style={{ margin: 0 }}>No MCP servers registered yet.</p>
          <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            Add one to give your agents filesystem access, a database, or any other MCP tool.
          </p>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          overflowY: 'auto',
          minHeight: 0
        }}
      >
        {servers.map(server => {
          const tone = statusTone(server.status);
          const isPending = pending.includes(server.id);
          return (
            <article
              key={server.id}
              style={{
                background: 'var(--color-surface-1)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: '8px',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                opacity: isPending ? 0.65 : 1
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '12px',
                  flexWrap: 'wrap'
                }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}
                >
                  <span
                    style={{
                      ...chip,
                      background: tone.background,
                      color: tone.color,
                      fontWeight: 600
                    }}
                  >
                    {tone.label}
                  </span>
                  <button
                    onClick={() => onOpenServer?.(server.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      color: 'var(--color-text-primary)',
                      fontSize: '0.95rem',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    {server.name}
                  </button>
                  <span style={chip}>{server.transport}</span>
                  {server.isGlobal && <span style={chip}>global</span>}
                  {!server.isEnabled && <span style={chip}>disabled</span>}
                </div>

                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {canStart(server) ? (
                    <button style={action} onClick={() => onStart(server.id)} disabled={isPending}>
                      Start
                    </button>
                  ) : (
                    <button style={action} onClick={() => onStop(server.id)} disabled={isPending}>
                      Stop
                    </button>
                  )}
                  <button style={action} onClick={() => onRestart(server.id)} disabled={isPending}>
                    Restart
                  </button>
                  <button
                    style={action}
                    onClick={() => onRefresh(server.id)}
                    disabled={isPending || server.status !== 'RUNNING'}
                  >
                    Refresh
                  </button>
                  <button
                    style={{ ...action, color: 'var(--color-state-error)' }}
                    onClick={() => onDelete(server.id)}
                    disabled={isPending}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={chip}>{server.capabilities?.tools.length ?? 0} tools</span>
                <span style={chip}>PID {server.pid ?? '—'}</span>
                <span style={chip}>up {formatUptime(server.uptimeSeconds)}</span>
                <span
                  style={{
                    fontFamily: 'var(--font-family-mono)',
                    fontSize: 'var(--font-size-xs, 12px)',
                    color: 'var(--color-text-muted)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {server.command} {server.args.join(' ')}
                </span>
              </div>

              {server.lastError && (
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--color-state-error)' }}>
                  {server.lastError}
                </p>
              )}
            </article>
          );
        })}
      </div>

      {creating && (
        <McpServerModal
          onSubmit={submit}
          onClose={() => setCreating(false)}
          error={formError}
          busy={busy}
        />
      )}

      {open && (
        <McpServerDetailDrawer
          server={open}
          onClose={() => onOpenServer?.(null)}
          onCallTool={(toolName, args) => onCallTool(open.id, toolName, args)}
          onRefresh={() => onRefresh(open.id)}
        />
      )}
    </div>
  );
}

/** Store-connected registry. */
export function McpServerExplorer({ workspaceId }: { workspaceId?: string | null }) {
  const servers = useMcpStore(state => state.servers);
  const isLoading = useMcpStore(state => state.isLoading);
  const error = useMcpStore(state => state.error);
  const pending = useMcpStore(state => state.pending);
  const activeServerId = useMcpStore(state => state.activeServerId);

  const loadServers = useMcpStore(state => state.loadServers);
  const startServer = useMcpStore(state => state.startServer);
  const stopServer = useMcpStore(state => state.stopServer);
  const restartServer = useMcpStore(state => state.restartServer);
  const refreshCapabilities = useMcpStore(state => state.refreshCapabilities);
  const deleteServer = useMcpStore(state => state.deleteServer);
  const createServer = useMcpStore(state => state.createServer);
  const callTool = useMcpStore(state => state.callTool);
  const setActiveServer = useMcpStore(state => state.setActiveServer);

  useEffect(() => {
    void loadServers(workspaceId || undefined);
  }, [workspaceId, loadServers]);

  return (
    <McpServerExplorerView
      servers={servers}
      isLoading={isLoading}
      error={error}
      pending={pending}
      onStart={id => void startServer(id).catch(() => undefined)}
      onStop={id => void stopServer(id).catch(() => undefined)}
      onRestart={id => void restartServer(id).catch(() => undefined)}
      onRefresh={id => void refreshCapabilities(id).catch(() => undefined)}
      onDelete={id => void deleteServer(id).catch(() => undefined)}
      onCreate={async input => {
        await createServer(input);
      }}
      onCallTool={callTool}
      openServerId={activeServerId}
      onOpenServer={setActiveServer}
    />
  );
}
