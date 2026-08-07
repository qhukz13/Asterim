import { useState, useEffect } from 'react';
import { Shield, Smartphone, Bell, Copy, Check, ArrowDown, Terminal } from 'lucide-react';
import { Navbar } from './components/Navbar';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { AccountLayout } from './components/AccountLayout';

function App() {
  const [copied, setCopied] = useState(false);
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [user, setUser] = useState<any | null>(null);

  useEffect(() => {
    // Check current session
    fetch('/api/v1/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && data.user) {
          setUser(data.user);
        }
      })
      .catch(() => {});
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText('npm install -g asterim');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLoginSuccess = (userData: any) => {
    setUser(userData);
  };

  const handleLogout = async () => {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
    setUser(null);
    navigate('/');
  };

  // Route: Sign In
  if (currentPath === '/account/login') {
    return (
      <div className="marketing-container">
        <Navbar currentPath={currentPath} navigate={navigate} user={user} />
        <Login navigate={navigate} onLoginSuccess={handleLoginSuccess} />
      </div>
    );
  }

  // Route: Register
  if (currentPath === '/account/register') {
    return (
      <div className="marketing-container">
        <Navbar currentPath={currentPath} navigate={navigate} user={user} />
        <Register navigate={navigate} onLoginSuccess={handleLoginSuccess} />
      </div>
    );
  }

  // Route: Account Portal Subpages
  if (currentPath.startsWith('/account')) {
    return (
      <div className="marketing-container">
        <Navbar currentPath={currentPath} navigate={navigate} user={user} />
        <AccountLayout
          user={user}
          currentSubPath={currentPath}
          navigate={navigate}
          onLogout={handleLogout}
        />
      </div>
    );
  }

  // Route: Default Landing Page
  return (
    <div className="marketing-container">
      <Navbar currentPath={currentPath} navigate={navigate} user={user} />

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
