import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { McpServerRuntimeInfo, McpToolCallResult, McpToolDefinition } from '@asterim/shared';

/**
 * Everything known about one MCP server: what it offers, and what it has said.
 *
 * The Tools tab is not a catalogue for reading — it runs the tool. That is the
 * point of discovery: a developer who can see `read_file` and its schema should
 * be able to answer "does it work?" without leaving the page.
 */

export type McpDrawerTab = 'tools' | 'resources' | 'logs';

/** Pretty-prints a schema, or says plainly that the server did not publish one. */
export function describeSchema(tool: McpToolDefinition): string {
  if (!tool.inputSchema || Object.keys(tool.inputSchema).length === 0) {
    return 'No input schema published.';
  }
  return JSON.stringify(tool.inputSchema, null, 2);
}

/** Flattens a tool answer into text a human can read. */
export function renderToolContent(result: McpToolCallResult | null): string {
  if (!result) return '';
  if (result.content.length === 0) return '(no content returned)';
  return result.content
    .map(part => {
      if (typeof part.text === 'string') return part.text;
      if (part.data) return `[${part.mimeType || part.type}: ${part.data.length} base64 chars]`;
      return `[${part.type}]`;
    })
    .join('\n');
}

const panel: React.CSSProperties = {
  background: 'var(--color-surface-1)',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: '8px',
  padding: '12px'
};

const mono: React.CSSProperties = {
  fontFamily: 'var(--font-family-mono)',
  fontSize: 'var(--font-size-sm, 13.5px)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  margin: 0
};

export interface McpServerDetailDrawerProps {
  server: McpServerRuntimeInfo;
  onClose: () => void;
  onCallTool: (toolName: string, args: Record<string, unknown>) => Promise<McpToolCallResult>;
  onRefresh: () => void;
  /** Initial tab. Exposed so a render test can reach the other panes. */
  initialTab?: McpDrawerTab;
}

export function McpServerDetailDrawer({
  server,
  onClose,
  onCallTool,
  onRefresh,
  initialTab = 'tools'
}: McpServerDetailDrawerProps) {
  const [tab, setTab] = useState<McpDrawerTab>(initialTab);
  const [openTool, setOpenTool] = useState<string | null>(null);
  const [argsText, setArgsText] = useState('{}');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<McpToolCallResult | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  const capabilities = server.capabilities;
  const tools = useMemo(() => capabilities?.tools ?? [], [capabilities]);

  // New stderr should be visible without scrolling, the way a terminal behaves.
  useEffect(() => {
    if (tab === 'logs') logEndRef.current?.scrollIntoView({ block: 'end' });
  }, [tab, server.recentStderrLogs.length]);

  const runTool = async (toolName: string) => {
    setRunning(true);
    setCallError(null);
    setResult(null);
    try {
      const parsed = argsText.trim() ? JSON.parse(argsText) : {};
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('Arguments must be a JSON object.');
      }
      setResult(await onCallTool(toolName, parsed as Record<string, unknown>));
    } catch (err) {
      setCallError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const tabButton = (id: McpDrawerTab, text: string) => (
    <button
      key={id}
      onClick={() => setTab(id)}
      aria-pressed={tab === id}
      style={{
        padding: '8px 14px',
        background: 'transparent',
        border: 'none',
        borderBottom:
          tab === id ? '2px solid var(--color-accent-primary)' : '2px solid transparent',
        color: tab === id ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        fontWeight: tab === id ? 600 : 500,
        cursor: 'pointer'
      }}
    >
      {text}
    </button>
  );

  return (
    <aside
      role="dialog"
      aria-label={`${server.name} details`}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 'min(560px, 100%)',
        background: 'var(--color-surface-2)',
        borderLeft: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
        // Above the workspace chrome (top bar at 100): a slide-over that the
        // app chrome overlaps would hide its own title.
        zIndex: 1100
      }}
    >
      <header
        style={{
          padding: '16px 18px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: '12px'
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--color-text-primary)' }}>
            {server.name}
          </h2>
          <p
            title={`${server.command} ${server.args.join(' ')}`}
            style={{
              margin: '4px 0 0',
              ...mono,
              color: 'var(--color-text-muted)',
              // An argument list can be arbitrarily long — an inline script, a
              // dozen paths. Clamped so the header cannot push the tabs off
              // the drawer; the full command is in the tooltip.
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden'
            }}
          >
            {server.command} {server.args.join(' ')}
          </p>
          {capabilities?.serverInfo && (
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
              {capabilities.serverInfo.name} v{capabilities.serverInfo.version} · protocol{' '}
              {capabilities.protocolVersion}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close details"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-secondary)',
            fontSize: '1.2rem',
            cursor: 'pointer'
          }}
        >
          ×
        </button>
      </header>

      <nav
        style={{
          display: 'flex',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          padding: '0 8px'
        }}
      >
        {tabButton('tools', `Tools (${tools.length})`)}
        {tabButton(
          'resources',
          `Resources & Prompts (${(capabilities?.resources.length ?? 0) + (capabilities?.prompts.length ?? 0)})`
        )}
        {tabButton('logs', `Logs (${server.recentStderrLogs.length})`)}
      </nav>

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}
      >
        {tab === 'tools' && (
          <>
            {tools.length === 0 && (
              <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>
                {server.status === 'RUNNING'
                  ? 'This server published no tools.'
                  : 'Start the server to discover its tools.'}
              </p>
            )}
            {tools.map(tool => (
              <div key={tool.name} style={panel}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                  <div>
                    <div style={{ ...mono, color: 'var(--color-accent-hover)' }}>{tool.name}</div>
                    {tool.description && (
                      <p
                        style={{
                          margin: '4px 0 0',
                          fontSize: '0.85rem',
                          color: 'var(--color-text-secondary)'
                        }}
                      >
                        {tool.description}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setOpenTool(openTool === tool.name ? null : tool.name);
                      setResult(null);
                      setCallError(null);
                    }}
                    style={{
                      alignSelf: 'flex-start',
                      padding: '6px 12px',
                      background: 'var(--color-accent-subtle)',
                      border: '1px solid var(--color-accent-primary)',
                      borderRadius: '6px',
                      color: 'var(--color-accent-hover)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    Try tool
                  </button>
                </div>

                {openTool === tool.name && (
                  <div
                    style={{
                      marginTop: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }}
                  >
                    <details>
                      <summary
                        style={{
                          cursor: 'pointer',
                          color: 'var(--color-text-secondary)',
                          fontSize: '0.8rem'
                        }}
                      >
                        Input schema
                      </summary>
                      <pre style={{ ...mono, color: 'var(--color-text-muted)', marginTop: '6px' }}>
                        {describeSchema(tool)}
                      </pre>
                    </details>

                    <label
                      htmlFor={`args-${tool.name}`}
                      style={{
                        fontSize: 'var(--font-size-xs, 12px)',
                        color: 'var(--color-text-secondary)'
                      }}
                    >
                      Arguments (JSON)
                    </label>
                    <textarea
                      id={`args-${tool.name}`}
                      value={argsText}
                      onChange={event => setArgsText(event.target.value)}
                      style={{
                        ...mono,
                        minHeight: '72px',
                        padding: '8px',
                        background: 'var(--color-surface-0)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '6px',
                        color: 'var(--color-text-primary)'
                      }}
                    />
                    <button
                      onClick={() => runTool(tool.name)}
                      disabled={running || server.status !== 'RUNNING'}
                      style={{
                        alignSelf: 'flex-start',
                        padding: '7px 14px',
                        background: 'var(--color-accent-primary)',
                        border: 'none',
                        borderRadius: '6px',
                        color: '#042114',
                        fontWeight: 600,
                        cursor: running ? 'progress' : 'pointer',
                        opacity: server.status === 'RUNNING' ? 1 : 0.5
                      }}
                    >
                      {running ? 'Running…' : 'Run'}
                    </button>

                    {callError && (
                      <p
                        role="alert"
                        style={{
                          margin: 0,
                          color: 'var(--color-state-error)',
                          fontSize: '0.85rem'
                        }}
                      >
                        {callError}
                      </p>
                    )}

                    {result && (
                      <div
                        style={{
                          ...panel,
                          background: 'var(--color-surface-0)',
                          borderColor: result.isError
                            ? 'var(--color-state-error)'
                            : 'rgba(255,255,255,0.06)'
                        }}
                      >
                        <div
                          style={{
                            fontSize: 'var(--font-size-xs, 12px)',
                            color: result.isError
                              ? 'var(--color-state-error)'
                              : 'var(--color-accent-hover)',
                            marginBottom: '6px'
                          }}
                        >
                          {result.isError ? 'Tool reported an error' : 'Tool result'}
                        </div>
                        <pre style={{ ...mono, color: 'var(--color-text-primary)' }}>
                          {renderToolContent(result)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {tab === 'resources' && (
          <>
            <h3 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
              Resources
            </h3>
            {(capabilities?.resources.length ?? 0) === 0 && (
              <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No resources published.</p>
            )}
            {capabilities?.resources.map(resource => (
              <div key={resource.uri} style={panel}>
                <div style={{ ...mono, color: 'var(--color-text-primary)' }}>{resource.uri}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                  {resource.name}
                  {resource.mimeType ? ` · ${resource.mimeType}` : ''}
                </div>
                {resource.description && (
                  <p
                    style={{
                      margin: '4px 0 0',
                      fontSize: '0.85rem',
                      color: 'var(--color-text-muted)'
                    }}
                  >
                    {resource.description}
                  </p>
                )}
              </div>
            ))}

            <h3
              style={{
                margin: '8px 0 0',
                fontSize: '0.9rem',
                color: 'var(--color-text-secondary)'
              }}
            >
              Prompts
            </h3>
            {(capabilities?.prompts.length ?? 0) === 0 && (
              <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>No prompts published.</p>
            )}
            {capabilities?.prompts.map(prompt => (
              <div key={prompt.name} style={panel}>
                <div style={{ ...mono, color: 'var(--color-text-primary)' }}>{prompt.name}</div>
                {prompt.description && (
                  <p
                    style={{
                      margin: '4px 0 0',
                      fontSize: '0.85rem',
                      color: 'var(--color-text-secondary)'
                    }}
                  >
                    {prompt.description}
                  </p>
                )}
                {(prompt.arguments?.length ?? 0) > 0 && (
                  <p
                    style={{
                      margin: '4px 0 0',
                      fontSize: '0.8rem',
                      color: 'var(--color-text-muted)'
                    }}
                  >
                    Arguments:{' '}
                    {prompt.arguments
                      ?.map(argument => `${argument.name}${argument.required ? '*' : ''}`)
                      .join(', ')}
                  </p>
                )}
              </div>
            ))}
          </>
        )}

        {tab === 'logs' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span
                style={{
                  fontSize: 'var(--font-size-xs, 12px)',
                  color: 'var(--color-text-secondary)'
                }}
              >
                Last {server.recentStderrLogs.length} stderr line(s)
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={onRefresh}
                  style={{
                    padding: '5px 10px',
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '6px',
                    color: 'var(--color-text-secondary)',
                    cursor: 'pointer',
                    fontSize: '0.8rem'
                  }}
                >
                  Refresh
                </button>
                <button
                  onClick={() => navigator.clipboard?.writeText(server.recentStderrLogs.join('\n'))}
                  style={{
                    padding: '5px 10px',
                    background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '6px',
                    color: 'var(--color-text-secondary)',
                    cursor: 'pointer',
                    fontSize: '0.8rem'
                  }}
                >
                  Copy
                </button>
              </div>
            </div>
            <div
              style={{
                ...panel,
                background: 'var(--color-surface-0)',
                maxHeight: '60vh',
                overflowY: 'auto'
              }}
            >
              {server.recentStderrLogs.length === 0 ? (
                <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
                  This server has written nothing to stderr.
                </p>
              ) : (
                server.recentStderrLogs.map((line, index) => (
                  <div
                    key={`${index}-${line.slice(0, 16)}`}
                    style={{ ...mono, color: 'var(--color-text-secondary)' }}
                  >
                    {line}
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
            {server.lastError && (
              <p style={{ margin: 0, color: 'var(--color-state-error)', fontSize: '0.85rem' }}>
                {server.lastError}
              </p>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
