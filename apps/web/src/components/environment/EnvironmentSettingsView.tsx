import React, { useState, useEffect } from 'react';
import type { WorkspaceMember, WorkspaceRole, AuditLogEntry, EnvironmentPreset } from '@asterim/shared';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { IconCheck, IconUser, IconBuilding, IconPlus } from '../icons/Icons';

export const EnvironmentSettingsView: React.FC = () => {
  const { activeWorkspace, workspaces, fetchWorkspaces } = useWorkspaceStore();
  const currentEnv = activeWorkspace || {
    id: 'personal',
    name: 'Personal Environment',
    isPersonal: true,
    preset: 'personal' as EnvironmentPreset,
  };

  const [activeSubTab, setActiveSubTab] = useState<
    'general' | 'members' | 'projects' | 'secrets' | 'mcp' | 'skills' | 'audit' | 'danger'
  >('general');

  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('member');
  const [createdInviteToken, setCreatedInviteToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  // Environment Settings state
  const [envName, setEnvName] = useState(currentEnv.name || 'Personal Environment');
  const [envPreset, setEnvPreset] = useState<EnvironmentPreset>(currentEnv.preset || 'personal');
  const [savedSettings, setSavedSettings] = useState(false);

  const loadData = async () => {
    if (!currentEnv.id) return;
    try {
      const [memRes, audRes, prjRes] = await Promise.all([
        fetch(`/api/v1/workspaces/${currentEnv.id}/members`),
        fetch(`/api/v1/workspaces/${currentEnv.id}/audit-log`),
        fetch(`/api/v1/projects?workspaceId=${currentEnv.id}`),
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
    setEnvName(currentEnv.name);
    setEnvPreset(currentEnv.preset || 'personal');
  }, [currentEnv.id, currentEnv.name, currentEnv.preset]);

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !currentEnv.id) return;
    setLoading(true);

    try {
      const res = await fetch(`/api/v1/workspaces/${currentEnv.id}/invite`, {
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
    if (!currentEnv.id) return;
    await fetch(`/api/v1/workspaces/${currentEnv.id}/members/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    });
    loadData();
  };

  const handleRemoveMember = async (userId: string) => {
    if (!currentEnv.id) return;
    await fetch(`/api/v1/workspaces/${currentEnv.id}/members/${userId}`, {
      method: 'DELETE',
    });
    loadData();
  };

  const handleReassignProject = async (projectId: string, targetEnvId: string) => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/workspace`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: targetEnvId }),
      });
      if (res.ok) {
        loadData();
      }
    } catch (e) {}
  };

  const handleCopyInviteLink = () => {
    if (!createdInviteToken) return;
    const link = `${window.location.origin}/account/join?token=${createdInviteToken}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getBadgeColor = (preset?: EnvironmentPreset) => {
    switch (preset) {
      case 'company':
        return { bg: 'rgba(59, 130, 246, 0.15)', border: 'rgba(59, 130, 246, 0.4)', text: '#60a5fa', bar: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' };
      case 'client':
        return { bg: 'rgba(245, 158, 11, 0.15)', border: 'rgba(245, 158, 11, 0.4)', text: '#fbbf24', bar: 'linear-gradient(135deg, #f59e0b, #d97706)' };
      case 'experimental':
        return { bg: 'rgba(139, 92, 246, 0.15)', border: 'rgba(139, 92, 246, 0.4)', text: '#a78bfa', bar: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' };
      default:
        return { bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.4)', text: '#34d399', bar: 'linear-gradient(135deg, #10b981, #059669)' };
    }
  };

  const badgeStyle = getBadgeColor(envPreset);

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
              width: '42px',
              height: '42px',
              borderRadius: '10px',
              background: badgeStyle.bar,
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '1.2rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
            }}
          >
            {(currentEnv.name || 'P')[0].toUpperCase()}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 800, color: '#ffffff' }}>
                {currentEnv.name}
              </h2>
              <span
                style={{
                  background: badgeStyle.bg,
                  border: `1px solid ${badgeStyle.border}`,
                  color: badgeStyle.text,
                  fontSize: '0.75rem',
                  padding: '2px 10px',
                  borderRadius: '12px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                {envPreset} Environment
              </span>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>
              Isolated Developer Universe • Secrets, MCP Tools & Context Scoped
            </p>
          </div>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '4px',
          padding: '0 1.5rem',
          borderBottom: '1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08))',
          background: 'var(--color-surface-1, #0c111d)',
          overflowX: 'auto',
          whiteSpace: 'nowrap',
        }}
      >
        {[
          { id: 'general', label: 'General & Presets' },
          { id: 'members', label: `Members & Governance (${members.length})` },
          { id: 'projects', label: `Projects & Assignment (${projects.length})` },
          { id: 'secrets', label: 'Secrets & Credentials' },
          { id: 'mcp', label: 'MCP Tools & Servers' },
          { id: 'skills', label: 'Skills & Prompts' },
          { id: 'audit', label: 'Audit Stream' },
          { id: 'danger', label: 'Danger Zone' },
        ].map((tab) => {
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as any)}
              style={{
                padding: '12px 16px',
                background: 'none',
                border: 'none',
                borderBottom: isActive ? '2px solid #10b981' : '2px solid transparent',
                color: isActive ? '#34d399' : '#94a3b8',
                fontWeight: isActive ? 600 : 500,
                fontSize: '0.85rem',
                cursor: 'pointer',
                transition: 'color 0.15s ease',
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Body Content */}
      <div style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
        {activeSubTab === 'general' && (
          <div style={{ maxWidth: '650px' }}>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                Environment Name
              </label>
              <input
                type="text"
                value={envName}
                onChange={(e) => setEnvName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: '#131b2e',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#ffffff',
                  fontSize: '0.95rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ marginBottom: '2rem' }}>
              <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px' }}>
                Environment Preset Type
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {[
                  { id: 'personal', title: 'Personal Environment', desc: '100% offline, solo developer mode with zero network dependencies.' },
                  { id: 'company', title: 'Company Environment', desc: 'Shared team tools, centralized audit stream, and enterprise RBAC.' },
                  { id: 'client', title: 'Client Sandbox', desc: 'Isolated secrets and custom MCP tools for freelance/contract projects.' },
                  { id: 'experimental', title: 'Experimental Sandbox', desc: 'Relaxed execution policies for testing experimental LLM models.' },
                ].map((p) => {
                  const isSel = envPreset === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => setEnvPreset(p.id as EnvironmentPreset)}
                      style={{
                        padding: '12px 14px',
                        borderRadius: '8px',
                        background: isSel ? 'rgba(16, 185, 129, 0.12)' : '#131b2e',
                        border: isSel ? '1px solid #10b981' : '1px solid rgba(255, 255, 255, 0.08)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ color: isSel ? '#34d399' : '#ffffff', fontWeight: 600, fontSize: '0.9rem' }}>{p.title}</div>
                      <div style={{ color: '#94a3b8', fontSize: '0.78rem', marginTop: '4px', lineHeight: 1.4 }}>{p.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {activeSubTab === 'members' && (
          <div style={{ maxWidth: '800px' }}>
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
                  fontSize: '0.9rem',
                  outline: 'none',
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
                  Invitation Link Created:
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {members.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: '0.9rem', padding: '1rem 0' }}>
                  Personal Developer Environment (Solo Developer Mode).
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
              Assign or move projects between Environments to isolate credentials and context.
            </div>
            {projects.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: '0.9rem', padding: '1rem 0' }}>
                No projects assigned to this Environment.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
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
                            background: badgeStyle.bg,
                            color: badgeStyle.text,
                            fontSize: '0.7rem',
                            padding: '2px 8px',
                            borderRadius: '10px',
                            fontWeight: 700,
                          }}
                        >
                          {envPreset}
                        </span>
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '6px', fontFamily: 'var(--font-family-mono)', wordBreak: 'break-all' }}>
                        {p.path}
                      </div>
                    </div>

                    <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(255, 255, 255, 0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <select
                        value={currentEnv.id}
                        onChange={(e) => handleReassignProject(p.id, e.target.value)}
                        style={{
                          padding: '4px 8px',
                          borderRadius: '6px',
                          background: '#090d16',
                          border: '1px solid rgba(255, 255, 255, 0.12)',
                          color: '#cbd5e1',
                          fontSize: '0.78rem',
                        }}
                      >
                        {workspaces.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => {
                          useWorkspaceStore.getState().setProjects(projects);
                        }}
                        style={{
                          background: 'transparent',
                          border: '1px solid rgba(255, 255, 255, 0.12)',
                          color: '#34d399',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '0.78rem',
                          fontWeight: 600,
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

        {activeSubTab === 'secrets' && (
          <div style={{ maxWidth: '700px' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              Environment Secrets are strictly isolated. API keys added here will never leak into other Environments.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[
                { name: 'OPENAI_API_KEY', placeholder: 'sk-proj-...' },
                { name: 'ANTHROPIC_API_KEY', placeholder: 'sk-ant-...' },
                { name: 'ASTERIM_API_KEY', placeholder: 'ast_ak_...' },
              ].map((sec) => (
                <div key={sec.name} style={{ padding: '14px', background: '#131b2e', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <label style={{ display: 'block', color: '#cbd5e1', fontSize: '0.825rem', fontWeight: 600, marginBottom: '6px' }}>{sec.name}</label>
                  <input
                    type="password"
                    placeholder={sec.placeholder}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      background: '#090d16',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      color: '#34d399',
                      fontSize: '0.85rem',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {activeSubTab === 'mcp' && (
          <div style={{ maxWidth: '800px' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              Model Context Protocol (MCP) servers bound to <strong>{currentEnv.name}</strong>.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {[
                { name: 'context', type: 'system', status: 'active' },
                { name: 'notebooks', type: 'system', status: 'active' },
                { name: 'visualization', type: 'system', status: 'active' },
              ].map((mcp) => (
                <div key={mcp.name} style={{ padding: '12px 16px', background: '#131b2e', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ color: '#ffffff', fontWeight: 600, fontSize: '0.9rem' }}>{mcp.name}</span>
                    <span style={{ marginLeft: '10px', color: '#94a3b8', fontSize: '0.75rem', background: 'rgba(255, 255, 255, 0.06)', padding: '2px 8px', borderRadius: '4px' }}>{mcp.type}</span>
                  </div>
                  <span style={{ color: '#34d399', fontSize: '0.8rem', fontWeight: 600 }}>Active</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeSubTab === 'skills' && (
          <div style={{ maxWidth: '800px' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              Agent Skills available in this Environment context (`.agents/skills/`).
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
              {['caveman', 'cavecrew', 'graphify'].map((sk) => (
                <div key={sk} style={{ padding: '12px 14px', background: '#131b2e', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <div style={{ color: '#34d399', fontWeight: 600, fontSize: '0.9rem' }}>/{sk}</div>
                  <div style={{ color: '#94a3b8', fontSize: '0.78rem', marginTop: '4px' }}>Environment Agent Skill</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeSubTab === 'audit' && (
          <div style={{ maxWidth: '900px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {auditLogs.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: '0.9rem', textAlign: 'center', padding: '3rem' }}>
                No audit log events recorded yet for this Environment.
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

        {activeSubTab === 'danger' && (
          <div style={{ maxWidth: '600px' }}>
            <div style={{ padding: '1.5rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '10px' }}>
              <h4 style={{ color: '#ef4444', margin: '0 0 8px 0', fontSize: '1rem', fontWeight: 700 }}>Delete Environment</h4>
              <p style={{ color: '#cbd5e1', fontSize: '0.85rem', margin: '0 0 1rem 0', lineHeight: 1.5 }}>
                Deleting an Environment removes Environment metadata, secrets, and MCP tool bindings. Your local repository files on disk are <strong>never deleted</strong>.
              </p>
              <button
                disabled={currentEnv.isPersonal}
                style={{
                  background: currentEnv.isPersonal ? '#64748b' : '#ef4444',
                  color: '#ffffff',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: currentEnv.isPersonal ? 'not-allowed' : 'pointer',
                }}
              >
                {currentEnv.isPersonal ? 'Personal Environment Cannot Be Deleted' : 'Delete Environment'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
