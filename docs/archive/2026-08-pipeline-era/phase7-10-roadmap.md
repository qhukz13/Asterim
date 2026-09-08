# Asterim Strategic Roadmap: Phases 7–10

**Milestone Scope:** Collaborative Agent Workspace & Production Release Architecture  
**Author:** Antigravity (CTO & Lead Architect)  
**Status:** PROPOSED & READY FOR HUMAN REVIEW  
**Governance Authority:** `blueprint/PRODUCT_VISION.md`, `blueprint/ARCHITECTURE.md`, `decisions.md` (DEC-001 through DEC-028)  

---

## 1. Product Evolution Trajectory

Asterim is evolving across four distinct strategic horizons:

```text
Product Evolution:
┌────────────────────────┐      ┌────────────────────────┐
│  AI AGENT WORKSTATION  │  ──► │ MULTI-AGENT CONTROL    │
│  (Phases 1 — 5)        │      │ PLANE (Phase 6)        │
│  • Single developer    │      │ • MCP Process Superv.  │
│  • Local PTY streaming │      │ • Reusable Skills      │
│  • Project Memory Core │      │ • Role Personas        │
└────────────────────────┘      └────────────────────────┘
            │                               │
            ▼                               ▼
┌────────────────────────┐      ┌────────────────────────┐
│ AI ENGINEERING         │  ──► │ COLLABORATIVE AGENT    │
│ PLATFORM (Phase 7 — 9) │      │ WORKSPACE (Phase 10)   │
│ • Stable / Dev Channels│      │ • Shared Team Agents   │
│ • Versioned Migrations │      │ • Multi-User Concurren.│
│ • Worktree Sandboxing  │      │ • Enterprise Air-Gap   │
│ • Verification Gates   │      │ • Sovereign Appliance  │
└────────────────────────┘      └────────────────────────┘
```

### Core Architecture Principle

> **Asterim is a local-first control plane for AI coding agents.**

It is **NOT**:
* An AI model provider (it orchestrates local and cloud models via standard protocols).
* A cloud IDE (it operates locally on developers' workstations).
* A replacement for agent CLIs like Claude Code or Aider (it supervises, governs, and collaborates with them).
* A service that stores source code in the cloud by default.

---

## 2. Core Strategic Initiatives

---

### Initiative A — Stable / Development Release Channels & Migration Engine

#### The Problem
Currently, running Asterim in development touches the same default database path (`~/.asterim/asterim.db`) as the daily-driver production instance. Developers actively working on Asterim cannot test experimental schema migrations, breaking changes, or development builds without risking production data corruption. Furthermore, SQLite schema updates are handled via ad-hoc `ALTER TABLE ... try/catch` calls rather than a versioned migration engine.

#### Architectural Specification
1. **Dual-Channel Isolation**:
   * **Stable Channel**: Daily driver running from release binaries or stable container images. Uses `~/.asterim/` data directory, standard port (default `3000`), and production `server.json` descriptor.
   * **Development Channel**: Experimental build running from the local source tree. Activated via `ASTERIM_CHANNEL=dev` or `pnpm dev`. Uses isolated data directory `~/.asterim-dev/`, offset port (default `3001`), and isolated `~/.asterim-dev/server.json`.
2. **Versioned Migration Engine (`MigrationEngine.ts`)**:
   * Replaces ad-hoc `try/catch` column additions with sequential SQL migration files (`packages/server/src/migrations/001_initial.sql`, `002_profiles.sql`, etc.).
   * Tracks applied versions and SHA-256 checksums in a dedicated `schema_migrations` table.
   * Enforces transactional execution with automatic rollback on failure.
   * Rejects forward schema migrations if run against an unrecognized or higher-versioned database file.
3. **Data Promotion & Rollback**:
   * CLI command `asterim data:clone --from stable --to dev` to seed development environment from production snapshot without modifying production.
   * CLI command `asterim data:backup` and `asterim data:restore` for instantaneous disaster recovery.

---

### Initiative B — Shared Team Agents

#### The Problem
AI agents today are isolated to single developer machines. When a developer solves a complex architectural problem or refactors a core subsystem, the agent's context, transcripts, and reasoning remain locked on their individual laptop. Development teams need shared agents that represent persistent team roles (e.g. "Backend Architect", "Security Auditor", "Code Reviewer") accessible to all authorized team members.

#### Architectural Specification
1. **Team Agent Primitive (`TeamAgent`)**:
   * A first-class entity belonging to a Team/Organization rather than a single local session.
   * Maintains a single, continuous, coherent conversation transcript shared across all authorized team members.
   * Configured with team-wide role prompts, specific MCP tools, and access permissions.
2. **Concurrency & Message Ordering (`AgentTurnLock`)**:
   * **FIFO Turn Queue**: Team members can queue instructions to the shared agent.
   * **Turn Locking**: When the agent is generating output or executing a multi-step tool call, `AgentTurnLock` prevents concurrent prompts from interrupting the session mid-turn.
   * Real-time WebSocket updates broadcast the agent's live status (`IDLE`, `PROCESSING_TURN`, `AWAITING_APPROVAL`) and active operator identity to all connected team members.
3. **Role-Based Approval Governance**:
   * Granular approval policies: Configure whether destructive tool executions require approval from any team member, specific role holders (`Owner` / `Admin`), or the specific developer who queued the task.
4. **DEC-028 Data Sovereignty Compliance**:
   * **Host Workstation / On-Premise Execution**: The shared agent runs either on a designated team member's workstation or a private on-premise Asterim server.
   * **Blind Relay Tunnels**: Remote team members communicate with the host instance over end-to-end encrypted WebSocket tunnels (ECDH P-256 + AES-256-GCM). The Cloud Relay routes packets blindly and stores zero project code, memory, or transcripts.
   * **Sovereign Air-Gap**: Within a corporate LAN, team members connect directly via ZeroConf / mDNS (Bonjour) with zero external internet communication.

---

## 3. Detailed Phase Roadmap: Phases 7–10

---

### Phase 7 — Release Channels, Migration Engine & Runtime Isolation

#### Goal
Establish complete separation between Stable and Development channels, implement a robust versioned SQL migration engine, and eliminate all risks of production database corruption during active development.

#### User Value
Developers can use Asterim as their reliable, mission-critical daily driver while simultaneously contributing to or testing experimental Asterim development builds with zero risk to their existing projects, memory, and settings.

#### Deliverables
1. **Channel Runtime Isolation**:
   * `ASTERIM_CHANNEL` environment variable (`stable` | `dev`).
   * Dynamic data directory resolution: `~/.asterim` for Stable vs `~/.asterim-dev` for Development.
   * Port separation (Port 3000 for Stable, Port 3001 for Development) and separate `server.json` connection descriptors.
   * Visual channel badge in the Web UI header (e.g. `[DEV-CHANNEL]` indicator in development builds).
2. **Versioned SQL Migration Engine (`MigrationEngine.ts`)**:
   * Transactional migration runner parsing sequential `.sql` migration files.
   * `schema_migrations` tracking table (`version`, `name`, `checksum`, `applied_at`).
   * Pre-flight migration dry-run and integrity verification on Core startup.
3. **Snapshot & Backup Tooling**:
   * Automated pre-migration database snapshotting (`asterim.db.bak.<timestamp>`).
   * CLI utilities: `asterim db:migrate`, `asterim db:status`, `asterim db:snapshot`.
4. **Worktree Boot-Time Orphan Sweeper**:
   * `GitWorktreeService` boot hook to detect and prune dead worktrees left behind by unclean shutdowns.

#### Architecture
* `apps/server/src/services/DatabaseService.ts` refactored to delegate schema creation to `MigrationEngine.ts`.
* `packages/shared/src/constants/channels.ts` defining channel invariants.

#### Security & Sovereignty
* Complete local isolation. Dev channel runs locally without external network exposure.

#### Verification
* Automated test suite `MigrationEngine.test.ts` verifying forward migrations, checksum mismatch rejection, rollback on syntax error, and dual-channel directory separation.

#### Success Criteria
* Running `pnpm dev` operates cleanly on `~/.asterim-dev` without touching `~/.asterim`.
* Applying a migration updates `schema_migrations` idempotently.
* 0 TypeScript errors, 0 lint errors, 100% test pass rate.

#### Risks & Complexity
* *Risk*: Existing legacy databases must migrate smoothly without manual user intervention.
* *Complexity*: **MEDIUM** (2 Sprints).

---

### Phase 8 — Collaborative Team Agents & Multi-User Governance

#### Goal
Introduce the Shared Team Agent primitive, enabling engineering teams to collaborate with shared, persistent AI agents with turn concurrency locks, team-wide project memory, and role-based approval governance under local-first sovereignty.

#### User Value
Teams can create shared specialist agents (e.g. "Tech Lead", "Security Reviewer", "Database Architect") that maintain continuous team context, allowing multiple developers to delegate tasks, inspect reasoning, and approve changes collaboratively.

#### Deliverables
1. **Team Agent Primitive & Service (`TeamAgentService.ts`)**:
   * SQLite schema: `team_agents`, `team_threads`, `team_agent_messages`, `team_turn_queue`.
   * Persistent team agent identities with configurable role prompts, allowed MCP servers, and access permissions.
2. **Turn Concurrency Engine (`AgentTurnLock.ts`)**:
   * FIFO turn queue managing multiple incoming developer requests.
   * Atomic turn reservation preventing concurrent message collisions.
   * Real-time turn state broadcasting over Socket.IO (`turn:queued`, `turn:started`, `turn:completed`).
3. **Collaborative Multi-User Web UI**:
   * Team Agent Explorer and Active Turn Queue inspector.
   * Multi-cursor / multi-user active observer indicators in thread chat.
   * Team-wide approval requests with author/admin approval badges.
4. **Team Project Memory Integration**:
   * Team-scoped decisions and architectural rules visible across all team members' sessions.
5. **LAN & Cloud Relay Collaboration Bridge**:
   * LAN ZeroConf peer discovery for local office networks.
   * E2E Encrypted Cloud Relay tunnel support for remote team members (`DEC-028` compliant).

#### Architecture
* `TeamAgentService` supervises shared agent sessions on the host machine.
* `AgentTurnLock` coordinates asynchronous input streams from multiple authenticated user sessions.

#### Security & Sovereignty
* **DEC-028 Strict Compliance**: Source code and memory reside on the host workstation. Cloud Relay acts solely as a blind, encrypted pipe with zero cloud-side transcript persistence.

#### Verification
* Integration test suite `TeamAgentService.test.ts` driving concurrent multi-user dispatches, FIFO queue ordering, turn lock contention, and team approval enforcement.

#### Success Criteria
* Two concurrent users can queue tasks to a shared team agent without race conditions.
* Approvals enforce configured role permissions (e.g. Member cannot approve destructive commands if Admin-only policy is set).
* Zero unencrypted data transmitted across the network.

#### Risks & Complexity
* *Risk*: Race conditions in WebSocket message delivery under high network latency.
* *Complexity*: **HIGH** (3-4 Sprints).

---

### Phase 9 — Multi-Agent Automated Pipelines & Worktree Fleet Execution

#### Goal
Scale multi-agent coordination from interactive chat into event-driven engineering pipelines executing across isolated Git worktrees with automated verification gates and pull request synthesis.

#### User Value
Developers and teams can trigger multi-stage agent workflows (e.g. Feature Implementation → Unit Test Generation → Security Audit → Documentation Update) automatically on git events or scheduled triggers, with all changes safely sandboxed in isolated worktrees.

#### Deliverables
1. **Declarative Pipeline Engine (`PipelineEngine.ts`)**:
   * Declarative YAML pipeline definitions (`.asterim/pipelines/*.yaml`).
   * Step chaining: sequential and parallel execution of specialized agent profiles.
   * Step-level timeouts, retry policies, and fail-closed security barriers.
2. **Worktree Fleet Orchestrator**:
   * Dynamic provisioning of multiple concurrent worktrees (`.asterim/worktrees/pipeline-<id>-step-<n>`).
   * Clean branch merging and automated conflict detection.
3. **Automated Verification Pipeline Integration**:
   * Automated toolchain execution (`typecheck`, `lint`, `test`, `build`) gating step transitions.
4. **Pipeline Execution Dashboard**:
   * Visual DAG execution graph in the Web UI showing live step progress, agent logs, and diff artifacts.
   * One-click "Synthesize Pull Request" combining multi-agent worktree changes into clean Git commits.

#### Architecture
* Extends `VerificationPipelineService` and `GitWorktreeService` into an event-driven execution DAG.

#### Security & Sovereignty
* Pipelines execute strictly locally inside isolated worktree directories with sanitized environment variables.

#### Verification
* Test suite `PipelineEngine.test.ts` executing multi-step pipelines in temporary git repositories.

#### Success Criteria
* Multi-stage pipeline executes across 3 specialized agent roles, passes verification gates, and produces a clean mergeable branch.
* Pipeline failure halts execution cleanly without corrupting the repository.

#### Risks & Complexity
* *Risk*: Long-running pipelines consuming excessive disk space or CPU if not bounded.
* *Complexity*: **HIGH** (3 Sprints).

---

### Phase 10 — Enterprise Fleet Deployment, Air-Gapped Sovereign Appliances & GA Packaging

#### Goal
Package Asterim for universal commercial distribution, delivering cross-platform native desktop installers, single-binary sovereign appliances, enterprise fleet administration, and formal General Availability (GA) certification.

#### User Value
Individual developers get a polished, native desktop app that installs in seconds with automatic updates; enterprise organizations get a turnkey, air-gapped sovereign deployment with centralized audit logging.

#### Deliverables
1. **Native Desktop Installers & Packaging**:
   * Windows: Signed MSI / NSIS installer with system tray background service.
   * macOS: Universal binary `.dmg` / `.app` with Apple Notarization and LaunchAgent background daemon.
   * Linux: AppImage, `.deb`, and systemd service unit.
2. **Sovereign Appliance Docker Image**:
   * Single-container production deployment (`asterim-sovereign`) bundling Core Server, Web UI, and local model integration (Ollama / vLLM API connectors) for 100% offline air-gapped server racks.
3. **Enterprise Fleet Administration & Compliance**:
   * Centralized policy configuration (`asterim.policy.json`) enforcing allowed AI models, approval rules, and banned commands across developer fleets.
   * Structured audit log exporter (Syslog / JSON-lines) streaming security clearance events to enterprise SIEM tools.
4. **Public GA Release Certification**:
   * Complete documentation suite (`docs.asterim.dev`), security whitepaper, and SOC 2 / GDPR compliance attestation.

#### Architecture
* Self-contained packaging bundling Node runtime, Fastify Core, compiled React Web UI, and desktop tray wrappers.

#### Security & Sovereignty
* Air-gapped appliance certified to make 0 outbound network requests. All dependencies statically bundled.

#### Verification
* Clean installer runs on fresh Windows 11, macOS Sequoia, and Ubuntu 24.04 virtual machines.
* Zero-network egress verification in air-gapped container test suite.

#### Success Criteria
* Desktop installer installs and boots Asterim to ready state in < 15 seconds.
* Air-gapped container passes comprehensive network isolation audit.
* 100% monorepo CI green across all platforms.

#### Risks & Complexity
* *Risk*: OS code signing and notarization pipeline complexity across Apple and Microsoft ecosystems.
* *Complexity*: **HIGH** (3 Sprints).

---

## 4. Proposed Architectural Decisions (DEC Register)

The following decisions are proposed as part of this roadmap:

### PROPOSED DEC-029: Stable vs Development Release Channels & Data Directory Isolation
* **Context**: Developers need to run Asterim as their daily driver while developing new Asterim features.
* **Decision**: Enforce distinct data directories (`~/.asterim` for Stable, `~/.asterim-dev` for Development) governed by `ASTERIM_CHANNEL`. Stable and Dev instances never share a database file or port.

### PROPOSED DEC-030: Versioned Forward Migration Engine & Database Compatibility Standard
* **Context**: Schema evolution must be reliable, reproducible, and recoverable without data corruption.
* **Decision**: Replace ad-hoc `ALTER TABLE` statements with sequential SQL migrations tracked in `schema_migrations` with SHA-256 checksums and automated pre-migration snapshots.

### PROPOSED DEC-031: Shared Team Agent Primitive, Turn Locking & Multi-User Event Synchronization
* **Context**: Teams need to share persistent agent personas without colliding during simultaneous prompts.
* **Decision**: Introduce `TeamAgent` with `AgentTurnLock` FIFO queueing, single-turn atomicity, and real-time Socket.IO status broadcasting.

### PROPOSED DEC-032: Local-First Team Collaboration Security & Cloud Relay E2E Boundary
* **Context**: Team members must collaborate without exposing sensitive codebase context to cloud servers.
* **Decision**: Host workstation maintains source code and transcripts; Cloud Relay operates strictly as an untrusted, blind E2E encrypted packet router (ECDH P-256 + AES-GCM-256) adhering to `DEC-028`.
