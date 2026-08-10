# Architectural & Product Decisions Record

## DEC-015: Introduction of Phase 4.5 — Marketing Website & Product Presentation Refinement

* **Date**: August 11, 2026
* **Status**: Approved Strategy
* **Context**: Following the completion of Phase 4 (Developer Workstation Local Engine Hardening) and prior to launching Phase 5 (SaaS Foundation & Public Beta), a gap was identified between the hardened execution capabilities of Asterim and its public product presentation layer (`asterim.dev`).
* **Decision**: Introduce Phase 4.5 as a mandatory intermediate product-presentation milestone. Phase 4.5 focuses on transforming `@asterim/marketing` into a high-precision, developer-focused marketing experience without building unneeded Phase 5 SaaS backend infrastructure.
* **Key Principles**:
  1. **Clear Product Positioning**: Answer immediate developer questions (What, Why, Capabilities, Differentiation, Ecosystem Availability, Quickstart) within seconds.
  2. **Accurate Ecosystem Status**: Distinguish clearly between Available Now (Desktop Local Engine, Web Account Portal), Beta (Web Remote Control), and Planned (Phase 5 Mobile Push & Relay).
  3. **Interactive Demonstrations over Static Text**: Show live UI previews (Agent PTY stream, AST safety guard, environment switcher, mobile tunnel) directly on the landing page.
  4. **Strict Phase 5 Compatibility**: Design routing, pricing tier breakdowns, and download pages to integrate cleanly with Phase 5 SaaS cloud services without premature code churn.
* **Impact**:
  - `docs/phase4-5-roadmap.md` established as Source of Truth for Phase 4.5.
  - `apps/marketing` routing and information architecture modernized.
  - Commercial readiness elevated prior to public SaaS beta launch.

---

## DEC-016: Phase 4.5 Marketing Content & Implementation Truth Contract & Legal Readiness

* **Date**: August 11, 2026
* **Status**: Approved Strategy & Compliance Requirement
* **Context**: User approved Phase 4.5 strategy with strict directives: (1) create a Marketing Content & Implementation Truth Contract (`docs/phase4-5-content-truth.md`) auditing codebase capabilities, (2) enforce presentation-only scope without Phase 5 backend implementations (no Stripe, no entitlement engines, no cloud relays), (3) implement lightweight `/docs` covering 8 core guides, (4) ground interactive demos in real Asterim application visual concepts, (5) formulate a 30-second "Why Asterim?" positioning story, and (6) add a Public Release Legal Readiness Checklist (`docs/phase4-5-legal-checklist.md`).
* **Decision**: Establish PR 0 to audit capabilities into strict categories (`AVAILABLE NOW`, `PARTIAL`, `BETA`, `PHASE 5`, `PLANNED`, `NOT IMPLEMENTED`), prohibit advertising unbuilt capabilities, and enforce legal/compliance checklists prior to public launch.
* **Impact**:
  - `docs/phase4-5-content-truth.md` and `docs/phase4-5-legal-checklist.md` created.
  - `docs/phase4-5-roadmap.md` updated to Version 2.0.0.
  - `tasks.md` updated with PR 0 through PR 7 sequence.

---

## DEC-017: Phase 4.5 Professional Website Audit & Visual Design System Refinement

* **Date**: August 11, 2026
* **Status**: Approved Strategy & Design System Standard
* **Context**: Following initial Phase 4.5 PR 0-7 implementation, a full professional UX audit (`docs/phase4-5-website-audit.md`) revealed visual design and structural patterns (card overuse, ad-hoc inline styles, overused green glows) that made the site look like an AI-generated template rather than a mature developer product comparable to Cursor, Linear, or Vercel.
* **Decision**: Adopt the "Remove before adding" principle and establish a unified visual design system in `apps/marketing/src/index.css`:
  1. **Consolidated Design Tokens**: Enforce CSS variables for surface elevations, neutral borders (`rgba(255,255,255,0.06)`), and structured typography.
  2. **Restrained Color Palette**: Limit emerald green accent (`#10b981`) to primary CTAs, active tab highlights, and live execution status indicators. Reduce glow opacities to 4-6%.
  3. **High-Fidelity Interactive Demos**: Replace decorative mockups with authentic representations of real Asterim Workstation UI components (`apps/web`).
  4. **Card Container Consolidation**: Merge redundant sections (`WhyAsterimSection` and `ProblemSolutionSection`) into a unified 2-column control plane architecture showcase.
---

## DEC-018: Pre-Phase-5 Pre-Release Audit & Final Verification

* **Date**: August 11, 2026
* **Status**: Approved Audit Verdict — READY TO BEGIN PHASE 5
* **Context**: Prior to initiating Phase 5 (SaaS Foundation & Beta Release), a mandatory independent audit (`docs/pre-phase5-audit.md`) was conducted across all 6 monorepo packages, routes, product claims, backend security, legal checklists, and core execution loop integration.
* **Decision**: Formally certify Phase 4.5 as 100% complete and declare the repository ready to enter Phase 5.
* **Key Audit Findings**:
  1. **Marketing & Routes Verification**: All routes (`/`, `/pricing`, `/docs`, `/download`, `/account/*`) built, verified, and tagged with explicit capability status badges.
  2. **Product Truth Contract**: Marketing claims audited against `apps/server` and `apps/web` implementations. No false production claims allowed.
  3. **Golden Execution Loop**: Agent -> EventBus -> WebSocket -> Workstation UI -> Approval -> Resume loop verified working.
  4. **Monorepo Build Integrity**: Full Turbo build (`pnpm build`) compiled cleanly across all 6 packages in 13.4s with 0 errors.
---

## DEC-019: Phase 4.5 Experience Overhaul & Interactive Control Plane Simulator Strategy

* **Date**: August 11, 2026
* **Status**: Approved Strategy & Product Presentation Standard
* **Context**: User directed a final experience overhaul to elevate `@asterim/marketing` from a static functional website to a distinctive, interactive product experience that teaches Asterim's control-plane architecture through meaningful interaction.
* **Decision**: Shift from static SaaS marketing patterns to an interactive product-led experience:
  1. **Hero Control Plane Interactive Topology**: Embed an interactive topology visualizer directly in the hero showing `Environment -> Agent -> Security -> Clearance`.
  2. **Multi-State Workstation Simulator**: Build interactive state engines for Agent Execution (`IDLE` -> `RUNNING` -> `TOOL CALL` -> `SECURITY CHECK` -> `COMPLETED`), AST Command Hazard Inspector (with selectable risk commands and Approve/Reject clearance), Scope Switcher (Personal, Company, Client), and E2E Remote Relay Push Approval.
  3. **Visual Architecture Primitives**: Derive visual concepts directly from Asterim's architecture (process trees, AST path bounds, control topology grids).
---

## DEC-020: Phase 4.5 Corrective Experience Redesign — Product-First Presentation

* **Date**: August 11, 2026
* **Status**: Approved Strategy & Presentation Standard
* **Context**: Critical product design audit (`docs/phase4-5-corrective-audit.md`) established that widget-heavy panels, dense metrics (`PID 4912`, `RAM 42MB`), abstract topology node inspector grids, and rounded card overload made the marketing site feel like an AI-generated SaaS template rather than a premium developer product like Cursor, Linear, or Raycast.
* **Decision**: Adopt a **Product-First Experience Architecture** (`docs/phase4-5-experience-redesign.md`):
  1. **Realistic Workstation UI Shell in Hero**: Replace abstract node diagrams with a large, crisp, realistic composition of the actual Asterim Workstation interface (`apps/web`).
  2. **Cinematic 8-Act Narrative Flow**: Replace 3-column card grids with a progressive visual story (`Hero -> Chaos Problem -> Agent in Action Workflow -> Environment Isolation -> AST Security Guard -> Multi-Surface Ecosystem -> Privacy Guarantee -> Quickstart`).
  3. **Immersive Workflow Demo**: Replace button/text toggle boxes with a 5-step interactive workflow (`Agent -> Tool Action -> Code Diff -> Security Approval Request -> Execution Completed`).
  4. **Eliminate Widget Noise**: Remove decorative counters, dense trivia panels, unanchored radial background glows, and repetitive card borders.
* **Impact**:
  - `docs/phase4-5-corrective-audit.md` and `docs/phase4-5-experience-redesign.md` created.
  - `@asterim/marketing` experience redesigned to premium developer product standards.
