# Asterim Marketing Website — Brutal Visual Audit v2

**Audit Date**: August 11, 2026  
**Auditor**: Lead Product Designer, Creative Director & CTO  
**Target Application**: `@asterim/marketing` (`asterim.dev`)  
**Visual Evidence Source**: Rendered page screenshots ([media__full.png](file:///home/qhukz/.gemini/antigravity-ide/brain/8c0b19e9-7951-4a05-a54b-79f868bf09c4/media__full.png) and [media__1440.png](file:///home/qhukz/.gemini/antigravity-ide/brain/8c0b19e9-7951-4a05-a54b-79f868bf09c4/media__1440.png))  

---

## 1. Visual Audit Summary & Diagnostic Findings

After capturing and inspecting the actual rendered website at 1440px and full-page viewport heights, the visual presentation has been classified as a **failed visual prototype**. While functional and free of build errors, the website suffers from severe visual monotony, formulaic component repetition, overused neon-green elements, and card container overload.

---

## 2. Section-by-Section Visual Breakdown

### Problem 1: Hero Section Visual Weakness & Overused Accent
- **Visual Evidence**: [media__1440.png](file:///home/qhukz/.gemini/antigravity-ide/brain/8c0b19e9-7951-4a05-a54b-79f868bf09c4/media__1440.png) shows a 3-line centered headline where half the sentence is rendered in bright neon emerald (`#34d399`), paired with a generic version pill (`Asterim v0.4.5 — Local Control Plane`) and a dark Workstation box cut off at the bottom.
- **Why It Looks Generic**: Centered 3-line headline with giant green text fill is the textbook AI SaaS template trope. The Workstation box underneath looks glued to the bottom without depth, layering, or scale.
- **Premium Implementation**:
  - Rebuild Hero as an asymmetric, high-impact product thesis statement.
  - Position a large, crisp, multi-layered composition of the actual Asterim Workstation UI (`apps/web`) with depth, subtle drop shadows (`0 40px 100px rgba(0,0,0,0.9)`), readable chrome, and active agent execution.
  - Restrain emerald text fill to a subtle single-word highlight or status dot.

### Problem 2: Formulaic Layout Repetition ("Tag + Title + Cards")
- **Visual Evidence**: [media__full.png](file:///home/qhukz/.gemini/antigravity-ide/brain/8c0b19e9-7951-4a05-a54b-79f868bf09c4/media__full.png) reveals 5 consecutive sections that repeat the exact same structural template:
  1. Small centered green uppercase tag (`INTERACTIVE PREVIEW`, `PRODUCT ARCHITECTURE`, `WORKFLOW ENGINEERING`, `CORE ARCHITECTURE`).
  2. Large centered title.
  3. Centered subhead.
  4. Grid or stack of dark rounded cards with green badges.
- **Why It Looks Generic**: Screams "Tailwind UI component assembly". There is zero visual rhythm, layout diversity, or narrative momentum.
- **Premium Implementation**:
  - Eliminate repetitive 3-column card grids.
  - Vary section compositions: full-width product UI, 2-column split-screen narrative with large typography and open whitespace, sticky interactive mechanics, and timeline flows.

### Problem 3: "Card Container Overload" & Repeated Badges
- **Visual Evidence**: [media__full.png](file:///home/qhukz/.gemini/antigravity-ide/brain/8c0b19e9-7951-4a05-a54b-79f868bf09c4/media__full.png) shows 15 dark rounded boxes (`.surface-card`), almost all stamped with `AVAILABLE NOW` or `PHASE 5 BETA` pills in neon green or sky blue.
- **Why It Looks Generic**: Every piece of information is trapped inside a container. It destroys whitespace and makes the website feel like a dashboard pasted onto a landing page.
- **Premium Implementation**:
  - Remove card containers. Use open typography-driven structures, hairline slate dividers (`border-t border-slate-800/60`), and whitespace to group ideas.
  - Consolidate capability status labels into clean technical metadata lines rather than repetitive pills.

### Problem 4: Meaningless Micro-Metrics & Decorative Noise
- **Visual Evidence**: The previous workstation preview displayed arbitrary trivia like `PID 4912`, `60 FPS / 16ms`, and `RAM 42MB`.
- **Why It Looks Generic**: Invented numbers destroy technical credibility. Developers recognize fake metrics instantly.
- **Premium Implementation**:
  - Ground all metadata strictly in real `apps/web` and `apps/server` states (actual file paths `apps/server/src/ApprovalManager.ts`, real git branch `main`, authentic agent CLI tools `Claude Code v0.4.5`).

---

## 3. Required Component & CSS Remediation List

1. **`index.css`**:
   - Replace generic typography with strict `Satoshi` display + `JetBrains Mono` code + `Inter` body tokens.
   - Recalibrate palette: base background `#070a10`, surface `#0d1424`, hairline borders `rgba(255,255,255,0.06)`, emerald `#10b981` reserved strictly for active execution states and primary CTAs.
   - Enforce anti-card overuse layout rules.
2. **`HeroSection.tsx`**:
   - Rebuild into a multi-layered, asymmetric product composition with realistic Workstation UI chrome (`apps/web`).
3. **`InteractiveProductDemo.tsx`**:
   - Rebuild into stateful interactive product mechanics (Agent Execution Engine, Environment Scope Switcher, AST Security Decomposer, Code Diff Inspector).
4. **`WhyAsterimSection.tsx` & `ProblemSolutionSection.tsx`**:
   - Replace card containers with open split-screen typography and architectural comparison panels.
5. **`PlatformMatrixSection.tsx`**:
   - Rebuild into a unified multi-surface ecosystem pipeline (`Desktop Workstation -> Web Portal -> Mobile Control`).
