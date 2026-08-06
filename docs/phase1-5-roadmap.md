# Asterim Phase 1.5 Implementation Roadmap

## Overview

This roadmap details the sequential Pull Requests required to execute Phase 1.5. Every PR targets a specific layer of the UI system—ranging from foundational design tokens and typography to rich chat rendering and microinteractions.

The goal is to elevate Asterim's UX quality to match tier-1 developer software (Linear, Cursor, Raycast, Warp, GitHub Desktop, Apple Pro Apps, Vercel Dashboard).

---

## Roadmap Overview

```
PR8: Typography & Scale Standardizations
 └──> PR9: Spacing & Grid System Refinement
       └──> PR10: Surface Hierarchy & Hairline Depth
             └──> PR11: Engineering Monochrome & Emerald Color Identity
                   └──> PR12: Motion Physics & State Transitions
                         └──> PR13: Microinteractions & Feedback Loops
                               └──> PR14: Chat Rendering Engine Polish
                                     └──> PR15: Final Consistency Pass & Commercial Launch Audit
```

---

## Detailed PR Breakdown

### PR8: Typography & Scale Standardization

#### Purpose
Establish a precise 6-step fluid typographic scale, enforce proper font feature settings for tabular numbers, and eliminate inline font size overrides across all components.

#### Files Affected
- `apps/web/src/styles/tokens.css`
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/TopBar.tsx`
- `apps/web/src/components/NavigationSidebar.tsx`
- `apps/web/src/components/SessionSidebar.tsx`
- `apps/web/src/components/InspectorPanel.tsx`

#### Expected UX Improvement
Eliminates text sizing disarray. Panel titles, metadata, and body text will feature crisp visual hierarchy and effortless 8+ hour reading comfort.

#### Difficulty
Medium

#### Risk
Low (CSS token remapping and component class updates).

#### Implementation Order
1

---

### PR9: Spacing & Grid System Refinement

#### Purpose
Standardize panel padding, margins, and control heights across the 3-column workstation shell using a strict 4px grid rhythm.

#### Files Affected
- `apps/web/src/styles/tokens.css`
- `apps/web/src/styles/layout.css`
- `apps/web/src/components/WorkspaceShell.tsx`
- `apps/web/src/components/NavigationSidebar.tsx`
- `apps/web/src/components/SessionSidebar.tsx`
- `apps/web/src/components/InspectorPanel.tsx`
- `apps/web/src/components/ChatInput.tsx`

#### Expected UX Improvement
Uniform column gutters, consistent button heights (32px / 36px / 44px), and perfectly aligned headers across all panels.

#### Difficulty
Medium

#### Risk
Low

#### Implementation Order
2

---

### PR10: Surface Hierarchy & Hairline Depth

#### Purpose
Refine the dark mode surface stack (`#0b0c0e` canvas to `#22262c` overlay) and replace thick border lines with high-contrast, sub-pixel hairlines and inset highlights.

#### Files Affected
- `apps/web/src/styles/tokens.css`
- `apps/web/src/styles/layout.css`
- `apps/web/src/index.css`
- `apps/web/src/components/TopBar.tsx`
- `apps/web/src/components/InspectorPanel.tsx`

#### Expected UX Improvement
Reduces visual noise and creates subtle spatial depth, making content pop out cleanly without heavy grid lines.

#### Difficulty
Medium

#### Risk
Low

#### Implementation Order
3

---

### PR11: Engineering Monochrome & Emerald Color Identity

#### Purpose
Transition primary accent from blue SaaS (`#3b82f6`) to a crisp engineering Emerald/Green (`#10b981`), align status badges to precise terminal color tokens, and remove all loud background gradients.

#### Files Affected
- `apps/web/src/styles/tokens.css`
- `apps/web/src/components/TopBar.tsx`
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/SessionSidebar.tsx`
- `apps/web/src/components/git/GitChangesView.tsx`

#### Expected UX Improvement
Gives Asterim an instantly recognizable, high-precision engineering brand identity while reducing eye strain.

#### Difficulty
Low

#### Risk
Low

#### Implementation Order
4

---

### PR12: Motion Physics & State Transitions

#### Purpose
Implement standard transition durations (`120ms` micro, `180ms` macro) and custom cubic-bezier easing (`cubic-bezier(0.16, 1, 0.3, 1)`) for accordion drawers, command palette overlays, tabs, and hover states.

#### Files Affected
- `apps/web/src/styles/tokens.css`
- `apps/web/src/index.css`
- `apps/web/src/components/CommandPalette.tsx`
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/InspectorPanel.tsx`

#### Expected UX Improvement
Eliminates sluggish or abrupt UI transitions. Interactions feel fluid, immediate, and high-performance.

#### Difficulty
Medium

#### Risk
Low

#### Implementation Order
5

---

### PR13: Microinteractions & Feedback Loops

#### Purpose
Add explicit micro-feedback for copying code blocks, selecting threads, dispatching agent actions, and keyboard navigation. Purge all decorative emojis from section headers and replace with clean typography or SVG icons.

#### Files Affected
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/TopBar.tsx`
- `apps/web/src/components/SessionSidebar.tsx`
- `apps/web/src/components/InspectorPanel.tsx`
- `apps/web/src/components/ChatInput.tsx`

#### Expected UX Improvement
Provides instant tactile confirmation for user actions, increasing confidence and speed during complex agent sessions.

#### Difficulty
Medium

#### Risk
Low

#### Implementation Order
6

---

### PR14: Chat Rendering Engine Polish

#### Purpose
Upgrade `ChatView` markdown rendering to support full GFM tables, formatted callout boxes (`> [!NOTE]`, `> [!IMPORTANT]`), interactive code block copy/syntax headers, file reference badges, collapsible execution accordions, and technical report components.

#### Files Affected
- `apps/web/src/ChatView.tsx`
- `apps/web/src/index.css`
- `apps/web/src/components/MarkdownRenderers.tsx` (NEW)

#### Expected UX Improvement
Transforms agent outputs into publication-quality engineering reports matching GitHub PRs and Linear issue documents.

#### Difficulty
High

#### Risk
Medium (Requires rigorous testing against long Markdown streams).

#### Implementation Order
7

---

### PR15: Final Consistency Pass & Commercial Launch Audit

#### Purpose
Perform a complete end-to-end verification of all screens, state variations, light/dark contrast standards, keyboard navigation loops, and production build bundle output.

#### Files Affected
- All application source files in `apps/web/src/`

#### Expected UX Improvement
Ensures 100% visual polish, zero regressions, and commercial readiness alongside tools like Linear, Cursor, and Raycast.

#### Difficulty
Medium

#### Risk
Low

#### Implementation Order
8

---

## Verification Criteria for PR Execution

Every PR must pass the following verification gates before being marked complete:
1. Production Build Pass: `pnpm --filter @asterim/web build` compiles with 0 errors.
2. Typecheck Pass: `pnpm --filter @asterim/web check-types` passes clean.
3. Manual UI Verification: Verified interactively with zero visual glitches.
4. Authenticated Screenshot Documentation: Captured and documented in PR walkthrough.

