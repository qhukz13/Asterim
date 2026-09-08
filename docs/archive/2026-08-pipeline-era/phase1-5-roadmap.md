# Asterim Phase 1.5 UX Implementation Roadmap

## Executive Overview

Phase 1 established Asterim's core architecture, 3-panel layout, thread navigation, session store, and terminal integration. Phase 1.5 transforms Asterim into a handcrafted, commercial-grade desktop environment alongside **Linear, Cursor, Raycast, Warp, GitHub Desktop, Arc, and Apple Pro Apps**.

This roadmap organizes Phase 1.5 around **User Experience Milestones**. Rather than executing isolated cosmetic tasks (such as color tweaks or typography adjustments), each Pull Request (PR) delivers a cohesive, user-visible milestone. After every PR, engineers using Asterim will immediately experience a noticeable jump in legibility, speed, brand identity, and operational focus.

---

## Phase 1.5 Design Principles

Every design and engineering decision in Phase 1.5 must adhere strictly to these core principles:

- **Calm over flashy**: Eliminate distracting glows, neon colors, and loud SaaS gradients. Asterim is a tool for deep engineering focus.
- **Precision over decoration**: Visual elements exist solely to serve utility, structural clarity, or state communication.
- **Engineering over marketing**: Design for developers spending 8–12 hours inside the workspace, not for landing page conversion metrics.
- **Information hierarchy first**: Primary actions must stand out instantly; secondary tools must be accessible; background context must remain unobtrusive.
- **Reduce cognitive load**: Remove unnecessary borders, redundant lines, and competing background fills to make scanning effortless.
- **Readability before density**: Never compress typography or line heights just to pack more text; balance comfortable legibility with structured information density.
- **Every pixel has a purpose**: No visual element exists purely for decoration.
- **Motion communicates state**: Animations must be fast (120ms–180ms), functional, and provide state feedback—never decorative.
- **Consistency over creativity**: Maintain rigid visual tokens across all screens, drawers, modals, and status badges.
- **The interface should disappear while working**: The UI should get out of the developer's way, leaving total focus on agent code, execution logs, and architecture documents.

---

## Roadmap Structure & UX Milestones

```
PR8: Workspace Readability & Information Density
 └──> PR9: Visual Identity & Brand Language
       └──> PR10: Interaction Polish & Micro-State Transitions
             └──> PR11: Engineering Documents & Rich Chat
                   └──> PR12: Commercial Beta Final Polish & Workspace Consistency
```

---

## Milestone Specifications

### PR8: Workspace Readability & Information Density

#### Purpose
Transform Asterim into an ergonomic control plane optimized for 8+ hour continuous engineering sessions. Fix undersized fonts, compressed line heights, cramped control touch targets, and visual clutter across all three workspace columns.

#### Why This PR Exists
Real-world usage confirmed that small text (`11px` metadata, `13px` body text) and tight line heights cause severe visual fatigue during long coding sessions. Legibility is the single highest priority for Asterim.

#### User-Visible Improvements
- **Comfortable Body Typography**: Chat messages and body text scale to a crisp `15px` (`1.55` line height) for effortless reading.
- **Readable Code & Terminal Outputs**: Monospace code blocks and terminal text expand to `14px` (`1.50` line height) with `JetBrains Mono` and tabular numeric alignment (`tnum`).
- **Clear Typographic Scale**: Thread titles scale to `20px` (`font-weight: 600`), section subheads to `16px`, and panel headers to `14px`, establishing unambiguous visual authority.
- **Ergonomic Control Heights**: Chat input container expands to `44px–48px` min-height; primary action buttons scale to standard `36px` and `40px` touch targets.
- **Spacious Layout Density**: Message margins expand to `16px`, card padding to `12px`, and sidebar list item spacing to `8px`, giving dense multi-step agent outputs breathing room.

#### Information Hierarchy & Cognitive Load Reduction
- **Clear Visual Anchor**: Main thread title (`20px`) and primary message content (`15px`) become the clear primary focal point on screen.
- **Reduced Eyestrain**: Increased line height (`1.55`) and expanded paragraph margins eliminate text compression and wall-of-text fatigue.
- **Scannable Metadata**: Secondary timestamps and agent status labels drop into a quiet, muted secondary tier (`12px`, `color: #64748b`), guiding the developer's eyes directly to critical content.

#### Components Affected
- `apps/web/src/styles/tokens.css`
- `apps/web/src/styles/layout.css`
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/ChatInput.tsx`
- `apps/web/src/components/NavigationSidebar.tsx`
- `apps/web/src/components/SessionSidebar.tsx`
- `apps/web/src/components/InspectorPanel.tsx`
- `apps/web/src/components/TopBar.tsx`

#### Acceptance Criteria
- Zero body text under `14px`; zero metadata text under `12px`.
- Monospace timers and status numbers use tabular figures without layout jitter.
- All 3 columns maintain consistent 12px panel margin gutters and baseline grid alignment.
- Typecheck (`pnpm check-types`) and production build (`pnpm build`) compile with 0 errors.

#### Estimated Scope
Large

---

### PR9: Visual Identity & Brand Language

#### Purpose
Establish Asterim's signature visual identity—combining a calm monochrome surface stack, neutral slate depth, sub-pixel hairlines, Lucide vector iconography, complete elimination of decorative emojis, and a single high-precision engineering Emerald Green accent (`#10b981`).

#### Why This PR Exists
Asterim currently uses generic blue SaaS accents (`#3b82f6`), purple-tinted dark backgrounds, thick borders, and informal emojis (`⚡`, `📁`, `📝`, `🚀`, `💬`, `🎯`, `⚠️`, `✓`) that make the product look like a consumer chat app or an AI-generated dashboard. This milestone makes Asterim recognizable from a single screenshot.

#### User-Visible Improvements
- **Recognizable Screenshot Identity**: Asterim gains a distinct, high-precision dark mode brand identity with neutral slate surfaces (`#0b0c0e` canvas, `#121417` primary panels, `#191c20` elevated containers, `#22262c` floating overlays).
- **Precision Emerald Accent System**: Primary action triggers, active session indicators, and agent execution dots utilize low-saturation Emerald Green (`#10b981`), creating a high-precision terminal aesthetic.
- **Lucide Vector Icon System**: 100% of decorative emojis across buttons, headers, sidebars, accordions, empty states, and badges are replaced with clean Lucide vector SVG icons and typographic badges.
- **Sub-Pixel Hairline Dividers**: Heavy 14% white border lines are replaced with subtle `rgba(255, 255, 255, 0.06)` hairlines and 1px inset highlights (`box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05)`).
- **Redesigned Status Badges**: Agent state pills (`Working`, `Paused`, `Completed`) feature streamlined dot indicators and matte background fills without shiny gradients.

#### Information Hierarchy & Cognitive Load Reduction
- **Unambiguous Primary Actions**: Solid Emerald Green (`#10b981`) is reserved strictly for primary execution triggers (`Send`, `New Agent`), while secondary actions use subtle slate surfaces, eliminating visual competition.
- **Elimination of Emoji Noise**: Replacing informal emojis with clean 14px vector icons removes visual clutter from headers and buttons, allowing developers to scan text labels instantly.
- **Quiet Panel Borders**: Hairline borders (`rgba(255,255,255,0.06)`) reduce gridline noise, letting code content and agent responses float naturally without harsh box boundaries.

#### Components Affected
- `apps/web/src/styles/tokens.css`
- `apps/web/src/styles/layout.css`
- `apps/web/src/index.css`
- `apps/web/src/components/TopBar.tsx`
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/SessionSidebar.tsx`
- `apps/web/src/components/NavigationSidebar.tsx`
- `apps/web/src/components/InspectorPanel.tsx`
- `apps/web/src/components/EmptyWorkspace.tsx`

#### Acceptance Criteria
- Asterim is instantly recognizable from a screenshot as a professional engineering workspace.
- 100% of UI chrome is free of decorative emojis (emojis allowed only inside user-authored chat text).
- Primary accent color consistently resolves to Emerald `#10b981`.
- Contrast ratios across body text, metadata, and panel titles achieve WCAG AAA compliance.

#### Estimated Scope
Large

---

### PR10: Interaction Polish & Micro-State Transitions

#### Purpose
Implement a cohesive motion physics system, instant feedback loops, active press states, smooth focus outlines, and tactile microinteractions across all workspace controls.

#### Why This PR Exists
Static button clicks and abrupt panel state changes make the UI feel rigid. Micro-transitions and tactile feedback confirm user actions instantly, enhancing speed and operational confidence.

#### User-Visible Improvements
- **Low-Latency Transitions**: Accordions, dropdowns, tab switching, and hover states operate on standardized `120ms` (micro-controls) and `180ms` (panels) curves using custom `cubic-bezier(0.16, 1, 0.3, 1)` easing.
- **Tactile Active Press States**: Buttons and clickable list items feature subtle scale compression (`transform: scale(0.98)`) on active mouse press.
- **Distinct Selection Anchors**: Active sidebar session items feature a crisp 2px left Emerald border indicator and elevated surface tint.
- **Instant Copy Feedback**: Copying code blocks or file paths triggers inline checkmark confirmation feedback (`Copied!`).
- **Hairline Focus Rings**: Keyboard navigation and input focus display clean, high-contrast 1px outlines (`outline: 1px solid var(--color-accent-primary)`).

#### Information Hierarchy & Cognitive Load Reduction
- **State Transparency**: Instant 120ms hover and press micro-animations communicate interactive affordances without requiring the developer to guess whether an element is clickable.
- **Focused Keyboard Traversal**: High-contrast hairline focus rings guide power users through mouse-free `⌘K` command palette and tab navigation smoothly.
- **Reduced Visual Interruption**: Transitions are short (120–180ms) and dampened, preventing distracting layout flashing or slow animation delays.

#### Components Affected
- `apps/web/src/styles/tokens.css`
- `apps/web/src/index.css`
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/CommandPalette.tsx`
- `apps/web/src/components/InspectorPanel.tsx`
- `apps/web/src/components/SessionSidebar.tsx`
- `apps/web/src/components/ChatInput.tsx`

#### Acceptance Criteria
- All interactive controls provide immediate visual hover/press/focus feedback within 16ms frame times.
- Zero layout jank or transition stutter during rapid accordion toggling.
- Typecheck and production build compile clean.

#### Estimated Scope
Medium

---

### PR11: Engineering Documents & Rich Chat

#### Purpose
Transform `ChatView` from a standard conversational message list into a publication-quality engineering document viewer designed for AI pull request reviews, architecture proposals, benchmark logs, and technical reports.

#### Why This PR Exists
Autonomous AI coding agents produce multi-faceted deliverables—code diffs, test matrices, execution steps, and architectural proposals. Long LLM responses must feel like professional technical documentation (GitHub PRs, Linear issues, Notion RFCs) rather than plain chat text bubbles.

#### User-Visible Improvements
- **High-Density GFM Data Tables**: Markdown tables render with fixed sticky headers, subtle grid borders, zebra striping, monospace number formatting, and horizontal scroll capability for wide benchmark datasets.
- **GitHub Alert Callouts**: Support for `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, and `> [!CAUTION]` callout blocks featuring subtle colored border accents and muted fills.
- **Rich Code Blocks with Inline Diffs**: Code snippets render inside a structured container with file path banner, language indicator, line numbers, one-click copy button, and colored inline diff line highlights (`+`/`-`).
- **Interactive Workspace File Chips**: File paths (`file:///...`) render as interactive monospace file chips with extension badges, line numbers (`L10-L25`), and click-to-inspect triggers.
- **Image Lightbox & Before/After Gallery**: Screenshots and UI diff images feature zoom lightbox overlays and side-by-side Before/After comparison sliders.
- **Structured Technical Report Cards**: Long agent outputs (PR reviews, architecture proposals) are wrapped in a technical report card featuring a summary stat bar (lines added/deleted, files modified) and raw markdown export.

#### Information Hierarchy & Cognitive Load Reduction
- **Document-First Hierarchy**: Complex AI deliverables are structured into distinct visual sections (stat bars, callouts, code blocks, diffs), allowing engineers to scan PR summaries in seconds.
- **Collapsible Low-Level Logs**: Agent tool execution steps and thought logs remain quietly collapsed in monospace accordions, preventing chat clutter while keeping full diagnostic context 1-click away.
- **High-Contrast Code Readability**: Code blocks feature crisp syntax highlighting and line numbers on deep black surface canvas (`#080a0f`), isolating code from prose.

#### Components Affected
- `apps/web/src/ChatView.tsx`
- `apps/web/src/index.css`
- `apps/web/src/components/markdown/MarkdownTable.tsx` (NEW)
- `apps/web/src/components/markdown/MarkdownCallout.tsx` (NEW)
- `apps/web/src/components/markdown/RichCodeBlock.tsx` (NEW)
- `apps/web/src/components/markdown/FileChip.tsx` (NEW)
- `apps/web/src/components/markdown/ImageGallery.tsx` (NEW)
- `apps/web/src/components/markdown/TechnicalReportCard.tsx` (NEW)

#### Acceptance Criteria
- Long technical AI responses feel like GitHub PR reviews or architecture documents.
- GFM tables, GitHub callouts, code diff highlights, file link chips, and technical report cards render accurately without breaking layout bounds.
- One-click copy and file inspect actions function reliably.
- Typecheck and production build compile with 0 errors.

#### Estimated Scope
Large

---

### PR12: Commercial Beta Final Polish & Workspace Consistency

#### Purpose
Perform a complete end-to-end polish pass across all workspace views, loading states, empty states, settings panels, scrollbars, keyboard navigation loops, and edge cases to ensure commercial readiness.

#### Why This PR Exists
Guarantees 100% visual consistency, zero leftover unpolished elements, clean accessibility compliance, and build stability before the public beta release.

#### User-Visible Improvements
- **Animated Skeleton Loaders**: Replace plain text loading strings with subtle animated pulse skeleton rows matching exact panel layouts.
- **Refined Custom Scrollbars**: Thin, dark-mode scrollbars (`4px` width, `--color-surface-3` thumb) that appear smoothly on hover and remain unobtrusive during reading.
- **Polished Settings & Overlay Modals**: AI Settings, Developer Settings, and Connection Modals match the neutral slate surface depth, typography, and Emerald accent identity.
- **Keyboard Navigation Polish**: Complete `⌘K` command palette navigation, tab cycling, and global shortcut loops verified for 100% mouse-free workflow.
- **Edge-Case Resilience**: Long project names, long thread titles, missing server connections, and truncated execution logs display elegant text overflow and fallback states.

#### Information Hierarchy & Cognitive Load Reduction
- **Seamless System States**: Skeletons and empty states preserve the exact spatial boundaries of loaded content, preventing layout shifts and orientation loss during data loading.
- **Uncluttered Overlays**: Modal settings cards use clear section headers, elevated surfaces (`#191c20`), and primary Emerald buttons to focus the user's attention on active settings without background noise.

#### Components Affected
- `apps/web/src/App.tsx`
- `apps/web/src/components/AISettings.tsx`
- `apps/web/src/components/DeveloperSettings.tsx`
- `apps/web/src/components/CommandPalette.tsx`
- `apps/web/src/components/git/GitChangesView.tsx`
- All application source files in `apps/web/src/`

#### Acceptance Criteria
- 100% of screens, modals, and drawers exhibit identical visual hierarchy, typography, colors, and border styles.
- Zero console warnings or React key errors.
- `pnpm --filter @asterim/web check-types` passes with 0 errors.
- `pnpm --filter @asterim/web build` succeeds clean.
- Comprehensive authenticated screenshot verification completed.

#### Estimated Scope
Medium

---

## Why This Order Was Chosen

The implementation strategy follows a logical dependency cascade where each milestone establishes the foundation for the next, preventing rework or design refactoring:

1. **PR8 (Workspace Readability & Density)** comes FIRST because font sizes, line heights, and padding establish the fundamental physical ergonomics of the entire application. Every subsequent component built or updated will inherit these core readable dimensions.
2. **PR9 (Visual Identity & Brand Language)** comes SECOND to apply Asterim's signature monochrome palette, neutral slate surfaces, hairline borders, Emerald Green accent, and Lucide vector icons across all chrome elements established in PR8.
3. **PR10 (Interaction Polish & Micro-State Transitions)** comes THIRD to bring the styled visual chrome to life with crisp micro-transitions, hover states, press feedback, and focus rings.
4. **PR11 (Engineering Documents & Rich Chat)** comes FOURTH to apply all typography, iconography, colors, and motion rules to the complex chat rendering canvas, transforming markdown into publication-quality engineering deliverables.
5. **PR12 (Commercial Beta Final Polish)** comes LAST to conduct a comprehensive audit across all views, modals, loading states, and keyboard loops, ensuring 100% consistency and build stability for public beta launch.

---

## Phase 1.5 Completion Criteria

Phase 1.5 is complete ONLY when all of the following criteria are met:

- **Instantly Recognizable**: The product is recognizable from a single screenshot via its neutral slate surface stack and crisp Emerald Green accent.
- **8+ Hour Viewing Comfort**: Engineers can work comfortably for an entire workday without experiencing visual fatigue from tiny text or cramped spacing.
- **Effortless Information Hierarchy**: Primary actions, active sessions, and critical code blocks dominate the visual focal hierarchy on every screen.
- **Zero Visual Noise**: Decorative emojis, heavy grid lines, and loud gradients have been 100% eliminated.
- **Publication-Quality Chat Reports**: AI responses render rich GFM tables, GitHub callouts, code diff highlights, and technical report cards.
- **Handcrafted Quality**: The application feels like software built by an elite product team rather than an AI-generated dashboard.
- **Commercial Readiness**: Asterim comfortably stands beside Cursor, Linear, Raycast, Warp, and GitHub Desktop without looking unfinished.

---

## Milestone Product Test Validation Rule

Before marking any PR complete, ask the following question:

> *"If a developer opened Asterim for the first time immediately after this PR, would they notice and appreciate a meaningful improvement in usability, readability, speed, or visual clarity?"*

If the answer is **"not really"**, the PR scope must be expanded or reorganized before proceeding. Every single PR must produce a visible, meaningful improvement to the product experience.
