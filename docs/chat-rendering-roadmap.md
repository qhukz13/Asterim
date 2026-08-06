# Asterim Chat Rendering Engine Implementation Roadmap

## Overview

This document defines the specialized pull requests required to transform Asterim's chat renderer into an engineering document engine. Rather than implementing a generic chat markdown parser, these PRs build a rich canvas tailored for AI pull request reviews, architecture reports, diff investigations, automated test logs, and design proposals.

---

## Chat Engine PR Sequence

```
PR15: Markdown Core & GFM Extension Parser
 └──> PR16: High-Density Table & Data Renderer
       └──> PR17: Callouts, Alerts & Status Badges
             └──> PR18: Rich Code Blocks & Inline Diff Engine
                   └──> PR19: Interactive File Chips & Kbd Shortcuts
                         └──> PR20: Image Galleries & Before/After Carousels
                               └──> PR21: Technical Report Card & Document Viewer
```

---

## Detailed PR Specifications

### PR15: Markdown Core & GFM Extension Parser

#### Purpose
Upgrade the core markdown rendering setup in `ChatView.tsx` with custom React components for lists, blockquotes, horizontal rules, and paragraph spacing.

#### Files Affected
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/markdown/MarkdownCore.tsx` (NEW)

#### Expected UX Improvement
Eliminates awkward list indentations and broken paragraph line breaks, establishing consistent vertical typography across all message blocks.

#### Difficulty
Medium

#### Risk
Low

#### Implementation Order
1

---

### PR16: High-Density Table & Data Renderer

#### Purpose
Build a specialized markdown table renderer (`MarkdownTable.tsx`) with zebra striping, sticky header option, monospace cell formatting for numbers, and horizontal overflow handling.

#### Files Affected
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/markdown/MarkdownTable.tsx` (NEW)

#### Expected UX Improvement
Allows engineers to view tabular test results, benchmark comparisons, and file change metrics cleanly in chat without broken layouts.

#### Difficulty
Medium

#### Risk
Low

#### Implementation Order
2

---

### PR17: Callouts, Alerts & Status Badges

#### Purpose
Implement parser and visual components for GitHub-style blockquote callouts (`[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`) and inline status badges (`PASSED`, `FAILED`, `PENDING`).

#### Files Affected
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/markdown/MarkdownCallout.tsx` (NEW)
- `apps/web/src/components/markdown/StatusBadge.tsx` (NEW)

#### Expected UX Improvement
Highlights crucial warnings, notes, and agent status notifications with visual authority without using noisy decorative emojis.

#### Difficulty
Low

#### Risk
Low

#### Implementation Order
3

---

### PR18: Rich Code Blocks & Inline Diff Engine

#### Purpose
Replace raw syntax highlighter with a feature-rich code block container featuring file path header, line numbers, copy button, language indicator, and inline diff highlight lines (`+` / `-`).

#### Files Affected
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/markdown/RichCodeBlock.tsx` (NEW)

#### Expected UX Improvement
Code blocks look like professional editor snippets with one-click copy and instant diff inspection.

#### Difficulty
High

#### Risk
Low

#### Implementation Order
4

---

### PR19: Interactive File Chips & Kbd Shortcuts

#### Purpose
Parse workspace file references (`file:///...`) into interactive mono file chips with extension icons, line numbers, and click-to-inspect actions. Parse `<kbd>` tags into styled hardware keyboard chips.

#### Files Affected
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/markdown/FileChip.tsx` (NEW)
- `apps/web/src/components/markdown/KbdChip.tsx` (NEW)

#### Expected UX Improvement
Engineers can jump directly to referenced code locations in Asterim's inspector or terminal with a single click.

#### Difficulty
Medium

#### Risk
Low

#### Implementation Order
5

---

### PR20: Image Galleries & Before/After Carousels

#### Purpose
Add lightbox modal capability to rendered images and implement a side-by-side / slider Before/After comparison component for UI design reviews.

#### Files Affected
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/markdown/ImageGallery.tsx` (NEW)

#### Expected UX Improvement
Allows visual design reviews, screenshot audits, and UI diff verifications to be conducted directly inside agent chat messages.

#### Difficulty
Medium

#### Risk
Low

#### Implementation Order
6

---

### PR21: Technical Report Card & Document Viewer

#### Purpose
Implement a top-level technical report card component wrapper for long agent deliverables (PR descriptions, architecture RFCs, release notes), featuring a summary bar (lines changed, files touched), sticky TOC header, and raw markdown download.

#### Files Affected
- `apps/web/src/ChatView.tsx`
- `apps/web/src/components/markdown/TechnicalReportCard.tsx` (NEW)

#### Expected UX Improvement
Transforms long technical text streams into structured, navigable documents that engineers can review in seconds.

#### Difficulty
High

#### Risk
Low

#### Implementation Order
7

---

## Verification Criteria

1. All custom markdown components render cleanly without console warnings.
2. Production build bundle compiles clean.
3. Chat stream performance remains 60fps during rapid log rendering.

