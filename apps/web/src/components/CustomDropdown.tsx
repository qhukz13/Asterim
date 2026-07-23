import React, { useState, useEffect, useRef } from 'react';

interface CustomDropdownProps {
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
  style?: React.CSSProperties;
  disabled?: boolean;
  dropup?: boolean;
}

export function CustomDropdown({
  value,
  onChange,
  options,
  style = {},
  disabled = false,
  dropup = false
}: CustomDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selected = options.find(o => o.value === value) || options[0];

  return (
    <div
      ref={ref}
      style={{ position: 'relative', display: 'block', zIndex: isOpen ? 1000 : 1, ...style }}
    >
      <div
        onClick={() => !disabled && setIsOpen(!isOpen)}
        className="glass-panel"
        style={{
          width: '100%',
          padding: '6px 12px',
          background: disabled ? 'rgba(0,0,0,0.1)' : 'transparent',
          border: '1px solid transparent',
          borderRadius: '8px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: disabled ? 'rgba(255,255,255,0.4)' : 'var(--color-text-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          fontSize: '0.8rem',
          opacity: disabled ? 0.6 : 1,
          transition: 'all 0.2s ease'
        }}
        onMouseOver={e => {
          if (!disabled) {
            e.currentTarget.style.color = '#fff';
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          }
        }}
        onMouseOut={e => {
          if (!disabled) {
            e.currentTarget.style.color = 'var(--color-text-secondary)';
            e.currentTarget.style.background = 'transparent';
          }
        }}
      >
        <span>{selected.label}</span>
        <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>▼</span>
      </div>

      {isOpen && !disabled && (
        <div
          style={{
            position: 'absolute',
            ...(dropup ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }),
            left: 0,
            right: 0,
            background: '#1e293b',
            border: '1px solid var(--color-border-default)',
            borderRadius: '8px',
            padding: '4px',
            minWidth: '100%',
            zIndex: 1000,
            boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
            gap: '2px'
          }}
        >
          {options.map(opt => (
            <div
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setIsOpen(false);
              }}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                background: value === opt.value ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                color: value === opt.value ? '#60a5fa' : 'var(--color-text-secondary)',
                fontSize: '0.85rem',
                transition: 'background 0.2s'
              }}
              onMouseOver={e => {
                if (value !== opt.value)
                  e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
              }}
              onMouseOut={e => {
                if (value !== opt.value) e.currentTarget.style.background = 'transparent';
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
