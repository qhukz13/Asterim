import React from 'react';
import { Sparkles, User, LogIn, ArrowRight, Menu } from 'lucide-react';

const GithubIcon: React.FC<{ size?: number }> = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

interface NavbarProps {
  currentPath: string;
  navigate: (path: string) => void;
  user: any | null;
  onOpenMobileDrawer?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentPath,
  navigate,
  user,
  onOpenMobileDrawer,
}) => {
  const isNavActive = (path: string) => {
    if (path === '/') return currentPath === '/';
    return currentPath.startsWith(path);
  };

  return (
    <nav className="marketing-navbar">
      {/* Brand Header */}
      <div
        onClick={() => navigate('/')}
        className="brand-logo"
      >
        <div className="brand-icon">
          <Sparkles size={18} />
        </div>
        <span className="brand-name">Asterim</span>
      </div>

      {/* Desktop Links */}
      <div className="desktop-nav-links">
        <button
          onClick={() => navigate('/')}
          className={`nav-link ${isNavActive('/') ? 'active' : ''}`}
        >
          Home
        </button>
        <button
          onClick={() => navigate('/pricing')}
          className={`nav-link ${isNavActive('/pricing') ? 'active' : ''}`}
        >
          Pricing
        </button>
        <button
          onClick={() => navigate('/docs')}
          className={`nav-link ${isNavActive('/docs') ? 'active' : ''}`}
        >
          Docs
        </button>
        <button
          onClick={() => navigate('/download')}
          className={`nav-link ${isNavActive('/download') ? 'active' : ''}`}
        >
          Download
        </button>
      </div>

      {/* Action Controls */}
      <div className="nav-actions">
        <a
          href="https://github.com/qhukz13/Asterim"
          target="_blank"
          rel="noopener noreferrer"
          className="github-badge-link"
          title="View Asterim on GitHub"
        >
          <GithubIcon size={16} />
          <span className="github-text">GitHub</span>
        </a>

        {user ? (
          <button
            onClick={() => navigate('/account/dashboard')}
            className="account-btn"
          >
            <User size={16} />
            <span className="btn-text">Account Portal</span>
          </button>
        ) : (
          <>
            <button
              onClick={() => navigate('/account/login')}
              className="login-btn"
            >
              <LogIn size={16} />
              <span className="btn-text">Sign In</span>
            </button>
            <button
              onClick={() => navigate('/account/register')}
              className="register-btn"
            >
              <span>Get Started</span>
              <ArrowRight size={16} />
            </button>
          </>
        )}

        {/* Mobile Hamburger Toggle */}
        <button
          onClick={onOpenMobileDrawer}
          className="mobile-hamburger-btn"
          aria-label="Open navigation menu"
        >
          <Menu size={22} />
        </button>
      </div>
    </nav>
  );
};
