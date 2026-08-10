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

