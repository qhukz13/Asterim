import React from 'react';

export interface QuestionOverlayProps {
  questionRequest: {
    questionId: string;
    question: string;
    options: string[];
    timestamp?: number;
  };
  onSelect: (questionId: string, index: number, text: string) => void;
}

export function QuestionOverlay({ questionRequest, onSelect }: QuestionOverlayProps) {
  return (
    <div className="dialog-overlay">
      <div className="dialog-box glass-panel" style={{ maxWidth: '600px', width: '90%' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, color: 'var(--color-accent-hover)' }}>Question from the agent</h3>
        </div>

        <p style={{ fontSize: '1.05rem', fontWeight: 500, marginTop: 0, marginBottom: '20px' }}>
          {questionRequest.question}
        </p>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            marginBottom: '16px',
            maxHeight: '50vh',
            overflowY: 'auto',
            paddingRight: '8px'
          }}
        >
          {questionRequest.options.map((opt, idx) => {
            const isRecommended = opt.includes('(Recommended)');
            const cleanOpt = opt.replace('(Recommended)', '').trim();

            return (
              <button
                key={idx}
                onClick={() => onSelect(questionRequest.questionId, idx + 1, opt)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  textAlign: 'left',
                  padding: '12px 16px',
                  background: isRecommended ? 'rgba(59, 130, 246, 0.15)' : 'rgba(0,0,0,0.3)',
                  border: isRecommended
                    ? '1px solid var(--color-accent-hover)'
                    : '1px solid var(--color-border-default)',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  color: 'var(--color-text-primary)'
                }}
                onMouseOver={e => {
                  e.currentTarget.style.background = isRecommended
                    ? 'rgba(59, 130, 246, 0.25)'
                    : 'rgba(255,255,255,0.05)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseOut={e => {
                  e.currentTarget.style.background = isRecommended
                    ? 'rgba(59, 130, 246, 0.15)'
                    : 'rgba(0,0,0,0.3)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <span
                  style={{
                    marginRight: '12px',
                    color: isRecommended
                      ? 'var(--color-accent-hover)'
                      : 'var(--color-text-secondary)',
                    fontWeight: 'bold',
                    minWidth: '24px'
                  }}
                >
                  {idx + 1}.
                </span>
                <div>
                  <span style={{ display: 'block', lineHeight: 1.4 }}>{cleanOpt}</span>
                  {isRecommended && (
                    <span
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--color-accent-hover)',
                        display: 'block',
                        marginTop: '4px'
                      }}
                    >
                      Recommended
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
