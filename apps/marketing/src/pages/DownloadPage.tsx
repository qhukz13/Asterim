import React from 'react';
import { TerminalCopyBlock } from '../components/common/TerminalCopyBlock';
import { Laptop, Check, Cpu } from 'lucide-react';

export const DownloadPage: React.FC = () => {
  const platforms = [
    {
      os: 'Linux',
      arch: 'x86_64 / ARM64',
      badge: 'Available Now',
      formats: [
        { label: 'CLI NPM Package', cmd: 'npm install -g asterim', primary: true },
        { label: 'AppImage Portable', cmd: 'wget https://releases.asterim.dev/asterim.AppImage' },
        { label: 'Debian / Ubuntu (.deb)', cmd: 'sudo dpkg -i asterim_0.4.5_amd64.deb' },
      ],
    },
    {
      os: 'macOS',
      arch: 'Apple Silicon (M1/M2/M3) & Intel',
      badge: 'Available Now',
      formats: [
        { label: 'Homebrew Formula', cmd: 'brew install asterim/tap/asterim', primary: true },
        { label: 'Desktop Disk Image (.dmg)', cmd: 'Download asterim-0.4.5.dmg' },
        { label: 'CLI NPM Package', cmd: 'npm install -g asterim' },
      ],
    },
    {
      os: 'Windows',
      arch: 'x64 / WSL2 Native',
      badge: 'Available Now',
      formats: [
        { label: 'PowerShell / NPM', cmd: 'npm install -g asterim', primary: true },
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
      <div style={{ textAlign: 'center', marginBottom: '56px' }}>
        <div
          style={{
            fontSize: '0.85rem',
            fontWeight: 700,
            color: '#10b981',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            marginBottom: '12px',
          }}
        >
          Cross-Platform Distribution
        </div>
        <h1
          style={{
            fontSize: 'clamp(2.25rem, 4vw, 3.5rem)',
            fontWeight: 800,
            color: '#ffffff',
            letterSpacing: '-0.02em',
            marginBottom: '16px',
          }}
        >
          Download Asterim Workstation Engine
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '1.15rem', maxWidth: '640px', margin: '0 auto', lineHeight: 1.6 }}>
          Get started in seconds via global NPM installation or native binary packages for Linux, macOS, and Windows.
        </p>
      </div>

      {/* Global CLI Quickstart Banner */}
      <div style={{ marginBottom: '64px', display: 'flex', justifyContent: 'center' }}>
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
            style={{
              background: '#0f172a',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '20px',
              padding: '36px 32px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '24px',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Laptop size={22} style={{ color: '#10b981' }} />
                  <h3 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc' }}>
                    {plat.os}
                  </h3>
                </div>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    color: '#34d399',
                    background: 'rgba(16, 185, 129, 0.15)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    padding: '4px 10px',
                    borderRadius: '12px',
                  }}
                >
                  {plat.badge}
                </span>
              </div>

              <div style={{ color: '#64748b', fontSize: '0.85rem', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Cpu size={14} /> Architecture: {plat.arch}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {plat.formats.map((fmt, fIdx) => (
                  <div
                    key={fIdx}
                    style={{
                      background: fmt.primary ? 'rgba(16, 185, 129, 0.08)' : '#04070d',
                      border: fmt.primary ? '1px solid rgba(16, 185, 129, 0.25)' : '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '10px',
                      padding: '14px 16px',
                    }}
                  >
                    <div style={{ color: fmt.primary ? '#34d399' : '#94a3b8', fontSize: '0.82rem', fontWeight: 600, marginBottom: '6px' }}>
                      {fmt.label}
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: '#f8fafc', overflowX: 'auto', whiteSpace: 'nowrap' }}>
                      {fmt.cmd}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)', paddingTop: '16px', color: '#94a3b8', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Check size={16} style={{ color: '#10b981' }} /> Automatic shell detection (bash, zsh, powershell, wsl)
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
