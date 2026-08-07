import React, { useState, useEffect } from 'react';
import type { WorkspaceMember, WorkspaceRole, AuditLogEntry } from '@asterim/shared';

interface WorkspaceSettingsModalProps {
  workspace?: any;
  onClose: () => void;
}

export const WorkspaceSettingsModal: React.FC<WorkspaceSettingsModalProps> = ({
  workspace,
  onClose,
}) => {
  const currentWs = workspace || { id: 'personal', name: 'Personal Workspace', isPersonal: true };
  const [activeTab, setActiveTab] = useState<'members' | 'projects' | 'audit' | 'settings'>('members');
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
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '720px',
          maxHeight: '85vh',
          background: '#090d16',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '16px',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.8)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header Bar */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: 'rgba(255, 255, 255, 0.02)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: currentWs.isPersonal
                  ? 'linear-gradient(135deg, #10b981, #059669)'
                  : 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {(currentWs.name || 'P')[0].toUpperCase()}
            </div>
            <div>
              <h3 style={{ margin: 0, color: '#f8fafc', fontSize: '1.1rem', fontWeight: 700 }}>
                {currentWs.name} Settings
              </h3>
              <p style={{ margin: '2px 0 0 0', color: '#94a3b8', fontSize: '0.8rem' }}>
                {currentWs.isPersonal ? 'Personal Developer Space' : 'Team Workspace & Governance'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1.2rem',
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Tab Navigation sub-bar */}
        <div
          style={{
            display: 'flex',
            gap: '6px',
            padding: '0 1.5rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            background: '#0c111d',
          }}
        >
          <button
            onClick={() => setActiveTab('members')}
            style={{
              padding: '10px 14px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'members' ? '2px solid #10b981' : '2px solid transparent',
              color: activeTab === 'members' ? '#34d399' : '#94a3b8',
              fontWeight: activeTab === 'members' ? 600 : 500,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            Members & Roles ({members.length})
          </button>
          <button
            onClick={() => setActiveTab('projects')}
            style={{
              padding: '10px 14px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'projects' ? '2px solid #10b981' : '2px solid transparent',
              color: activeTab === 'projects' ? '#34d399' : '#94a3b8',
              fontWeight: activeTab === 'projects' ? 600 : 500,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            Shared Projects ({projects.length})
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            style={{
              padding: '10px 14px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'audit' ? '2px solid #10b981' : '2px solid transparent',
              color: activeTab === 'audit' ? '#34d399' : '#94a3b8',
              fontWeight: activeTab === 'audit' ? 600 : 500,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            Audit Log Stream
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            style={{
              padding: '10px 14px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === 'settings' ? '2px solid #10b981' : '2px solid transparent',
              color: activeTab === 'settings' ? '#34d399' : '#94a3b8',
              fontWeight: activeTab === 'settings' ? 600 : 500,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            General Settings
          </button>
        </div>

        {/* Content Body */}
        <div style={{ flex: 1, padding: '1.5rem', overflowY: 'auto' }}>
          {activeTab === 'members' && (
            <div>
              {/* Invite teammate form */}
              <form onSubmit={handleSendInvite} style={{ display: 'flex', gap: '10px', marginBottom: '1.5rem' }}>
                <input
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="teammate@company.com"
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: '#131b2e',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#ffffff',
                    outline: 'none',
                    fontSize: '0.85rem',
                  }}
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: '#131b2e',
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
                  type="submit"
                  disabled={loading || !inviteEmail.trim()}
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
                  Invite Teammate
                </button>
              </form>

              {createdInviteToken && (
                <div
                  style={{
                    padding: '1rem',
                    background: 'rgba(16, 185, 129, 0.12)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    borderRadius: '8px',
                    marginBottom: '1.25rem',
                  }}
                >
                  <div style={{ color: '#34d399', fontWeight: 600, fontSize: '0.85rem', marginBottom: '6px' }}>
                    Invite Link Created:
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      readOnly
                      value={`${window.location.origin}/account/join?token=${createdInviteToken}`}
                      style={{
                        flex: 1,
                        background: '#080c14',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        padding: '6px 10px',
                        borderRadius: '4px',
                        color: '#34d399',
                        fontSize: '0.8rem',
                        fontFamily: 'var(--font-family-mono)',
                      }}
                    />
                    <button
                      onClick={handleCopyInviteLink}
                      style={{
                        background: '#10b981',
                        border: 'none',
                        color: '#042114',
                        padding: '6px 12px',
                        borderRadius: '4px',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                      }}
                    >
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}

              {/* Members List */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {members.length === 0 ? (
                  <div style={{ color: '#94a3b8', fontSize: '0.85rem', padding: '1rem 0' }}>
                    Personal Developer Workspace (Solo Member).
                  </div>
                ) : (
                  members.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 14px',
                        background: '#131b2e',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                      }}
                    >
                      <div>
                        <div style={{ color: '#ffffff', fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {m.fullName}
                          <span
                            style={{
                              background: m.role === 'owner' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                              color: m.role === 'owner' ? '#34d399' : '#60a5fa',
                              fontSize: '0.7rem',
                              padding: '2px 8px',
                              borderRadius: '10px',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                            }}
                          >
                            {m.role}
                          </span>
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '2px' }}>
                          {m.email}
                        </div>
                      </div>

                      {m.role !== 'owner' && (
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <select
                            value={m.role}
                            onChange={(e) => handleUpdateRole(m.userId, e.target.value as WorkspaceRole)}
                            style={{
                              padding: '4px 8px',
                              borderRadius: '4px',
                              background: '#090d16',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                              color: '#ffffff',
                              fontSize: '0.8rem',
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
                              fontSize: '0.8rem',
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

          {activeTab === 'projects' && (
            <div>
              {projects.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: '0.85rem', padding: '1rem 0' }}>
                  No shared team projects in this workspace yet.
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                  {projects.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        padding: '12px 14px',
                        background: '#131b2e',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                      }}
                    >
                      <div style={{ color: '#ffffff', fontWeight: 600, fontSize: '0.9rem' }}>{p.name}</div>
                      <div style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '4px', fontFamily: 'var(--font-family-mono)' }}>
                        {p.path}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'audit' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {auditLogs.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: '0.85rem', textAlign: 'center', padding: '2rem' }}>
                  No audit log entries recorded yet for this workspace.
                </div>
              ) : (
                auditLogs.map((log) => (
                  <div
                    key={log.id}
                    style={{
                      padding: '8px 12px',
                      background: '#131b2e',
                      borderRadius: '6px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.8rem',
                    }}
                  >
                    <div>
                      <span style={{ color: '#34d399', fontWeight: 600 }}>{log.action}</span> by{' '}
                      <span style={{ color: '#cbd5e1' }}>{log.userEmail}</span>
                    </div>
                    <div style={{ color: '#64748b' }}>
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'settings' && (
            <div>
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                  Workspace Display Name
                </label>
                <input
                  type="text"
                  defaultValue={currentWs.name}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: '#131b2e',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#ffffff',
                    fontSize: '0.9rem',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
