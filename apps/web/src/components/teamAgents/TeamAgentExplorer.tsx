import React, { useEffect, useState } from 'react';
import type { TeamAgent, TeamThread } from '@asterim/shared';
import { capabilitySummary } from '../../stores/useProfileStore';
import {
  filterTeamAgents,
  systemPromptPreview,
  threadStateTone,
  useTeamAgentStore
} from '../../stores/useTeamAgentStore';
import { CreateTeamAgentModal } from './CreateTeamAgentModal';
import { TeamThreadChat } from './TeamThreadChatView';
import { IconPlus, IconSearch } from '../icons/Icons';

/**
 * The team's shared agents, and the way into their conversations (P8-02).
 *
 * A card per persistent role — "Tech Lead", "Security Reviewer" — with the
 * three things that decide whether it is the one to ask: what it is for, what
 * it has been told to be, and what it is allowed to reach. The system prompt
 * preview is not decoration: the difference between two roles is entirely in
 * that text, and a member choosing between them has nothing else to go on.
 *
 * Threads hang off the card rather than living in a separate list, because a
 * collaborative thread has no meaning apart from the role it is with, and each
 * one carries its own turn state — so a member can see that the Tech Lead is
 * mid-turn on one thread and idle on another without opening either.
 */

const chip: React.CSSProperties = {
  padding: '2px 8px',
  borderRadius: 'var(--radius-full)',
  fontSize: 'var(--font-size-xs, 12px)',
  background: 'var(--color-surface-3)',
  color: 'var(--color-text-secondary)',
  whiteSpace: 'nowrap'
};

/** The one-line capability summary shown on a card. */
export function capabilityPills(agent: TeamAgent): string[] {
  return [
    agent.model || 'Workstation default model',
    `MCP: ${capabilitySummary(agent.enabledMcpServers, 'servers')}`,
    `Skills: ${capabilitySummary(agent.enabledSkills, 'skills')}`
  ];
}

export interface TeamAgentExplorerViewProps {
  agents: TeamAgent[];
  /** Collaborative threads by agent id, for the agents that have been opened. */
  threadsByAgent: Record<string, TeamThread[]>;
  search: string;
  onSearch: (search: string) => void;
  expandedAgentId?: string | null;
  onExpandAgent?: (id: string | null) => void;
  onOpenThread?: (thread: TeamThread) => void;
  onCreateThread?: (agent: TeamAgent) => void;
  onCreateAgent?: () => void;
  onEditAgent?: (agent: TeamAgent) => void;
  onDeleteAgent?: (agent: TeamAgent) => void;
  isLoading?: boolean;
  error?: string | null;
  notice?: string | null;
  /** Absent when no team is selected, which is the one state with no actions. */
  teamId?: string | null;
}

/** The explorer's presentation, driven entirely by props. */
export function TeamAgentExplorerView({
  agents,
  threadsByAgent,
  search,
  onSearch,
  expandedAgentId = null,
  onExpandAgent,
  onOpenThread,
  onCreateThread,
  onCreateAgent,
  onEditAgent,
  onDeleteAgent,
  isLoading = false,
  error = null,
  notice = null,
  teamId = null
}: TeamAgentExplorerViewProps) {
  const visible = filterTeamAgents(agents, search);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        padding: 'var(--spacing-4)',
        gap: 'var(--spacing-3)'
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--color-text-primary)' }}>Team Agents</h1>
          <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
            Persistent shared roles everyone on this team can talk to, one turn at a time.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={chip}>
            {visible.length} of {agents.length}
          </span>
          <button
            onClick={onCreateAgent}
            disabled={!teamId}
            aria-label="New team agent"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-accent-primary)',
              background: teamId ? 'var(--color-accent-subtle)' : 'transparent',
              color: teamId ? 'var(--color-accent-primary)' : 'var(--color-text-muted)',
              cursor: teamId ? 'pointer' : 'not-allowed',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--font-weight-semibold)'
            }}
          >
            <IconPlus size={12} color="currentColor" /> New agent
          </button>
        </div>
      </header>

      <div style={{ position: 'relative', maxWidth: '320px' }}>
        <input
          type="text"
          value={search}
          onChange={event => onSearch(event.target.value)}
          placeholder="Search team agents…"
          aria-label="Search team agents"
          style={{
            width: '100%',
            padding: '7px 10px 7px 28px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-surface-1)',
            border: '1px solid var(--color-border-subtle)',
            color: 'var(--color-text-primary)',
            fontSize: '0.85rem',
            outline: 'none',
            boxSizing: 'border-box'
          }}
        />
        <div style={{ position: 'absolute', left: '9px', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>
          <IconSearch size={12} color="var(--color-text-muted)" />
        </div>
      </div>

      {error && (
        <p role="alert" style={{ margin: 0, color: 'var(--color-state-error)', fontSize: '0.85rem' }}>
          {error}
        </p>
      )}
      {notice && !error && (
        <p aria-live="polite" style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>
          {notice}
        </p>
      )}

      {!teamId && (
        <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>
          Select a team to see the agents it shares.
        </p>
      )}

      {isLoading && agents.length === 0 && (
        <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>Loading team agents…</p>
      )}

      {teamId && !isLoading && agents.length === 0 && (
        <div
          style={{
            border: '1px dashed var(--color-border-default)',
            borderRadius: 'var(--radius-lg)',
            padding: 'var(--spacing-8)',
            textAlign: 'center',
            color: 'var(--color-text-secondary)'
          }}
        >
          <p style={{ margin: 0 }}>This team shares no agents yet.</p>
          <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
            A team agent is a role, not a session: create one and every member talks to the same
            one, into the same transcript.
          </p>
        </div>
      )}

      {agents.length > 0 && visible.length === 0 && (
        <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: '0.85rem' }}>
          No team agent matches this search.
        </p>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 'var(--spacing-3)',
          overflowY: 'auto',
          minHeight: 0,
          alignContent: 'start'
        }}
      >
        {visible.map(agent => {
          const threads = threadsByAgent[agent.id] || [];
          const expanded = expandedAgentId === agent.id;
          return (
            <article
              key={agent.id}
              style={{
                background: 'var(--color-surface-1)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--spacing-3)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <h2
                  style={{
                    margin: 0,
                    fontSize: '0.95rem',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: 'var(--color-text-primary)'
                  }}
                >
                  {agent.name}
                </h2>
                <span
                  style={{
                    ...chip,
                    fontFamily: 'var(--font-family-mono)',
                    background: 'var(--color-accent-subtle)',
                    color: 'var(--color-accent-primary)',
                    fontWeight: 600
                  }}
                >
                  {agent.role}
                </span>
              </div>

              {agent.description && (
                <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                  {agent.description}
                </p>
              )}

              <p
                style={{
                  margin: 0,
                  fontSize: '0.78rem',
                  color: 'var(--color-text-muted)',
                  fontFamily: 'var(--font-family-mono)',
                  lineHeight: 1.5,
                  overflowWrap: 'anywhere'
                }}
              >
                {systemPromptPreview(agent.systemPrompt)}
              </p>

              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {capabilityPills(agent).map(pill => (
                  <span key={pill} style={chip}>
                    {pill}
                  </span>
                ))}
              </div>

              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  onClick={() => onExpandAgent?.(expanded ? null : agent.id)}
                  aria-expanded={expanded}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border-default)',
                    background: expanded ? 'var(--color-surface-2)' : 'transparent',
                    color: 'var(--color-text-secondary)',
                    cursor: 'pointer',
                    fontSize: '0.78rem'
                  }}
                >
                  {threads.length === 1 ? '1 thread' : `${threads.length} threads`}
                </button>
                <button
                  onClick={() => onCreateThread?.(agent)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-accent-primary)',
                    background: 'transparent',
                    color: 'var(--color-accent-primary)',
                    cursor: 'pointer',
                    fontSize: '0.78rem'
                  }}
                >
                  New thread
                </button>
                <span style={{ flex: 1 }} />
                <button
                  onClick={() => onEditAgent?.(agent)}
                  aria-label={`Edit ${agent.name}`}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--color-text-muted)',
                    cursor: 'pointer',
                    fontSize: '0.78rem'
                  }}
                >
                  Edit
                </button>
                <button
                  onClick={() => onDeleteAgent?.(agent)}
                  aria-label={`Delete ${agent.name}`}
                  style={{
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-sm)',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--color-state-error)',
                    cursor: 'pointer',
                    fontSize: '0.78rem'
                  }}
                >
                  Delete
                </button>
              </div>

              {expanded && (
                <ul
                  aria-label={`${agent.name} threads`}
                  style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}
                >
                  {threads.length === 0 ? (
                    <li style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                      No collaborative threads yet.
                    </li>
                  ) : (
                    threads.map(thread => {
                      const tone = threadStateTone(thread.status);
                      return (
                        <li key={thread.id}>
                          <button
                            onClick={() => onOpenThread?.(thread)}
                            style={{
                              width: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '8px',
                              padding: '6px 8px',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--color-border-subtle)',
                              background: 'var(--color-surface-2)',
                              color: 'var(--color-text-primary)',
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                              textAlign: 'left'
                            }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {thread.title}
                            </span>
                            <span style={{ ...chip, background: tone.background, color: tone.color }}>
                              {tone.label}
                            </span>
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Store-connected explorer.
 *
 * Also the host for the open collaborative thread: a thread is entered from a
 * card and left back to it, so keeping both here means the whole subsystem is
 * one view in the workspace shell rather than two that have to agree about
 * which is showing.
 */
export function TeamAgentExplorer({ teamId, projectId }: { teamId?: string | null; projectId?: string | null }) {
  const agents = useTeamAgentStore(state => state.teamAgents);
  const threadsByAgent = useTeamAgentStore(state => state.teamThreads);
  const activeAgentId = useTeamAgentStore(state => state.activeAgentId);
  const activeThread = useTeamAgentStore(state => state.activeThread);
  const isLoading = useTeamAgentStore(state => state.isLoading);
  const error = useTeamAgentStore(state => state.error);
  const notice = useTeamAgentStore(state => state.notice);

  const fetchTeamAgents = useTeamAgentStore(state => state.fetchTeamAgents);
  const fetchTeamAgent = useTeamAgentStore(state => state.fetchTeamAgent);
  const fetchTeamThread = useTeamAgentStore(state => state.fetchTeamThread);
  const createTeamThread = useTeamAgentStore(state => state.createTeamThread);
  const deleteTeamAgent = useTeamAgentStore(state => state.deleteTeamAgent);
  const setActiveAgent = useTeamAgentStore(state => state.setActiveAgent);
  const closeThread = useTeamAgentStore(state => state.closeThread);
  const reset = useTeamAgentStore(state => state.reset);

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<TeamAgent | null>(null);
  const [isComposing, setComposing] = useState(false);

  useEffect(() => {
    // Another team's agents were never fetched, so a team change reloads rather
    // than filters — the same rule the skills library follows for its scan.
    reset();
    if (teamId) void fetchTeamAgents(teamId);
  }, [teamId, fetchTeamAgents, reset]);

  const openAgent = (id: string | null) => {
    setActiveAgent(id);
    if (id) void fetchTeamAgent(id);
  };

  if (activeThread) {
    const agent = agents.find(entry => entry.id === activeThread.teamAgentId) || null;
    return <TeamThreadChat agent={agent} onBack={closeThread} />;
  }

  return (
    <>
      <TeamAgentExplorerView
        agents={agents}
        threadsByAgent={threadsByAgent}
        search={search}
        onSearch={setSearch}
        expandedAgentId={activeAgentId}
        onExpandAgent={openAgent}
        onOpenThread={thread => void fetchTeamThread(thread.id)}
        onCreateThread={agent => {
          void createTeamThread(agent.id, {
            title: `${agent.name} — shared thread`,
            projectId: projectId || undefined
          }).then(thread => {
            if (thread) {
              setActiveAgent(agent.id);
              void fetchTeamThread(thread.id);
            }
          });
        }}
        onCreateAgent={() => {
          setEditing(null);
          setComposing(true);
        }}
        onEditAgent={agent => {
          setEditing(agent);
          setComposing(true);
        }}
        onDeleteAgent={agent => {
          // Confirmed here rather than trusted from the button: deleting a
          // shared role takes every collaborative thread on it — transcripts
          // the rest of the team wrote — with it through the schema's cascade.
          const threads = threadsByAgent[agent.id]?.length ?? 0;
          const detail = threads
            ? ` This also deletes ${threads === 1 ? 'its 1 collaborative thread' : `its ${threads} collaborative threads`} and their transcripts.`
            : '';
          if (!window.confirm(`Delete ${agent.name} for the whole team?${detail}`)) return;
          void deleteTeamAgent(agent.id);
        }}
        isLoading={isLoading}
        error={error}
        notice={notice}
        teamId={teamId || null}
      />
      {isComposing && teamId && (
        <CreateTeamAgentModal
          teamId={teamId}
          editingAgent={editing}
          onClose={() => {
            setComposing(false);
            setEditing(null);
          }}
        />
      )}
    </>
  );
}
