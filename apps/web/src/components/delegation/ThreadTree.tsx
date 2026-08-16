import React from 'react';
import type { DelegationChildState, DelegationParentState } from '@asterim/shared';
import {
  ThreadStatusDescriptor,
  ThreadTreeNode,
  threadStatusTone
} from '../../stores/useProjectStore';
import { IconBot, IconChevronDown, IconChevronRight } from '../icons/Icons';

/**
 * The thread list drawn as the hierarchy it actually is (P7-02).
 *
 * Delegation makes a thread list a tree: a child is a real thread with its own
 * transcript, and its only visible relationship to its parent is the row it
 * hangs from. So the sidebar indents, draws a connector, and says three things
 * per row that a flat list could not — which role is running it, how deep it
 * sits, and whether it is working, parked, done or broken.
 *
 * Props-only, like the profiles and MCP views: zustand v5 serves initial state
 * as the server snapshot, so a store-reading component renders empty under
 * `react-dom/server` and could not be asserted on at all.
 */

/** How far one level of nesting shifts a row. */
const INDENT_PX = 14;

export interface ThreadTreeViewProps {
  nodes: ThreadTreeNode[];
  activeThreadId: string | null;
  parentStates: Record<string, DelegationParentState>;
  childStates: Record<string, DelegationChildState>;
  /** Thread ids whose children are hidden. */
  collapsed: Record<string, boolean>;
  onSelect: (threadId: string) => void;
  onToggleCollapse: (threadId: string) => void;
  /**
   * Stops a child that is still running (P7-03). Offered on the row rather than
   * only on the parent's banner because the runaway child is the thing the
   * operator is looking at when they decide to stop it — and a parent parked
   * behind a deeper chain is not the row that is pulsing.
   */
  onCancelChild?: (threadId: string) => void;
  /** Child thread ids with a cancellation already in flight. */
  cancellingThreads?: Record<string, boolean>;
}

/** Whether this row is a delegated child that has not finished. */
export function isCancellableChild(
  node: ThreadTreeNode,
  childStates: Record<string, DelegationChildState>
): boolean {
  if (node.depth === 0 || !node.context) return false;
  const live = childStates[node.thread.id];
  if (live) return live === 'STARTING' || live === 'ACTIVE';
  // No live state means nothing has been said since the row was served, so the
  // row is what decides — and a child row with no recorded status is running.
  return !node.context.status;
}

function StatusDot({ status }: { status: ThreadStatusDescriptor }) {
  if (status.tone === 'idle') return null;
  return (
    <span
      className={status.tone === 'running' || status.tone === 'waiting' ? 'delegation-pulse' : undefined}
      title={status.label}
      aria-label={status.label}
      style={{
        width: '7px',
        height: '7px',
        borderRadius: '50%',
        background: status.color,
        flexShrink: 0
      }}
    />
  );
}

function Badge({ children, color, background }: { children: React.ReactNode; color: string; background: string }) {
  return (
    <span
      style={{
        padding: '0 5px',
        borderRadius: 'var(--radius-full, 999px)',
        fontSize: '10px',
        fontWeight: 600,
        lineHeight: '15px',
        color,
        background,
        whiteSpace: 'nowrap',
        flexShrink: 0,
        fontFamily: 'var(--font-family-mono)'
      }}
    >
      {children}
    </span>
  );
}

function ThreadTreeRow({
  node,
  activeThreadId,
  parentStates,
  childStates,
  collapsed,
  onSelect,
  onToggleCollapse,
  onCancelChild,
  cancellingThreads
}: ThreadTreeViewProps & { node: ThreadTreeNode }) {
  const thread = node.thread;
  const isActive = activeThreadId === thread.id;
  const isCollapsed = !!collapsed[thread.id];
  const hasChildren = node.children.length > 0;
  const status = threadStatusTone(node, { parentStates, childStates });
  const role = node.context?.role;
  const isCancelling = !!cancellingThreads?.[thread.id];
  const canCancel = !!onCancelChild && isCancellableChild(node, childStates);

  return (
    <div>
      <div
        onClick={() => onSelect(thread.id)}
        role="button"
        tabIndex={0}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onSelect(thread.id);
          }
        }}
        title={node.context?.taskDescription || thread.name}
        style={{
          padding: 'var(--spacing-2) var(--spacing-3)',
          marginLeft: `${node.depth * INDENT_PX}px`,
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer',
          fontSize: '14px',
          lineHeight: '1.4',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-1)',
          background: isActive ? 'var(--color-surface-2)' : 'transparent',
          color: isActive ? 'var(--color-accent-hover)' : 'var(--color-text-primary)',
          border: `1px solid ${isActive ? 'var(--color-border-default)' : 'transparent'}`,
          borderLeft:
            node.depth > 0
              ? '2px solid var(--color-border-subtle)'
              : isActive
                ? '2px solid var(--color-accent-primary)'
                : '1px solid transparent',
          transition: 'background 0.15s, color 0.15s'
        }}
        onMouseOver={event => {
          if (!isActive) event.currentTarget.style.background = 'var(--color-surface-1)';
        }}
        onMouseOut={event => {
          if (!isActive) event.currentTarget.style.background = 'transparent';
        }}
      >
        {hasChildren ? (
          <button
            onClick={event => {
              event.stopPropagation();
              onToggleCollapse(thread.id);
            }}
            aria-label={isCollapsed ? `Expand ${thread.name}` : `Collapse ${thread.name}`}
            aria-expanded={!isCollapsed}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '14px',
              height: '14px',
              padding: 0,
              flexShrink: 0,
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-muted)',
              cursor: 'pointer'
            }}
          >
            {isCollapsed ? <IconChevronRight size={11} /> : <IconChevronDown size={11} />}
          </button>
        ) : (
          <span style={{ width: '14px', flexShrink: 0 }} />
        )}

        <IconBot
          size={14}
          style={{
            opacity: isActive ? 1 : 0.6,
            flexShrink: 0,
            color: isActive ? 'var(--color-accent-primary)' : 'currentColor'
          }}
        />

        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
          {thread.name}
        </div>

        {role && (
          <Badge color="var(--color-text-secondary)" background="rgba(148, 163, 184, 0.12)">
            {role}
          </Badge>
        )}
        {node.depth > 0 && (
          <Badge color="var(--color-accent-hover)" background="var(--color-accent-subtle)">
            L{node.depth}
          </Badge>
        )}
        {canCancel && (
          <button
            onClick={event => {
              event.stopPropagation();
              onCancelChild?.(thread.id);
            }}
            disabled={isCancelling}
            aria-label={`Stop ${thread.name}`}
            title="Stop this delegated agent and release the thread waiting on it"
            style={{
              padding: '0 5px',
              borderRadius: 'var(--radius-full, 999px)',
              fontSize: '10px',
              fontWeight: 600,
              lineHeight: '15px',
              flexShrink: 0,
              fontFamily: 'var(--font-family-mono)',
              background: 'transparent',
              border: '1px solid var(--color-state-error)',
              color: 'var(--color-state-error)',
              cursor: isCancelling ? 'default' : 'pointer',
              opacity: isCancelling ? 0.6 : 1
            }}
          >
            {isCancelling ? '…' : 'Stop'}
          </button>
        )}
        <StatusDot status={status} />
      </div>

      {hasChildren && !isCollapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-1)', marginTop: 'var(--spacing-1)' }}>
          {node.children.map(child => (
            <ThreadTreeRow
              key={child.thread.id}
              node={child}
              nodes={node.children}
              activeThreadId={activeThreadId}
              parentStates={parentStates}
              childStates={childStates}
              collapsed={collapsed}
              onSelect={onSelect}
              onToggleCollapse={onToggleCollapse}
              onCancelChild={onCancelChild}
              cancellingThreads={cancellingThreads}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ThreadTreeView(props: ThreadTreeViewProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-2)' }}>
      {props.nodes.map(node => (
        <ThreadTreeRow key={node.thread.id} node={node} {...props} />
      ))}
    </div>
  );
}
