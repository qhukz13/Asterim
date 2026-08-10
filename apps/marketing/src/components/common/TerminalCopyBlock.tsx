import React, { useState } from 'react';
import { Terminal, Copy, Check } from 'lucide-react';

interface TerminalCopyBlockProps {
  command?: string;
}

export const TerminalCopyBlock: React.FC<TerminalCopyBlockProps> = ({
  command = 'npm install -g asterim',
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      style={{
        background: '#04070d',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        padding: '16px 20px',
        fontFamily: 'var(--font-mono)',
        color: '#34d399',
        textAlign: 'left',
        width: '100%',
        maxWidth: '560px',
        boxShadow: '0 16px 36px rgba(0, 0, 0, 0.6), 0 0 20px rgba(16, 185, 129, 0.08)',
      }}
    >
      <div
        style={{
          color: '#64748b',
          fontSize: '0.8rem',
          marginBottom: '10px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <Terminal size={14} /> # Install global CLI package via NPM
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.98rem' }}>
          <span style={{ color: '#64748b' }}>$</span>
          <span style={{ color: '#f8fafc', fontWeight: 500 }}>{command}</span>
        </div>
        <button
          onClick={handleCopy}
          aria-label="Copy installation command"
          style={{
            background: copied ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)',
            border: copied ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(255, 255, 255, 0.1)',
            color: copied ? '#34d399' : '#94a3b8',
            borderRadius: '6px',
            padding: '6px 12px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.85rem',
            fontWeight: 500,
            transition: 'all 0.15s ease',
          }}
        >
          {copied ? (
            <>
              <Check size={14} style={{ color: '#22c55e' }} /> Copied
            </>
          ) : (
            <>
              <Copy size={14} /> Copy
            </>
          )}
        </button>
      </div>
    </div>
  );
};
