import React from 'react';
import { Sparkles, User, LogIn, ArrowRight } from 'lucide-react';

interface NavbarProps {
  currentPath: string;
  navigate: (path: string) => void;
  user: any | null;
}

export const Navbar: React.FC<NavbarProps> = ({ currentPath, navigate, user }) => {
  return (
    <nav style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '14px 32px',
      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
      background: 'rgba(8, 12, 20, 0.85)',
      backdropFilter: 'blur(16px)',
      position: 'sticky',
      top: 0,
      zIndex: 100
    }}>
      <div 
        onClick={() => navigate('/')} 
        style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '1.2rem', color: '#f8fafc' }}
      >
        <div style={{
          width: '32px',
          height: '32px',
          borderRadius: '8px',
          background: 'rgba(16, 185, 129, 0.15)',
          border: '1px solid rgba(16, 185, 129, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#10b981'
        }}>
          <Sparkles size={18} />
        </div>
        Asterim
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
        <button 
          onClick={() => navigate('/')} 
          style={{ background: 'none', border: 'none', color: currentPath === '/' ? '#10b981' : '#94a3b8', cursor: 'pointer', fontWeight: 500, fontSize: '0.95rem' }}
        >
          Home
        </button>
        <button 
          onClick={() => navigate('/pricing')} 
          style={{ background: 'none', border: 'none', color: currentPath === '/pricing' ? '#10b981' : '#94a3b8', cursor: 'pointer', fontWeight: 500, fontSize: '0.95rem' }}
        >
          Pricing
        </button>
        <button 
          onClick={() => navigate('/docs')} 
          style={{ background: 'none', border: 'none', color: currentPath === '/docs' ? '#10b981' : '#94a3b8', cursor: 'pointer', fontWeight: 500, fontSize: '0.95rem' }}
        >
          Docs
        </button>
        <button 
          onClick={() => navigate('/download')} 
          style={{ background: 'none', border: 'none', color: currentPath === '/download' ? '#10b981' : '#94a3b8', cursor: 'pointer', fontWeight: 500, fontSize: '0.95rem' }}
        >
          Download
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {user ? (
          <button
            onClick={() => navigate('/account/dashboard')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              borderRadius: '8px',
              background: '#0f172a',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              color: '#34d399',
              fontWeight: 600,
              fontSize: '0.9rem',
              cursor: 'pointer'
            }}
          >
            <User size={16} />
            Account Portal
          </button>
        ) : (
          <>
            <button
              onClick={() => navigate('/account/login')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                borderRadius: '8px',
                background: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#f8fafc',
                fontWeight: 500,
                fontSize: '0.9rem',
                cursor: 'pointer'
              }}
            >
              <LogIn size={16} />
              Sign In
            </button>
            <button
              onClick={() => navigate('/account/register')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                borderRadius: '8px',
                background: '#10b981',
                border: 'none',
                color: '#062b1b',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: 'pointer'
              }}
            >
              Get Started <ArrowRight size={16} />
            </button>
          </>
        )}
      </div>
    </nav>
  );
};
