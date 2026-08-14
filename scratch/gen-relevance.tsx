/**
 * Builds scratch/relevance-explorer.html — the drift filter in both states.
 * Run: pnpm --filter @asterim/web exec tsx ../../scratch/gen-relevance.tsx
 */
import fs from 'fs';
import path from 'path';

(globalThis as any).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
(globalThis as any).fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });

const root = path.resolve(__dirname, '..');

async function main() {
  // Resolved from apps/web, not from scratch/: the repo root hoists react-dom 19
  // (the marketing app) while the dashboard is on react 18, and mixing the two
  // gives "Invalid hook call" rather than markup.
  const React = (await import(path.join(root, 'apps/web/node_modules/react/index.js'))).default;
  const { renderToStaticMarkup } = await import(path.join(root, 'apps/web/node_modules/react-dom/server.js'));
  const { DecisionExplorerView } = await import(path.join(root, 'apps/web/src/components/memory/DecisionExplorer'));
  const tokens = fs.readFileSync(path.join(root, 'apps/web/src/styles/tokens.css'), 'utf8');

  const d = (over: any) => ({
    id: 'd', projectId: 'p', title: '', summary: '', rationale: '', constraints: [],
    status: 'ACTIVE', supersededBy: null, provenance: 'HUMAN_CONFIRMED', confidence: 0.9,
    createdAt: 1_752_000_000_000, updatedAt: 1_752_000_000_000, relatedFiles: [], ...over
  });

  const decisions = [
    d({
      id: 'k',
      title: 'Rotate the signing key every 90 days',
      summary: 'Keys are issued with a 90-day lifetime and rotated on a schedule.',
      constraints: ['Never reuse a retired key id'],
      relatedFiles: ['apps/server/src/services/security/keys.ts']
    }),
    d({
      id: 'a',
      title: 'Hash passwords with Argon2id',
      summary: 'Argon2id at 64 MiB memory cost, not bcrypt.',
      provenance: 'AGENT_STATEMENT',
      confidence: 0.75,
      relatedFiles: ['apps/server/src/services/AuthService.ts']
    }),
    d({
      id: 's',
      title: 'Sessions are stored server-side',
      summary: 'The cookie carries an opaque id, never claims.',
      relatedFiles: ['apps/server/src/services/SessionService.ts']
    })
  ];

  const drift = {
    k: {
      decisionId: 'k',
      drifted: true,
      worst: 'FILE_DELETED',
      refs: [{ refId: 'r1', filePath: 'apps/server/src/services/security/keys.ts', type: 'FILE_DELETED', detail: 'apps/server/src/services/security/keys.ts no longer exists' }]
    },
    a: {
      decisionId: 'a',
      drifted: true,
      worst: 'SYMBOL_NOT_FOUND',
      refs: [{ refId: 'r2', filePath: 'apps/server/src/services/AuthService.ts', symbolName: 'hashPassword', type: 'SYMBOL_NOT_FOUND', detail: 'hashPassword is no longer in AuthService.ts' }]
    },
    s: { decisionId: 's', drifted: false, worst: null, refs: [] }
  };

  const props = { projectId: 'p', decisions, rules: [], activeIntent: null, briefing: null, drift, loading: false, error: null };

  const all = renderToStaticMarkup(React.createElement(DecisionExplorerView, { ...props } as any));
  const only = renderToStaticMarkup(
    React.createElement(DecisionExplorerView, { ...props, initialDriftFilter: 'drifted' } as any)
  );

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${tokens}
    body{margin:0;background:var(--color-surface-0);color:var(--color-text-primary);font-family:var(--font-family-sans)}
    .pane{width:1360px}
    .cap{font:600 11px var(--font-family-sans);letter-spacing:.08em;text-transform:uppercase;color:var(--color-text-muted);padding:20px 24px 0}
  </style></head><body>
  <div class="pane"><div class="cap">Drift filter — All</div>${all}</div>
  <div class="pane"><div class="cap">Drift filter — Drifted only</div>${only}</div>
  </body></html>`;

  fs.writeFileSync(path.join(root, 'scratch/relevance-explorer.html'), html);
  console.log('wrote scratch/relevance-explorer.html');
}

void main();
