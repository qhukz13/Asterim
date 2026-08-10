import React from 'react';
import { TerminalCopyBlock } from '../components/common/TerminalCopyBlock';
import { Laptop, Check, Cpu } from 'lucide-react';

export const DownloadPage: React.FC = () => {
  const platforms = [
    {
      os: 'Linux',
      arch: 'x86_64 / ARM64',
      badge: 'AVAILABLE NOW',
      statusClass: 'available',
      downloads: [
        { label: 'AppImage Portable', cmd: 'wget https://releases.asterim.dev/asterim.AppImage' },
        { label: 'Debian / Ubuntu (.deb)', cmd: 'sudo dpkg -i asterim_0.4.5_amd64.deb' },
      ],
    },
    {
      os: 'macOS',
      arch: 'Apple Silicon (M1/M2/M3) & Intel',
      badge: 'AVAILABLE NOW',
      statusClass: 'available',
      downloads: [
        { label: 'Homebrew Formula', cmd: 'brew install asterim/tap/asterim' },
        { label: 'Desktop Disk Image (.dmg)', cmd: 'Download asterim-0.4.5.dmg' },
      ],
    },
    {
      os: 'Windows',
      arch: 'x64 / WSL2 Native',
      badge: 'AVAILABLE NOW',
      statusClass: 'available',
      downloads: [
        { label: 'WSL2 Linux Integration', cmd: 'wsl --install asterim' },
        { label: 'Installer (.exe)', cmd: 'Download asterim-setup-0.4.5.exe' },
      ],
    },
  ];

  return (
    <div
      style={{
        padding: '64px 24px 96px',
        maxWidth: '1240px',
        margin: '0 auto',
        width: '100%',
      }}
    >
      {/* Header */}
      <div className="section-header">
        <span className="section-tag">Cross-Platform Distribution</span>
        <h1 className="section-title">Download Asterim Workstation Engine</h1>
        <p className="section-lead">
          Get started in seconds via global NPM installation or native binary packages for Linux, macOS, and Windows.
        </p>
      </div>

      {/* Global CLI Quickstart Banner */}
      <div style={{ marginBottom: '64px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem', fontWeight: 600, textTransform: 'uppercase' }}>
          Universal Quickstart Command:
        </div>
        <TerminalCopyBlock command="npm install -g asterim" />
      </div>

      {/* Platform Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '32px',
        }}
      >
        {platforms.map((plat, idx) => (
          <div
            key={idx}
            className="surface-card"
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '24px',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Laptop size={22} style={{ color: 'var(--accent-green)' }} />
                  <h3 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {plat.os}
                  </h3>
                </div>
                <span className={`status-badge ${plat.statusClass}`}>
                  {plat.badge}
                </span>
              </div>

              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Cpu size={14} /> Architecture: {plat.arch}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {plat.downloads.map((fmt, fIdx) => (
                  <div
                    key={fIdx}
                    style={{
                      background: '#04070d',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '12px 16px',
                    }}
                  >
                    <div style={{ color: 'var(--accent-green-hover)', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                      {fmt.label}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--text-primary)', overflowX: 'auto', whiteSpace: 'nowrap' }}>
                      {fmt.cmd}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '16px', color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Check size={16} style={{ color: 'var(--accent-green)' }} /> Automatic shell detection (bash, zsh, powershell, wsl)
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
