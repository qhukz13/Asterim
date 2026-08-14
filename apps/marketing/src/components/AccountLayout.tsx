import React, { useState, useEffect } from 'react';
import {
  User,
  Shield,
  Smartphone,
  Key,
  CreditCard,
  LogOut,
  Check,
  Trash2,
  Plus,
  Copy,
  Laptop,
  RefreshCw,
  Zap,
  ChevronRight,
  Users,
} from 'lucide-react';
import { WorkspaceSettings } from './WorkspaceSettings';

type AccountTab = 'overview' | 'members' | 'sessions' | 'devices' | 'apikeys' | 'billing';

interface AccountLayoutProps {
  user: any;
  currentSubPath: string;
  navigate: (path: string) => void;
  onLogout: () => void;
}

export const AccountLayout: React.FC<AccountLayoutProps> = ({
  user,
  currentSubPath,
  navigate,
  onLogout,
}) => {
  // The account tabs are addressable URLs, so the visible tab is derived from
  // the path on every render rather than mirrored into state.
  const activeTab: AccountTab = currentSubPath.includes('/members')
    ? 'members'
    : currentSubPath.includes('/sessions')
      ? 'sessions'
      : currentSubPath.includes('/devices')
        ? 'devices'
        : currentSubPath.includes('/apikeys')
          ? 'apikeys'
          : currentSubPath.includes('/billing')
            ? 'billing'
            : 'overview';
  const [sessions, setSessions] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [loading, setLoading] = useState(false);

  // Fetch Sessions
  const loadSessions = async () => {
    try {
      const res = await fetch('/api/v1/sessions');
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
    } catch {
      // The request failed; the previously loaded state is left in place.
    }
  };

  // Fetch Devices
  const loadDevices = async () => {
    try {
      const res = await fetch('/api/v1/devices');
      if (res.ok) {
        const data = await res.json();
        setDevices(data.devices || []);
      }
    } catch {
      // The request failed; the previously loaded state is left in place.
    }
  };

  // Fetch API Keys
  const loadApiKeys = async () => {
    try {
      const res = await fetch('/api/v1/apikeys');
      if (res.ok) {
        const data = await res.json();
        setApiKeys(data.apiKeys || []);
      }
    } catch {
      // The request failed; the previously loaded state is left in place.
    }
  };

  // The loaders are async: every setState they run happens in a promise
  // continuation, not synchronously in the effect body. The rule cannot see
  // through the async boundary, and restructuring the fetches into the effect
  // would duplicate them, since the same loaders are re-run by the handlers below.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see the note above
    if (activeTab === 'sessions') loadSessions();
    if (activeTab === 'devices') loadDevices();
    if (activeTab === 'apikeys') loadApiKeys();
    if (activeTab === 'overview') {
      loadSessions();
      loadDevices();
      loadApiKeys();
    }
  }, [activeTab]);

  const handleRevokeSession = async (sessionId: string) => {
    await fetch('/api/v1/sessions/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    loadSessions();
  };

  const handleRevokeDevice = async (deviceId: string) => {
    await fetch('/api/v1/devices/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId }),
    });
    loadDevices();
  };

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/v1/apikeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyName: newKeyName.trim(), scopes: ['read', 'write'] }),
      });
      if (res.ok) {
        const data = await res.json();
        setCreatedRawKey(data.rawSecretKey);
        setNewKeyName('');
        loadApiKeys();
      }
    } catch {
      // The request failed; the finally block below clears the pending flag.
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteApiKey = async (id: string) => {
    await fetch(`/api/v1/apikeys/${id}`, { method: 'DELETE' });
    loadApiKeys();
  };

  const handleCopyRawKey = () => {
    if (!createdRawKey) return;
    navigator.clipboard.writeText(createdRawKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const userInitial = (user?.fullName || user?.email || 'U')[0].toUpperCase();

  return (
    <div style={{ maxWidth: '1240px', margin: '0 auto', padding: '2rem 1.5rem', width: '100%' }}>
      {/* SaaS Top Header Section */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: '1.5rem',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: '#94a3b8',
              fontSize: '0.85rem',
              marginBottom: '4px',
            }}
          >
            <span>Asterim Portal</span>
            <ChevronRight size={14} />
            <span style={{ color: '#34d399', fontWeight: 600 }}>
              {activeTab === 'overview' && 'Account Overview'}
              {activeTab === 'sessions' && 'Active Sessions'}
              {activeTab === 'devices' && 'Trusted Devices'}
              {activeTab === 'apikeys' && 'API Keys'}
              {activeTab === 'billing' && 'Subscription & Billing'}
            </span>
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#ffffff', margin: 0 }}>
            {user?.fullName || 'Personal Workspace'}
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '6px 14px',
              borderRadius: '20px',
              background: '#0f172a',
              border: '1px solid rgba(16, 185, 129, 0.25)',
            }}
          >
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #10b981, #059669)',
                color: '#042114',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.85rem',
              }}
            >
              {userInitial}
            </div>
            <div>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc' }}>
                {user?.email || 'developer@asterim.dev'}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#34d399', fontWeight: 500 }}>
                Free Plan • Personal
              </div>
            </div>
          </div>

          <button
            onClick={onLogout}
            style={{
              background: 'transparent',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              padding: '8px 14px',
              borderRadius: '8px',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <LogOut size={15} /> Sign Out
          </button>
        </div>
      </div>

      {/* SaaS Horizontal Navigation Bar */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          marginBottom: '2rem',
          overflowX: 'auto',
        }}
      >
        <button
          onClick={() => {
            navigate('/account/dashboard');
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 18px',
            background: 'none',
            border: 'none',
            borderBottom:
              activeTab === 'overview' ? '2px solid #10b981' : '2px solid transparent',
            color: activeTab === 'overview' ? '#34d399' : '#94a3b8',
            fontWeight: activeTab === 'overview' ? 600 : 500,
            fontSize: '0.95rem',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <User size={16} /> Overview
        </button>

        <button
          onClick={() => {
            navigate('/account/members');
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 18px',
            background: 'none',
            border: 'none',
            borderBottom:
              activeTab === 'members' ? '2px solid #10b981' : '2px solid transparent',
            color: activeTab === 'members' ? '#34d399' : '#94a3b8',
            fontWeight: activeTab === 'members' ? 600 : 500,
            fontSize: '0.95rem',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <Users size={16} /> Members & Roles
        </button>

        <button
          onClick={() => {
            navigate('/account/sessions');
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 18px',
            background: 'none',
            border: 'none',
            borderBottom:
              activeTab === 'sessions' ? '2px solid #10b981' : '2px solid transparent',
            color: activeTab === 'sessions' ? '#34d399' : '#94a3b8',
            fontWeight: activeTab === 'sessions' ? 600 : 500,
            fontSize: '0.95rem',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <Shield size={16} /> Active Sessions
        </button>

        <button
          onClick={() => {
            navigate('/account/devices');
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 18px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'devices' ? '2px solid #10b981' : '2px solid transparent',
            color: activeTab === 'devices' ? '#34d399' : '#94a3b8',
            fontWeight: activeTab === 'devices' ? 600 : 500,
            fontSize: '0.95rem',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <Smartphone size={16} /> Trusted Devices
        </button>

        <button
          onClick={() => {
            navigate('/account/apikeys');
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 18px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'apikeys' ? '2px solid #10b981' : '2px solid transparent',
            color: activeTab === 'apikeys' ? '#34d399' : '#94a3b8',
            fontWeight: activeTab === 'apikeys' ? 600 : 500,
            fontSize: '0.95rem',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <Key size={16} /> API Keys
        </button>

        <button
          onClick={() => {
            navigate('/account/billing');
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 18px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'billing' ? '2px solid #10b981' : '2px solid transparent',
            color: activeTab === 'billing' ? '#34d399' : '#94a3b8',
            fontWeight: activeTab === 'billing' ? 600 : 500,
            fontSize: '0.95rem',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <CreditCard size={16} /> Subscription & Billing
        </button>
      </div>

      {/* Main SaaS Dashboard Content */}
      <div>
        {activeTab === 'overview' && (
          <div>
            {/* Stat Cards Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                gap: '1.25rem',
                marginBottom: '2rem',
              }}
            >
              <div
                style={{
                  padding: '1.5rem',
                  background: '#0f172a',
                  borderRadius: '14px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <div
                  style={{
                    color: '#94a3b8',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Zap size={15} style={{ color: '#10b981' }} /> Current Plan
                </div>
                <div
                  style={{
                    color: '#ffffff',
                    fontSize: '1.4rem',
                    fontWeight: 800,
                    marginTop: '8px',
                  }}
                >
                  Free Community
                </div>
                <div style={{ color: '#34d399', fontSize: '0.8rem', marginTop: '4px' }}>
                  Local Execution & Adapters
                </div>
              </div>

              <div
                style={{
                  padding: '1.5rem',
                  background: '#0f172a',
                  borderRadius: '14px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <div
                  style={{
                    color: '#94a3b8',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Shield size={15} style={{ color: '#10b981' }} /> Active Sessions
                </div>
                <div
                  style={{
                    color: '#ffffff',
                    fontSize: '1.4rem',
                    fontWeight: 800,
                    marginTop: '8px',
                  }}
                >
                  {sessions.length || 1} Sessions
                </div>
                <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '4px' }}>
                  Secured via JWT & Rotation
                </div>
              </div>

              <div
                style={{
                  padding: '1.5rem',
                  background: '#0f172a',
                  borderRadius: '14px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <div
                  style={{
                    color: '#94a3b8',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <Smartphone size={15} style={{ color: '#10b981' }} /> Trusted Devices
                </div>
                <div
                  style={{
                    color: '#ffffff',
                    fontSize: '1.4rem',
                    fontWeight: 800,
                    marginTop: '8px',
                  }}
                >
                  {devices.length || 1} Devices
                </div>
                <div style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: '4px' }}>
                  Hardware Fingerprint Registered
                </div>
              </div>
            </div>

            {/* Profile Overview Section */}
            <div
              style={{
                background: '#0f172a',
                borderRadius: '14px',
                padding: '2rem',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <h3
                style={{
                  color: '#ffffff',
                  fontSize: '1.15rem',
                  fontWeight: 700,
                  margin: '0 0 1.25rem 0',
                }}
              >
                Account Information
              </h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                  gap: '1.25rem',
                }}
              >
                <div>
                  <div style={{ color: '#64748b', fontSize: '0.8rem', fontWeight: 600 }}>
                    USER ID
                  </div>
                  <code
                    style={{
                      display: 'block',
                      background: '#080c14',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      color: '#34d399',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.9rem',
                      marginTop: '4px',
                    }}
                  >
                    {user?.id}
                  </code>
                </div>
                <div>
                  <div style={{ color: '#64748b', fontSize: '0.8rem', fontWeight: 600 }}>
                    EMAIL ADDRESS
                  </div>
                  <div
                    style={{
                      color: '#f8fafc',
                      fontSize: '0.95rem',
                      fontWeight: 500,
                      marginTop: '4px',
                    }}
                  >
                    {user?.email}
                  </div>
                </div>
                <div>
                  <div style={{ color: '#64748b', fontSize: '0.8rem', fontWeight: 600 }}>
                    FULL NAME
                  </div>
                  <div
                    style={{
                      color: '#f8fafc',
                      fontSize: '0.95rem',
                      fontWeight: 500,
                      marginTop: '4px',
                    }}
                  >
                    {user?.fullName || 'Developer'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'members' && <WorkspaceSettings workspaceId="personal" />}

        {activeTab === 'sessions' && (
          <div
            style={{
              background: '#0f172a',
              borderRadius: '14px',
              padding: '2rem',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1.5rem',
              }}
            >
              <div>
                <h3 style={{ color: '#ffffff', fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
                  Active User Sessions
                </h3>
                <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '4px 0 0 0' }}>
                  Manage connected web browsers, desktop apps, and remote CLI sessions.
                </p>
              </div>
              <button
                onClick={loadSessions}
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

            {sessions.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                <Laptop size={32} style={{ color: '#10b981', marginBottom: '8px' }} />
                <div>Fetching active sessions...</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {sessions.map((s) => (
                  <div
                    key={s.id}
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
                      <div
                        style={{
                          color: '#ffffff',
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <Laptop size={18} style={{ color: '#10b981' }} />
                        {s.deviceName} ({s.clientType.toUpperCase()})
                        {s.isCurrentSession && (
                          <span
                            style={{
                              background: 'rgba(16, 185, 129, 0.15)',
                              color: '#34d399',
                              fontSize: '0.75rem',
                              padding: '2px 10px',
                              borderRadius: '12px',
                              fontWeight: 600,
                            }}
                          >
                            Current Session
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          color: '#94a3b8',
                          fontSize: '0.85rem',
                          marginTop: '6px',
                          display: 'flex',
                          gap: '12px',
                        }}
                      >
                        <span>
                          IP: <code style={{ color: '#34d399' }}>{s.ipAddress || '127.0.0.1'}</code>
                        </span>
                        <span>•</span>
                        <span>Last Active: {new Date(s.lastActiveAt).toLocaleString()}</span>
                      </div>
                    </div>

                    {!s.isCurrentSession && (
                      <button
                        onClick={() => handleRevokeSession(s.id)}
                        style={{
                          background: 'rgba(239, 68, 68, 0.15)',
                          border: '1px solid rgba(239, 68, 68, 0.3)',
                          color: '#f87171',
                          padding: '6px 14px',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontWeight: 600,
                          fontSize: '0.85rem',
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'devices' && (
          <div
            style={{
              background: '#0f172a',
              borderRadius: '14px',
              padding: '2rem',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1.5rem',
              }}
            >
              <div>
                <h3 style={{ color: '#ffffff', fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
                  Registered Trusted Devices
                </h3>
                <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '4px 0 0 0' }}>
                  Hardware devices registered via Asterim Desktop auto-login.
                </p>
              </div>
              <button
                onClick={loadDevices}
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

            {devices.length === 0 ? (
              <div
                style={{
                  padding: '3rem',
                  textAlign: 'center',
                  background: '#162032',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <Smartphone size={36} style={{ color: '#10b981', marginBottom: '12px' }} />
                <h4 style={{ color: '#ffffff', margin: '0 0 6px 0', fontSize: '1.05rem' }}>
                  No External Devices Registered Yet
                </h4>
                <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: 0 }}>
                  Launch Asterim Desktop and click "Sign In" to register your machine automatically.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {devices.map((d) => (
                  <div
                    key={d.id}
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
                      <div
                        style={{
                          color: '#ffffff',
                          fontWeight: 600,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <Smartphone size={18} style={{ color: '#10b981' }} />
                        {d.deviceName}
                        <span
                          style={{
                            background: 'rgba(16, 185, 129, 0.15)',
                            color: '#34d399',
                            fontSize: '0.75rem',
                            padding: '2px 10px',
                            borderRadius: '12px',
                            fontWeight: 600,
                          }}
                        >
                          Trusted
                        </span>
                      </div>
                      <div
                        style={{
                          color: '#94a3b8',
                          fontSize: '0.85rem',
                          marginTop: '6px',
                          display: 'flex',
                          gap: '12px',
                        }}
                      >
                        <span>OS: {d.osType.toUpperCase()}</span>
                        <span>•</span>
                        <span>Client Version: {d.clientVersion}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleRevokeDevice(d.id)}
                      style={{
                        background: 'rgba(239, 68, 68, 0.15)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        color: '#f87171',
                        padding: '6px 14px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: '0.85rem',
                      }}
                    >
                      Revoke Device
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'apikeys' && (
          <div
            style={{
              background: '#0f172a',
              borderRadius: '14px',
              padding: '2rem',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ color: '#ffffff', fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
                Machine-to-Machine API Keys
              </h3>
              <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: '4px 0 0 0' }}>
                Create API keys for CLI scripts, CI/CD automated agent dispatches, and SDKs.
              </p>
            </div>

            <form
              onSubmit={handleCreateApiKey}
              style={{ display: 'flex', gap: '12px', marginBottom: '2rem' }}
            >
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Key Description (e.g. GitHub Actions CI/CD Key)"
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
              <button
                type="submit"
                disabled={loading || !newKeyName.trim()}
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
                <Plus size={16} /> Create API Key
              </button>
            </form>

            {createdRawKey && (
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
                  Save your API Key now! (Shown only once)
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
                      fontSize: '0.9rem',
                    }}
                  >
                    {createdRawKey}
                  </code>
                  <button
                    onClick={handleCopyRawKey}
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
                    {copiedKey ? <Check size={16} /> : <Copy size={16} />} Copy Key
                  </button>
                </div>
              </div>
            )}

            {apiKeys.length === 0 ? (
              <div style={{ color: '#94a3b8', padding: '1rem 0' }}>No API keys created yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {apiKeys.map((k) => (
                  <div
                    key={k.id}
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
                      <div style={{ color: '#ffffff', fontWeight: 600 }}>{k.keyName}</div>
                      <div
                        style={{
                          color: '#94a3b8',
                          fontSize: '0.85rem',
                          marginTop: '4px',
                          display: 'flex',
                          gap: '12px',
                        }}
                      >
                        <span>
                          Prefix:{' '}
                          <code style={{ color: '#34d399', fontFamily: 'var(--font-mono)' }}>
                            {k.keyPrefix}
                          </code>
                        </span>
                        <span>•</span>
                        <span>Created: {new Date(k.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteApiKey(k.id)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ef4444',
                        padding: '6px 12px',
                        cursor: 'pointer',
                      }}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'billing' && (
          <div
            style={{
              background: '#0f172a',
              borderRadius: '14px',
              padding: '2rem',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <h3
              style={{
                color: '#ffffff',
                fontSize: '1.2rem',
                fontWeight: 700,
                margin: '0 0 1rem 0',
              }}
            >
              Subscription Tiers & Entitlements
            </h3>

            <div
              style={{
                padding: '1.5rem',
                background: '#162032',
                borderRadius: '12px',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                marginBottom: '1.5rem',
              }}
            >
              <div
                style={{
                  color: '#34d399',
                  fontWeight: 700,
                  fontSize: '1.2rem',
                  marginBottom: '6px',
                }}
              >
                Community Edition (Free Tier Active)
              </div>
              <p style={{ color: '#94a3b8', fontSize: '0.95rem', margin: 0, lineHeight: 1.6 }}>
                You are currently utilizing Asterim's free local execution engine. Billing hooks
                are architecture-ready for commercial Stripe/LemonSqueezy integration in Phase 5
                without requiring identity or authentication rewrites.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
