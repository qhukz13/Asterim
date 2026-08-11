# Asterim Design System Specification

**Version**: 1.0.0 (Phase 4.5 Marketing & Product Presentation)  
**Target Package**: `@asterim/marketing`  
**Source of Truth File**: `apps/marketing/src/index.css`  

---

## 1. Typography Tokens

- **Display & Section Headings**: `Geist`, `Satoshi`, or `Outfit` sans-serif stack.
  - Hero H1: `font-size: clamp(2.5rem, 5.2vw, 4.5rem); font-weight: 800; letter-spacing: -0.03em; line-height: 1.08;`
  - Section H2: `font-size: clamp(1.85rem, 3.5vw, 2.75rem); font-weight: 800; letter-spacing: -0.02em; line-height: 1.15;`
  - Card H3: `font-size: 1.25rem; font-weight: 700; letter-spacing: -0.01em;`
- **Body & Paragraphs**: `Inter` sans-serif stack.
  - Section Lead: `font-size: 1.15rem; color: #94a3b8; line-height: 1.6; max-width: 740px;`
  - Standard Body: `font-size: 0.95rem; color: #cbd5e1; line-height: 1.6;`
  - Caption / Small: `font-size: 0.82rem; color: #64748b;`
- **Monospace Code & Data**: `JetBrains Mono` or `Fira Code`.
  - Terminal & Diff Logs: `font-family: 'JetBrains Mono', monospace; font-size: 0.84rem; line-height: 1.6;`

---

## 2. Color Palette Calibration

| Token Name | Hex / RGBA | Role & Application |
| :--- | :--- | :--- |
| `--bg-dark` | `#080c14` | Primary viewport background (Charcoal / Off-black; NO pure `#000000`) |
| `--bg-surface` | `#0f172a` | Primary surface containers & navigation bar |
| `--bg-elevated` | `#142036` | Elevated cards, popovers, and inspector panels |
| `--border-subtle` | `rgba(255, 255, 255, 0.05)` | Hairline dividers and quiet card boundaries |
| `--border-hover` | `rgba(255, 255, 255, 0.12)` | Interactive element hover state boundary |
| `--border-accent` | `rgba(16, 185, 129, 0.3)` | Active execution & focus ring boundary |
| `--text-primary` | `#f8fafc` | Primary headlines and high-contrast titles |
| `--text-secondary` | `#94a3b8` | Subheads, descriptive paragraphs, and labels |
| `--text-muted` | `#64748b` | Captions, metadata, and inactive tabs |
| `--accent-green` | `#10b981` | Primary emerald accent (CTAs, active execution state, status indicators) |
| `--accent-green-hover` | `#34d399` | Hover state for emerald buttons & active links |
| `--accent-green-bg` | `rgba(16, 185, 129, 0.1)` | Subtle emerald background tint |

*Strict Anti-Purple Rule*: No purple button glows, no neon radial overlays, no multi-color gradient text fills. Accent color is strictly desaturated emerald `#10b981`.

---

## 3. Spacing, Radius & Borders

- **Container Max-Width**: `max-width: 1180px; margin: 0 auto;`
- **Section Vertical Rhythm**: `padding: 96px 24px;` (Desktop) / `padding: 64px 20px;` (Mobile).
- **Corner Radii**:
  - Small (`--radius-sm`): `6px` (Buttons, inputs, status badges)
  - Medium (`--radius-md`): `10px` (Inner cards, code blocks)
  - Large (`--radius-lg`): `16px` (Workstation shell, major containers)
- **Anti-Card Overuse Policy**: Omit rounded card containers when `border-t`, `divide-y`, or open whitespace groups content cleanly.

---

## 4. Motion & Animation System

- **Timing & Easing**:
  - Interactive Hover / Focus: `transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);`
  - Stateful Workflow Step Transitions: `0.3s ease-in-out`
- **Tactile Feedback**: On button `:active`, apply `transform: scale(0.98)` or `translateY(-1px)`.
- **Accessibility (`prefers-reduced-motion`)**:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
  ```

---

## 5. Component Primitives Policy

- **Buttons**: `.btn-primary` (Emerald background `#10b981` with dark text `#042114`) and `.btn-secondary` (Subtle dark surface `#0f172a` with white text and hairline border).
- **Focus Rings**: `:focus-visible` enforces `outline: 2px solid #10b981; outline-offset: 2px;`.
- **Status Badges**: `.status-badge.available` (Emerald), `.status-badge.beta` (Sky blue), `.status-badge.planned` (Amber).
