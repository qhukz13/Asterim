import React from 'react';
import { X } from 'lucide-react';
import { NAV_ITEMS } from './Navbar';
import { GITHUB_URL } from '../site';

interface MobileNavDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  navigate: (path: string) => void;
}

export const MobileNavDrawer: React.FC<MobileNavDrawerProps> = ({ isOpen, onClose, navigate }) => {
  if (!isOpen) return null;
  const go = (path: string) => {
    onClose();
    navigate(path);
  };
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label="Navigation">
        <button className="drawer-close" onClick={onClose} aria-label="Close navigation">
          <X size={20} />
        </button>
        <button className="nav-link" onClick={() => go('/')}>
          Home
        </button>
        {NAV_ITEMS.map(item => (
          <button key={item.path} className="nav-link" onClick={() => go(item.path)}>
            {item.label}
          </button>
        ))}
        <a className="nav-link" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          GitHub
        </a>
        <button className="btn btn-primary" onClick={() => go('/docs#install')}>
          Install
        </button>
      </div>
    </>
  );
};
