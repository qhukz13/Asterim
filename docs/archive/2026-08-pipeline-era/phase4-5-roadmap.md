# Asterim Phase 4.5 — Marketing Website & Product Presentation Refinement Roadmap

**Document Version**: 2.0.0 — SOURCE OF TRUTH FOR PHASE 4.5  
**Author**: CTO, Product Architect, Lead UX Engineer & Product Marketing Engineer  
**Date**: August 11, 2026  
**Status**: Proposal for User Approval  
**Target Platform**: `@asterim/marketing` (`asterim.dev`)  

---

## 1. Executive Summary & Mission Statement

Asterim Phase 4 (**Developer Workstation Local Engine Hardening**) is complete. Before commencing Phase 5 (**SaaS Foundation & Beta Release**), Phase 4.5 introduces a dedicated product presentation and marketing refinement phase.

The goal of Phase 4.5 is **NOT** merely cosmetic refinement, nor is it SaaS infrastructure implementation. The primary objective is to transform the public marketing website (`asterim.dev` / `apps/marketing`) into a high-precision, developer-focused product presentation experience that clearly communicates:
1. **What is Asterim?** A local-first AI engineering operating system and control center for autonomous coding agents.
2. **Why does it exist?** Managing multiple autonomous agents, project contexts, shell permissions, MCP tools, and environments across terminal windows is chaotic and unsafe.
3. **What does it actually do?** Hardened agent execution, real-time command AST security parsing, isolated environment presets, MCP server lifecycle management, real-time Git diff inspection, and cross-platform remote monitoring.
4. **Why should I use it?** Eliminates agent sprawl, guarantees safety via command interception, isolates credentials/skills, and provides single-pane monitoring across Desktop, Web, and Mobile.
5. **Where can I use it?** Desktop (Local Engine — Available Now), Web (Remote Control & SaaS Portal — Available Now/Beta), Mobile (Monitoring & Approvals — Phase 5 Beta).
6. **How do I start?** Immediate access via CLI installation (`npm install -g asterim`), Desktop download, Documentation quickstart, GitHub repository, and Account Portal registration.

---

## 2. Phase 4.5 Guardrails & Boundaries

To preserve architectural focus and prevent premature SaaS bloat, Phase 4.5 is subject to strict operational boundaries:

### ⛔ STRICTLY OUT OF SCOPE FOR PHASE 4.5 (NO BACKEND IMPLEMENTATION)
- **NO** Stripe or LemonSqueezy payment processing integration.
- **NO** real billing entitlement backend or paywall enforcement logic.
- **NO** cloud relay WebSocket tunnel infrastructure or cloud relay servers.
- **NO** mobile push notification backend services.
- **NO** multi-tenant database synchronization or cloud storage APIs.
- **NO** changes to core Asterim application architecture.

*Pricing will be presented as static product information to explain tier capabilities without live transaction processing.*

---

## 3. "Why Asterim?" Core Product Story (30-Second Positioning)

The homepage hero and narrative structure must convey Asterim's unique positioning within 30 seconds:

```text
Problem:
AI coding agents are powerful, but managing multiple autonomous agents across IDE windows,
raw terminals, unvetted shell commands, and mixed project credentials is chaos.

Solution:
Asterim is the local-first AI Engineering Operating System.

Differentiation:
Asterim is NOT another inline code completion plugin or IDE wrapper.
Asterim is the Control Plane that orchestrates, isolates, monitors, and secures
autonomous AI agents across projects, environments, and devices.
```

---

## 4. Complete Codebase & Website Audit Summary

An exhaustive audit of the `apps/marketing` codebase was conducted against product requirements and implementation evidence (documented in detail in `docs/phase4-5-content-truth.md`).

### 4.1 Audit Categorization

#### 🟢 READY (Usable & Functional)
* **Account Authentication Forms** (`apps/marketing/src/pages/Login.tsx` & `Register.tsx`): Fully functional UI components connecting to backend server API endpoints (`/api/v1/auth/login`, `/api/v1/auth/register`).
* **Account Portal Dashboard** (`apps/marketing/src/components/AccountLayout.tsx` & `WorkspaceSettings.tsx`): Rich post-login user portal supporting overview stats, active sessions management, trusted devices revocation, API key generation, team member lists, and billing tier display.
* **Basic Styling Tokens** (`apps/marketing/src/index.css`): Monochrome color variables with emerald green accents (`--accent-emerald: #10b981`), dark surface layers (`#080c14`, `#0f172a`), and font tokens.

#### 🟡 PARTIAL (Exists but Requires Refinement)
* **Homepage Layout** (`apps/marketing/src/App.tsx`): Contains basic hero text and 3 feature cards, but lacks structured product storytelling, interactive previews, platform breakdown, environment details, or call-to-action sections.
* **Navigation Header** (`apps/marketing/src/components/Navbar.tsx`): Contains brand logo and nav buttons, but lacks active path indicators, mobile navigation drawer/toggle, GitHub star counter link, and proper route handling.
* **Responsive Behavior**: Basic breakpoint at 768px in `index.css`, but navigation items crowd and overflow on mobile devices.

#### 🔴 MISSING (Does Not Exist)
* **Dedicated Pages**:
  * `/pricing`: Static pricing tier page explaining Community Free vs Pro vs Enterprise capabilities, self-hosted local engine vs cloud relay features.
  * `/docs`: Lightweight, clean documentation viewer covering Quickstart, What is Asterim?, Environments, AI Agents, Security, MCP & Skills, Architecture, and CLI.
  * `/download`: Platform download page displaying OS support matrix (Linux, macOS, Windows) and CLI install commands.
* **Interactive Product Demonstrations**: Live UI previews using real Asterim concepts (agent session streaming, AST safety guard, environment switcher, mobile monitoring).
* **Platform Presentation Section**: Section detailing Desktop, Web, and Mobile ecosystem with explicit availability status.
* **Footer Component**: Website footer containing product links, documentation, legal checklist links, social/GitHub links, status indicators, and copyright.
* **SEO & Typography Infrastructure**: `index.html` title tag is generic (`<title>marketing</title>`), missing meta description, Open Graph cards, Twitter metadata, and Google Fonts imports (`Inter` & `JetBrains Mono`).

#### ❌ BROKEN (Functions Incorrectly)
* **Navigation Subpage Routing**: Clicking `/pricing`, `/docs`, or `/download` updates state but falls through in `App.tsx` to render the homepage hero instead of dedicated content.
* **CTA Button Action**: "Explore Features" button uses hardcoded `window.scrollTo({ top: 800 })` offset instead of element ref or section ID anchor.
* **Unused CSS Boilerplate**: `App.css` contains unused template CSS from Vite default app (`.counter`, `.hero .framework`, etc.).

---

## 5. Website Information Architecture (IA)

The redesigned website will implement a clean, lightweight client-side routing model:

```text
asterim.dev
├── / (Home — Master Product Story, "Why Asterim?", & Interactive Previews)
├── /pricing (Static Tier Overview: Community Free vs Pro vs Enterprise)
├── /docs (Lightweight Documentation Viewer: Quickstart, Architecture, MCP & Skills, CLI)
├── /download (Desktop Releases, CLI npm install, Platform Support Matrix)
└── /account/
    ├── /login (Cloud Identity Authentication)
    ├── /register (Account Creation)
    ├── /dashboard (Account Overview & Stats)
    ├── /members (Team Workspace Management)
    ├── /sessions (Active Session Control & Remote Logout)
    ├── /devices (Trusted Device Registration)
    ├── /apikeys (Machine-to-Machine API Tokens)
    └── /billing (Subscription Status & Static Tier Details)
```

---

## 6. Lightweight Documentation Architecture (`/docs`)

To avoid building an over-engineered documentation platform, `/docs` will provide a fast, tabbed/sidebar navigation interface rendering clean Markdown/TSX guides for:

1. **Quickstart**: Installation via `npm install -g asterim`, pairing desktop client, starting first agent.
2. **What is Asterim?**: Core architecture, local-first engine philosophy, agent control plane.
3. **Environments**: Isolated workspace presets (Personal, Company, Client, Experimental), credential scoping.
4. **AI Agents**: Interoperability with Claude Code, Aider, custom scripts, process tree management.
5. **Security & Approvals**: Real-time shell AST command parsing, path traversal sandbox guard, diff previews.
6. **MCP & Skills**: Model Context Protocol configuration, reusable task skills, parameter schemas.
7. **Architecture**: Core Engine, Adapters, Client Shell, Cloud Relay boundaries.
8. **CLI Reference**: Full command-line interface usage guide.

---

## 7. Interactive Product Demonstrations (Real Asterim Concepts)

The interactive preview component on the homepage (`InteractiveProductDemo.tsx`) will strictly reflect real Asterim application visual language (`apps/web`) and concepts:

* **Tab 1: [Subprocess & PTY Streaming]**: Live output streaming showing xterm.js frame chunking, 10,000+ line backpressure throttling, and process PID tracking.
* **Tab 2: [Command AST Security Guard]**: Visual diff preview of proposed shell command, AST hazard evaluation (`rm -rf /` blocked, sandbox path verification passed), and interactive Approve/Reject button.
* **Tab 3: [Environment Isolation Switcher]**: Real-time switcher between `Personal (Local)`, `Acme Corp (Company)`, and `Client Portal`, demonstrating credential and tool isolation per environment.
* **Tab 4: [Remote Tunnel & Mobile Control]**: Visual mockup of mobile PWA status indicator receiving agent approval push prompts over E2E encrypted tunnel.

---

## 8. UX Inspiration vs. Visual Identity

* **Inspiration (Cursor/Linear Tier UX)**: High-density information layout, sleek spacing, effortless typography scaling, fast responsiveness, clear value-focused copywriting.
* **Asterim Identity**: 
  * Monochrome palette with single **Accent Emerald Green** (`#10b981`).
  * Engineering-first, precise UI chrome without superfluous neon gradients or decorative sparkles.
  * Heavy emphasis on control, safety, terminal output, and workstation precision.

---

## 9. Legal & Public Release Readiness Checklist

All legal and compliance requirements for public operation are defined in [docs/phase4-5-legal-checklist.md](file:///home/qhukz/Documents/Projects/Asterim/docs/phase4-5-legal-checklist.md), covering:
- Terms of Service & Privacy Policy
- Local vs Cloud Data Boundary declarations
- MIT License & Third-Party Attribution
- Cookie & Consent requirements
- Account Deletion & Security Contact (`security@asterim.dev`)
- Commercial / Tax legal disclosures & DMCA contact details

---

## 10. PR Breakdown (8 Sequential PRs)

Phase 4.5 implementation will be executed across 8 logical, self-contained PRs:

### PR 0 — Marketing Truth & Content Contract Audit
* **Objective**: Create `docs/phase4-5-content-truth.md` and `docs/phase4-5-legal-checklist.md` to establish normative claims and compliance frameworks.
* **Files**:
  - `docs/phase4-5-content-truth.md` [NEW]
  - `docs/phase4-5-legal-checklist.md` [NEW]

### PR 1 — Marketing Router Architecture, Navigation & Layout Shell
* **Objective**: Fix client-side routing, build responsive navigation shell, header, mobile drawer, and footer.
* **Files**:
  - `apps/marketing/src/App.tsx` (Route matcher for `/`, `/pricing`, `/docs`, `/download`, `/account/*`)
  - `apps/marketing/src/components/Navbar.tsx` (Active states, GitHub link, mobile drawer toggle)
  - `apps/marketing/src/components/Footer.tsx` [NEW] (Multi-column footer layout with legal links)
  - `apps/marketing/src/components/MobileNavDrawer.tsx` [NEW] (Responsive mobile navigation)
  - `apps/marketing/index.html` (Title, meta tags, Google Fonts `Inter` + `JetBrains Mono`)
  - `apps/marketing/src/App.css` (Clean up unused Vite boilerplate styles)

### PR 2 — Homepage Hero & "Why Asterim?" Positioning Section
* **Objective**: Rebuild hero section with 30-second value proposition, status badge, install snippet, and primary CTAs.
* **Files**:
  - `apps/marketing/src/components/home/HeroSection.tsx` [NEW]
  - `apps/marketing/src/components/home/WhyAsterimSection.tsx` [NEW]
  - `apps/marketing/src/components/common/TerminalCopyBlock.tsx` [NEW]

### PR 3 — Interactive Product Demonstration Components
* **Objective**: Build interactive tabbed preview component showing real Asterim UI concepts (PTY stream, AST guard, environment switcher, mobile tunnel).
* **Files**:
  - `apps/marketing/src/components/home/InteractiveProductDemo.tsx` [NEW]
  - `apps/marketing/src/components/home/demo/AgentStreamTab.tsx` [NEW]
  - `apps/marketing/src/components/home/demo/SecurityGuardTab.tsx` [NEW]
  - `apps/marketing/src/components/home/demo/EnvironmentTab.tsx` [NEW]
  - `apps/marketing/src/components/home/demo/MobileTunnelTab.tsx` [NEW]

### PR 4 — Problem/Solution, Core Capabilities & Platform Matrix
* **Objective**: Implement problem vs solution comparison, 5-pillar capability visual grid, and platform availability matrix (Desktop, Web, Mobile).
* **Files**:
  - `apps/marketing/src/components/home/ProblemSolutionSection.tsx` [NEW]
  - `apps/marketing/src/components/home/CapabilitiesGrid.tsx` [NEW]
  - `apps/marketing/src/components/home/PlatformMatrixSection.tsx` [NEW]
  - `apps/marketing/src/components/home/OpenSourceSection.tsx` [NEW]

### PR 5 — Dedicated Pages: Pricing, Download & Lightweight Docs
* **Objective**: Implement static pricing comparison page, OS download page, and lightweight documentation viewer (`/docs`).
* **Files**:
  - `apps/marketing/src/pages/PricingPage.tsx` [NEW] (Static Community vs Pro vs Enterprise comparison table)
  - `apps/marketing/src/pages/DownloadPage.tsx` [NEW] (Platform matrix: Linux, macOS, Windows, CLI instructions)
  - `apps/marketing/src/pages/DocsPage.tsx` [NEW] (Clean, navigable documentation viewer covering 8 core guides)

### PR 6 — Responsive UX, Mobile Polish & Accessibility Audit
* **Objective**: Audit and refine mobile breakpoints, touch targets, screen-reader labels, and keyboard navigation.
* **Files**:
  - `apps/marketing/src/index.css` (Refined mobile grid media queries)
  - `apps/marketing/src/components/*` (Accessibility ARIA attributes)

### PR 7 — Final Polish, Production Verification & Build Validation
* **Objective**: End-to-end testing, asset optimization, production Vite build validation, and final documentation sync.
* **Files**:
  - `apps/marketing/*` (Final build verification, 0 lint/TS errors)
  - `docs/phase4-5-roadmap.md` & `tasks.md`

---

## 11. Risks & Mitigation Strategies

1. **Risk**: Prematurely building Phase 5 SaaS cloud infrastructure (billing backends, Stripe webhooks, cloud relay).
   * **Mitigation**: Phase 4.5 is strictly the presentation and UX layer. Billing and download pages will clearly present plan structures and availability statuses without modifying Phase 5 cloud contracts.
2. **Risk**: False claims regarding unreleased features (e.g. mobile push notifications or cloud relay).
   * **Mitigation**: Strict platform availability badges ("Available Now", "Beta", "Phase 5 Roadmap") governed by `docs/phase4-5-content-truth.md`.
3. **Risk**: Heavy animation libraries slowing down page performance.
   * **Mitigation**: Rely exclusively on pure CSS hardware-accelerated transitions (`transform`, `opacity`) and React state. Zero external heavy animation dependencies.

---

## 12. Exact Verification Plan

1. **Monorepo Build Verification**: Run `pnpm --filter @asterim/marketing build` to confirm zero TypeScript, React, or Vite bundling errors.
2. **Route Verification**: Test all client routes (`/`, `/pricing`, `/docs`, `/download`, `/account/login`, `/account/register`, `/account/dashboard`) to ensure correct component mounting.
3. **Responsive Verification**: Verify navigation drawer and visual grids on viewport widths: 1440px (Desktop), 1024px (Tablet), 768px (Mobile landscape), 375px (Mobile portrait).
