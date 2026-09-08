# Asterim Marketing Art Direction & Design System Specification

**Version**: 3.0.0  
**Target Application**: `@asterim/marketing` (`apps/marketing`)  
**Design Tier Benchmark**: Linear, Cursor, Raycast, Vercel  

---

## 1. Primary Design System Laws

### Law 1: The Website IS the Product
All product UI previews must look and feel like real, working React software from `apps/web`. Static SaaS illustrations, fake card grids, and generic mockup graphics are strictly banned.

### Law 2: Motion Communicates Causality
Animations must reflect real system state events (agent streaming logs, AST security command interception, environment scope switching, multi-agent thread execution). Floating decorative blobs or meaningless floating cards are forbidden.

### Law 3: Spacing & Visual Rhythm
Maintain spatial dignity and breathing room across all viewports. Every section uses standardized vertical rhythm (`padding: 104px 24px` desktop / `64px 20px` mobile).

### Law 4: Anti-Card Policy
Repeating 3x3 or 2x3 rounded icon boxes ("card slop") is prohibited. Content must be structured using open 2-column split views, hairline dividers (`border-t border-slate-800/60`), and full-width interactive workstation frames.

---

## 2. Color Palette & Surgical Emerald Standard

| Token | Color Value | Role & Application |
| :--- | :--- | :--- |
| `--bg-dark` | `#070a10` | Viewport background (Strictly NO `#000000`, NO purple glows) |
| `--bg-surface` | `#0d1424` | Workstation panels, navbar chrome, header bars |
| `--bg-elevated` | `#121b30` | Popovers, modals, elevated workstation panels |
| `--bg-terminal` | `#04070d` | Code diff containers and terminal log viewports |
| `--border-subtle` | `rgba(255, 255, 255, 0.06)` | Hairline slate section dividers and panel boundaries |
| `--border-hover` | `rgba(255, 255, 255, 0.14)` | Subtle element hover boundaries |
| `--border-accent` | `rgba(16, 185, 129, 0.35)` | Active execution, security clearance, and focus ring boundary |
| `--text-primary` | `#f8fafc` | Primary headlines and high-contrast titles |
| `--text-secondary` | `#94a3b8` | Subheads, descriptive paragraphs, and tab labels |
| `--text-muted` | `#64748b` | Captions, metadata, inactive tab indicators |
| `--accent-emerald` | `#10b981` | **Surgical Emerald**: Signal color ONLY (Active execution, status, CTAs) |
| `--accent-emerald-hover` | `#34d399` | Hover state for primary emerald buttons & badges |
| `--hazard-red` | `#ef4444` | AST security intercepted hazard alert state |

### Surgical Emerald Rule
Emerald `#10b981` is reserved strictly for signal indicators:
- Active agent execution badges
- Passed AST security clearances
- Primary conversion CTAs
- Focused keyboard navigation outlines (`outline: 2px solid #10b981`)

*Banned*: Decorative text fill gradients in emerald, unanchored green radial blobs, or green borders on inactive cards.

---

## 3. Typography System

- **Display & Headlines**: Satoshi or Geist
  - Hero H1: `font-size: clamp(2.75rem, 5.5vw, 4.75rem); font-weight: 800; letter-spacing: -0.035em; line-height: 1.05;`
  - Section H2: `font-size: clamp(2.0rem, 3.8vw, 3.0rem); font-weight: 800; letter-spacing: -0.025em; line-height: 1.12;`
  - Subhead H3: `font-size: 1.25rem; font-weight: 700; letter-spacing: -0.015em;`
- **Body Text**: Inter
  - Lead: `font-size: 1.15rem; color: #94a3b8; line-height: 1.65; max-width: 720px;`
  - Body: `font-size: 0.95rem; color: #cbd5e1; line-height: 1.6;`
- **Terminal / Logs / Code Diffs**: JetBrains Mono
  - Code/Log: `font-family: 'JetBrains Mono', monospace; font-size: 0.84rem; line-height: 1.6; font-weight: 500;`

---

## 4. UI Shell & Workstation Surfaces

```css
.workstation-frame {
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: #070a10;
  box-shadow: 0 32px 96px rgba(0, 0, 0, 0.85);
  overflow: hidden;
}

.workstation-header {
  height: 40px;
  background: #0d1424;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.terminal-viewport {
  background: #04070d;
  font-family: 'JetBrains Mono', monospace;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
}
```
