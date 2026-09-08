# Asterim Marketing Website — Full Design Audit & Competitive Analysis

**Audit Date**: August 11, 2026  
**Auditor**: Lead Product Designer, Creative Director & CTO  
**Target Application**: `@asterim/marketing` (`apps/marketing`)  
**Applied Design Skills**: `design-taste-frontend`, `scroll-experience`, `frontend-design`, `frontend-design-review`  

---

## 0. Installed Design Skills Application Framework

The following installed design skills have been selected and integrated into this audit and redesign methodology:

1. **`design-taste-frontend` (` Leonxlnx/taste-skill`)**:
   - *Why Relevant*: Provides strict anti-generic constraints, anti-card overuse rules, color calibration (desaturated emerald accent `#10b981`, no purple glows), deterministic typography (`Geist`/`Satoshi` + `JetBrains Mono`), layout variance, and tactile micro-interaction feedback.
   - *Application*: Applied to eliminate repetitive rounded card containers, enforce strict palette desaturation, and establish tactile button/tab physics.
2. **`scroll-experience` (`vibeship-spawner-skills`)**:
   - *Why Relevant*: Guides scroll-driven storytelling, progressive narrative reveals, sticky product previews, and GPU-accelerated motion without layout jank.
   - *Application*: Applied to structure the homepage into a progressive 8-act visual narrative with smooth transform/opacity scroll reveals and `prefers-reduced-motion` compliance.
3. **`frontend-design` (`anthropics/skills`)**:
   - *Why Relevant*: Treats the hero as a thesis, mandates distinctive typography, enforces Chanel's rule ("remove one accessory before leaving"), and insists on active voice copy written from the user's perspective.
   - *Application*: Applied to make the Hero a bold product thesis featuring the real Asterim Workstation UI, eliminating decorative numbering (`01/02/03`) and filler AI copy.
4. **`frontend-design-review` (`microsoft/skills`)**:
   - *Why Relevant*: Provides systematic accessibility, focus ring (`:focus-visible`), touch target (>= 40px), and responsive layout stability checks across viewports.
   - *Application*: Applied during visual QA to ensure WCAG AAA accessibility, keyboard navigation, and mobile view stability (`min-h-[100dvh]`).

---

## 1. Full Visual & Experience Diagnostic

### Current Strengths
- Fast production build times (< 1.5s).
- Clean React component architecture and zero external WebGL/heavy video dependencies.
- Clear product claims carrying explicit status badges (`AVAILABLE NOW`, `BETA`, `PHASE 5 BETA`, `PLANNED`).

### Critical Experience & Design Failures
1. **"Card Container Overload"**: Virtually every section wraps its contents inside rounded dark rectangle boxes (`.surface-card`). This creates visual monotony, destroys whitespace rhythm, and screams "AI SaaS template".
2. **Widget Noise & Metric Trivia**: Past iterations filled the UI with small inspector cards, dense counters (`PID 4912`, `RAM 42MB`, `60 FPS / 16ms`), and text toggle boxes. These metrics create cognitive clutter without demonstrating what using Asterim actually feels like.
3. **Abstract Architecture Over Real Product UI**: The Hero and features rely on abstract node diagrams and text blocks rather than showing large, crisp, realistic compositions of the actual Asterim Workstation application (`apps/web`).
4. **Lack of Cinematic Motion**: Animations are limited to static string appends and basic hover colors rather than stateful workflow motion (`Agent -> Tool Action -> Code Diff -> Security Approval Request -> Execution Completed`).
5. **Generic Layout Rhythm**: The page repeats the formula: `section-tag` + `section-title` + `3-column card grid` across almost every section.

---

## 2. Human-Level Experience Critique

| Section | What I See | What I Understand | What I Feel | Diagnostic & Recommended Change |
| :--- | :--- | :--- | :--- | :--- |
| **Hero** | Large headline + terminal snippet + dark Workstation box. | Asterim is an engine for AI agents. | Interested, but wants to see the actual application in action immediately. | **REDESIGN**: Make the Hero a bold product thesis featuring a large, crisp, realistic composition of the Asterim Workstation UI (`apps/web`). |
| **Why Asterim** | 2 rounded card boxes contrasting "Loose Terminals" vs "Workstation". | Agents in terminals are chaotic; Asterim brings control. | Feels repetitive and text-heavy inside card containers. | **REDESIGN**: Remove card containers. Use an open 2-column split-screen layout with large typography and generous whitespace. |
| **Agent Workflow** | Tabbed preview box showing agent steps. | Agents execute tasks and ask for approvals. | Feels like a static widget rather than a live application. | **REDESIGN**: Create an auto-progressing **Agent in Action Workflow Engine** (`Agent -> Tool Action -> Code Diff -> Security Interception -> Approval -> Task Completed`). |
| **Capabilities Grid** | 5 rounded card boxes in a grid. | Explains sub-processes, AST security, environments, MCP, Git. | Feels like a generic SaaS feature grid. | **REDESIGN**: Replace generic grid cards with an open 2-column architectural panel showcasing real product surfaces. |
| **Platform Matrix** | 3 rounded card boxes for Desktop, Web, Mobile. | Asterim works across Desktop, Web, and Mobile. | Cards feel disconnected from each other. | **REDESIGN**: Create a unified multi-surface ecosystem composition (`Desktop Workstation -> Web Portal -> Mobile Control`). |

---

## 3. Competitive Design Research & Asterim Principles

### Principles Extracted from Category Leaders
- **Cursor**: Displays the real IDE interface as the hero centerpiece. Uses subtle dark slate tones, desaturated accents, and direct product workflow reveals.
- **Linear**: Relies on large typography, deep dark surfaces (`#080c14`), hairline dividers (`border-slate-800`), precise motion physics, and ultra-clean whitespace.
- **Vercel**: Uses monochrome typography, high contrast, open layouts without card clutter, and purposeful micro-interactions.

### Asterim Design Principles
1. **Product as Thesis**: Show the real Asterim Workstation UI (`apps/web`) first. Never replace real UI with decorative abstract diagrams.
2. **Whitespace over Card Boxes**: Omit container boxes whenever whitespace or divider lines can group content. Let the UI breathe.
3. **Restrained Accent Palette**: Neutral charcoal base (`#080c14` / `#0f172a`), desaturated slate borders (`rgba(255,255,255,0.05)`), and emerald `#10b981` reserved strictly for active execution states and primary CTAs.
4. **Cinematic Stateful Motion**: Animate workflow state transitions (`Agent -> Tool -> Interception -> Approval -> Resume`) to teach the product architecture through motion.
5. **Truth in Copy & Status**: Use concrete active-voice copy. Explicitly tag every capability (`AVAILABLE NOW`, `BETA`, `PHASE 5 BETA`, `PLANNED`).
