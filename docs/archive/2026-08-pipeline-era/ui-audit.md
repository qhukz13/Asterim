# Asterim UI/UX Audit & Inconsistency Report

## Overview

This audit documents every visual, structural, and interaction inconsistency in the Asterim web frontend prior to Phase 1 implementation. Addressing these issues is required to make Asterim feel like a high-density, professional developer tool (Cursor/Linear tier) comfortable for 8+ hours of daily engineering work.

---

## 1. Design Tokens & Color Palette Inconsistencies

| Issue Area | Current State | Problem | Target Standard |
| :--- | :--- | :--- | :--- |
| **CSS Variables vs Inline Styles** | Defined in `index.css` (`--bg-color`, `--panel-bg`, `--accent-color`), but bypassed across 80%+ of components using inline hex/rgba values (e.g. `rgba(59, 130, 246, 0.2)`, `#60a5fa`, `rgba(0,0,0,0.3)`). | Prevents central theme control, causes color drift, and creates uneven contrast. | 100% tokenized color palette (`surface-0` through `surface-3`, `border-subtle`, `text-primary`, `text-secondary`, `accent-primary`). |
| **Background Gradient** | `body` contains radial ambient gradients (`rgba(59, 130, 246, 0.15)` & `rgba(16, 185, 129, 0.08)`). | Creates visual noise behind terminal and code panels, distracting from text readability. | Clean, flat, ultra-dark solid workspace background (`#0d0f14` or `#090a0f`). |
| **Status Colors** | Warning/Error/Success badge colors vary across `ApprovalOverlay` (`rgba(239, 68, 68, 0.2)`), `index.css` (`var(--success-color)`), and inline status badges. | Inconsistent visual feedback for critical state changes. | Standardized status color tokens for **Working** (Cyan), **Paused for Review** (Amber), **Waiting** (Purple), **Completed** (Emerald), **Error** (Rose). |

---

## 2. Layout, Margins & Density Inconsistencies

| Issue Area | Current State | Problem | Target Standard | PR Status |
| :--- | :--- | :--- | :--- | :--- |
| **Outer Canvas Margins** | `.app-container` applies `padding: 0; gap: 0;` (Resolved PR1/PR2). | Previously wasted 24px around screen edges. | Full-bleed workspace shell with 0px canvas margins and thin 1px panel divider borders. | ✅ Resolved (PR2) |
| **Panel Radii** | `.glass-panel` applies `border-radius: var(--radius-md)` (6px) (Resolved PR1). | Floating consumer-card appearance that lowered code reading density. | High-density tool aesthetic with subtle `radius-md` (`6px`) panel borders. | ✅ Resolved (PR1) |
| **Sidebar Padding** | Standardized to `var(--spacing-2) var(--spacing-3)` (8px 12px) across headers & items (Resolved PR2). | Unaligned text baselines and ragged alignment across sidebars. | Grid-aligned spacing token system (`spacing-1: 4px`, `spacing-2: 8px`, `spacing-3: 12px`, `spacing-4: 16px`). | ✅ Resolved (PR2) |

---

## 3. Typography & Hierarchy Inconsistencies

| Issue Area | Current State | Problem | Target Standard |
| :--- | :--- | :--- | :--- |
| **Font Family Allocation** | UI uses `Inter`, terminal uses `Consolas` or `Monaco`, and code snippets fall back to default browser monospace fonts. | Uneven code rendering across chat messages, terminal, and git diff views. | Dual-stack typography system: `Inter` for UI sans-serif, `JetBrains Mono` / `Fira Code` for all code, diffs, and terminal lines. |
| **Type Scale** | Font sizes jump arbitrarily (`0.75rem`, `0.8rem`, `0.85rem`, `0.875rem`, `0.9rem`, `0.95rem`, `1.2rem`, `1.5rem`). | Lack of visual hierarchy and awkward text scaling on high-DPI monitors. | Strict 5-tier type scale (`xs: 11px`, `sm: 12px`, `md: 13px/14px`, `lg: 16px`, `xl: 20px`). |
| **Font Weights** | Headers and labels mix `fontWeight: 700`, `600`, `500`, `'bold'`, and normal. | Inconsistent emphasis between section headers and action titles. | Fixed weight mappings (`400` body, `500` medium labels, `600` semi-bold section titles). |

---

## 4. Buttons, Inputs & Controls Inconsistencies

| Issue Area | Current State | Problem | Target Standard |
| :--- | :--- | :--- | :--- |
| **Button Variants** | 3 different button styles: `.btn-primary` (gradient + hover transform), plain unstyled `<button>` tags with inline styles, and icon action squares. | Cluttered interaction model with conflicting hover/active animations. | Unified Button System: `Primary` (Solid accent), `Secondary` (Glass border), `Ghost` (Icon hover), and `Danger` (Rose outline). |
| **Input Fields** | Chat input uses `border-radius: 12px` and `min-height: 50px`, while search in `CommandPalette` uses unbordered input with `font-size: 1.2rem`. | Disconnected typing experience across modals, chat, and command search. | Unified input styling (`radius-md`, subtle border, clear focus outline `0 0 0 2px var(--color-accent-glow)`). |
| **Dropdowns & Overlays** | Approval dropdowns and modal dialogs use floating overlays with variable z-indices (`9999` vs `10`). | Overlapping dialogs and potential z-index collision during terminal notifications. | Central modal overlay system with predictable z-index layering (`modal: 1000`, `palette: 2000`, `toast: 3000`). |

---

## 5. Navigation & State Inconsistencies

| Issue Area | Current State | Problem | Target Standard |
| :--- | :--- | :--- | :--- |
| **Active Row Highlight** | `CommandPalette` keyboard navigation & row selection: Tokenized hover (`var(--color-surface-2)`), active accent highlight (`var(--color-accent-hover)`), and keyboard arrow selection (Resolved PR5). | Standardized row highlighting across dropdowns, lists, and command palette. | Unified selection state token (`bg-surface-hover` + subtle left accent indicator or high-contrast row background). | ✅ Resolved (PR5) |
| **Agent State Signals** | Rich Execution State Pill in TopBar: **Working** Cyan, **Paused for Review** Amber (300s timer), **Completed** Emerald (Resolved PR3). | Users can instantly see live agent state and execution status without scrolling log text. | Standardized Agent State Pills: **Working** (animated glow), **Paused for Review** (amber indicator), **Waiting**, **Completed**, **Error**. | ✅ Resolved (PR3) |
| **Empty States** | AI-First Inspector Panel: Removed all empty placeholder cards ("No mission extracted", "Git metadata will be displayed here"). (Resolved PR4). | Every visible card provides immediate value (Agent Activity, Action Review, Pinned Context). | Helpful, clean empty states with clear 1-click CTA buttons and hotkey suggestions (`⌘K` to open project). | ✅ Resolved (PR4) |
