import React, { useState, useEffect } from 'react';
import type { WorkspaceMember, WorkspaceRole } from '@asterim/shared';
import { UserPlus, Trash2, Check, Copy, RefreshCw } from 'lucide-react';

interface WorkspaceSettingsProps {
  workspaceId: string;
}

export const WorkspaceSettings: React.FC<WorkspaceSettingsProps> = ({ workspaceId }) => {
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<WorkspaceRole>('member');
  const [createdInviteToken, setCreatedInviteToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadData = async () => {
    try {
      const res = await fetch(`/api/v1/workspaces/${workspaceId}/members`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members || []);
      }
    } catch {
      // The request failed; the previously loaded state is left in place.
    }
  };

  // loadData is async: its setMembers call happens in a promise continuation,
  // not synchronously in the effect body. The rule cannot see through the async
  // boundary, and the same loader is re-run by the handlers below.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see the note above
    loadData();
  }, [workspaceId]);

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setLoading(true);

    try {
      const res = await fetch(`/api/v1/workspaces/${workspaceId}/invite`, {
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
    } catch {
      // The request failed; the finally block below clears the pending flag.
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateRole = async (userId: string, newRole: WorkspaceRole) => {
    await fetch(`/api/v1/workspaces/${workspaceId}/members/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    });
    loadData();
  };

  const handleRemoveMember = async (userId: string) => {
    await fetch(`/api/v1/workspaces/${workspaceId}/members/${userId}`, {
      method: 'DELETE',
    });
    loadData();
  };

  const handleCopyInviteLink = () => {
    if (!createdInviteToken) return;
    const link = `${window.location.origin}/account/join?token=${createdInviteToken}`;
    navigator.clipboard.writeText(link);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  return (
    <div style={{ background: '#0f172a', borderRadius: '14px', padding: '2rem', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h3 style={{ color: '#ffffff', fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
            Workspace Members & Roles
          </h3>
          <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '4px 0 0 0' }}>
            Invite teammates and assign RBAC role permissions (`Owner`, `Admin`, `Member`, `Viewer`).
          </p>
        </div>
        <button
          onClick={loadData}
          style={{
            background: 'transparent',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            color: '#cbd5e1',
            padding: '8px 14px',
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontWeight: 500,
            fontSize: '0.85rem',
          }}
        >
          <RefreshCw size={14} /> Refresh Roster
        </button>
      </div>

      {/* Invite Member Form */}
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
            background: '#162032',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            color: '#ffffff',
            outline: 'none',
            fontSize: '0.95rem',
          }}
        />
        <select
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value as WorkspaceRole)}
          style={{
            padding: '10px 14px',
            borderRadius: '8px',
            background: '#162032',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            color: '#ffffff',
            outline: 'none',
            fontSize: '0.95rem',
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
            fontSize: '0.95rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <UserPlus size={16} /> Send Invitation
        </button>
      </form>

      {createdInviteToken && (
        <div
          style={{
            padding: '1.25rem',
            background: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.35)',
            borderRadius: '10px',
            marginBottom: '1.5rem',
          }}
        >
          <div style={{ color: '#34d399', fontWeight: 700, marginBottom: '8px' }}>
            Invitation Link Generated! Share with your teammate:
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <code
              style={{
                flex: 1,
                background: '#080c14',
                padding: '10px 14px',
                borderRadius: '6px',
                color: '#34d399',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.85rem',
                overflowX: 'auto',
              }}
            >
              {`${window.location.origin}/account/join?token=${createdInviteToken}`}
            </code>
            <button
              onClick={handleCopyInviteLink}
              style={{
                background: '#10b981',
                border: 'none',
                color: '#042114',
                padding: '10px 16px',
                borderRadius: '6px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {copiedToken ? <Check size={16} /> : <Copy size={16} />} Copy Link
            </button>
          </div>
        </div>
      )}

      {/* Member Roster List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {members.map((m) => (
          <div
            key={m.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '1.25rem',
              background: '#162032',
              borderRadius: '10px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <div>
              <div style={{ color: '#ffffff', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                {m.fullName}
                <span
                  style={{
                    background: m.role === 'owner' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                    color: m.role === 'owner' ? '#34d399' : '#60a5fa',
                    fontSize: '0.75rem',
                    padding: '2px 10px',
                    borderRadius: '12px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                  }}
                >
                  {m.role}
                </span>
              </div>
              <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: '4px' }}>
                {m.email} • Joined {new Date(m.joinedAt).toLocaleDateString()}
              </div>
            </div>

            {m.role !== 'owner' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <select
                  value={m.role}
                  onChange={(e) => handleUpdateRole(m.userId, e.target.value as WorkspaceRole)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: '6px',
                    background: '#0f172a',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
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
                    padding: '6px',
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
