# Asterim Marketing Art Direction Specification

**Version**: 2.0.0  
**Target Application**: `@asterim/marketing` (`apps/marketing`)  
**Design Skills Applied**: `design-taste-frontend`, `scroll-experience`, `frontend-design`, `frontend-design-review`  

---

## 1. Primary Typography System

### Display & Headlines
- **Typeface**: **`Satoshi`** (Primary Display Face)
- **Hero H1**: `font-family: 'Satoshi', 'Inter', sans-serif; font-size: clamp(2.75rem, 5.5vw, 4.75rem); font-weight: 800; letter-spacing: -0.035em; line-height: 1.05;`
- **Section H2**: `font-family: 'Satoshi', 'Inter', sans-serif; font-size: clamp(2.0rem, 3.8vw, 3.0rem); font-weight: 800; letter-spacing: -0.025em; line-height: 1.12;`
- **Subhead H3**: `font-family: 'Satoshi', 'Inter', sans-serif; font-size: 1.25rem; font-weight: 700; letter-spacing: -0.015em;`

### Code & Terminal Metadata
- **Typeface**: **`JetBrains Mono`**
- **Terminal Logs & Code Diffs**: `font-family: 'JetBrains Mono', monospace; font-size: 0.84rem; line-height: 1.6; font-weight: 500;`

### Body & Paragraphs
- **Typeface**: **`Inter`**
- **Section Lead**: `font-size: 1.15rem; color: #94a3b8; line-height: 1.65; max-width: 720px;`
- **Standard Body**: `font-size: 0.95rem; color: #cbd5e1; line-height: 1.6;`

---

## 2. Color Composition & Palette Calibration

| Token | Color Code / RGBA | Role & Application |
| :--- | :--- | :--- |
| `--bg-dark` | `#070a10` | Deep technical charcoal viewport background (Strictly NO `#000000`, NO purple gradients) |
| `--bg-surface` | `#0d1424` | Calm slate workstation panels & navigation chrome |
| `--bg-elevated` | `#121b30` | Elevated workstation panels & popovers |
| `--border-subtle` | `rgba(255, 255, 255, 0.06)` | Hairline slate dividers and subtle section borders |
| `--border-hover` | `rgba(255, 255, 255, 0.14)` | Hover boundary state |
| `--border-accent` | `rgba(16, 185, 129, 0.35)` | Active execution & focus ring boundary |
| `--text-primary` | `#f8fafc` | Primary headlines and high-contrast titles |
| `--text-secondary` | `#94a3b8` | Subheads, descriptive paragraphs, and labels |
| `--text-muted` | `#64748b` | Metadata, captions, and inactive tabs |
| `--accent-green` | `#10b981` | Surgical emerald accent (CTAs, active execution state, status indicators) |
| `--accent-green-hover` | `#34d399` | Hover state for emerald buttons & active links |

*Surgical Emerald Rule*: Emerald `#10b981` must NOT become the identity of every section. It is reserved strictly for active execution states, approved security clearance, and primary CTAs. Banned from decorative text fills and unanchored radial background glows.

---

## 3. Spatial & Structural Language

- **Container Scale**: `max-width: 1180px; margin: 0 auto;`
- **Section Rhythm**: `padding: 104px 24px;` (Desktop) / `padding: 64px 20px;` (Mobile).
- **Anti-Card Overuse Policy**: Omit container boxes when `border-t border-slate-800/60`, `divide-y`, or open whitespace groups content cleanly.
- **Visual Variety**: Alternating layout patterns across the 10 acts (asymmetric hero, open 2-column split screens, full-width Workstation UI compositions, sticky workflow engines, and ecosystem pipeline grids).

---

## 4. Shape & Surface Language

- **Workstation UI Shell**: `border-radius: 16px; border: 1px solid rgba(255,255,255,0.08); background: #070a10; shadow: 0 40px 100px rgba(0,0,0,0.9);`
- **Inner Panels & Code Diffs**: `border-radius: 8px; border: 1px solid rgba(255,255,255,0.06); background: #04070d;`
- **CTAs & Buttons**: `border-radius: 6px;`

---

## 5. Motion & Causality System

Every animation communicates a system event:
- **Agent Output Streaming**: Real-time terminal log appends.
- **Diff Reveal**: Staged code patch appearance upon agent tool call.
- **AST Security Interception**: Dangerous command analysis and clearance prompt.
- **Environment Context Switch**: Visually updates workspace root paths, scoped credentials, attached MCP tools, and file access policies.
