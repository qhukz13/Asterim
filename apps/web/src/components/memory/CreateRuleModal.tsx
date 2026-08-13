import React, { useState } from 'react';
import type { ArchitecturalRuleSeverity } from '@asterim/shared';
import { useMemoryStore } from '../../stores/useMemoryStore';

/** Severities offered by the form, in the order they are shown. */
export const RULE_SEVERITIES: readonly ArchitecturalRuleSeverity[] = ['warning', 'error', 'info'];

/** What each severity means to whoever reads the rule later. */
export const SEVERITY_HINTS: Record<ArchitecturalRuleSeverity, string> = {
  error: 'Breaking this is a defect. Agents must not do it.',
  warning: 'Deviating needs a reason, and the reason should be recorded.',
  info: 'Context worth knowing. Not enforced.'
};

/**
 * The colour a severity carries.
 *
 * `info` stays neutral rather than taking a colour of its own: it is not a
 * warning, and giving it one would put three competing hues in a panel the design
 * system asks to keep monochrome apart from state.
 */
export function severityColor(severity: ArchitecturalRuleSeverity): string {
  switch (severity) {
    case 'error':
      return 'var(--color-state-error)';
    case 'warning':
      return 'var(--color-state-paused)';
    default:
      return 'var(--color-text-muted)';
  }
}

/** The scope pattern stored when the field is left blank. */
export const DEFAULT_SCOPE_PATTERN = '*';

/**
 * The scope pattern a rule is stored with.
 *
 * Pulled out of the submit handler so it can be tested: with no DOM environment
 * the handler itself never runs, and "blank means project-wide" would otherwise
 * be an untested claim sitting behind a click.
 */
export function resolveScopePattern(input: string): string {
  return input.trim() || DEFAULT_SCOPE_PATTERN;
}

export interface CreateRuleModalProps {
  projectId: string;
  onClose: () => void;
  onCreated?: (ruleId: string) => void;
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: 'var(--spacing-2) var(--spacing-3)',
  background: 'var(--color-surface-1)',
  border: '1px solid var(--color-border-default)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text-primary)',
  fontSize: 'var(--font-size-sm)',
  fontFamily: 'var(--font-family-sans)',
  lineHeight: 'var(--line-height-normal)',
  boxSizing: 'border-box'
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: '6px',
  fontSize: 'var(--font-size-xs)',
  fontWeight: 'var(--font-weight-semibold)' as any,
  color: 'var(--color-text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em'
};

export function CreateRuleModal({ projectId, onClose, onCreated }: CreateRuleModalProps) {
  const [title, setTitle] = useState('');
  const [statement, setStatement] = useState('');
  const [severity, setSeverity] = useState<ArchitecturalRuleSeverity>('warning');
  const [scopePattern, setScopePattern] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length > 0 && statement.trim().length > 0 && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const rule = await useMemoryStore.getState().createRule(projectId, {
        title: title.trim(),
        statement: statement.trim(),
        severity,
        scopePattern: resolveScopePattern(scopePattern)
      });
      onCreated?.(rule.id);
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Could not add the rule');
      setSubmitting(false);
    }
  };

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--color-bg-overlay)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--spacing-6)',
        zIndex: 'var(--z-index-modal)' as any
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add architectural rule"
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key === 'Escape') onClose();
        }}
        style={{
          width: '100%',
          maxWidth: '520px',
          maxHeight: '100%',
          overflowY: 'auto',
          background: 'var(--color-surface-3)',
          border: '1px solid var(--color-border-default)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-lg)',
          padding: 'var(--spacing-6)',
          boxSizing: 'border-box'
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 'var(--font-size-lg)',
            fontWeight: 'var(--font-weight-semibold)' as any,
            color: 'var(--color-text-primary)'
          }}
        >
          Add architectural rule
        </h2>
        <p style={{ margin: '4px 0 var(--spacing-5)', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
          A standing constraint. Every agent session reads these before it starts work.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
          <div>
            <label style={labelStyle} htmlFor="rule-title">
              Title
            </label>
            <input
              id="rule-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Enforce service isolation"
              autoFocus
              style={fieldStyle}
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="rule-statement">
              The rule, as a directive
            </label>
            <textarea
              id="rule-statement"
              value={statement}
              onChange={e => setStatement(e.target.value)}
              rows={3}
              placeholder="All MCP memory operations must delegate to ProjectMemoryService."
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
          </div>

          <div>
            <label style={labelStyle} htmlFor="rule-severity">
              Severity
            </label>
            <select
              id="rule-severity"
              value={severity}
              onChange={e => setSeverity(e.target.value as ArchitecturalRuleSeverity)}
              style={{ ...fieldStyle, cursor: 'pointer' }}
            >
              {RULE_SEVERITIES.map(value => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <p style={{ margin: '6px 0 0', fontSize: 'var(--font-size-xs)', color: severityColor(severity) }}>
              {SEVERITY_HINTS[severity]}
            </p>
          </div>

          <div>
            <label style={labelStyle} htmlFor="rule-scope">
              Scope pattern — optional
            </label>
            <input
              id="rule-scope"
              value={scopePattern}
              onChange={e => setScopePattern(e.target.value)}
              placeholder={DEFAULT_SCOPE_PATTERN}
              style={{ ...fieldStyle, fontFamily: 'var(--font-family-mono)', fontSize: 'var(--font-size-xs)' }}
            />
            <p style={{ margin: '6px 0 0', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              Which paths the rule covers. Left blank it applies project-wide.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              style={{
                padding: 'var(--spacing-3)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-state-error-bg)',
                color: 'var(--color-state-error)',
                fontSize: 'var(--font-size-sm)'
              }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--spacing-2)' }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                height: 'var(--control-height-md)',
                padding: '0 var(--spacing-4)',
                background: 'transparent',
                border: '1px solid var(--color-border-default)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--color-text-secondary)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--font-weight-medium)' as any,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                height: 'var(--control-height-md)',
                padding: '0 var(--spacing-4)',
                background: canSubmit ? 'var(--color-accent-primary)' : 'var(--color-surface-2)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                color: canSubmit ? '#042114' : 'var(--color-text-muted)',
                fontSize: 'var(--font-size-sm)',
                fontWeight: 'var(--font-weight-semibold)' as any,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                transition: 'background var(--transition-fast)'
              }}
            >
              {submitting ? 'Adding…' : 'Add rule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
