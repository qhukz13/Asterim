# Asterim Phase 1.5 Implementation Roadmap (v2)

## Overview & User Feedback Foundation

Asterim's architecture, navigation, layouts, 3-panel shell, and thread/session workflows are stable and successful. Phase 1.5 is strictly a **polish and readability phase** designed to elevate Asterim into a handcrafted, commercial-grade desktop environment alongside **Linear, Cursor, Raycast, Warp, GitHub Desktop, Arc, and Apple Pro Apps**.

### Core Principles derived from Real User Feedback:
1. **Interface Architecture Remains Untouched**: Do NOT redesign navigation, workspace layout, panel structure, or command palette workflows.
2. **Priority #1: Readability & Long-Session Ergonomics**: Fonts were slightly too small and spacing slightly too tight. Improving legibility and reducing 8+ hour cognitive fatigue is a higher priority than visual creativity.
3. **Eliminate "Agent-Generated" Artifacts**: Replace generic blue SaaS accents (`#3b82f6`), thick border lines, and shiny gradients with neutral slate-graphite surfaces (`#0b0c0e` to `#22262c`), hairline dividers (`rgba(255,255,255,0.06)`), and a single low-saturation engineering Emerald Green accent (`#10b981`).
4. **Purge All Decorative Emojis**: Emojis like `⚡`, `📁`, `📝`, `🚀`, `💬`, `🎯`, `⚠️`, `✓` are unacceptable for professional desktop engineering tools. Replace with clean SVG icons, Lucide icon primitives, or pure typography.
5. **Transform Chat into an Engineering Report Engine**: Upgrade `ChatView` to render GFM tables, GitHub callout alert boxes (`> [!NOTE]`), rich code blocks with diff line highlights and copy buttons, interactive workspace file chips, status badges, and structured technical report summaries.

---

## PR Roadmap Matrix

```
PR8: Emoji Removal & SVG Icon Standardization
 └──> PR9: Ergonomic Readability & Typography Scale Expansion
       └──> PR10: Whitespace & Breathing Room Spacing System
             └──> PR11: Monochrome & Precision Emerald Color Identity
                   └──> PR12: Low-Latency Motion & Micro-State Transitions
                         └──> PR13: Chat Markdown Engine & Data Table Renderer
                               └──> PR14: GitHub Callouts, Alert Blocks & Engineering Badges
                                     └──> PR15: Rich Code Blocks & Interactive Workspace File References
                                           └──> PR16: Technical Report Card & Final Commercial Launch Audit
```

---

## Itemized Implementation Specifications

### PR8: Emoji Removal & SVG Icon Standardization

#### Purpose
Purge all decorative emojis from section headers, TopBar status pills, accordions, sidebars, and empty states. Replace with clean vector SVG icons and pure typographic status badges.

#### Problem Being Solved
Decorative emojis (`⚡`, `📁`, `📝`, `🚀`, `💬`, `🎯`, `⚠️`, `✓`) make the product look like Discord or an AI chatbot rather than a professional desktop tool like Cursor or Linear (User Feedback Observation #5).

#### Why It Matters
Directly establishes a professional, calm engineering tone across the entire UI chrome.

#### Affected Files
- `apps/web/src/components/TopBar.tsx`
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/SessionSidebar.tsx`
- `apps/web/src/components/NavigationSidebar.tsx`
- `apps/web/src/components/InspectorPanel.tsx`
- `apps/web/src/components/EmptyWorkspace.tsx`

#### Risk
Low (Component icon & markup replacement).

#### Expected UX Improvement
Asterim immediately looks like tier-1 desktop engineering software.

#### Verification Plan
- Build pass (`pnpm build`).
- Typecheck pass (`pnpm check-types`).
- Manual inspection of TopBar, sidebars, tool accordions, and empty states to verify 0 decorative emojis remain.

#### Estimated Size
Medium

---

### PR9: Ergonomic Readability & Typography Scale Expansion

#### Purpose
Elevate typography to comfortable desktop sizing: `15px` body text (`1.55` line-height), `14px` code/terminal text (`1.50` line-height), `12px` tabular metadata (`tnum`), `16px` section headers, and `20px` thread titles. Standardize input heights to 44px–48px.

#### Problem Being Solved
Body fonts (`13px`), code snippets, and metadata are compressed, causing eye strain and fatigue during 8–12 hour engineering sessions (User Feedback Observation #3).

#### Why It Matters
Directly addresses the #1 user priority: Readability and long-session comfort.

#### Affected Files
- `apps/web/src/styles/tokens.css`
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/ChatInput.tsx`
- `apps/web/src/components/InspectorPanel.tsx`
- `apps/web/src/components/SessionSidebar.tsx`

#### Risk
Medium (Requires verifying text container bounds in sidebars).

#### Expected UX Improvement
Effortless long-session reading comfort with clear typographic hierarchy.

#### Verification Plan
- Verify font sizing across all 3 columns on standard high-DPI displays.
- Confirm tabular numeric alignment (`font-variant-numeric: tabular-nums`) on timestamps and counters.

#### Estimated Size
Medium

---

### PR10: Whitespace & Breathing Room Spacing System

#### Purpose
Expand spacing rhythm across the 3-column shell: `16px` message margins, `12px` card gaps, `12px` sidebar item padding, `12px` sidebar inset, `16px` main canvas inset, and standardized control heights (32px / 36px / 44px).

#### Problem Being Solved
Message bubbles (`8px` margin) and list items are tightly packed, making dense multi-step agent outputs difficult to scan (User Feedback Observation #3).

#### Why It Matters
Restores visual rhythm and breathing room so engineers can scan multi-paragraph agent steps quickly without visual overload.

#### Affected Files
- `apps/web/src/styles/tokens.css`
- `apps/web/src/styles/layout.css`
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/SessionSidebar.tsx`
- `apps/web/src/components/NavigationSidebar.tsx`
- `apps/web/src/components/InspectorPanel.tsx`

#### Risk
Low

#### Expected UX Improvement
Spacious, scannable layout with clear visual grouping between panels and controls.

#### Verification Plan
- Test column resizing; verify gutters and flex gap behavior.

#### Estimated Size
Medium

---

### PR11: Monochrome & Precision Emerald Color Identity Refinement

#### Purpose
Refine dark mode tokens to a neutral slate-graphite surface hierarchy (`#0b0c0e` canvas, `#121417` primary panel surface, `#191c20` elevated surface, `#22262c` active/dropdown), high-contrast hairline dividers (`rgba(255,255,255,0.06)`), and a single low-saturation engineering Emerald Green accent (`#10b981`). Remove all loud gradients and shiny SaaS background fills.

#### Problem Being Solved
Generic blue SaaS primary accent (`#3b82f6`), thick borders, and purple dark tints make the application look "agent generated" (User Feedback Observation #4).

#### Why It Matters
Gives Asterim a memorable, high-precision engineering brand identity matching terminal environments.

#### Affected Files
- `apps/web/src/styles/tokens.css`
- `apps/web/src/styles/layout.css`
- `apps/web/src/index.css`
- `apps/web/src/components/TopBar.tsx`
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/SessionSidebar.tsx`

#### Risk
Low (CSS token refinement).

#### Expected UX Improvement
Recognizable, calm, high-contrast monochrome identity with zero visual noise.

#### Verification Plan
- Audit contrast ratios for text against background surfaces (WCAG AAA compliant).

#### Estimated Size
Medium

---

### PR12: Low-Latency Motion & Micro-State Transitions

#### Purpose
Implement standardized low-latency CSS transitions (`120ms` micro, `180ms` macro) with custom cubic-bezier easing (`cubic-bezier(0.16, 1, 0.3, 1)`). Add subtle hover states, active press transforms (`scale(0.98)`), and focus hairline outlines.

#### Problem Being Solved
Accordions, dropdowns, and button hover states feel snap-abrupt or static, lacking subtle micro-feedback.

#### Why It Matters
Makes every interaction feel responsive, intentional, and high-performance.

#### Affected Files
- `apps/web/src/styles/tokens.css`
- `apps/web/src/index.css`
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/CommandPalette.tsx`
- `apps/web/src/components/InspectorPanel.tsx`

#### Risk
Low

#### Expected UX Improvement
Tactile, responsive feel with instantaneous, crisp state transitions without sluggish delays.

#### Verification Plan
- Test accordion toggle, tab switching, and button hover states.

#### Estimated Size
Small

---

### PR13: Chat Markdown Engine & Data Table Renderer

#### Purpose
Upgrade `ChatView` markdown rendering with custom GFM table rendering (sticky headers, horizontal scroll, zebra striping, monospace number formatting) and standardized block element spacing.

#### Problem Being Solved
Chat view renders unstyled HTML tables and basic text, breaking when agents output tabular test results or benchmark summaries (Chat Rendering requirement).

#### Why It Matters
Turns chat into an engineering report viewer capable of displaying complex test matrixes and technical benchmarks.

#### Affected Files
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/markdown/MarkdownTable.tsx` [NEW]

#### Risk
Medium

#### Expected UX Improvement
Clean, interactive table rendering for agent technical outputs.

#### Verification Plan
- Render multi-column test results table in chat; verify scrollability and column alignment.

#### Estimated Size
Medium

---

### PR14: GitHub Callouts, Alert Blocks & Engineering Badges

#### Purpose
Support GitHub-style callout alert boxes (`NOTE`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`) with subtle colored border indicators (`2px solid`) and muted background fills. Render inline build & test status badges (`PASSED`, `FAILED`, `PENDING`) and `<kbd>` hardware key chips.

#### Problem Being Solved
Markdown callouts (`> [!NOTE]`, `> [!WARNING]`) render as generic grey blockquotes without visual hierarchy. Statuses render as plain text.

#### Why It Matters
Highlights critical warnings, test failures, and key takeaways in agent pull request reviews and architectural proposals.

#### Affected Files
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/markdown/MarkdownCallout.tsx` [NEW]
- `apps/web/src/components/markdown/StatusBadge.tsx` [NEW]

#### Risk
Low

#### Expected UX Improvement
Instant visual scanning of warnings, notes, and test status inside agent deliverables.

#### Verification Plan
- Render all 5 callout types in chat; verify rendering accuracy and light contrast.

#### Estimated Size
Medium

---

### PR15: Rich Code Blocks & Interactive Workspace File References

#### Purpose
Implement rich code block container featuring file path banner, language badge, line numbers, one-click copy button, and inline diff line highlights (`+`/`-`). Parse workspace file references into interactive monospace file chips with click-to-inspect triggers.

#### Problem Being Solved
Code blocks lack path banners, line numbers, and copy buttons. File references (`file:///...`) render as un-clickable plain text.

#### Why It Matters
Essential for reviewing AI coding reports, diff proposals, and jumping directly to edited files in the workspace.

#### Affected Files
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/markdown/RichCodeBlock.tsx` [NEW]
- `apps/web/src/components/markdown/FileChip.tsx` [NEW]

#### Risk
Medium

#### Expected UX Improvement
Code snippets look like IDE code blocks; file references enable 1-click workspace navigation.

#### Verification Plan
- Test code block copy, diff highlighting, and file link click-to-inspect triggers.

#### Estimated Size
Medium to Large

---

### PR16: Technical Report Card Component & Final Commercial Launch Audit

#### Purpose
Create a structured `TechnicalReportCard.tsx` for major agent outputs (featuring stat summary bar for files/lines touched, collapsible section navigation, and raw markdown export). Perform complete end-to-end commercial audit pass.

#### Problem Being Solved
Long agent deliverables (PR descriptions, architecture docs) render as endless scrolling text. The UI requires a final pass to verify zero regressions across all states.

#### Why It Matters
Completes Asterim's transformation into an elite engineering report viewer and verifies readiness alongside Linear and Cursor.

#### Affected Files
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/markdown/TechnicalReportCard.tsx` [NEW]
- All application source files in `apps/web/src/`

#### Risk
Low

#### Expected UX Improvement
Long technical deliverables feel like GitHub PR reports / Notion engineering RFCs. 100% verified commercial polish.

#### Verification Plan
- Run `pnpm build`, `pnpm check-types`, manual visual verification across all views, and screenshot capture.

#### Estimated Size
Medium

---

## Execution & Verification Rules

For every PR:
1. **Pre-Implementation**: Review affected files and existing specs.
2. **Execution**: Apply changes cleanly adhering to project guidelines.
3. **Verification**:
   - `pnpm --filter @asterim/web build`
   - `pnpm --filter @asterim/web check-types`
   - Manual interactive UI check
   - Authenticated screenshot capture & documentation
