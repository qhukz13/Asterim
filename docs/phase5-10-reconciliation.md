# Asterim Original Roadmap Reconciliation & Post-Phase-6 Audit

**Document Version:** 1.0.0  
**Audit Date:** 2026-08-17  
**Auditor / Lead Architect:** Antigravity (CTO & Orchestrator)  
**Governance Scope:** `blueprint/ROADMAP.md`, `blueprint/ARCHITECTURE.md`, `decisions.md` (DEC-001 through DEC-028), `reports/current.md`, `docs/`  

---

## 1. Executive Summary

This document performs an exhaustive, factual reconciliation of the original Asterim Commercial Launch Roadmap (`blueprint/ROADMAP.md`) against the actual state of the codebase. 

While past milestone sprints delivered significant architectural breakthroughs (including the SQLite-backed Project Memory Core, Stdio MCP Supervisor, Reusable Skills, Role Profiles, Git Worktree Sandboxing, and AES-256-GCM Secret Vault), the project's rapid evolution created divergences between original roadmap promises and actual implementations.

Furthermore, running Asterim for day-to-day engineering while actively developing Asterim itself revealed two critical architectural requirements:
1. **Stable vs Development Release Channels & Data Isolation**: Preventing development builds, schema migrations, and test runs from clobbering or corrupting daily production data (`~/.asterim/asterim.db`).
2. **Shared Team Agents**: Enabling development teams to interact with shared, persistent agent personas with concurrency locks, collaborative threads, and role-based approval governance under Asterim's strict Local-First Data Sovereignty Mandate (`DEC-028`).

---

## 2. Phase-by-Phase Historical Reconciliation

### Summary Matrix

| Phase ID | Original Roadmap Title | Actual Implementation Status | Classification | Key Architectural Finding / Redefinition |
| :--- | :--- | :---: | :---: | :--- |
| **Phase 1** | Product UX & Design System | Complete in `apps/web` | **COMPLETE** | Dark-mode workspace shell, navigation sidebar, xterm.js terminal streaming, command palette (`Cmd+K`). |
| **Phase 2** | Authentication & Account Platform | Complete in `apps/server` & `apps/marketing` | **COMPLETE** | User sessions, Argon2/bcrypt password hashing, RBAC, feature entitlements, device pairing PIN. |
| **Phase 3** | Teams & Workspaces | Redefined to Local Workspaces | **REDEFINED** | Shifted from multi-tenant cloud organization sync to local-first project workspaces (`WorkspaceService.ts`, `ProjectManager.ts`) to maintain zero-cloud privacy. |
| **Phase 4** | Developer Workstation Hardening | Complete in `apps/server` | **COMPLETE** | `ProcessTreeManager`, orphan process reaper, 16ms terminal backpressure chunker, AST shell command security guard. |
| **Phase 4.5** | Marketing & Product Presentation | Complete in `apps/marketing` | **COMPLETE** | 10-Act product story, `Satoshi` + `Geist` tokens, interactive workstation simulators, truth contract. |
| **Phase 5** | SaaS Foundation & Project Memory | Complete across server, relay, mcp | **COMPLETE** | SQLite WAL Project Memory Core, `@asterim/mcp-memory-server`, loopback relay (DEC-026), drift detection (DEC-027), Stripe billing, Sovereign Mode air-gap (DEC-028). |
| **Phase 6** | AI Ecosystem, MCP, Skills & Profiles | Complete across server & web | **COMPLETE** | Stdio MCP supervisor, JSON-RPC handshake, autostart, per-server `SerialQueue`, `.agents/skills` parser, 6 built-in engineering roles, capability filtering. |
| **Original Phase 7** | Extensions Platform & Marketplace | Replaced by MCP & Skills | **REDEFINED / OBSOLETE** | Building a proprietary VS-Code-like JS/WASM extension sandbox was superseded by the industry-standard MCP and Markdown Skills architecture. |
| **Original Phase 8** | Automation & Workflows | Partial / Programmatic | **PARTIAL** | Worktree sandboxing (`GitWorktreeService`) and verification pipelines (`VerificationPipelineService`) built; visual drag-and-drop workflow builder not implemented. |
| **Original Phase 9** | Enterprise Security & IAM | Local Hardening Complete | **PARTIAL / REDEFINED** | Local Secret Vault (`SecretVaultService` AES-256-GCM) and local air-gap complete; enterprise cloud SAML/OIDC deferred. |
| **Original Phase 10** | AI Operating System Vision | Foundational Primitives Built | **REDEFINED** | Evolved into the local-first collaborative agent control plane. |

---

### Detailed Reconciliation by Phase

#### Phase 1 — Product UX
* **Original Promise**: Sleek dark-mode developer UI, command palette (`Cmd+K`), xterm.js terminal integration, thread list, project switcher.
* **Actual Code State**: Fully implemented in `apps/web`. Uses Tailwind CSS, custom design tokens in `tokens.css`, `xterm.js` with WebGL addon, and Zustand stores (`useProjectStore.ts`, `useTerminalStore.ts`).
* **Verdict**: **COMPLETE**.

#### Phase 2 — Authentication & Account Platform
* **Original Promise**: Centralized web auth, deep-link authentication, account portal, subscription entitlement schema.
* **Actual Code State**: Implemented in `apps/server` and `apps/marketing`. SQLite tables `users`, `accounts`, `user_sessions`, and `feature_entitlements`. Device pairing PIN protocol implemented in `PairingService.ts`.
* **Verdict**: **COMPLETE**.

#### Phase 3 — Teams & Workspaces
* **Original Promise**: Cloud-synchronized organization switcher, remote team member rosters, email invitations, cloud RBAC.
* **Actual Code State**: **Redefined architecturally**. Under the local-first data sovereignty mandate (`DEC-028`), storing user codebases and workspace metadata in a central cloud database was rejected. Implemented instead as local workstation workspaces (`workspaces` table) with environment presets (`personal`, `company`, `client`, `experimental`).
* **Verdict**: **REDEFINED**. *Note: True collaborative team agents are now elevated to Phase 8.*

#### Phase 4 — Developer Workstation Engine Hardening
* **Original Promise**: Fault-tolerant agent subprocess management, terminal backpressure throttling, shell AST security parser, git diff inspector.
* **Actual Code State**: Implemented in `apps/server`. `ProcessTreeManager.ts` tracks process trees with cascading `SIGTERM` → `SIGKILL` teardown. `TerminalStreamThrottler.ts` implements 16ms frame chunking. `evaluateCommandSecurity` parses command strings against dangerous patterns.
* **Verdict**: **COMPLETE**.

#### Phase 4.5 — Marketing Website & Product Presentation
* **Original Promise**: High-fidelity product presentation on `asterim.dev` (`@asterim/marketing`).
* **Actual Code State**: Fully implemented in `apps/marketing`. 10-Act progressive scroll narrative, `Satoshi` display typography, interactive workstation simulators, WCAG compliance, and truth contract audited in `DEC-016`–`DEC-022`.
* **Verdict**: **COMPLETE**.

#### Phase 5 — SaaS Foundation, Project Memory & Continuous Governance
* **Original Promise**: Project Memory persistence, cross-agent MCP memory server, drift detection, candidate decision extraction, Stripe billing, and Cloud Relay.
* **Actual Code State**: Implemented and verified across 24 test suites. `@asterim/mcp-memory-server` provides stdio access with 4-tier CWD resolution. `GitDriftDetector` flags staleness non-destructively (`DEC-027`). `BillingService` handles Stripe Checkout/Portal. `SovereignMode` guarantees 0 external network requests (`DEC-028`).
* **Verdict**: **COMPLETE**.

#### Phase 6 — AI Ecosystem (MCP, Skills & Profiles)
* **Original Promise**: Stdio MCP server process supervisor, reusable skills engine, agent profile personas.
* **Actual Code State**: Implemented across Tasks P6-01 through P6-07. `McpProcessSupervisor.ts` manages child processes. `SkillService.ts` parses `.agents/skills/*/SKILL.md`. `ProfileService.ts` manages 6 built-in engineering roles with capability filtering (`filterToolsForProfile`).
* **Verdict**: **COMPLETE**.

#### Original Phases 7–10
* **Analysis**:
  - **Original Phase 7 (Extensions Platform & Marketplace)**: Proprietary extension runtime was superseded by open MCP standards and Markdown Skills.
  - **Original Phase 8 (Automation & Workflows)**: Implemented programmatic worktree sandboxing (`GitWorktreeService`) and verification pipelines (`VerificationPipelineService`). Visual workflow builder remained unbuilt.
  - **Original Phase 9 (Enterprise)**: Implemented local secret vault (`SecretVaultService` AES-256-GCM) and local air-gapped sovereign mode. Cloud SAML/SSO remained unbuilt.
  - **Original Phase 10 (AI OS)**: Re-scoped to concrete platform goals (Stable/Dev release channels, Collaborative Team Agents, Fleet deployment).

---

## 3. Remaining Legacy Work Inventory

Before commencing Phases 7–10, the following items from historical development must be accounted for:

### P0 — Release, Security & Correctness Blockers

1. **Single SQLite Database Collision Risk (Stable vs Dev)**:
   - *Problem*: Currently, running the server in development or running tests touches the same default database path (`~/.asterim/asterim.db`) unless overridden by temp paths. Developers using Asterim for daily coding cannot safely test experimental development branches without risking database corruption or migration locks.
   - *Resolution*: Must be resolved in **Phase 7 (Stable/Dev Release Channels & Migration Engine)**.

2. **Ad-Hoc SQLite Schema Migrations**:
   - *Problem*: `DatabaseService.ts` uses raw `ALTER TABLE ... ADD COLUMN` statements wrapped in `try/catch (ignore if exists)`. There is no `schema_migrations` table, no version tracking, no checksum validation, and no forward/down migration runner.
   - *Resolution*: Must be resolved in **Phase 7** with a formal versioned migration engine.

3. **Subagent Worktree Orphan Cleanup on Hard Server Crash**:
   - *Problem*: If Asterim Core is killed forcefully (e.g. `kill -9` or power loss) while subagents are running in `.asterim/worktrees/<threadId>`, ephemeral worktrees and branch refs remain on disk until manual pruning.
   - *Resolution*: Add boot-time orphan worktree detection and cleanup in `GitWorktreeService.ts` (incorporated into Phase 7).

---

### P1 — Important Production Work

1. **Windows Signal Timing Assertion in Unit Tests**:
   - *Problem*: On Windows, `ChildProcess.kill('SIGTERM')` translates to Win32 `TerminateProcess()`, executing in ~8ms rather than waiting out the 3,000ms grace period. Unit tests asserting grace period delays fail on Windows hosts.
   - *Resolution*: Guard timing-sensitive signal assertions with `process.platform === 'win32'` checks.

2. **Full UI Disconnection Recovery & Socket Re-Attachment**:
   - *Problem*: When the web browser disconnects during long-running background delegations, the active thread view must re-synchronize pending approval states and streaming logs on reconnect without requiring a hard browser refresh.
   - *Resolution*: Enhance `useProjectStore.ts` socket reconnect handler with state reconciliation.

---

### P2 — Future Improvements & Non-Critical Polish

1. **Visual Workflow Drag-and-Drop Editor**:
   - *Status*: Declarative YAML pipelines (`.asterim/pipelines/*.yaml`) are sufficient for developer use. Visual canvas UI is deferred to post-Phase 10.
2. **Third-Party Commercial Extension Marketplace**:
   - *Status*: Open MCP ecosystem and Git-based Skills repositories supersede proprietary marketplace infrastructure. Declared **OBSOLETE**.

---

## 4. Production Risks & Mitigation Strategy

| Risk | Severity | Root Cause | Architectural Mitigation |
| :--- | :---: | :--- | :--- |
| **Development Branch Data Corruption** | **HIGH** | Single shared data directory (`~/.asterim`). | Phase 7 Channel Isolation (`~/.asterim` for Stable, `~/.asterim-dev` for Development). |
| **Schema Migration Desynchronization** | **HIGH** | Unversioned `db.exec(ALTER TABLE)`. | Phase 7 Versioned SQL Migration Engine with transactional rollbacks. |
| **Concurrent Team Member Agent Collisions** | **HIGH** | Multiple users dispatching tasks to one agent simultaneously. | Phase 8 `AgentTurnLock` FIFO queueing and turn ownership. |
| **Cloud Relay Data Leakage** | **CRITICAL** | Misconfigured cloud relays transmitting memory unencrypted. | Phase 8 E2E Tunnel Encryption (`DEC-028` enforcement, zero cloud storage). |
