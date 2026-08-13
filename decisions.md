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
---

## DEC-021: Phase 4.5 Full Design Audit & Agentic Design System Strategy

* **Date**: August 11, 2026
* **Status**: Approved Strategy & Visual Design Standard
* **Context**: Integrated installed Agentic Awesome Skills (`design-taste-frontend`, `scroll-experience`, `frontend-design`, `frontend-design-review`) to execute a full visual and product presentation redesign of `@asterim/marketing`.
* **Decision**: Adopt the **Asterim Design System & Experience Architecture** (`docs/phase4-5-full-design-audit.md` & `docs/phase4-5-design-system.md`):
  1. **Installed Skills Framework**: Apply `design-taste-frontend` for strict color calibration, typography (`Geist`/`Satoshi` + `JetBrains Mono`), tactile feedback, and anti-card overuse rules; apply `scroll-experience` for smooth, progressive scroll reveals; apply `frontend-design` for hero-as-a-thesis composition; apply `frontend-design-review` for accessibility and responsive stability.
  2. **Product as Thesis**: Position a large, realistic composition of the actual Asterim Workstation interface (`apps/web`) as the hero centerpiece.
  3. **Anti-Card Overuse & Restrained Accent**: Eliminate generic 3-column card grids; use open whitespace, hairline slate dividers (`rgba(255,255,255,0.05)`), and desaturated emerald `#10b981` strictly for active execution states and primary CTAs.
* **Impact**:
  - `docs/phase4-5-full-design-audit.md` and `docs/phase4-5-design-system.md` created.
  - `@asterim/marketing` visual design system certified to premium developer product standards.

---

## DEC-022: Phase 4.5 Visual Art Direction & Iterative Visual QA Standard

* **Date**: August 11, 2026
* **Status**: Approved Art Direction & Visual Verification Standard
* **Context**: Rendered visual evidence ([media__full.png](file:///home/qhukz/.gemini/antigravity-ide/brain/8c0b19e9-7951-4a05-a54b-79f868bf09c4/media__full.png)) established that build success alone does not prove visual quality. The marketing site suffered from visual monotony, formulaic component repetition, overused green text fills, and card container overload.
* **Decision**: Adopt the **Asterim Art Direction & Iterative Visual QA Framework** (`docs/phase4-5-visual-audit-v2.md`, `docs/asterim-marketing-art-direction.md`, `docs/phase4-5-experience-redesign-v2.md`):
  1. **Art Direction & Satoshi Display Typography**: Mandate `Satoshi` display typography, desaturated deep charcoal base (`#070a10`), calm slate surfaces (`#0d1424`), and surgical emerald `#10b981` reserved strictly for active execution states and primary CTAs.
  2. **10-Act Continuous Narrative**: Eliminate 3-column card grids. Use open split-screen typography panels, full-width Workstation UI compositions, sticky mechanics, and multi-surface pipeline flows.
  3. **Visual QA Loop**: Mandatory visual screenshot inspection across viewports (1440px to 375px) before reporting Phase 4.5 completion.
* **Impact**:
  - `docs/phase4-5-visual-audit-v2.md`, `docs/asterim-marketing-art-direction.md`, and `docs/phase4-5-experience-redesign-v2.md` created.
  - Visual verification standard enforced.

---

## DEC-023: Project Memory Scoping Model — Strict Write Boundaries, Default-Scoped Reads

* **Date**: August 13, 2026
* **Status**: Approved Architectural Constraint
* **Context**: `@asterim/mcp-memory-server` runs as an independent process per agent session, scoped to one project resolved at startup (CLI flag, environment variable, or working directory). All three memory tools accept an optional `projectId`. Phase 5.1 had to decide whether that parameter selects a *default* or defines a *boundary*, and the answer differs between reads and writes.
* **Decision**: Adopt an **asymmetric scoping model**:
  1. **Writes are bounded.** `record_decision` accepts `projectId` only when it equals the resolved project. Any other value — registered or not — is refused in band with `Cannot record decision for project 'X' from workspace of project 'Y'`, before validation and before a transaction opens.
  2. **Reads are defaulted, not bounded.** `get_project_briefing` and `query_decisions` fall back to the resolved project when `projectId` is absent, but will return another project's memory when explicitly asked for it by id.
  3. **Resolution never guesses.** When no project matches, the server exits non-zero listing the registered projects rather than selecting one.
* **Rationale**: A misdirected write is unrecoverable from inside the process — the decision lands in another project's memory and reads as that project's own history from then on. A misdirected read is merely information disclosure on a local, single-user database. Verified during P5.1-05: with the write guard removed, a write into a *registered* neighbouring project succeeds silently, with no foreign-key violation and no error. **The application-level check is the only enforcement; there is no database-level backstop.**
* **Impact**:
  - The write boundary rests on one condition in `packages/mcp-memory-server/src/index.ts` and must not be weakened without replacing it.
  - The read asymmetry is a deliberate, recorded position and not an oversight. It must be revisited before the Phase 5 multi-tenant cloud relay, where the same boundary question recurs with a materially different threat model.

---

## DEC-024: Agent Memory Defaults — `AGENT_STATEMENT` Provenance at 0.75 Confidence

* **Date**: August 13, 2026
* **Status**: Approved Domain Default
* **Context**: `ProjectMemoryService.insertDecision` defaults `provenance` to `HUMAN_CONFIRMED` and `confidence` to `1.0`. Those defaults are correct for the REST surface, where a human is on the other end of the request. They are wrong for an MCP agent writing unprompted.
* **Decision**: `record_decision` applies its own defaults when the caller omits them: `provenance: 'AGENT_STATEMENT'`, `confidence: 0.75`, `status: 'ACTIVE'`. An agent may raise `provenance` to `HUMAN_CONFIRMED` only when the user actually confirmed the decision, as stated in the tool description.
* **Rationale**: `provenance` is the field a reviewer uses to decide how much weight a remembered decision deserves. Inheriting the service default would record an agent's unprompted assertion as human-confirmed at maximum confidence — the strongest provenance in the domain awarded to the weakest evidence — and would erase the distinction the field exists to carry. Verified during P5.1-05: removing the override stores exactly that, in both the tool response and the persisted row.
* **Impact**:
  - Memory review can separate what an agent asserted from what a human approved.
  - Out-of-range `confidence` is **rejected** rather than clamped: `clampConfidence` maps values above 1 to `1.0`, so an agent meaning "75%" and sending `75` would have its guess stored as maximum confidence, the inverse of what it expressed.

---

## DEC-025: In-Band Error Handling for stdio JSON-RPC Stability

* **Date**: August 13, 2026
* **Status**: Approved Engineering Standard
* **Context**: The MCP memory server speaks JSON-RPC over stdio. `process.stdout` is the protocol channel; a single non-protocol byte on it desynchronises every subsequent response. A thrown request handler additionally surfaces as a protocol-level error, which hands the model nothing it can act on.
* **Decision**: Three rules for this transport:
  1. **stdout carries protocol frames only.** `src/stdio-guard.ts` rebinds `globalThis.console` to `stderr` as the first executed import, before `DatabaseService` logs from its singleton constructor. Diagnostics — database path, resolved project — go to stderr.
  2. **Tool failures are returned, not thrown.** Every handler path returns `{ isError: true, content: [{ type: 'text', text }] }` so the transport survives and the model receives a message it can correct against.
  3. **Startup failures precede the transport.** Project resolution runs before `server.connect()`, so an unresolvable project exits `1` with an empty stdout rather than answering a request it is about to abandon.
* **Rationale**: This is the local expression of the standing rule in `blueprint/ARCHITECTURE.md` that adapter and tool failures must never take down the Core. Verified by negative control in P5.1-02 (removing the guard makes a database log the first stdout frame, desynchronising every response) and in P5.1-04 (removing the handler `try/catch` turns four validation failures into protocol errors).
* **Impact**:
  - Applies to any future MCP server in this repository, not only the memory server.
  - Argument validation belongs in the MCP package rather than downstream, so that a malformed request produces a corrective message and no partial write.

---

## DEC-026: Cross-Process Memory Event Relay — Local Loopback Notification

* **Date**: August 14, 2026
* **Status**: Approved Architecture Decision
* **Context**: The MCP memory server runs as an independent external subprocess (spawned by Claude Code, Cursor, or CLI) communicating with SQLite directly in WAL mode. Because the Core server's `EventBus` is an in-memory `EventEmitter`, writes made by external MCP processes commit immediately to disk but do not trigger the Core `EventBus` or Socket.IO push to connected web browsers until manual page refresh.
* **Decision**: Adopt a lightweight, zero-dependency local loopback notification bridge:
  1. Core server writes an active connection descriptor (`~/.asterim/server.json`) upon startup, containing its local URL and an ephemeral loopback auth token.
  2. Core exposes loopback endpoint `POST /api/v1/internal/memory-events` guarded by the token.
  3. MCP memory server checks for `~/.asterim/server.json` after successful writes. If found, it fires a fire-and-forget loopback POST.
  4. Core server verifies loopback auth and republishes the event onto `EventBus` -> `SocketManager` -> Web UI.
  5. If Core server is not running, MCP continues immediately with 0 delay and zero errors.
* **Rationale**: Preserves 100% local-first, zero-setup simplicity without introducing heavyweight external IPC daemons (Redis, ZeroMQ, RabbitMQ).
* **Impact**:
  - Web UI gains instant 0ms updates when external agents record decisions via MCP.
  - Zero performance impact when running headless CLI agents without the web UI.

---

## DEC-027: Non-Destructive Git Drift Detection & Staged Decision Candidate Queue

* **Date**: August 14, 2026
* **Status**: Approved Architecture Decision
* **Context**: As codebases evolve, anchored code references in `decision_code_refs` can drift due to file edits, renames, deletions, and refactors. Furthermore, agents making decisions in sessions should be captured without allowing autonomous unconfirmed LLM writes to directly pollute authoritative project memory.
* **Decision**:
  1. **Non-Destructive Drift**: `GitDriftDetector` computes drift status against working tree diffs (`FILE_MODIFIED`, `FILE_DELETED`, `SYMBOL_NOT_FOUND`) and flags decisions visually in Explorer/Timeline and briefings. Human-confirmed decisions are **never** automatically deleted or mutated.
  2. **Staged Extraction Queue**: Automated decision extraction populates a dedicated `candidate_decisions` staging table with `status: 'PENDING'`. Only human operator confirmation (`POST .../approve`) transitions candidate decisions into active `project_decisions` with `provenance: 'HUMAN_CONFIRMED'` and `confidence: 1.0`.
* **Rationale**: Guarantees memory integrity, prevents destructive data loss, and eliminates compounding LLM hallucination loops across sessions.
* **Impact**:
  - Human governance remains the authoritative quality gate for project memory.
  - Engineers receive clear visual drift alerts when code changes outpace recorded architectural decisions.
