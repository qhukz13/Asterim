import React from 'react';
import { ADAPTER_STATUS, DISCUSSIONS_URL, GITHUB_URL, LICENSE, VERSION } from '../site';

interface FooterProps {
  navigate: (path: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ navigate }) => {
  const go = (path: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(path);
  };

  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div className="status-line">
          <span className="dot" aria-hidden="true" />
          Asterim {VERSION}
          {ADAPTER_STATUS.map(a => (
            <span key={a.name}>
              {' · '}
              {a.name}: {a.status}
            </span>
          ))}
          {' · '}nothing leaves your machine
        </div>
        <div className="footer-links">
          <a href="/docs" onClick={go('/docs')}>
            Docs
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            Source
          </a>
          <a href={DISCUSSIONS_URL} target="_blank" rel="noopener noreferrer">
            Discussions
          </a>
          <a href="/docs#privacy" onClick={go('/docs#privacy')}>
            Privacy
          </a>
          <a href="/docs#licence" onClick={go('/docs#licence')}>
            {LICENSE} licence
          </a>
        </div>
      </div>
    </footer>
  );
};
