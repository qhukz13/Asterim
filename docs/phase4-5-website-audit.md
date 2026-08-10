# Phase 4.5 — Professional Product Website Audit

**Audit Date**: 2026-08-11  
**Auditor**: Lead UX Engineer & Product Architect  
**Target Application**: `@asterim/marketing` (`apps/marketing`)  

---

## Executive Summary

An empirical audit of the Asterim marketing website was conducted across visual hierarchy, typography, color usage, spacing rhythm, content credibility, interactive product previews, responsive viewports, and accessibility.

While the current site functions and builds cleanly without errors, the presentation contains visual and structural patterns that make it look like an AI-generated template rather than a mature, premium developer product (e.g. Cursor, Linear, Vercel, Raycast).

This document details every identified issue categorized by severity (P0, P1, P2) alongside actionable implementation recommendations.

---

## 1. Visual Design & System Audit

### Issue 1.1: Ad-hoc Inline Styles & Broken Spacing Rhythm
* **Evidence**: Components (`HeroSection`, `WhyAsterimSection`, `InteractiveProductDemo`, `ProblemSolutionSection`, `CapabilitiesGrid`, `PlatformMatrixSection`, `OpenSourceSection`, `PricingPage`, `DownloadPage`, `DocsPage`) rely heavily on ad-hoc inline `style={{ ... }}` blocks with hardcoded padding (`80px 24px`, `64px 24px`, `56px 40px`), varied margins, and divergent border colors (`rgba(255,255,255,0.08)`, `rgba(255,255,255,0.1)`, `rgba(16,185,129,0.25)`).
* **Impact**: Inconsistent vertical rhythm, visual noise, and lack of design system cohesion across pages.
* **Severity**: **P0 — Professionalism Blocker**
* **Recommended Fix**: Consolidate design tokens in `apps/marketing/src/index.css` (`--surface-bg`, `--surface-border`, `--space-section`, `--radius-lg`, `--font-hero`, etc.) and replace arbitrary inline styles with reusable CSS classes.

---

### Issue 1.2: Overused Emerald Accent Green & Radial Glows
* **Evidence**: Radial green background gradients (`rgba(16, 185, 129, 0.1)`) and bright green borders are applied to almost every card, pill badge, icon container, and button on the homepage.
* **Impact**: Visual fatigue. Overuse of accent colors destroys visual hierarchy. Premium developer tools (e.g. Linear, Cursor) exercise color restraint, using accent colors strictly for primary action CTAs, active tab indicators, and live execution status badges.
* **Severity**: **P1 — Design Polish**
* **Recommended Fix**: Reduce background glow intensity to 4-6%. Use neutral slate borders (`rgba(255,255,255,0.06)`) for standard cards and reserve emerald green for primary CTAs, status badges, and active state indicators.

---

### Issue 1.3: Card Overuse & Template Repetition
* **Evidence**: `WhyAsterimSection`, `ProblemSolutionSection`, `CapabilitiesGrid`, `PlatformMatrixSection`, and `OpenSourceSection` repeat the exact same pattern: dark background + rounded border + icon + heading + short text paragraph across 15+ cards.
* **Impact**: The site feels like a generic SaaS template. Visitors scroll past repetitive cards without retaining information.
* **Severity**: **P0 — Professionalism Blocker**
* **Recommended Fix**: Apply the "Remove before adding" principle. Consolidate `WhyAsterimSection` and `ProblemSolutionSection` into a unified high-impact product architecture section with a crisp 2-column layout and real terminal/UI code split views instead of card grids.

---

## 2. Product Messaging & Content Credibility Audit

### Issue 2.1: Message Overlap & Redundancy
* **Evidence**: The core message ("Control Plane vs. Loose Terminals") is repeated in `WhyAsterimSection`, `ProblemSolutionSection`, and `OpenSourceSection`. Offline capability and MIT license claims appear 4 separate times.
* **Impact**: Dilutes user attention and slows down the 30-second value proposition discovery.
* **Severity**: **P1 — Content Polish**
* **Recommended Fix**: Streamline section hierarchy:
  1. Hero: Core 30-second value proposition & quickstart CLI block.
  2. Interactive Workstation Demo: Show, don't tell (real terminal, AST guard, environment switcher, mobile tunnel preview).
  3. Control Plane Architecture: Unified problem/solution breakdown.
  4. Core Pillars: 5 architectural capabilities.
  5. Platform Ecosystem Matrix: Desktop (Available Now), Web (Beta), Mobile (Phase 5).
  6. Open Core & Security Guarantee.

---

## 3. Interactive Product Demonstration Audit

### Issue 3.1: Artificial Component Mockups in Demo Tabs
* **Evidence**: `AgentStreamTab`, `SecurityGuardTab`, `EnvironmentTab`, and `MobileTunnelTab` render hardcoded mock divs with emoji icons (`💡`, `✨`) and basic text instead of pixel-perfect representations of the actual Asterim Workstation app (`apps/web`).
* **Impact**: The demo looks like a static marketing widget rather than a high-fidelity preview of a real AI engineering operating system.
* **Severity**: **P0 — Professionalism Blocker**
* **Recommended Fix**: Refine the demo components to mirror the exact UI elements from `apps/web`:
  - `AgentStreamTab`: Realistic PTY output log with line numbers, status badge, 16ms backpressure rate indicator, and realistic agent prompt execution (`@asterim/core`).
  - `SecurityGuardTab`: Interactive command AST scanner preview showing flagged hazard (`rm -rf /var/log`), diff inspector, and clean Approve/Reject controls.
  - `EnvironmentTab`: Scope switcher for Personal, Company, and Client presets showing active secret count and attached project paths.
  - `MobileTunnelTab`: Live E2E cloud relay status with interactive mobile approval push prompt card.

---

## 4. Navigation & Page Structure Audit

### Issue 4.1: Download Page Command Duplication
* **Evidence**: `DownloadPage.tsx` lists `npm install -g asterim` 3 separate times across Linux, macOS, and Windows cards.
* **Impact**: Redundant layout and cluttered UI.
* **Severity**: **P1 — UX Polish**
* **Recommended Fix**: Create a clean top Quickstart block (`npm install -g asterim`) and present OS-specific binary downloads (AppImage, DMG, EXE, Homebrew) in a structured tabbed/grid platform layout.

---

### Issue 4.2: Documentation Viewer Layout & Search
* **Evidence**: `DocsPage.tsx` uses basic inline conditional blocks for 11 topics with minimal formatting.
* **Impact**: Navigation feels rudimentary.
* **Severity**: **P1 — UX Polish**
* **Recommended Fix**: Refine `DocsPage.tsx` into a structured documentation reader with clean markdown-styled typography, code copy blocks, active topic highlighting, search filter input, and breadcrumb headers.

---

## 5. Responsive UX, Interaction & Accessibility Audit

### Issue 5.1: Touch Target Sizes & Focus Ring Visibility
* **Evidence**: Interactive tab buttons and navbar links in mobile views lack explicit `:focus-visible` styling and accessibility ARIA attributes (`aria-selected`, `aria-controls`, `role="tab"`).
* **Impact**: Suboptimal keyboard navigation and mobile touch accessibility.
* **Severity**: **P1 — Accessibility**
* **Recommended Fix**: Add standardized `:focus-visible` outline rules (`outline: 2px solid #10b981`) and proper ARIA roles across all navigation buttons, tabs, and form controls.

---

## Summary of Audit Findings by Severity

| Severity | Count | Primary Areas |
| :--- | :--- | :--- |
| **P0 (Blocker)** | 3 | Design system tokens, Card container overuse, Demo UI fidelity |
| **P1 (Important)** | 4 | Color restraint, Message deduplication, Download UI layout, Docs viewer UX |
| **P2 (Polish)** | 2 | Micro-interactions, Focus accessibility & keyboard navigation |
