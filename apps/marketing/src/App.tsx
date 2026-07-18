import { useState } from 'react';

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
        <div className="logo">Asterim</div>
        <div>
          <a
            href="https://github.com/asterim/asterim"
            style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 500 }}
          >
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
          <div style={{ color: '#94a3b8', marginBottom: '8px' }}># Install globally via NPM</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>$ npm install -g asterim</span>
            <button
              onClick={handleCopy}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#3b82f6',
                cursor: 'pointer',
                fontFamily: 'inherit'
              }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        <button
          className="cta-button"
          onClick={() => window.scrollTo({ top: 800, behavior: 'smooth' })}
        >
          Explore Features ↓
        </button>
      </main>

      <section className="features-grid">
        <div className="feature-card">
          <div className="feature-icon">🔒</div>
          <div className="feature-title">End-to-End Encryption</div>
          <div className="feature-desc">
            Connect from any coffee shop or cellular network. Your code and logs never touch our
            servers in plaintext.
          </div>
        </div>
        <div className="feature-card">
          <div className="feature-icon">📱</div>
          <div className="feature-title">Mobile Native Feel</div>
          <div className="feature-desc">
            Optimized UI that feels like a native app on iOS and Android. Review diffs and send
            commands with a thumb.
          </div>
        </div>
        <div className="feature-card">
          <div className="feature-icon">🔔</div>
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
