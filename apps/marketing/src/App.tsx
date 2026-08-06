import { useState } from 'react';
import { Shield, Smartphone, Bell, Copy, Check, ArrowDown, Terminal, Sparkles } from 'lucide-react';

const GithubIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ display: 'inline-block', verticalAlign: 'middle' }}>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

function App() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText('npm install -g asterim');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="marketing-container">
      <nav>
        <div className="logo" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Sparkles size={22} style={{ color: '#3b82f6' }} />
          Asterim
        </div>
        <div>
          <a
            href="https://github.com/asterim/asterim"
            style={{
              color: 'var(--text-primary)',
              textDecoration: 'none',
              fontWeight: 500,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px'
            }}
          >
            <GithubIcon size={18} />
            GitHub
          </a>
        </div>
      </nav>

      <main className="hero">
        <h1>
          Code Anywhere.
          <br />
          Monitor Everywhere.
        </h1>
        <p>
          The ultimate control center for autonomous coding agents. Monitor, approve, and direct AI
          agents like Aider from your mobile device securely over an E2E encrypted tunnel.
        </p>

        <div className="terminal-mockup">
          <div style={{ color: '#94a3b8', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Terminal size={14} /> # Install globally via NPM
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>$ npm install -g asterim</span>
            <button
              onClick={handleCopy}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#3b82f6',
                cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.9rem'
              }}
            >
              {copied ? (
                <>
                  <Check size={16} style={{ color: '#22c55e' }} /> Copied!
                </>
              ) : (
                <>
                  <Copy size={16} /> Copy
                </>
              )}
            </button>
          </div>
        </div>

        <button
          className="cta-button"
          onClick={() => window.scrollTo({ top: 800, behavior: 'smooth' })}
        >
          Explore Features <ArrowDown size={18} />
        </button>
      </main>

      <section className="features-grid">
        <div className="feature-card">
          <div className="feature-icon">
            <Shield size={24} />
          </div>
          <div className="feature-title">End-to-End Encryption</div>
          <div className="feature-desc">
            Connect from any coffee shop or cellular network. Your code and logs never touch our
            servers in plaintext.
          </div>
        </div>
        <div className="feature-card">
          <div className="feature-icon">
            <Smartphone size={24} />
          </div>
          <div className="feature-title">Mobile Native Feel</div>
          <div className="feature-desc">
            Optimized UI that feels like a native app on iOS and Android. Review diffs and send
            commands with a thumb.
          </div>
        </div>
        <div className="feature-card">
          <div className="feature-icon">
            <Bell size={24} />
          </div>
          <div className="feature-title">Push Notifications</div>
          <div className="feature-desc">
            Go grab a coffee while Aider works. Receive a push notification instantly when the agent
            needs your approval.
          </div>
        </div>
      </section>
    </div>
  );
}

export default App;
