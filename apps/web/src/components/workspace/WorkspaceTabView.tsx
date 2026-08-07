import React, { useState, useEffect } from 'react';
import type { WorkspaceMember, WorkspaceRole, AuditLogEntry } from '@asterim/shared';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { IconCheck, IconUser, IconBuilding, IconPlus } from '../icons/Icons';

export const WorkspaceTabView: React.FC = () => {
  const { activeWorkspace, workspaces } = useWorkspaceStore();
  const currentWs = activeWorkspace || { id: 'personal', name: 'Personal Workspace', isPersonal: true };
  const [activeSubTab, setActiveSubTab] = useState<'members' | 'projects' | 'audit' | 'settings'>('members');
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('member');
  const [createdInviteToken, setCreatedInviteToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    if (!currentWs.id) return;
    try {
      const [memRes, audRes, prjRes] = await Promise.all([
        fetch(`/api/v1/workspaces/${currentWs.id}/members`),
        fetch(`/api/v1/workspaces/${currentWs.id}/audit-log`),
        fetch(`/api/v1/projects?workspaceId=${currentWs.id}`),
      ]);

      if (memRes.ok) {
        const memData = await memRes.json();
        setMembers(memData.members || []);
      }
      if (audRes.ok) {
        const audData = await audRes.json();
        setAuditLogs(audData.auditLogs || []);
      }
      if (prjRes.ok) {
        const prjData = await prjRes.json();
        setProjects(prjData.projects || []);
      }
    } catch (e) {}
  };

  useEffect(() => {
    loadData();
  }, [currentWs.id]);

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !currentWs.id) return;
    setLoading(true);

    try {
      const res = await fetch(`/api/v1/workspaces/${currentWs.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });

      if (res.ok) {
        const data = await res.json();
        setCreatedInviteToken(data.invitation.token);
        setInviteEmail('');
        loadData();
      }
    } catch (e) {
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateRole = async (userId: string, newRole: WorkspaceRole) => {
    if (!currentWs.id) return;
    await fetch(`/api/v1/workspaces/${currentWs.id}/members/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    });
    loadData();
  };

  const handleRemoveMember = async (userId: string) => {
    if (!currentWs.id) return;
    await fetch(`/api/v1/workspaces/${currentWs.id}/members/${userId}`, {
      method: 'DELETE',
    });
    loadData();
  };

  const handleCopyInviteLink = () => {
    if (!createdInviteToken) return;
    const link = `${window.location.origin}/account/join?token=${createdInviteToken}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      style={{
        flex: 1,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg-primary, #080c14)',
        color: 'var(--color-text-primary, #f8fafc)',
        overflow: 'hidden',
      }}
    >
      {/* Header Banner */}
      <div
        style={{
          padding: '1.5rem 2rem',
          borderBottom: '1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08))',
          background: 'var(--color-surface-1, #0c111d)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: currentWs.isPersonal
                ? 'linear-gradient(135deg, #10b981, #059669)'
                : 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '1.1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {(currentWs.name || 'P')[0].toUpperCase()}
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#ffffff' }}>
              {currentWs.name}
            </h2>
            <p style={{ margin: '3px 0 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>
              {currentWs.isPersonal ? 'Personal Developer Workspace (Solo Mode)' : 'Team Workspace & Governance'}
            </p>
          </div>
        </div>
      </div>

      {/* Sub-Tab Navigation Bar */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          padding: '0 2rem',
          borderBottom: '1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08))',
          background: 'var(--color-surface-1, #0c111d)',
        }}
      >
        <button
          onClick={() => setActiveSubTab('members')}
          style={{
            padding: '12px 18px',
            background: 'none',
            border: 'none',
            borderBottom: activeSubTab === 'members' ? '2px solid #10b981' : '2px solid transparent',
            color: activeSubTab === 'members' ? '#34d399' : '#94a3b8',
            fontWeight: activeSubTab === 'members' ? 600 : 500,
            fontSize: '0.9rem',
            cursor: 'pointer',
          }}
        >
          Members & Roles ({members.length})
        </button>
        <button
          onClick={() => setActiveSubTab('projects')}
          style={{
            padding: '12px 18px',
            background: 'none',
            border: 'none',
            borderBottom: activeSubTab === 'projects' ? '2px solid #10b981' : '2px solid transparent',
            color: activeSubTab === 'projects' ? '#34d399' : '#94a3b8',
            fontWeight: activeSubTab === 'projects' ? 600 : 500,
            fontSize: '0.9rem',
            cursor: 'pointer',
          }}
        >
          Shared Projects ({projects.length})
        </button>
        <button
          onClick={() => setActiveSubTab('audit')}
          style={{
            padding: '12px 18px',
            background: 'none',
            border: 'none',
            borderBottom: activeSubTab === 'audit' ? '2px solid #10b981' : '2px solid transparent',
            color: activeSubTab === 'audit' ? '#34d399' : '#94a3b8',
            fontWeight: activeSubTab === 'audit' ? 600 : 500,
            fontSize: '0.9rem',
            cursor: 'pointer',
          }}
        >
          Real-Time Audit Stream
        </button>
        <button
          onClick={() => setActiveSubTab('settings')}
          style={{
            padding: '12px 18px',
            background: 'none',
            border: 'none',
            borderBottom: activeSubTab === 'settings' ? '2px solid #10b981' : '2px solid transparent',
            color: activeSubTab === 'settings' ? '#34d399' : '#94a3b8',
            fontWeight: activeSubTab === 'settings' ? 600 : 500,
            fontSize: '0.9rem',
            cursor: 'pointer',
          }}
        >
          Workspace Settings
        </button>
      </div>

      {/* Main Tab Content */}
      <div style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
        {activeSubTab === 'members' && (
          <div style={{ maxWidth: '800px' }}>
            {/* Invite Teammate Form */}
            <form onSubmit={handleSendInvite} style={{ display: 'flex', gap: '12px', marginBottom: '2rem' }}>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: '#131b2e',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#ffffff',
                  outline: 'none',
                  fontSize: '0.9rem',
                }}
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
                style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: '#131b2e',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#ffffff',
                  fontSize: '0.9rem',
                }}
              >
                <option value="admin">Admin</option>
                <option value="member">Member</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="submit"
                disabled={loading || !inviteEmail.trim()}
                style={{
                  background: '#10b981',
                  border: 'none',
                  color: '#042114',
                  padding: '10px 20px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                }}
              >
                Invite Teammate
              </button>
            </form>

            {createdInviteToken && (
              <div
                style={{
                  padding: '1.25rem',
                  background: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  borderRadius: '10px',
                  marginBottom: '1.5rem',
                }}
              >
                <div style={{ color: '#34d399', fontWeight: 600, fontSize: '0.9rem', marginBottom: '8px' }}>
                  Invitation Link Generated:
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <input
                    readOnly
                    value={`${window.location.origin}/account/join?token=${createdInviteToken}`}
                    style={{
                      flex: 1,
                      background: '#080c14',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      color: '#34d399',
                      fontSize: '0.85rem',
                      fontFamily: 'var(--font-family-mono)',
                    }}
                  />
                  <button
                    onClick={handleCopyInviteLink}
                    style={{
                      background: '#10b981',
                      border: 'none',
                      color: '#042114',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: 'pointer',
                    }}
                  >
                    {copied ? 'Copied!' : 'Copy Link'}
                  </button>
                </div>
              </div>
            )}

            {/* Member Roster List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {members.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: '0.9rem', padding: '1rem 0' }}>
                  Personal Developer Workspace (Solo Developer).
                </div>
              ) : (
                members.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '14px 18px',
                      background: '#131b2e',
                      borderRadius: '10px',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                    }}
                  >
                    <div>
                      <div style={{ color: '#ffffff', fontWeight: 600, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {m.fullName}
                        <span
                          style={{
                            background: m.role === 'owner' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                            color: m.role === 'owner' ? '#34d399' : '#60a5fa',
                            fontSize: '0.75rem',
                            padding: '2px 10px',
                            borderRadius: '12px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                          }}
                        >
                          {m.role}
                        </span>
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: '4px' }}>
                        {m.email}
                      </div>
                    </div>

                    {m.role !== 'owner' && (
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                        <select
                          value={m.role}
                          onChange={(e) => handleUpdateRole(m.userId, e.target.value as WorkspaceRole)}
                          style={{
                            padding: '6px 12px',
                            borderRadius: '6px',
                            background: '#090d16',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            color: '#ffffff',
                            fontSize: '0.85rem',
                          }}
                        >
                          <option value="admin">Admin</option>
                          <option value="member">Member</option>
                          <option value="viewer">Viewer</option>
                        </select>
                        <button
                          onClick={() => handleRemoveMember(m.userId)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#ef4444',
                            fontSize: '0.85rem',
                            cursor: 'pointer',
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {activeSubTab === 'projects' && (
          <div style={{ maxWidth: '1000px' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              Projects linked to <strong>{currentWs.name}</strong>. Moving projects between Environments changes resource and context scoping.
            </div>
            {projects.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: '0.9rem', padding: '1rem 0' }}>
                No projects currently linked to this Environment.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                {projects.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      padding: '16px 18px',
                      background: '#131b2e',
                      borderRadius: '10px',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: '#ffffff', fontWeight: 600, fontSize: '1rem' }}>{p.name}</span>
                        <span
                          style={{
                            background: 'rgba(16, 185, 129, 0.15)',
                            color: '#34d399',
                            fontSize: '0.7rem',
                            padding: '2px 8px',
                            borderRadius: '10px',
                            fontWeight: 700,
                          }}
                        >
                          {currentWs.isPersonal ? 'Personal' : 'Environment'}
                        </span>
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '6px', fontFamily: 'var(--font-family-mono)', wordBreak: 'break-all' }}>
                        {p.path}
                      </div>
                    </div>

                    <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => {
                          useWorkspaceStore.getState().setProjects(projects);
                        }}
                        style={{
                          background: 'transparent',
                          border: '1px solid rgba(255, 255, 255, 0.12)',
                          color: '#cbd5e1',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                        }}
                      >
                        Open Project
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeSubTab === 'audit' && (
          <div style={{ maxWidth: '900px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {auditLogs.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: '0.9rem', textAlign: 'center', padding: '3rem' }}>
                No audit log events recorded yet for this workspace.
              </div>
            ) : (
              auditLogs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    padding: '12px 16px',
                    background: '#131b2e',
                    borderRadius: '8px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '0.85rem',
                  }}
                >
                  <div>
                    <span style={{ color: '#34d399', fontWeight: 600 }}>{log.action}</span> by{' '}
                    <span style={{ color: '#cbd5e1' }}>{log.userEmail}</span>
                  </div>
                  <div style={{ color: '#64748b', fontSize: '0.8rem' }}>
                    {new Date(log.timestamp).toLocaleString()}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeSubTab === 'settings' && (
          <div style={{ maxWidth: '600px' }}>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.9rem', fontWeight: 600, marginBottom: '8px' }}>
                Workspace Name
              </label>
              <input
                type="text"
                defaultValue={currentWs.name}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: '#131b2e',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#ffffff',
                  fontSize: '0.95rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
