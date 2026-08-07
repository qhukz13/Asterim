# Asterim Phase 3.5 — Collaboration Architectural Review

**Author**: CTO, Product Architect & Lead UX Engineer  
**Date**: August 7, 2026  
**Status**: Architectural Audit & Paradigm Shift Proposal  
**Target Milestone**: Phase 3.5 (Collaboration Architecture Refinement)  

---

## Executive Summary

Phase 3 (**Teams & Workspaces**) successfully delivered the technical plumbing for multi-user collaboration: SQLite tables, REST routes, JWT claims, WebSocket room partitioning (`workspace:<id>`), and RBAC permission evaluation.

However, an architectural audit reveals a fundamental product mismatch:
- **The Problem**: Phase 3 implemented a conventional, web-first SaaS "Teams & Workspaces" feature (similar to GitHub Orgs or Slack Teams).
- **The Vision**: Asterim is **NOT** a web SaaS dashboard. It is a **local-first developer operating system for AI-assisted software engineering**.
- **The Paradigm Shift**: We must move beyond generic "Teams & Workspaces" and introduce **Environments**—isolated, self-contained universes that encapsulate local projects, agent processes, thread states, MCP configurations, skills, secrets, extensions, and context indexes.

This document reviews the current implementation across 12 core categories, identifies long-term architectural risks, and proposes the **Environment Paradigm**.

---

## Category-by-Category Architectural Audit

### 1. Workspace Model
- **Current Implementation**: A workspace is represented as a database row in `workspaces` with an `id`, `name`, `slug`, and `is_personal` flag. Projects are loosely tagged with `workspace_id`.
- **Problems**: Workspaces feel like external administrative groupings rather than runtime execution containers. Switching workspaces only filters project lists; it does not change local agent configurations, secrets, or toolchains.
- **Long-term Risks**: Fragmented developer state. If a developer switches from "Personal" to "Acme Corp", their MCP servers, API keys, and custom skills bleed across workspace boundaries.
- **Suggested Redesign**: Reframe "Workspace" as an **Environment**. An Environment is an isolated runtime universe. Switching Environments instantly rebinds projects, agent tools, secrets, MCP configurations, skills, and active threads.
- **Priority**: **P0 (Critical Architecture)**

---

### 2. Team Model
- **Current Implementation**: Teams are modeled via `workspace_memberships` linking users to workspaces with fixed roles (`owner`, `admin`, `member`, `viewer`).
- **Problems**: Assumes team membership is a mandatory foreground concept. For a developer working solo in their Personal space, team controls clutter the visual interface.
- **Long-term Risks**: High friction for solo developers. Asterim must feel instant and zero-overhead for solo developers while seamlessly scaling to enterprise teams.
- **Suggested Redesign**: Make team capability an **optional layer** on top of an Environment. Personal Environments have 0 team overhead. Team Environments activate role governance, audit streaming, and peer activity feeds.
- **Priority**: **P1 (High)**

---

### 3. Personal Workflow
- **Current Implementation**: Personal space is hardcoded as `is_personal = 1` or `workspaceId = 'personal'`.
- **Problems**: Treated as a special "fallback edge case" in code rather than the primary mode of developer operation.
- **Long-term Risks**: Offline/air-gapped development breaks if auth middleware or database queries expect cloud user identities.
- **Suggested Redesign**: First-class **Personal Environment**. Operates 100% offline with zero network or cloud identity requirement. Dev user context (`usr_dev` / `acc_dev`) is natively built into the local kernel.
- **Priority**: **P0 (Critical Architecture)**

---

### 4. Multi-User Workflow
- **Current Implementation**: Multi-user sync relies on Socket.io room broadcasting (`workspace:<id>`) for real-time thread state.
- **Problems**: Lack of visual peer presence. Developers cannot see which teammate is actively running an agent on a shared thread or inspecting a file.
- **Long-term Risks**: Concurrent agent dispatches on shared local repositories can cause uncoordinated git state conflicts.
- **Suggested Redesign**: Introduce **Environment Peer Presence** and **Agent Session Leases**. Show live avatar indicators on active threads and lock agent execution on shared repositories to prevent concurrent git collisions.
- **Priority**: **P1 (High)**

---

### 5. Environment Architecture
- **Current Implementation**: Non-existent as an explicit abstraction. Configuration (MCP, skills, settings) is global per-installation.
- **Problems**: Global configuration leak. A custom MCP tool created for a client project is exposed to personal side projects.
- **Long-term Risks**: Security vulnerabilities and compliance breaches (e.g., exposing client API keys or proprietary skills across non-client repositories).
- **Suggested Redesign**: Enforce strict **Environment Isolation Containers**. Projects, MCP configs, Skills, Extensions, Secrets, and Context Indexes belong strictly to their parent Environment.
- **Priority**: **P0 (Critical Architecture)**

---

### 6. Navigation
- **Current Implementation**: TopBar dropdown (`[P] Personal Workspace`) with a popup modal overlay for settings.
- **Problems**: Disconnected navigation. Modal windows overlaying the IDE disrupt developer focus. The breadcrumb text formatted `All / Projects` on separate lines.
- **Long-term Risks**: UI fragmentation and modal fatigue.
- **Suggested Redesign**: 
  1. Unified **Environment Switcher** in the TopBar and Command Palette (`⌘K` -> `Switch Environment`).
  2. Single-line breadcrumb (`Personal Environment / MainTest / Session 1`).
  3. **Environment View Tab** (`WorkspaceTabView`) rendered natively inside the main IDE shell alongside Chat, Terminal, Changes, and Settings.
- **Priority**: **P0 (Critical UX)**

---

### 7. Information Architecture
- **Current Implementation**: Navigation hierarchy is ambiguous: Workspace -> Project -> Thread vs Global Navigation Sidebar.
- **Problems**: Clicking workspace settings opens a modal that masks the active project and thread context.
- **Long-term Risks**: User disorientation when navigating between high-level team governance and low-level code inspection.
- **Suggested Redesign**: Strict 3-level information hierarchy:
  - **Level 1 (Scope)**: Environment (`Personal`, `Acme Corp`, `Client X`).
  - **Level 2 (Repository)**: Project (`Asterim`, `Relay`, `Docs`).
  - **Level 3 (Mission)**: Thread / Agent Execution Session (`Refactor Auth`, `Fix Grid Bug`).
- **Priority**: **P1 (High)**

---

### 8. Role-Based Access Control (RBAC)
- **Current Implementation**: Fixed permissions (`workspace:read`, `workspace:write`, `member:invite`, `agent:spawn`, `agent:approve`) evaluated per REST route.
- **Problems**: RBAC checks are evaluated at the REST HTTP layer, but local CLI actions and internal agent event loops bypass route guards.
- **Long-term Risks**: Security enforcement gaps when agents run terminal commands locally.
- **Suggested Redesign**: Move RBAC evaluation into the **Core Agent Dispatch Engine**. Enforce execution approval policies based on Environment RBAC rules before spawning sub-processes.
- **Priority**: **P1 (High)**

---

### 9. Sharing Model
- **Current Implementation**: Binary project visibility (`private` vs `workspace`).
- **Problems**: Inflexible sharing options. Developers cannot share a single thread or agent transcript without exposing the entire project.
- **Long-term Risks**: Exposure of sensitive codebase files when developers only want to seek feedback on a specific bug or agent conversation.
- **Suggested Redesign**: Granular **Selective Artifact Sharing**:
  - Share Environment (Team-wide access).
  - Share Project (Workspace access).
  - Share Thread / Mission Transcript (Read-only link or export).
  - Share Custom Skill / MCP Server (Team marketplace catalog).
- **Priority**: **P2 (Medium)**

---

### 10. Collaboration UX
- **Current Implementation**: Administrative SaaS tables for members and audit logs.
- **Problems**: Feels cold and administrative, like an AWS IAM or Stripe Billing dashboard inside an IDE.
- **Long-term Risks**: Developers dislike administrative overhead inside code editors.
- **Suggested Redesign**: Developer-centric collaboration UX:
  - Live activity ticker of agent missions.
  - One-click invite link generation.
  - Visual indicator of active peer workstations.
  - Zero modal dialogs during active coding sessions.
- **Priority**: **P1 (High)**

---

### 11. Future SaaS Compatibility
- **Current Implementation**: Direct SQLite calls in routes with local auth fallbacks.
- **Problems**: Tightly coupled local database queries without abstraction for cloud state synchronization.
- **Long-term Risks**: Rewriting the entire backend when Cloud Sync and Enterprise Subscriptions launch in Phase 5.
- **Suggested Redesign**: Abstract storage operations behind `IEnvironmentProvider` and `ISyncAdapter` interfaces. Allows transparent switching between local SQLite (default) and Supabase / Cloud Postgres without changing app code.
- **Priority**: **P0 (Critical Architecture)**

---

### 12. Local-First Philosophy
- **Current Implementation**: Mixed assumptions—some routes expect JWT user sessions while local desktop runs zero-auth.
- **Problems**: Intermittent 401 Unauthorized errors on local dev ports.
- **Long-term Risks**: Violates Asterim's core commitment to local-first speed and reliability.
- **Suggested Redesign**: Enforce **Local Kernel First**. All core operations (reading files, dispatching local agents, executing shell commands) operate against the local kernel with 0 network latency. Cloud services strictly extend local capabilities.
- **Priority**: **P0 (Critical Architecture)**

---

## Summary Matrix

| Category | Current State | Target State (Phase 3.5) | Priority |
| :--- | :--- | :--- | :---: |
| **Workspace Model** | Generic SaaS DB row | Isolated Runtime Environment Universe | **P0** |
| **Team Model** | Mandatory administrative role list | Optional collaboration layer on Environment | **P1** |
| **Personal Workflow** | Hardcoded fallback condition | First-class, zero-auth offline Environment | **P0** |
| **Multi-User Workflow** | Basic Socket.io room events | Peer presence & agent session leases | **P1** |
| **Environment Isolation** | Global config leak across projects | Isolated Secrets, Skills, MCP, Context Indexes | **P0** |
| **Navigation** | TopBar dropdown + popup modal | Single-line breadcrumb + Native Tab View | **P0** |
| **Information Architecture** | Ambiguous hierarchy | Environment -> Project -> Thread Hierarchy | **P1** |
| **RBAC Enforcement** | HTTP route middleware only | Agent Dispatch Kernel Guard | **P1** |
| **Sharing Model** | Binary project flag | Granular Environment / Thread / Skill sharing | **P2** |
| **Collaboration UX** | Administrative SaaS tables | High-density developer activity stream | **P1** |
| **Future SaaS Compatibility** | Direct SQLite binding | `IEnvironmentProvider` & `ISyncAdapter` | **P0** |
| **Local-First Philosophy** | Intermittent auth friction | Local Kernel First (0 network latency) | **P0** |
