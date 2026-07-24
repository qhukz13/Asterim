# Asterim Phase 1 UX & Product Quality Audit

## Executive Summary

This review provides a brutally honest, senior-product-designer critique of Asterim's current rendered UI. 

While PR1–PR5 established basic tokenization and layout boundaries, **Asterim does NOT yet feel like a premium engineering product (Linear/Cursor tier)**. It still suffers from visual inconsistencies, unrefined typography, abrupt state changes, and functional gaps in the core chat/terminal workspace.

Below is an itemized audit across 16 critical UX dimensions, categorized by Priority (**P0** = Immediate Blocker, **P1** = Required for Premium Feel, **P2** = Polish & Delight).

---

## 1. Visual Hierarchy
* **Current State**: TopBar, Left Sidebar, Chat messages, and Right Inspector share flat, low-contrast borders (`rgba(255,255,255,0.07)`).
* **Problems**: No clear visual "depth stack". The user's eye gets trapped in competing panel borders rather than focusing on the active thread conversation and terminal stream.
* **Why Unpolished**: Lacks elevated surface distinction (`surface-0` canvas vs `surface-1` panels vs `surface-2` active elements).
* **Proposed Improvements**: Implement clear z-index and elevation hierarchy. Darken deep canvas background (`#090b0e`), elevate active code/chat panels (`#131722`), and highlight active section headers.
* **Priority**: **P0**

---

## 2. Whitespace & Canvas Layout
* **Current State**: Layout fills `100vw`/`100vh`, but padding inside panels ranges randomly between 4px, 8px, 12px, and 16px.
* **Problems**: Uneven text baselines across adjacent columns (e.g. Left Sidebar header vs TopBar vs Main Chat header).
* **Why Unpolished**: Looks misaligned when resizing columns or inspecting line boundaries.
* **Proposed Improvements**: Enforce a strict 4px/8px grid system for all layout margins, flex gaps, and component containers.
* **Priority**: **P1**

---

## 3. Spacing Consistency
* **Current State**: Buttons, input boxes, and list items mix custom inline styles with design token variables.
* **Problems**: Disconnected element heights across controls (`20px` in sidebar button vs `24px` in topbar avatar vs `32px` in input buttons).
* **Why Unpolished**: Breaks muscle memory; controls feel unaligned.
* **Proposed Improvements**: Standardize control heights: `Small` (24px), `Medium` (32px), `Large` (40px).
* **Priority**: **P1**

---

## 4. Typography & Monospace Code Stack
* **Current State**: System font fallback mixes `Inter` with browser defaults. Terminal uses default `monospace` font stack.
* **Problems**: Code snippets inside chat bubbles render in sans-serif or raw browser monospace without clean line height.
* **Why Unpolished**: Low code legibility compared to VS Code or Cursor (JetBrains Mono / Fira Code).
* **Proposed Improvements**: Load Google Font `JetBrains Mono` globally. Set code line height to `1.5` and font-size to `12px/13px` with high-contrast tokenized syntax colors.
* **Priority**: **P0**

---

## 5. Navigation & View Routing
* **Current State**: Wouter location routing updates URL, but switching views causes momentary flickering or scrollback reset.
* **Problems**: Back button in thread view jumps back to root instead of preserving selected project state.
* **Why Unpolished**: Navigation feels fragile rather than instant and fluid.
* **Proposed Improvements**: Cache thread view states in Zustand store so switching between Chat, Terminal, and Diffs is instant (<16ms) with preserved scroll position.
* **Priority**: **P0**

---

## 6. Layout Density
* **Current State**: Improved in PR2, but chat message bubbles still contain massive padding (16px) with wide empty margins.
* **Problems**: Only 2–3 agent messages fit on screen at once on a 1080p laptop display.
* **Why Unpolished**: Requires constant scrolling to follow multi-step agent tool executions.
* **Proposed Improvements**: Introduce a compact, high-density message layout (Linear/GitHub PR comment style) with collapsible tool execution blocks.
* **Priority**: **P1**

---

## 7. Chat Experience (Core Agent Flow)
* **Current State**: Chat messages render basic Markdown with raw text blocks for tool calls.
* **Problems**: Long terminal outputs or file diffs dump directly into chat bubbles, cluttering the discussion stream.
* **Why Unpolished**: Chat feels like a generic LLM wrapper instead of an engineering control plane.
* **Proposed Improvements**:
  1. Accordion collapse for tool calls (e.g. `▶ Executed bash command: npm install` - click to expand).
  2. Inline diff cards with line numbers and syntax highlighting.
  3. Floating prompt bar with shortcut pills (`/commit`, `/explain`, `@file`).
* **Priority**: **P0**

---

## 8. Terminal Experience (XTerm & Shell)
* **Current State**: Integrated `xterm.js` terminal, but lacks quick actions and status feedback.
* **Problems**: Terminal output scrollback gets lost when switching views. Terminal lacks a clear "Clear Buffer" or "Maximize" control bar.
* **Why Unpolished**: Feels like a basic embedded iframe rather than a first-class PTY shell.
* **Proposed Improvements**: Add a top terminal utility bar (`Clear`, `Copy Log`, `Maximize`, `Reconnect PTY`).
* **Priority**: **P1**

---

## 9. Inspector Usefulness
* **Current State**: Displays basic Agent Activity and Context files.
* **Problems**: Attached Context files cannot be removed or pinned directly from the Inspector UI; lacks quick file preview modal.
* **Why Unpolished**: Inspector feels like a read-only widget rather than an interactive context management engine.
* **Proposed Improvements**: Allow 1-click file pinning (`+ Pin File`), rule attachment (`+ Add Project Rule`), and symbol jump.
* **Priority**: **P1**

---

## 10. Sidebar Usability
* **Current State**: Collapsible sidebars resize via mouse drag.
* **Problems**: Drag handle is a thin 4px line that is difficult to grab. Hover indicator is faint.
* **Why Unpolished**: Column resizing feels clunky.
* **Proposed Improvements**: Expand drag hover target to 8px with clear active accent highlight (`var(--color-accent-primary)`).
* **Priority**: **P2**

---

## 11. Interaction Feedback
* **Current State**: Clicking buttons triggers immediate actions without active press states or visual ripples.
* **Problems**: Lack of micro-interactions makes the UI feel static and non-responsive.
* **Why Unpolished**: Modern tools (Linear, Cursor) use subtle active transforms (`scale(0.98)` or hover glow) to confirm touch/click feedback.
* **Proposed Improvements**: Add tokenized micro-animations (`transition: transform 0.1s, background 0.15s`) for all buttons and list items.
* **Priority**: **P2**

---

## 12. Animations & Transitions
* **Current State**: Views snap instantly without transition effects.
* **Problems**: Switching between Chat and Terminal feels abrupt.
* **Why Unpolished**: Lacks subtle fade/slide transitions that orient the user.
* **Proposed Improvements**: Add subtle `fadeIn 0.15s` / `slideUp 0.15s` view transitions for panels and modals.
* **Priority**: **P2**

---

## 13. Loading States & Skeletons
* **Current State**: Displays plain text "Loading agents..." or "Loading projects...".
* **Problems**: Unstyled text strings create layout jumps when data loads.
* **Why Unpolished**: Skeletons are standard in commercial products.
* **Proposed Improvements**: Replace text loaders with animated pulse skeleton rows (`width: 60%`, `height: 16px`, `background: var(--color-surface-2)`).
* **Priority**: **P1**

---

## 14. Empty States & Guidance
* **Current State**: Displays "No active threads" or "No projects found".
* **Problems**: Empty screens provide no guidance on what to do next.
* **Why Unpolished**: Missed opportunity to onboard the user.
* **Proposed Improvements**: Rich empty state cards with 1-click CTA buttons (`+ Create First Thread`, `⌘K Open Command Palette`, `📁 Open Local Repository`).
* **Priority**: **P1**

---

## 15. Onboarding & PIN Pairing UX
* **Current State**: Requires entering a 6-digit PIN from terminal output into `PinScreen.tsx`.
* **Problems**: Users running the app for the first time find the manual PIN code step disorienting.
* **Why Unpolished**: Unnecessary friction for local desktop users.
* **Proposed Improvements**: Auto-pair local desktop sessions automatically when `localhost` / `127.0.0.1` is detected, reserving PIN pairing for remote mobile/LAN devices.
* **Priority**: **P1**

---

## 16. Overall "Premium Feel" Assessment

| Dimension | Current Grade | Target Commercial Standard |
| :--- | :--- | :--- |
| **Visual Density & Spacing** | **C+** | High-density 4px grid (Linear grade) |
| **Code & Typography** | **C** | Dual-stack JetBrains Mono code legibility |
| **Agent Tool Execution UX** | **D+** | Collapsible tool cards & inline diff previews |
| **Navigation & Command Velocity** | **B-** | Instant `⌘K` global quick launcher |
| **Overall Readiness** | **C** | **Requires P0/P1 UX Refinements before Public Launch** |

---

## 🎯 Actionable Next Steps

To make Asterim feel like a product software engineers would happily use for 8+ hours a day, the next development sprint must focus on the **P0 / P1 items**:

1. **P0**: Collapsible Tool Call Accordions & High-Density Chat Bubbles.
2. **P0**: JetBrains Mono Typography & High-Contrast Syntax Code Rendering.
3. **P0**: Preserved View & Scroll States across Chat, Terminal, and Diffs.
4. **P1**: Animated Loading Skeletons & Rich Actionable Empty States.
5. **P1**: Interactive Context Management in Inspector (`+ Pin File`, `/rule`).
