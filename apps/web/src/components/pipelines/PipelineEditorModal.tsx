import React, { useState } from 'react';
import { MAX_PIPELINE_YAML_CHARS } from '@asterim/shared';
import type { Pipeline } from '@asterim/shared';
import {
  PIPELINE_TEMPLATES,
  usePipelineStore,
  validatePipelineDraft
} from '../../stores/usePipelineStore';

/**
 * Writing a pipeline definition (P9-03).
 *
 * A textarea over the YAML, and deliberately not a form over the schema. The
 * definition is a file the operator owns — `.asterim/pipelines/*.yaml` — and the
 * Core stores the text exactly as written so that their comments and their
 * ordering survive a round trip. A form would re-serialize it, and the first
 * save would silently rewrite the file.
 *
 * Validation is in two layers, and only the second one is authoritative. The
 * draft check here catches the handful of mistakes worth catching without a
 * round trip; the save is what actually decides, because the parser on the Core
 * is the gate — it resolves roles against the profile catalogue and refuses a
 * cycle — and it answers with the line it stopped on, which is what is shown.
 */

export interface PipelineEditorModalViewProps {
  yaml: string;
  onYamlChange: (yaml: string) => void;
  onSelectTemplate: (templateId: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  /** The pipeline being edited, when this is an edit rather than a creation. */
  editing?: Pipeline | null;
  isSaving?: boolean;
  /** What the Core refused the last save with, line number included. */
  error?: string | null;
}

/** The editor's presentation, driven entirely by props. */
export function PipelineEditorModalView({
  yaml,
  onYamlChange,
  onSelectTemplate,
  onSubmit,
  onClose,
  editing = null,
  isSaving = false,
  error = null
}: PipelineEditorModalViewProps) {
  const issues = validatePipelineDraft(yaml);

  return (
    <div className="dialog-overlay" role="dialog" aria-label="Pipeline definition">
      <div className="dialog-box glass-panel" style={{ maxWidth: '720px', width: '100%' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--color-text-primary)' }}>
          {editing ? `Edit ${editing.name}` : 'New pipeline'}
        </h3>
        <p style={{ margin: '6px 0 12px', fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
          Steps declare what they depend on; what runs in parallel follows from that, and is not
          written down separately.
        </p>

        {!editing && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
            {PIPELINE_TEMPLATES.map(template => (
              <button
                key={template.id}
                type="button"
                onClick={() => onSelectTemplate(template.id)}
                title={template.description}
                style={{
                  padding: '4px 10px',
                  borderRadius: 'var(--radius-full)',
                  border: '1px solid var(--color-border-default)',
                  background: 'var(--color-surface-2)',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  fontSize: '0.75rem'
                }}
              >
                {template.name}
              </button>
            ))}
          </div>
        )}

        <textarea
          value={yaml}
          onChange={event => onYamlChange(event.target.value)}
          aria-label="Pipeline YAML"
          spellCheck={false}
          rows={16}
          maxLength={MAX_PIPELINE_YAML_CHARS}
          placeholder={'name: My pipeline\ntrigger: MANUAL\nsteps:\n  - id: build\n    role: Tech Lead\n    task: …'}
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-surface-0)',
            border: `1px solid ${
              issues.length > 0 ? 'var(--color-state-paused)' : 'var(--color-border-subtle)'
            }`,
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-family-mono)',
            fontSize: '0.78rem',
            lineHeight: 1.5,
            resize: 'vertical',
            boxSizing: 'border-box'
          }}
        />

        {issues.length > 0 && (
          <ul
            aria-label="Draft problems"
            style={{
              listStyle: 'none',
              margin: '8px 0 0',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '2px'
            }}
          >
            {issues.map(issue => (
              <li
                key={`${issue.line}:${issue.message}`}
                style={{ fontSize: '0.78rem', color: 'var(--color-state-paused)' }}
              >
                {issue.line > 0 ? `Line ${issue.line}: ` : ''}
                {issue.message}
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p role="alert" style={{ margin: '8px 0 0', fontSize: '0.8rem', color: 'var(--color-state-error)' }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border-default)',
              background: 'transparent',
              color: 'var(--color-text-secondary)',
              cursor: 'pointer',
              fontSize: '0.82rem'
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={issues.length > 0 || isSaving}
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-accent-primary)',
              background: issues.length > 0 ? 'transparent' : 'var(--color-accent-subtle)',
              color: issues.length > 0 ? 'var(--color-text-muted)' : 'var(--color-accent-primary)',
              cursor: issues.length > 0 || isSaving ? 'not-allowed' : 'pointer',
              fontSize: '0.82rem',
              fontWeight: 'var(--font-weight-semibold)'
            }}
          >
            {isSaving ? 'Saving…' : editing ? 'Save definition' : 'Create pipeline'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The editor with its own draft state, over the store's save action. */
export function PipelineEditorModal({
  editing,
  workspaceId,
  activeBackendUrl,
  onClose,
  onSaved
}: {
  editing?: Pipeline | null;
  workspaceId?: string | null;
  activeBackendUrl?: string | null;
  onClose: () => void;
  onSaved?: (pipeline: Pipeline) => void;
}) {
  const savePipeline = usePipelineStore(state => state.savePipeline);
  const isSaving = usePipelineStore(state => state.isSaving);
  const error = usePipelineStore(state => state.error);

  const [yaml, setYaml] = useState(editing?.yaml ?? PIPELINE_TEMPLATES[0].yaml);

  return (
    <PipelineEditorModalView
      yaml={yaml}
      onYamlChange={setYaml}
      onSelectTemplate={templateId => {
        const template = PIPELINE_TEMPLATES.find(entry => entry.id === templateId);
        if (template) setYaml(template.yaml);
      }}
      onSubmit={() => {
        void savePipeline(
          { id: editing?.id, workspaceId, yaml },
          activeBackendUrl
        ).then(pipeline => {
          // Left open on a refusal: the message names the line to fix, and
          // closing the editor would take the draft with it.
          if (pipeline) {
            onSaved?.(pipeline);
            onClose();
          }
        });
      }}
      onClose={onClose}
      editing={editing}
      isSaving={isSaving}
      error={error}
    />
  );
}
