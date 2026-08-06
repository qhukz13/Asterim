# Asterim Chat Rendering Engine Review & Audit

## Overview

Asterim is a Mission Control for Autonomous AI Coding Agents. In professional engineering workflows, AI agent outputs are not simple conversational replies; they are complex technical deliverables—pull request reviews, architecture proposals, diff breakdowns, execution logs, automated test summaries, and design reviews.

This audit evaluates Asterim's current chat rendering capabilities, identifies every rendering limitation, and establishes standards to transform chat into a tier-1 engineering document canvas.

---

## Message Type Audit & Rendering Limitations

### 1. Markdown Tables

#### Current Behavior
Tables are rendered as plain unstyled HTML table tags with default browser borders, leading to unaligned columns, clipped cell text, and lack of visual density control.

#### Expected Behavior
Render high-density, horizontal scroll-supported tables with fixed header rows, subtle grid borders (`var(--color-border-subtle)`), zebra striping (`var(--color-surface-1)` / `var(--color-surface-2)`), tabular numeric font alignment, and copy-table data capabilities.

#### Severity
High

#### Implementation Complexity
Medium

#### Priority
P0

---

### 2. Code Blocks & Syntax Highlighting

#### Current Behavior
Uses basic `react-syntax-highlighter` with `vscDarkPlus` theme, basic language badge, no line numbers, no copy button, no file path banner, and no inline diff highlighting.

#### Expected Behavior
Render engineering-grade code blocks featuring:
- Top bar banner with language icon, file path, line count, and one-click copy button.
- Toggleable line numbers.
- Diff line highlights (green background for `+` lines, red background for `-` lines).
- Neutral slate syntax theme aligned with Asterim's monochrome palette.

#### Severity
High

#### Implementation Complexity
Medium

#### Priority
P0

---

### 3. Callouts & Alert Blocks (`> [!NOTE]`, `> [!WARNING]`, etc.)

#### Current Behavior
GitHub-style markdown callouts render as generic grey blockquotes (`>`) without distinct border colors, icons, or visual hierarchy.

#### Expected Behavior
Full support for GitHub & Obsidian callout formats (`NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`):
- Colored left border indicator (`2px solid`).
- Muted background tint matching callout severity.
- Clean typographic title badge without emoji noise.

#### Severity
High

#### Implementation Complexity
Low

#### Priority
P0

---

### 4. File References & Workspace Hyperlinks

#### Current Behavior
File links like `[App.tsx](file:///path/to/App.tsx#L10-L20)` render as plain text or standard browser hyperlinks that attempt page navigation instead of opening in Asterim's inspector or terminal.

#### Expected Behavior
Render interactive workspace file chips:
- Monospace chip styling (`var(--font-family-mono)`).
- Icon indicator for file extension (`.ts`, `.tsx`, `.css`, `.json`).
- Line number badge (`L10-L20`).
- Click-to-inspect trigger opening the target file in Asterim's inspector panel.

#### Severity
High

#### Implementation Complexity
Medium

#### Priority
P0

---

### 5. Images & Before/After Screenshot Galleries

#### Current Behavior
Standard Markdown `![caption](url)` images render full width without max-height constraints, lightbox zoom, or side-by-side screenshot comparisons.

#### Expected Behavior
- Constrained inline image preview with rounded corners and subtle border.
- Click-to-zoom lightbox overlay.
- Before/After comparison carousel viewer for visual design & layout PR reviews.

#### Severity
Medium

#### Implementation Complexity
Medium

#### Priority
P1

---

### 6. Checklists & Task Lists

#### Current Behavior
Task list items (`- [ ]`, `- [x]`) render as unstyled native browser checkboxes that cannot be toggled interactively.

#### Expected Behavior
Custom styled, high-precision checkboxes with strikethrough styling for completed engineering tasks, real-time completion counter (`3/5 tasks done`), and keyboard toggle capability.

#### Severity
Medium

#### Implementation Complexity
Low

#### Priority
P1

---

### 7. Collapsible Sections & Tool Execution Accordions

#### Current Behavior
Tool accordions use custom text tags (`▸ Thought`, `[Tool:`) with basic expand/collapse toggles and text symbols (`▸`, `⚡`, `📝`).

#### Expected Behavior
Native support for HTML `<details>`/`<summary>` elements and streamlined agent thought/tool accordions with clean micro-transitions, execution duration timers (`1.4s`), and copy log output.

#### Severity
Medium

#### Implementation Complexity
Medium

#### Priority
P1

---

### 8. Status Badges & Keyboard Shortcut Chips

#### Current Behavior
Inline shortcuts like `⌘K` or `Ctrl+Enter` render as plain text inside parentheses. Statuses render as unstyled text strings.

#### Expected Behavior
- Native `<kbd>` keyboard chip rendering (`kbd` tags styled as elevated mono caps).
- Inline status badges for build results (`PASSED`, `FAILED`, `PENDING`) using high-contrast, subtle background fills.

#### Severity
Low

#### Implementation Complexity
Low

#### Priority
P2

---

### 9. Pull Request Reports & Technical Documentation Viewers

#### Current Behavior
Long engineering summaries render as continuous text streams without jump-to-section navigation or table-of-contents sidebars.

#### Expected Behavior
Structured technical report card component containing:
- Sticky mini table-of-contents header for long document streams.
- Stat summary bar (files modified, lines added/deleted, test pass rate).
- One-click copy raw markdown action.

#### Severity
Medium

#### Implementation Complexity
High

#### Priority
P2

---

## Audit Summary Table

| Feature / Element | Current Status | Expected Behavior | Severity | Complexity | Priority |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Markdown Tables | Unstyled HTML | High-density grid table with copy data | High | Medium | P0 |
| Code Blocks & Syntax | Basic Prism | Path banner, line numbers, diff highlight | High | Medium | P0 |
| Callout Alerts | Generic quote | GitHub-style alert callouts | High | Low | P0 |
| File References | Plain link | Workspace interactive file chip | High | Medium | P0 |
| Image & Screenshot Galleries | Raw image tag | Lightbox & Before/After carousel | Medium | Medium | P1 |
| Task Checklists | Native checkbox | Styled task item & progress tracker | Medium | Low | P1 |
| Collapsible Accordions | Text parsing | Native details/summary + execution timer | Medium | Medium | P1 |
| Shortcuts & Badges | Plain text | Native `<kbd>` chips & build badges | Low | Low | P2 |
| Technical Reports | Continuous stream | Stat header & section navigation | Medium | High | P2 |

