# Asterim Environment Architecture Specification

**Author**: CTO, Product Architect & Lead UX Engineer  
**Date**: August 7, 2026  
**Status**: Core Architectural Blueprint  
**Target Milestone**: Phase 3.5 & Foundation for Commercial Platform  

---

## 1. Executive Summary & Paradigm Shift

Asterim is **NOT** a traditional web SaaS dashboard. It is a **local-first developer operating system for AI software engineering**.

Conventional SaaS tools treat "Workspaces" as administrative billing accounts with user lists. In Asterim, we replace this concept with **Environment**—an isolated, self-contained execution universe.

Switching Environments in Asterim is like switching virtual workstations or operating system contexts. Changing your Environment instantly changes everything visible, executable, and accessible inside the IDE.

---

## 2. Environment Types & Scopes

An Environment is designed to fit every developer context—from a solo developer working offline on open-source code to an enterprise engineer handling zero-trust client codebases.

```
                    ┌─────────────────────────────────────────┐
                    │          ASTERIM ENVIRONMENT            │
                    ├─────────────────────────────────────────┤
                    │  • Projects & Local Repositories        │
                    │  • Agent Processes & Active Threads     │
                    │  • MCP Servers & Tools                  │
                    │  • Custom Agent Skills & Extensions     │
                    │  • Environment Secrets & API Keys       │
                    │  • Context Indexes & Vector Storage     │
                    │  • Git Credentials & AI Providers       │
                    │  • Audit Stream & Team Roster           │
                    └─────────────────────────────────────────┘
```

### Environment Taxonomy
1. **Personal Environment (Default)**:
   - Zero-config, 100% offline, solo developer mode.
   - Default home for side projects, personal scripts, and private code.
   - Requires zero network requests or cloud authentication.
2. **Company Environment**:
   - Organization-wide developer workspace (e.g., *Acme Corp Engineering*).
   - Contains shared company projects, centralized team MCP servers, shared skills, enterprise RBAC policies, and audit logging.
3. **Client Environment**:
   - Isolated sandbox for client contract work (e.g., *Client X Freelance*).
   - Strict security boundaries: client API keys, custom MCP configurations, and secrets remain 100% segregated from personal code.
4. **Open Source Environment**:
   - Community-focused space for open-source contributions.
   - Uses public AI providers, shared community skills, and public context indexes.
5. **Experimental / Sandbox Environment**:
   - Ephemeral testing ground for trying new AI models, experimental agents, or risky MCP tools without affecting production setups.

---

## 3. Isolated State Universe

Every Environment forms a strictly isolated state container. When an Environment is active, the Asterim engine binds all system resources exclusively to that Environment:

| Component | Isolation Mechanism & Behavior |
| :--- | :--- |
| **Projects** | Filtered strictly to repositories linked to the active Environment. Existing unassigned projects automatically belong to the Personal Environment. |
| **Agents & Sessions** | Active agent processes, sub-process execution states, and session logs run within the Environment context. |
| **Threads & Tasks** | Thread histories, chat transcripts, and mission objectives are scoped to Environment projects. |
| **Knowledge (KI)** | Local Knowledge Items, vector embeddings, and repository maps are indexed per Environment. |
| **Secrets & Keys** | Environment-specific API keys (OpenAI, Anthropic, Custom LLM endpoints) and API tokens (`ast_ak_...`). Personal keys never leak to Client Environments. |
| **MCP Configuration** | Model Context Protocol (MCP) servers (e.g. Postgres MCP, GitHub MCP, GCP Telemetry MCP) are configured per Environment. |
| **Skills & Prompts** | Agent skills, slash commands, and custom workflows (`.agents/skills/`) belong to their target Environment. |
| **Extensions** | Installed Asterim plugins and tools are scoped per Environment. |
| **Git Settings** | Git author identities (`name`, `email`), SSH keys, and commit signing configurations. |
| **AI Providers** | Model endpoints, temperature settings, and rate-limit quotas tailored per Environment. |
| **Context Indexes** | AST symbol graphs (`graphify-out/`), code search indexes, and local RAG caches. |
| **Team Roster & RBAC** | Optional member list (`Owner`, `Admin`, `Member`, `Viewer`) and capability policy rules. |
| **Audit History** | Security and action logs (`AuditService`) recorded strictly within the Environment stream. |

---

## 4. Native Navigation Architecture

Navigation in Asterim must feel instant, natural, and integrated into the developer's keyboard-first workflow.

### A. Location Breadcrumb (TopBar)
- **Design**: Clean, single-line horizontal path (`whiteSpace: 'nowrap'`):
  ```
  [P] Personal Environment  /  Asterim  /  Refactor Auth Thread
  ```
- **Rationale**: Eliminates flashy, heavy buttons. Clicking the Environment breadcrumbs segment opens the high-density switcher dropdown.

### B. Environment Switcher Dropdown
- **Placement**: TopBar left section next to Asterim logo.
- **Shortcut**: `⌘E` or `Ctrl+E` for instant hotkey switching.
- **Controls**:
  - Environment list with status badges (`Personal`, `Team`, `Client`).
  - `⚙ Environment Settings` -> opens `WorkspaceTabView` inside main IDE shell.
  - `+ Create Environment` -> opens quick creation dialog.

### C. Native Workspace Tab View (`WorkspaceTabView`)
- **Placement**: Rendered inside the main IDE shell alongside `Chat`, `Terminal`, `Changes`, and `Settings`.
- **Navigation Tabs**:
  - `Members & Governance` (Team roster, role assignments, invite links).
  - `Projects & Repositories` (Grid of assigned projects with workspace transfer controls).
  - `MCP & Tooling` (Environment-scoped Model Context Protocol servers).
  - `Skills & Workflows` (Custom agent skills and prompts).
  - `Audit Stream` (Real-time security log).
  - `Environment Settings` (Display name, secrets, dangerous actions).
- **Rationale**: Avoids floating popup modals that interrupt coding focus.

### D. Command Palette (`⌘K`) Integration
- Developers can type `⌘K` -> `Switch Environment` or `⌘K` -> `Environment Settings` to navigate without touching the mouse.

---

## 5. Collaboration Philosophy & Granular Sharing

Asterim approaches collaboration from a **developer-centric, local-first perspective**:

### Granular Sharing Model
1. **Sharing an Environment**:
   - Teammates join the Environment to gain access to shared projects, team MCP configurations, shared skills, and team thread activity.
2. **Sharing a Project**:
   - A developer can explicitly assign a project to an Environment or flag it as `workspace` visibility.
3. **Sharing Individual Threads / Transcripts**:
   - Developers can generate a read-only share link or export a thread transcript (`.json` or `.md`) without inviting external users to the full Environment.
4. **Environment-Scoped Approvals**:
   - Command approval policies (e.g. `Auto-Approve Read Commands`, `Require Confirmation for Terminal Writes`) are configured per Environment. A sandbox environment can be configured with relaxed approvals, while a production client environment strictly enforces manual approval.
5. **Environment-Scoped Skills & MCP Tools**:
   - Custom skills created in one Environment (e.g. `gcp-data-pipelines`) remain locked to that Environment unless published to the team catalog.

---

## 6. Future SaaS & Enterprise Compatibility

The Environment architecture is designed to support all upcoming commercial roadmap capabilities without requiring future refactoring:

| Future Roadmap Capability | Environment Architecture Support |
| :--- | :--- |
| **Authentication & Identity** | Seamlessly maps local dev user (`usr_dev`) to authenticated SaaS account (`usr_live_...`) upon login. |
| **Cloud Sync** | Environment state (threads, skills, settings) can be synced to cloud storage via `ISyncAdapter`. |
| **MCP & Skill Marketplaces** | Environments pull verified skills and MCP packages directly from the Asterim Marketplace. |
| **Subscriptions & Metering** | Feature entitlements (`canAccessFeature('teams')`) and agent token usage meters are evaluated per Environment. |
| **Enterprise Governance** | Zero-trust SSO, SAML 2.0, audit log exports, and strict RBAC policy enforcement. |
| **Multi-Device & Remote Workstations** | Developers can switch between local laptop execution and remote cloud GPU workstations inside the same Environment. |
| **Environment Backup & Templates** | Environments can be exported as `.asterim-env` templates containing pre-configured MCP tools, skills, and settings for instant onboarding of new team members. |
