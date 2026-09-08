import React from 'react';
import { Menu } from 'lucide-react';
import { GithubIcon } from './GithubIcon';
import { GITHUB_URL } from '../site';

interface NavbarProps {
  currentPath: string;
  navigate: (path: string) => void;
  onOpenMobileDrawer: () => void;
}

export const NAV_ITEMS: { label: string; path: string }[] = [
  { label: 'How it works', path: '/#how-it-works' },
  { label: 'Pricing', path: '/pricing' },
  { label: 'Docs', path: '/docs' }
];

export const Navbar: React.FC<NavbarProps> = ({ currentPath, navigate, onOpenMobileDrawer }) => {
  const isActive = (path: string) => path !== '/' && !path.includes('#') && currentPath.startsWith(path);

  return (
    <nav className="nav">
      <div className="container nav-inner">
        <a
          href="/"
          className="brand"
          onClick={e => {
            e.preventDefault();
            navigate('/');
          }}
        >
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          Asterim
        </a>

        <div className="nav-links">
          {NAV_ITEMS.map(item => (
            <a
              key={item.path}
              href={item.path}
              className={`nav-link ${isActive(item.path) ? 'active' : ''}`}
              onClick={e => {
                e.preventDefault();
                navigate(item.path);
              }}
            >
              {item.label}
            </a>
          ))}
        </div>

        <div className="nav-actions">
          <a href={GITHUB_URL} className="btn btn-sm btn-secondary-desktop" target="_blank" rel="noopener noreferrer">
            <GithubIcon size={15} />
            GitHub
          </a>
          <a
            href="/docs#install"
            className="btn btn-sm btn-primary"
            onClick={e => {
              e.preventDefault();
              navigate('/docs#install');
            }}
          >
            Install
          </a>
          <button className="hamburger" onClick={onOpenMobileDrawer} aria-label="Open navigation">
            <Menu size={22} />
          </button>
        </div>
      </div>
    </nav>
  );
};
