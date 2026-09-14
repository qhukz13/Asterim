# Asterim Phase 1.5 Design Audit & Review

## Overview

This document provides a comprehensive design audit of Asterim following the completion of Phase 1. As Asterim transitions from functional architecture to a commercial-grade desktop product for autonomous AI engineering teams, every visual token, component behavior, spacing rhythm, and layout density has been systematically audited against leading developer tools (Linear, Cursor, Raycast, Warp, GitHub Desktop, Apple Pro Apps, and Vercel Dashboard).

---

## Audit Methodology & Evaluation Criteria

Each category is audited across five parameters:
- Current Status: Precise description of current implementation in `tokens.css`, `layout.css`, and UI components.
- Identified Problems: Specific visual or functional deficits causing visual noise, illegibility, or friction.
- Commercial Quality Score: 1–10 scale rating against tier-1 engineering tools (10 = Linear/Cursor tier).
- Improvement Plan: Direct engineering and design remediation steps.
- Priority: P0 (Critical/Blocker), P1 (High/Essential), P2 (Medium/Enhancement), P3 (Polish).

---

## 1. Typography & Readability

### Current Status
- Font Stack: `Inter` for UI sans-serif, `JetBrains Mono` for code & terminal output.
- Scale: Base font sizes defined in `tokens.css`: `--font-size-xs` (12px), `--font-size-sm` (13.5px), `--font-size-md` (15px), `--font-size-lg` (15px), `--font-size-xl` (20px).
- Line Heights: `--line-height-tight` (1.25), `--line-height-normal` (1.55), `--line-height-code` (1.50), `--line-height-relaxed` (1.65).

### Identified Problems
- Font Sizing Inconsistencies: `--font-size-md` and `--font-size-lg` are both mapped to `15px`, eliminating clear typographic scale steps between panel headers and body text.
- Inline Style Pollution: Multiple components override tokens with hardcoded pixel font sizes (e.g. `10px`, `1.8rem`, `1.35`, `0.85em`), creating visual disharmony across sidebar and chat views.
- Mono Alignment & Tabular Figures: Monospace numbers and metadata in top bar and session sidebar lack `font-variant-numeric: tabular-nums`, leading to subtle layout shifts when agent elapsed timers update.
- Line Height Conflicts: Body paragraphs in chat render with un-clamped line heights, leading to vertical loose text density during 8+ hour coding sessions.

### Commercial Quality Score
- Score: 6/10

### Improvement Plan
- Establish a strict 6-step fluid modular typographic scale (`11px` micro, `12px` caption/mono, `13px` body-dense, `14px` body-standard, `16px` subhead, `20px` title).
- Enforce strict font-weight hierarchy: 400 (regular body), 500 (medium labels), 600 (semibold headers). Eliminate 700 (bold) from body text to preserve calm visual aesthetics.
- Replace all hardcoded pixel overrides in components with standardized CSS token references.
- Apply `font-feature-settings: "cv02", "cv03", "cv04", "cv11", "tnum"` for Inter and tabular figures across all timestamps and status indicators.

### Priority
- Priority: P0

---

## 2. Spacing, Grid & Visual Rhythm

### Current Status
- Base Scale: 4px base grid (`--spacing-1: 4px`, `--spacing-2: 8px`, `--spacing-3: 12px`, `--spacing-4: 16px`, `--spacing-5: 20px`, `--spacing-6: 24px`, `--spacing-8: 32px`).
- Control Heights: `--control-height-sm` (32px), `--control-height-md` (36px), `--control-height-lg` (42px), `--control-height-input` (48px).

### Identified Problems
- Vertical Rhythm Disruption: Components mix `--spacing-2` and `--spacing-3` without consistent padding tokens for cards, toolbars, and list items.
- Panel Margin Drift: `ChatView` uses `padding: 12px 16px`, whereas `SessionSidebar` uses `padding: 8px`, creating uneven visual gutters between columns.
- Control Height Mismatches: Buttons and input controls in `ChatInput` use ad-hoc inline styles instead of adhering to standard control height tokens.

### Commercial Quality Score
- Score: 6/10

### Improvement Plan
- Standardize panel padding across all 3 columns to a unified spacing rhythm: 12px horizontal inset for sidebars, 16px horizontal inset for main workspace canvas.
- Lock all interactive input controls to strict 32px (dense), 36px (standard), or 44px (chat input) height specs.
- Enforce strict alignment along the 4px baseline grid using CSS flexbox gap variables exclusively.

### Priority
- Priority: P0

---

## 3. Surface Hierarchy, Elevation & Color System

### Current Status
- Surface Layers: 4-tier dark mode stack (`--color-surface-0: #080a0f`, `--color-surface-1: #10141e`, `--color-surface-2: #181d2b`, `--color-surface-3: #222838`).
- Accent Color: Blue accent (`--color-accent-primary: #3b82f6`).
- Borders: `rgba(255, 255, 255, 0.08)` for subtle splitters, `rgba(255, 255, 255, 0.14)` for cards/controls.

### Identified Problems
- Color Identity Mismatch: Blue primary accent (`#3b82f6`) creates a generic SaaS appearance that conflicts with Asterim's core `DESIGN_SYSTEM.md` requirement for a monochrome palette with a single high-contrast engineering accent green (`#10b981` / `#059669`).
- Excess Surface Noise: `#181d2b` and `#222838` contain strong blue-purple tints that look like generic consumer apps rather than high-precision tools like Linear or Warp.
- Border Contrast Bleed: Borders are overly visible under low-light conditions, creating heavy gridlines that draw attention away from code content.

### Commercial Quality Score
- Score: 5/10

### Improvement Plan
- Shift surface color palette to a neutral slate-graphite system (`--color-surface-0: #0b0c0e`, `--color-surface-1: #121417`, `--color-surface-2: #191c20`, `--color-surface-3: #22262c`).
- Re-align primary accent color to high-precision engineering Emerald/Green (`--color-accent-primary: #10b981`), matching terminal execution aesthetics.
- Tune borders to subtle dark-mode hairlines (`rgba(255, 255, 255, 0.06)` for structural dividers, `rgba(255, 255, 255, 0.12)` for interactive elements).
- Eliminate all loud background gradients and replace with subtle, 1px inset highlights (`box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05)`).

### Priority
- Priority: P0

---

## 4. UI Components & Panel Review

### TopBar & Navigation
- Current Status: Top bar displays brand icon, project name, mission title, agent execution status pill, workstation badge, and ⌘K trigger.
- Problems: Agent status pill uses bright round badges with emoji symbols (`⚡`, `⚠️`, `✓`). Mission title container has rounded pill background that clashes with panel headers.
- Quality Score: 6/10
- Plan: Convert status pill into a sleek monochrome status badge with precise dot indicators. Clean up mission text alignment.

### Sidebar (Project & Session Navigation)
- Current Status: Two left sidebars (`NavigationSidebar` and `SessionSidebar`) with collapsible drag handles.
- Problems: Hover states lack smooth micro-transitions. Active session item uses solid background without active indicator bar. Section headers use text-transform uppercase with inconsistent tracking.
- Quality Score: 6.5/10
- Plan: Implement a 2px left border highlight for active sessions. Refine section headers with `11px` uppercase tracking (`letter-spacing: 0.06em`).

### Inspector Panel
- Current Status: Displays workstation details, agent configuration, active tool execution logs, and environment context.
- Problems: Tab controls lack active underline indicator. Key-value inspect rows lack structured mono alignment.
- Quality Score: 6/10
- Plan: Upgrade inspector to use tabbed line navigation with smooth transition, tabular key-value formatting, and mono value copy buttons.

### Chat Input & Execution Controls
- Current Status: Multiline text input with action buttons for send, stop, clear chat, and agent selection.
- Problems: Input area lacks distinct focus ring state. Send button does not indicate keyboard shortcut (`⌘Enter`). Stop execution button lacks clear danger highlight.
- Quality Score: 6/10
- Plan: Wrap input in an elevated container with subtle focus ring. Add visible keyboard shortcut tooltips (`⌘↵` for send).

### Terminal Panel (`XTerminal`)
- Current Status: Renders terminal emulator using Xterm.js for interactive shell execution.
- Problems: Padding around xterm canvas feels raw. Shell header bar lacks quick action controls (clear, font resize, popout).
- Quality Score: 7/10
- Plan: Add a polished terminal header bar with status indicator, clear output action, and clean padding around canvas.

### Changes & Diff View
- Current Status: Displays diff output for file modifications made by autonomous agents.
- Problems: Diff blocks in chat and inspector lack unified side-by-side / unified toggle. Line additions/deletions use overly saturated green/red fills.
- Quality Score: 5.5/10
- Plan: Mute diff background tints (`rgba(16, 185, 129, 0.1)` for additions, `rgba(239, 68, 68, 0.1)` for deletions) with crisp 2px gutter indicators.

### Priority
- Priority: P1

---

## 5. States, Polish, Motion & Microinteractions

### Current Status
- Motion: Basic CSS transitions (`0.15s ease`) on hover states.
- Microinteractions: Minimal. No copy feedback toasts, drop indicators, or keyboard shortcut animations.
- Icons: Mixed inline SVG and plain unicode text symbols (`▸`, `▼`, `▶`).
- Empty States: Generic text blocks (`No projects found`, `No messages in active thread`) with decorative emojis.

### Identified Problems
- Emoji Usage Violation: Components contain decorative emojis (`💬`, `⚡`, `🎯`, `📝`) contrary to the product's engineering design guidelines.
- Unrefined Motion: Modal popovers and tooltips appear instantly without subtle scaling or fade transitions.
- Lack of Micro-Feedback: Copying code blocks or file paths does not show inline checkmark confirmation.

### Commercial Quality Score
- Score: 5/10

### Improvement Plan
- Purge all decorative emojis from section headers and status badges. Replace with clean SVG icons or typographic badges.
- Introduce a unified motion physics system: `120ms cubic-bezier(0.16, 1, 0.3, 1)` for micro-interactions (buttons, dropdowns, tab switches), `180ms cubic-bezier(0.16, 1, 0.3, 1)` for panels/modals.
- Implement explicit micro-feedback for copy actions, thread selection, and agent execution transitions.
- Redesign empty states with clean vector icon placeholders, helpful guidance text, and quick action shortcuts.

### Priority
- Priority: P1

---

## Summary Matrix

| Category | Current Score | Target Score | Primary Blocker | Priority |
| :--- | :--- | :--- | :--- | :--- |
| Typography & Readability | 6/10 | 9.5/10 | Dual 15px font step; hardcoded pixel inline styles | P0 |
| Spacing & Grid | 6/10 | 9.5/10 | Irregular panel margins & control height gaps | P0 |
| Color System & Surfaces | 5/10 | 10/10 | Blue SaaS accent; purple dark surface tint | P0 |
| Component Polish | 6/10 | 9.5/10 | Ad-hoc buttons, tab headers, & diff styling | P1 |
| States & Microinteractions | 5/10 | 9.0/10 | Decorative emojis; missing transition physics | P1 |

