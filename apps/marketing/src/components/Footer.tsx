import React from 'react';
import { Sparkles } from 'lucide-react';

const GithubIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

interface FooterProps {
  navigate: (path: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ navigate }) => {
  return (
    <footer
      style={{
        background: '#04070d',
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        padding: '64px 32px 32px',
        color: '#94a3b8',
        fontSize: '0.9rem',
      }}
    >
      <div
        style={{
          maxWidth: '1240px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '40px',
          marginBottom: '48px',
        }}
      >
        {/* Brand Column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', gridColumn: 'span 1' }}>
          <div
            onClick={() => navigate('/')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              cursor: 'pointer',
              fontWeight: 700,
              fontSize: '1.2rem',
              color: '#f8fafc',
            }}
          >
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#10b981',
              }}
            >
              <Sparkles size={18} />
            </div>
            Asterim
          </div>
          <p style={{ color: '#64748b', lineHeight: 1.6, fontSize: '0.88rem' }}>
            The local-first AI engineering operating system. Orchestrate, isolate, monitor, and secure autonomous AI coding agents.
          </p>

          {/* Operational Status */}
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 12px',
              borderRadius: '20px',
              background: 'rgba(16, 185, 129, 0.08)',
              border: '1px solid rgba(16, 185, 129, 0.2)',
              width: 'fit-content',
              fontSize: '0.82rem',
              color: '#34d399',
            }}
          >
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#10b981',
                boxShadow: '0 0 8px #10b981',
              }}
            />
            All Systems Operational
          </div>
        </div>

        {/* Product Column */}
        <div>
          <h4 style={{ color: '#f8fafc', fontWeight: 600, fontSize: '0.95rem', marginBottom: '16px' }}>
            Product
          </h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <li>
              <button onClick={() => navigate('/')} style={footerLinkStyle}>
                Home
              </button>
            </li>
            <li>
              <button onClick={() => navigate('/pricing')} style={footerLinkStyle}>
                Pricing
              </button>
            </li>
            <li>
              <button onClick={() => navigate('/download')} style={footerLinkStyle}>
                Download Desktop App
              </button>
            </li>
            <li>
              <a
                href="https://github.com/qhukz13/Asterim"
                target="_blank"
                rel="noopener noreferrer"
                style={footerLinkStyle}
              >
                GitHub Repository
              </a>
            </li>
          </ul>
        </div>

        {/* Documentation Column */}
        <div>
          <h4 style={{ color: '#f8fafc', fontWeight: 600, fontSize: '0.95rem', marginBottom: '16px' }}>
            Documentation
          </h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <li>
              <button onClick={() => navigate('/docs?topic=quickstart')} style={footerLinkStyle}>
                Quickstart Guide
              </button>
            </li>
            <li>
              <button onClick={() => navigate('/docs?topic=environments')} style={footerLinkStyle}>
                Environments & Isolation
              </button>
            </li>
            <li>
              <button onClick={() => navigate('/docs?topic=security')} style={footerLinkStyle}>
                AST Command Security
              </button>
            </li>
            <li>
              <button onClick={() => navigate('/docs?topic=mcp')} style={footerLinkStyle}>
                MCP Tools & Skills
              </button>
            </li>
            <li>
              <button onClick={() => navigate('/docs?topic=cli')} style={footerLinkStyle}>
                CLI Command Reference
              </button>
            </li>
          </ul>
        </div>

        {/* Legal & Compliance Column */}
        <div>
          <h4 style={{ color: '#f8fafc', fontWeight: 600, fontSize: '0.95rem', marginBottom: '16px' }}>
            Legal & Compliance
          </h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <li>
              <button onClick={() => navigate('/docs?topic=privacy')} style={footerLinkStyle}>
                Privacy Policy
              </button>
            </li>
            <li>
              <button onClick={() => navigate('/docs?topic=terms')} style={footerLinkStyle}>
                Terms of Service
              </button>
            </li>
            <li>
              <button onClick={() => navigate('/docs?topic=security')} style={footerLinkStyle}>
                Security & Disclosure
              </button>
            </li>
            <li>
              <button onClick={() => navigate('/docs?topic=license')} style={footerLinkStyle}>
                Open Source (MIT)
              </button>
            </li>
          </ul>
        </div>
      </div>

      {/* Bottom Bar */}
      <div
        style={{
          maxWidth: '1240px',
          margin: '0 auto',
          paddingTop: '24px',
          borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
          color: '#64748b',
          fontSize: '0.85rem',
        }}
      >
        <div>© 2026 Asterim. MIT Licensed Open Core Engine.</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <a
            href="https://github.com/qhukz13/Asterim"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#94a3b8', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <GithubIcon size={16} /> GitHub
          </a>
          <span style={{ color: '#334155' }}>•</span>
          <span>security@asterim.dev</span>
        </div>
      </div>
    </footer>
  );
};

const footerLinkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#94a3b8',
  fontSize: '0.88rem',
  cursor: 'pointer',
  padding: 0,
  textAlign: 'left',
  textDecoration: 'none',
  transition: 'color 0.15s ease',
};
