# Asterim Commercial Launch Roadmap

## Strategic Vision

Prepare Asterim for its first commercial public beta as **the operating system for AI software engineering teams**. This roadmap focuses strictly on user value, product UX excellence, team collaboration, reliable local execution, and commercial readiness.

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

## Phase 2 — Authentication

### Goal
Implement a production-grade, secure authentication system supporting local development, self-hosted instances, and future multi-tenant SaaS deployment.

### Deliverables
* **Auth Backend Services**: User database schema, password hashing (Argon2 / bcrypt), JWT access/refresh token rotation, and rate-limited auth routes (`/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/refresh`, `/api/auth/me`).
* **Web Auth Flow**: Login, Register, Forgot Password, and Profile Settings UI screens with client-side form validation and state persistence.
* **Protected Routes & Security Guards**: Client-side route guards and Fastify middleware protecting all private API endpoints and WebSocket channels.
* **API Token System**: Machine-to-machine API key generation and management for CLI adapters and remote workstation pairing.
* **Secure Token Storage**: HTTP-only secure cookie strategy for web sessions + encrypted local store keychains for local CLI tools.

### Dependencies
* Phase 1 UI Shell (for auth layout templates).
* Enhanced SQLite/Postgres database migrations layer in `@asterim/server`.

### Success Criteria
* 100% of internal API endpoints and WebSocket handshakes require valid authentication tokens.
* Graceful token refresh without disrupting active terminal sessions.
* Zero cross-talk or token leakage across user sessions.

### Risks
* WebSocket reconnection drops if token renewal logic fails mid-stream.
* Increased friction during initial local-only onboarding if local auth isn't zero-config by default.

### Estimated Complexity
**Medium-High** (2 Sprints)

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
