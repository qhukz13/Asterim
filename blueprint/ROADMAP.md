# Asterim Commercial Launch Roadmap

## Strategic Vision

Prepare Asterim for its evolution into **the operating system for software engineering**. This roadmap outlines the strategic trajectory from an initial high-performance local tool to an extensible, automated, enterprise-ready commercial ecosystem.

## Long-Term Product Strategy

Asterim's strategic evolution is divided into two distinct operational horizons:

1. **Product Core & Foundation (Phases 1–5)**: Establishes the robust technical foundation of Asterim as a local-first, highly reliable developer workspace. It focuses on an elite developer UX (Phase 1), enterprise-grade authentication (Phase 2), team collaboration and RBAC (Phase 3), hardened workstation PTY/git execution engine (Phase 4), and multi-tenant SaaS cloud infrastructure (Phase 5). These foundational phases ensure speed, security, and developer delight.
2. **Platform Ecosystem & AI Operating System (Phases 6–10)**: Evolves Asterim from an intelligent IDE companion into the universal platform for AI-native software engineering. Phase 6 introduces standardized AI primitives (MCP management, reusable Skills, and Agent Profiles). Phase 7 opens Asterim to the community via a sandboxed Extension SDK and Marketplace. Phase 8 automates local/cloud development workflows with agent pipelines. Phase 9 satisfies enterprise security, compliance, and fleet administration requirements. Finally, Phase 10 fulfills the long-term vision of Asterim as the unified Operating System for Software Engineering.

---

## Phase 1 — Product UX

### Goal
Redesign the Asterim interface into a sleek, high-density, professional developer tool inspired by modern standards (Linear, Cursor, GitHub), eliminating visual clutter and establishing clear, intuitive navigation.

### Deliverables
* **Modern Workspace Layout**: Structured shell with collapsible navigation sidebar, persistent top context bar, unified thread list, clean workspace tab switcher, and inspector panel.
* **Component Design System**: Dark-mode-first aesthetic with refined typography (Inter/JetBrains Mono), subtle borders, HSL surface palettes, status badges, and consistent micro-interactions.
* **Linear-Style Command Palette (`Cmd+K`)**: Fast keyboard navigation to switch projects, jump to active threads, trigger git actions, or toggle agent settings.
* **Streamlined Agent Terminal & Chat UX**: Side-by-side or stacked view for chat conversation and live terminal streaming with smooth auto-scroll, clean approval banners, and diff previews.
* **Project & Mission Dashboard**: Consolidated view of active projects, agent missions, execution status, and recent change history.

### Dependencies
* Clean frontend router (`React Router` / lightweight router pattern).
* Tailored design tokens and CSS utility layer (`apps/web/src/styles`).

### Success Criteria
* 0 visual clutter or overlapping elements across desktop and tablet screen sizes.
* Command palette response time < 50ms.
* Interface feels like a polished commercial desktop/web app (Cursor/Linear tier) rather than an unstyled internal tool.

### Risks
* UX over-complication causing layout performance drop during high-frequency PTY streaming.
* Design churn if layout shifts too far from existing functional components.

### Estimated Complexity
**Medium** (2-3 Sprints)

---

## Phase 2 — Authentication, Account Portal & Commercial Foundation

### Goal
Establish the commercial hub and account identity platform for Asterim via a public website (`asterim.dev`), separating web identity ownership from desktop execution, while laying the subscription, entitlement, session, and device management architecture from day one.

### Deliverables
* **Public Website & Commercial Portal (`asterim.dev`)**:
  * **Commercial Entry Point**: The public website acts as the primary user portal and commercial entry point before entering the Asterim application (inspired by Cursor, Linear, Raycast, Vercel, Stripe, and GitHub).
  * **Shared Design System**: Built with the unified Asterim Design System tokens, typography, HSL color palettes, dark-mode aesthetics, and shared UI components.
  * **Core Pages**: Home (Landing), Features, Documentation, Pricing, Download, GitHub repository links, Changelog, Roadmap, Blog (future-ready), and Account Portal.

* **Centralized Web Authentication Architecture**:
  * **Identity Ownership**: The public website (`asterim.dev`) owns identity creation and account registration (`/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/refresh`, `/api/auth/me`). The Asterim desktop application consumes identity and never acts as the primary registration point.
  * **Desktop OAuth / Deep-Link Auth Flow**: Users authenticate on `asterim.dev` to acquire cloud credentials. The desktop/web application signs into existing cloud accounts via secure deep-link callback (`asterim://auth/callback`) or token exchange.
  * **Auth Backend Services**: User database schema, password hashing (Argon2 / bcrypt), JWT access/refresh token rotation, rate-limited auth routes, HTTP-only secure cookie strategy for web sessions, and encrypted keychain storage for local CLI tools.

* **User Account Dashboard**:
  * **Centralized Portal Sections**: Post-login web account dashboard featuring Profile management, Security (password & MFA), Connected Devices, Active Sessions, Machine-to-Machine API Keys, Desktop Downloads, Subscription status, Billing history, Team Management, Workspace Management, Extension Licenses (future-ready), and MCP Licenses (future-ready).

* **Day-One Subscription & Entitlement Architecture**:
  * **Subscription Data Model**: Schema ready for Free, Pro, Team, and Enterprise plans out of the box without requiring future authentication rewrites. Accounts expose `currentPlan`, `subscriptionStatus`, `billingState`, `featureEntitlements`, and `usageLimits` (defaulting initial accounts to Free).
  * **Feature Entitlement Layer**: Decoupled authorization layer querying specific capability permissions (`canAccessFeature('cloud_sync')` or `canAccessFeature('teams')`) instead of hardcoded plan checks (`isProAccount()`).

* **Device & Session Management**:
  * **Trusted Device Registration**: Automatic registration of trusted devices on login, tracking operating system, client version, last active timestamp, custom device renaming, and remote device revocation.
  * **Multi-Session Architecture**: Central session management on `asterim.dev` supporting concurrent desktop, web browser, and future mobile sessions with remote single-click session logout.

* **Future Billing Integration Infrastructure**:
  * **Payment Gateway Hooks**: Authentication model designed to seamlessly attach Stripe or LemonSqueezy payment processing via account IDs (`stripeCustomerId`) and webhook handlers without altering identity schemas or authentication tokens.

* **Protected Routes & Security Guards**:
  * Client-side route guards, API token verification for CLI adapters, and Fastify middleware protecting private API endpoints and WebSocket handshakes.

### Dependencies
* Phase 1 (Product UX & Shared Design System tokens).
* Fastify / Node backend services with PostgreSQL/SQLite database migrations in `@asterim/server`.

### Success Criteria
* 100% of user registrations occur securely on `asterim.dev` rather than inside the desktop app shell.
* Desktop application pairs with web account via deep-link callback in < 2 seconds.
* Feature entitlement layer correctly evaluates access rights across Free, Pro, Team, and Enterprise schema flags.
* Central web dashboard allows instant remote revocation of active desktop sessions and trusted devices.
* 100% of internal API endpoints and WebSocket handshakes require valid authentication tokens.

### Risks
* Deep-link protocol callback (`asterim://`) blocked by OS permissions or browser popup blockers.
* WebSocket reconnection drops if token renewal logic or remote session revocation triggers mid-stream.
* Increased friction if local-only offline development mode isn't zero-config by default.

### Estimated Complexity
**High** (3 Sprints)

---

## Phase 3 — Teams & Workspaces

### Goal
Introduce multi-user collaborative workspaces, enabling software development teams to share projects, view concurrent agent threads, and manage team-level agent permissions.

### Deliverables
* **Workspace & Team Data Model**: Data structures and storage tables for Organizations, Workspaces, Teams, Memberships, and Roles (Owner, Admin, Member, Viewer).
* **Team Management UI**: Organization switcher, Team Settings page, Member roster management, and Email/Link Invitation flows.
* **Shared Projects & Threads**: Ability to share projects within an organization, view team-mate active threads, and inspect agent session logs in real time.
* **RBAC & Granular Approvals**: Role-based permissions controlling who can spawn agents, modify project settings, approve code mutations, or view sensitive API keys.
* **Team Activity Feed**: Real-time audit log of team actions (agent dispatches, approvals granted/denied, git commits, configuration changes).

### Dependencies
* Phase 1 (Product UX)
* Phase 2 (Authentication & User Identity)

### Success Criteria
* Multiple authenticated users can view and interact with shared project threads concurrently.
* Non-admin members are strictly blocked from unauthorized actions (e.g. modifying workspace settings or approving restricted shell commands).
* Audit log captures 100% of workspace security events.

### Risks
* Real-time multi-user WebSocket synchronization latency and state divergence.
* DB complexity for enterprise RBAC permissions.

### Estimated Complexity
**High** (3 Sprints)

---

## Phase 4 — Developer Workstation (Local Engine Hardening)

### Goal
Harden the local-first execution engine to guarantee 99.9% reliability for daily engineering use across macOS, Linux, and Windows.

### Deliverables
* **Fault-Tolerant Agent Execution**: Robust subprocess lifecycle management, automatic recovery from process crashes, zombie process cleanup, and memory leak prevention.
* **Terminal & PTY Hardening**: Zero-lag xterm.js rendering with output buffer backpressure throttling, full ANSI color/cursor escape code support, and seamless cross-platform shell initialization (bash, zsh, powershell, wsl).
* **Hardened Approval & Safety System**: Real-time regex and AST parsing for shell commands, strict path traversal blocking, file mutation diff previews, and customizable auto-approval rules.
* **Git Subsystem Polish**: Instant git status tracking, branch management, unstaged/staged diff inspector, conflict detection, and one-click `✨ Generate Commit` powered by local context.
* **Persistent Context Indexing**: Fast file symbol parser, workspace file watcher with debounced re-indexing, and token-efficient context window assembly for agent prompts.

### Dependencies
* `@asterim/adapters` package
* Phase 1 UI (for Terminal & Git components)

### Success Criteria
* Zero UI freeze or browser memory leak during 10,000+ line terminal streaming stress tests.
* Agent execution recoverable after sudden network disconnects or process restarts.
* Windows PTY execution 100% reliable with zero path escaping errors.

### Risks
* Windows PTY platform edge cases (winpty / conpty bugs).
* High CPU consumption during background workspace re-indexing.

### Estimated Complexity
**High** (3 Sprints)

---

## Phase 5 — SaaS Foundation & Beta Release

### Goal
Establish cloud deployment infrastructure, multi-region database architecture, billing readiness, and remote synchronization to launch the commercial public beta.

### Deliverables
* **Cloud API & Relay Orchestrator**: Cloud gateway routing remote web/mobile client requests securely to local workstations via authenticated WebSocket tunnels.
* **Production Database & Multi-Tenancy**: Postgres + Prisma/Drizzle ORM migration path for cloud deployment with tenant isolation.
* **Billing & Subscription Engine**: Integration with Stripe / LemonSqueezy for user/team tiers (Free, Pro, Team, Enterprise), plan limits, and usage metering.
* **State Synchronization**: Bi-directional sync for context index metadata, user preferences, and thread bookmarks between local instances and cloud accounts.
* **CI/CD & Deployment Pipeline**: Automated Docker build, staging/production infrastructure setup (AWS/GCP/Fly.io), telemetry monitoring (Sentry/OpenTelemetry), and automated release pipeline.

### Dependencies
* Phases 1, 2, 3, and 4.

### Success Criteria
* Commercial registration, onboarding, and subscription checkout flow operational end-to-end.
* Remote client can securely connect to a local workstation via cloud relay with sub-100ms latency.
* Pass internal security audit and load testing for public beta launch.

### Risks
* Cloud relay infrastructure costs and WebSocket scalability under heavy concurrent traffic.
* Payment webhook edge cases and plan entitlement synchronization bugs.

### Estimated Complexity
**High** (3-4 Sprints)

---

## Phase 6 — AI Ecosystem

### Goal
Turn Asterim into the universal control center for AI development by providing standardized, manageable primitives for tools, capabilities, and agent configurations.

### Deliverables
* **MCP Management System**:
  * **MCP Registry**: Central repository of public, team, and local Model Context Protocol servers with one-click installation and removal.
  * **Server Lifecycle Control**: Graphical interface to Enable/Disable MCP servers globally or per project.
  * **Per-Agent MCP Assignment**: Precise mapping of specific MCP servers to target agent profiles or threads.
  * **Configuration & Environment**: Global and project-level environment variable configuration, custom execution arguments, and path management.
  * **Secret Management**: Secure local keychain and vault integration for MCP API keys and credentials.
  * **Health Monitoring & Logs**: Live connection status indicators, ping latency metrics, restart buttons, and real-time stderr/stdout log viewers for running MCP servers.
  * **Version Management & Auto-Update**: Automatic update checks, version pin settings, and zero-downtime background updates.
  * **UI/UX**: Refined interface blending the familiarity of VS Code Extensions with the container and process control experience of Docker Desktop.

* **Reusable Skills System**:
  * **Skill Registry**: Searchable index of agent skills categorized by task domain (Git Workflow, Release Notes, Refactoring, Code Review, Debugging, Documentation, Architecture Review).
  * **Multi-Scope Hierarchy**: Support for Local Skills (`.agents/skills`), Workspace Skills, Team-shared Skills, and Marketplace-ready distributed skills.
  * **Skill Parameters & Schema**: Structured input parameters (JSON Schema definitions) with validated UI form inputs for agent skill invocations.
  * **Skill Lifecycle**: Full versioning, search, one-click install, and enable/disable toggles per workspace.

* **Agent Profiles**:
  * **Pre-configured Roles**: Out-of-the-box system profiles (Senior Backend Engineer, Frontend Reviewer, DevOps Engineer, Security Auditor, QA Engineer, Tech Lead).
  * **Profile Configuration Schema**: Custom profile definition specifying target model, temperature, enabled MCP servers, active Skills, auto-approval security rules, system prompts, and execution resource limits.

### Dependencies
* Phase 1 (Product UX)
* Phase 4 (Developer Workstation Hardening)
* `@asterim/adapters` for MCP transport layer (Stdio, SSE, WebSocket)

### Success Criteria
* MCP servers install, connect, and stream context to agent sessions in < 500ms.
* Zero secret leakage in MCP logs or thread export files.
* Skills execute reproducibly across different agent profiles and workspace contexts.

### Risks
* Malicious or buggy third-party MCP servers hanging agent processes or consuming excessive CPU/memory.
* Schema divergence between different MCP spec versions.

### Estimated Complexity
**High** (3-4 Sprints)

---

## Phase 7 — Extensions Platform

### Goal
Allow the developer community and internal enterprise teams to extend Asterim's functionality without modifying core codebase files, using a safe, sandboxed architecture inspired by VS Code, Raycast, and Obsidian.

### Deliverables
* **Extension SDK**:
  * **UI Extensions**: API for injecting custom webview UI Panels, status bar widgets, sidebar items, and dynamic chat renderer cards.
  * **Core Interoperability**: Extension hooks for workspace commands, keyboard shortcuts, context providers, custom notification toasts, settings pages, and event subscriptions.
  * **Lifecycle & Workspace APIs**: Full programmatic access to workspace metadata, file changes, terminal events, and git hooks.

* **Sandboxed Runtime**:
  * Isolated JavaScript/WebAssembly sandbox for third-party extensions with strict resource quotas and non-blocking IPC wrappers.

* **Extension Marketplace**:
  * **Browser & Discovery**: In-app Extension Marketplace browser with categories, search, ratings, download statistics, and release notes.
  * **Verification & Trust**: Security verification badges, publisher verification, and automated vulnerability scanning for published extension packages.
  * **Updates & Versioning**: Version pinning, automated background updates, and rollback capabilities.

* **Permission System**:
  * **Explicit Permission Guard**: Explicit prompt and consent dialogs requiring extensions to declare required scopes before activation.
  * **Permission Domains**: Granular scopes covering Filesystem access, Git repository mutation, Network requests, Terminal execution, System notifications, Workspace metadata, and AI context access.

### Dependencies
* Phase 1 (Product UX)
* Phase 6 (AI Ecosystem Primitives)

### Success Criteria
* Extension crash or memory leak does not crash the host Asterim app or agent thread.
* 100% of extension permissions enforced at the runtime sandbox barrier.
* Third-party extensions can register custom commands and render custom UI components seamlessly within < 100ms.

### Risks
* Sandbox security escape vulnerabilities in extension runtime.
* API breakage as core Asterim frontend evolves, requiring strict API deprecation policies.

### Estimated Complexity
**Very High** (4 Sprints)

---

## Phase 8 — Automation & Workflows

### Goal
Empower developers and teams to automate repetitive software engineering tasks by combining event-driven triggers with multi-agent orchestration — bringing GitHub Actions capabilities into local AI agents.

### Deliverables
* **Workflow Builder & Engine**:
  * **Visual & Code Workflow Builder**: GUI workflow editor alongside declarative YAML workflow specifications (`.asterim/workflows/*.yaml`).
  * **Multi-Agent Pipelines**: Sequential and parallel execution of multi-agent tasks, chaining agent profiles (e.g. Developer -> Code Reviewer -> Security Auditor -> PR Generator).
  * **Control Flow**: Conditional logic branching, step-level timeouts, exponential backoff retry policies, and error handling fallback strategies.

* **Event Trigger System**:
  * **Git Event Triggers**: Trigger workflows on commit, branch push, PR creation, merge conflict detection, or tag release.
  * **File Change Triggers**: Real-time file system watchers triggering automated agents on spec changes, test file updates, or schema modifications.
  * **Scheduled Tasks**: Cron-style scheduled tasks for night-shift refactoring, dependency updates, compliance scans, and documentation updates.

* **Execution History & Observability**:
  * **Workflow History Inspector**: Detailed run log history, step duration metrics, step-by-step diff previews, and retry controls.

### Dependencies
* Phase 4 (Developer Workstation Hardening)
* Phase 6 (AI Ecosystem & Agent Profiles)

### Success Criteria
* Automated background workflows run with zero manual intervention upon specified triggers.
* Multi-agent pipeline handoffs pass context cleanly without token inflation or drop in accuracy.
* Failed workflow steps retry automatically according to defined policies.

### Risks
* Uncontrolled loop execution or runaway agent pipelines consuming high token volumes or disk space.
* High CPU/Disk IO overhead from constant filesystem event monitoring.

### Estimated Complexity
**High** (3-4 Sprints)

---

## Phase 9 — Enterprise

### Goal
Prepare Asterim for enterprise-wide deployment by delivering robust identity federation, strict security compliance, centralized governance, and fleet administration capabilities.

### Deliverables
* **Identity & Access Management (IAM)**:
  * **Enterprise SSO**: Support for Single Sign-On via OpenID Connect (OIDC), SAML 2.0, and LDAP integrations (Okta, Azure AD / Entra ID, PingIdentity).
  * **Expanded RBAC**: Granular custom role builder for workspace, project, and fleet-level authorization.

* **Compliance & Security Governance**:
  * **Immutable Audit Logs**: Centralized, tamper-evident audit logging tracking all agent executions, shell approvals, file modifications, and configuration changes.
  * **Secret Vault Integration**: Enterprise secret management integrations (HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager).
  * **Organization Policies**: Central policies enforcing allowed AI models, max token spend per developer, required approval thresholds, and telemetry options.

* **Deployment & Fleet Management**:
  * **Air-gapped Mode**: 100% offline operational mode with local LLM models (via Ollama/vLLM) and isolated network configurations.
  * **Self-hosted Administration**: Kubernetes Helm charts, Terraform modules, and administrative control panel for self-hosted Asterim server deployment.
  * **Fleet Management & Remote Admin**: Central dashboard for IT admins to manage developer workstation licenses, deploy mandatory skills/extensions, and monitor usage analytics.

### Dependencies
* Phase 2 (Authentication)
* Phase 3 (Teams & Workspaces)
* Phase 5 (SaaS Foundation)

### Success Criteria
* Pass enterprise security SOC 2 Type II and ISO 27001 readiness audits.
* Seamless SSO login flow and enterprise directory synchronization across 1,000+ developer accounts.
* Zero external internet calls required when deployed in Air-gapped Mode.

### Risks
* Complex customer enterprise IT environments causing SSO/LDAP setup friction.
* Custom local LLM latency and context window limitations in strict air-gapped environments.

### Estimated Complexity
**High** (3-4 Sprints)

---

## Phase 10 — AI Operating System Vision

### Goal
Fulfill the long-term vision of Asterim as **the operating system for software engineering** — a unified, intelligent, distributed ecosystem that redefines how software is designed, built, tested, deployed, and maintained.

### Deliverables
* **Unified Agent Orchestration**:
  * Seamless management of thousands of specialized, autonomous AI agents operating as an integrated engineering organization with automatic load balancing and goal-driven collaboration.

* **Intelligent Context Engine**:
  * Global, real-time repository intelligence parsing codebases, dynamic system graphs, historical git commits, design specs, ticket tracking, and operational telemetry into a zero-latency contextual fabric.

* **Distributed & Hybrid Execution**:
  * Seamless mesh compute architecture intelligently scheduling compute tasks across local workstation GPUs, on-premise hardware, and cloud serverless clusters based on latency, cost, and privacy constraints.

* **Developer Operating System**:
  * The central developer surface uniting code editing, agent control, continuous automation, environment provisioning, software architecture visualization, and team orchestration into a single fluid environment.

* **Autonomous Software Lifecycle**:
  * End-to-end self-healing infrastructure, proactive security patch generation, automated feature implementation from specifications, and continuous quality verification.

### Dependencies
* Completion of Phases 1 through 9.

### Success Criteria
* Asterim recognized as the standard operational substrate for AI-native engineering teams globally.
* Engineering teams report a 10x multiplier in shipping speed and software reliability.

### Risks
* Rapid shift in underlying AI model paradigms requiring architectural adaptation.

### Estimated Complexity
**Architectural Vision / Strategic Direction** (Ongoing Platform Evolution)
