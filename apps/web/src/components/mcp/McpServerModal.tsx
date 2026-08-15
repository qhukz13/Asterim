import React, { useState } from 'react';
import type { McpServerInput, McpServerRuntimeInfo, McpTransport } from '@asterim/shared';

/**
 * Create or edit an MCP server configuration.
 *
 * The command and its arguments are entered separately rather than as one
 * shell-looking string: the Core spawns without a shell, so `--root "/my dir"`
 * is one argument and pretending otherwise would produce a server that silently
 * never starts.
 */

/** Splits the argument box into one argument per line, blank lines dropped. */
export function parseArgsText(text: string): string[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

export function argsToText(args: string[] | undefined): string {
  return (args || []).join('\n');
}

/**
 * Reads `KEY=value` lines into an environment map.
 *
 * Everything after the first `=` is the value, so a token containing `=` — which
 * base64 and JWTs routinely do — survives.
 */
export function parseEnvText(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (!key) continue;
    env[key] = line.slice(separator + 1).trim();
  }
  return env;
}

export function envToText(env: Record<string, string> | undefined): string {
  return Object.entries(env || {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

const field: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--color-surface-1)',
  border: '1px solid var(--color-border-subtle, rgba(255,255,255,0.08))',
  borderRadius: '6px',
  color: 'var(--color-text-primary)',
  fontSize: 'var(--font-size-sm, 13.5px)',
  fontFamily: 'var(--font-family-mono)'
};

const label: React.CSSProperties = {
  display: 'block',
  fontSize: 'var(--font-size-xs, 12px)',
  color: 'var(--color-text-secondary)',
  marginBottom: '4px',
  fontWeight: 600
};

export interface McpServerModalProps {
  /** The server being edited, or null when creating one. */
  server?: McpServerRuntimeInfo | null;
  /** Scopes a newly created server; omitted for a workstation-wide one. */
  workspaceId?: string | null;
  onSubmit: (input: McpServerInput) => Promise<void> | void;
  onClose: () => void;
  /** Surfaced from the caller so a failed save keeps the form open. */
  error?: string | null;
  busy?: boolean;
}

export function McpServerModal({
  server = null,
  workspaceId = null,
  onSubmit,
  onClose,
  error = null,
  busy = false
}: McpServerModalProps) {
  const [name, setName] = useState(server?.name ?? '');
  const [transport, setTransport] = useState<McpTransport>(server?.transport ?? 'stdio');
  const [command, setCommand] = useState(server?.command ?? '');
  const [argsText, setArgsText] = useState(argsToText(server?.args));
  const [envText, setEnvText] = useState(envToText(server?.env));
  const [isGlobal, setIsGlobal] = useState(server?.isGlobal ?? false);
  const [isEnabled, setIsEnabled] = useState(server?.isEnabled ?? true);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onSubmit({
      name: name.trim(),
      transport,
      command: command.trim(),
      args: parseArgsText(argsText),
      env: parseEnvText(envText),
      isGlobal,
      isEnabled,
      workspaceId: isGlobal ? null : (server?.workspaceId ?? workspaceId ?? null)
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={server ? 'Edit MCP server' : 'New MCP server'}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1200,
        padding: '24px'
      }}
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={event => event.stopPropagation()}
        style={{
          width: 'min(560px, 100%)',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'var(--color-surface-3)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: '10px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px'
        }}
      >
        <h2 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--color-text-primary)' }}>
          {server ? `Edit ${server.name}` : 'New MCP Server'}
        </h2>

        <div>
          <label style={label} htmlFor="mcp-name">
            Name
          </label>
          <input
            id="mcp-name"
            style={field}
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder="filesystem"
            required
          />
        </div>

        <div>
          <label style={label} htmlFor="mcp-transport">
            Transport
          </label>
          <select
            id="mcp-transport"
            style={{ ...field, fontFamily: 'var(--font-family-sans)' }}
            value={transport}
            onChange={event => setTransport(event.target.value as McpTransport)}
          >
            <option value="stdio">stdio (supervised child process)</option>
            <option value="sse">sse (not yet supervised)</option>
          </select>
        </div>

        <div>
          <label style={label} htmlFor="mcp-command">
            Command
          </label>
          <input
            id="mcp-command"
            style={field}
            value={command}
            onChange={event => setCommand(event.target.value)}
            placeholder="npx"
            required
          />
        </div>

        <div>
          <label style={label} htmlFor="mcp-args">
            Arguments — one per line
          </label>
          <textarea
            id="mcp-args"
            style={{ ...field, minHeight: '76px', resize: 'vertical' }}
            value={argsText}
            onChange={event => setArgsText(event.target.value)}
            placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/home/dev/projects'}
          />
        </div>

        <div>
          <label style={label} htmlFor="mcp-env">
            Environment — KEY=value, one per line
          </label>
          <textarea
            id="mcp-env"
            style={{ ...field, minHeight: '64px', resize: 'vertical' }}
            value={envText}
            onChange={event => setEnvText(event.target.value)}
            placeholder={'GITHUB_TOKEN=ghp_...'}
          />
          <p
            style={{
              margin: '6px 0 0',
              fontSize: 'var(--font-size-xs, 12px)',
              color: 'var(--color-text-muted)'
            }}
          >
            Asterim never passes its own credentials to a server. Anything this server needs must be
            named here.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap' }}>
          <label
            style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              color: 'var(--color-text-secondary)'
            }}
          >
            <input
              type="checkbox"
              checked={isGlobal}
              onChange={event => setIsGlobal(event.target.checked)}
            />
            Available in every workspace
          </label>
          <label
            style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              color: 'var(--color-text-secondary)'
            }}
          >
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={event => setIsEnabled(event.target.checked)}
            />
            Start with Asterim
          </label>
        </div>

        {error && (
          <p
            role="alert"
            style={{ margin: 0, color: 'var(--color-state-error)', fontSize: '0.85rem' }}
          >
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 14px',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '6px',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            style={{
              padding: '8px 16px',
              background: 'var(--color-accent-primary)',
              border: 'none',
              borderRadius: '6px',
              color: '#042114',
              fontWeight: 600,
              cursor: busy ? 'progress' : 'pointer',
              opacity: busy ? 0.7 : 1
            }}
          >
            {server ? 'Save changes' : 'Add server'}
          </button>
        </div>
      </form>
    </div>
  );
}
