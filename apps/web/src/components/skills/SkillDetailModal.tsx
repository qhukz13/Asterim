import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { SkillDefinition } from '@asterim/shared';
import { requiredParameters } from '../../stores/useSkillsStore';
import { scopeTone } from './SkillsExplorer';

/**
 * One skill, in full.
 *
 * The instructions are rendered as markdown rather than shown as a code block
 * because that is how the author wrote them and how the agent will read them —
 * a skill whose headings and lists render differently here than in the file
 * would make this panel a worse copy of the editor rather than a view of it.
 *
 * The parameter table is the part worth spelling out. An agent calling
 * `skill__<name>` has to satisfy the declared schema, so the modal names each
 * parameter, its type, whether it is required and what it is for; the raw
 * schema follows underneath for anyone who needs the exact JSON.
 */

/** One row of the parameter table, flattened out of the JSON Schema. */
export interface SkillParameterRow {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

/**
 * Reads a skill's schema into rows.
 *
 * Tolerant on purpose: the schema comes from a file a person wrote by hand, and
 * a property with no `type` is a property worth showing as `any` rather than a
 * reason to render nothing.
 */
export function parameterRows(skill: SkillDefinition): SkillParameterRow[] {
  const properties = (skill.parametersSchema as { properties?: Record<string, unknown> } | undefined)
    ?.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];

  const required = new Set(requiredParameters(skill));

  return Object.entries(properties).map(([name, raw]) => {
    const descriptor = (raw && typeof raw === 'object' ? raw : {}) as {
      type?: unknown;
      description?: unknown;
      enum?: unknown;
    };
    const type = Array.isArray(descriptor.type)
      ? descriptor.type.filter(part => typeof part === 'string').join(' | ')
      : typeof descriptor.type === 'string'
        ? descriptor.type
        : 'any';
    const enumValues = Array.isArray(descriptor.enum)
      ? ` (one of: ${descriptor.enum.map(value => JSON.stringify(value)).join(', ')})`
      : '';
    return {
      name,
      type: type || 'any',
      required: required.has(name),
      description: `${typeof descriptor.description === 'string' ? descriptor.description : ''}${enumValues}`.trim()
    };
  });
}

/** The schema as JSON, or a sentence saying there is none. */
export function describeSchema(skill: SkillDefinition): string {
  if (!skill.parametersSchema) return 'This skill declares no parameters.';
  try {
    return JSON.stringify(skill.parametersSchema, null, 2);
  } catch {
    return 'This skill’s parameter schema could not be displayed.';
  }
}

const cell: React.CSSProperties = {
  padding: '6px 10px',
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  fontSize: '0.82rem',
  color: 'var(--color-text-secondary)',
  textAlign: 'left',
  verticalAlign: 'top'
};

const sectionTitle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: 'var(--font-size-xs, 12px)',
  fontWeight: 600,
  color: 'var(--color-text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em'
};

const chip: React.CSSProperties = {
  padding: '2px 8px',
  borderRadius: '999px',
  fontSize: 'var(--font-size-xs, 12px)',
  background: 'var(--color-surface-3)',
  color: 'var(--color-text-secondary)',
  whiteSpace: 'nowrap'
};

export interface SkillDetailModalProps {
  skill: SkillDefinition;
  onClose: () => void;
}

export function SkillDetailModal({ skill, onClose }: SkillDetailModalProps) {
  const rows = parameterRows(skill);
  const tone = scopeTone(skill.scope);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`The ${skill.name} skill`}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        zIndex: 1000
      }}
      onClick={onClose}
    >
      <div
        onClick={event => event.stopPropagation()}
        style={{
          background: 'var(--color-surface-1)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '10px',
          width: 'min(820px, 100%)',
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0
        }}
      >
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '12px',
            padding: '16px 18px',
            borderBottom: '1px solid rgba(255,255,255,0.08)'
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: '1rem',
                  fontFamily: 'var(--font-family-mono)',
                  color: 'var(--color-text-primary)'
                }}
              >
                {skill.name}
              </h2>
              <span style={{ ...chip, background: tone.background, color: tone.color, fontWeight: 600 }}>
                {tone.label}
              </span>
              <span style={{ ...chip, fontFamily: 'var(--font-family-mono)' }}>skill__{skill.name}</span>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
              {skill.description}
            </p>
            <p
              style={{
                margin: '4px 0 0',
                fontFamily: 'var(--font-family-mono)',
                fontSize: 'var(--font-size-xs, 12px)',
                color: 'var(--color-text-muted)',
                wordBreak: 'break-all'
              }}
            >
              {skill.path}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              padding: '6px 11px',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '6px',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              fontSize: '0.8rem'
            }}
          >
            Close
          </button>
        </header>

        <div style={{ padding: '16px 18px', overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <section>
            <h3 style={sectionTitle}>Parameters</h3>
            {rows.length === 0 ? (
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                This skill declares no parameters.
              </p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...cell, color: 'var(--color-text-muted)' }}>Name</th>
                    <th style={{ ...cell, color: 'var(--color-text-muted)' }}>Type</th>
                    <th style={{ ...cell, color: 'var(--color-text-muted)' }}>Required</th>
                    <th style={{ ...cell, color: 'var(--color-text-muted)' }}>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(row => (
                    <tr key={row.name}>
                      <td style={{ ...cell, fontFamily: 'var(--font-family-mono)', color: 'var(--color-text-primary)' }}>
                        {row.name}
                      </td>
                      <td style={{ ...cell, fontFamily: 'var(--font-family-mono)' }}>{row.type}</td>
                      <td style={cell}>{row.required ? 'Required' : 'Optional'}</td>
                      <td style={cell}>{row.description || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {(!!skill.scripts?.length || !!skill.references?.length) && (
            <section>
              <h3 style={sectionTitle}>Files</h3>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {(skill.scripts ?? []).map(file => (
                  <span key={`script-${file}`} style={{ ...chip, fontFamily: 'var(--font-family-mono)' }}>
                    {file}
                  </span>
                ))}
                {(skill.references ?? []).map(file => (
                  <span key={`reference-${file}`} style={{ ...chip, fontFamily: 'var(--font-family-mono)' }}>
                    {file}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section>
            <h3 style={sectionTitle}>Instructions</h3>
            {skill.instructions.trim() ? (
              <div className="markdown-body" style={{ fontSize: '0.88rem', color: 'var(--color-text-primary)', lineHeight: 1.55 }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{skill.instructions}</ReactMarkdown>
              </div>
            ) : (
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                This skill&rsquo;s SKILL.md has no body below its frontmatter.
              </p>
            )}
          </section>

          <section>
            <h3 style={sectionTitle}>Parameter schema</h3>
            <pre
              style={{
                margin: 0,
                padding: '10px 12px',
                background: 'var(--color-surface-2)',
                borderRadius: '6px',
                fontFamily: 'var(--font-family-mono)',
                fontSize: 'var(--font-size-xs, 12px)',
                color: 'var(--color-text-secondary)',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap'
              }}
            >
              {describeSchema(skill)}
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}
