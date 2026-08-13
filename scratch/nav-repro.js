// Reproduces the workspace shell at a narrow width with the inspector expanded.
const fs = require('fs'), path = require('path');
const tokens = fs.readFileSync('apps/web/src/styles/tokens.css', 'utf8');
const layout = fs.readFileSync('apps/web/src/styles/layout.css', 'utf8');

const tab = (label, active) => `<button class="nav-btn" style="padding:8px 18px;height:40px;font-size:var(--font-size-lg);font-weight:var(--font-weight-semibold);background:${active?'var(--color-surface-2)':'transparent'};color:${active?'#fff':'var(--color-text-secondary)'};display:flex;align-items:center;gap:6px;border-bottom:${active?'2px solid var(--color-accent-primary)':'2px solid transparent'};border-radius:var(--radius-sm) var(--radius-sm) 0 0;cursor:pointer;border-left:none;border-right:none;border-top:none;white-space:nowrap">${label}</button>`;

const TABS = ['Chat','Terminal','Changes','Memory','Settings','⚙ Environment'];

// SCROLLABLE=1 renders the fixed markup; otherwise the current markup.
const scrollable = process.env.SCROLLABLE === '1';
const stripOpen = scrollable
  ? `<div class="view-navigation-tabs" style="display:flex;gap:8px">`
  : `<div style="display:flex;gap:8px">`;
const navStyle = scrollable
  ? `display:flex;justify-content:space-between;align-items:center;padding:8px 24px;border-bottom:1px solid var(--color-border-default)`
  : `display:flex;justify-content:space-between;align-items:center;padding:8px 24px;border-bottom:1px solid var(--color-border-default)`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>${tokens}${layout}
*{box-sizing:border-box} body{margin:0;font-family:var(--font-family-sans)}
button{font-family:inherit}
</style></head><body>
<div class="workspace-shell">
  <div class="workspace-body">
    <div class="workspace-navigation-sidebar" style="align-items:center;justify-content:center;color:var(--color-text-muted)">Nav</div>
    <div class="workspace-main-content">
      <div class="view-navigation" style="${navStyle}">
        ${stripOpen}${TABS.map((t,i)=>tab(t,i===0)).join('')}</div>
        <div class="view-navigation-actions" style="display:flex;align-items:center;gap:12px"></div>
      </div>
      <div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--color-text-muted)">Main workspace</div>
    </div>
    <aside class="workspace-inspector-panel" style="width:500px;border-left:1px solid var(--color-border-subtle);background:var(--color-surface-0);display:flex;flex-direction:column;overflow:hidden;position:relative">
      <div style="padding:12px;color:var(--color-text-secondary);font-size:13px">AI Context &amp; State</div>
    </aside>
  </div>
</div></body></html>`;
fs.writeFileSync(path.resolve('scratch/nav-repro.html'), html);
console.log('wrote scratch/nav-repro.html  (scrollable=' + scrollable + ')');
