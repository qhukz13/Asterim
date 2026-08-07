# Asterim Environment Architecture — Canonical Blueprint

**Document Version**: 3.0.0 — CANONICAL SINGLE SOURCE OF TRUTH  
**Author**: CTO, Product Architect & Lead UX Engineer  
**Date**: August 7, 2026  
**Status**: Authoritative Product Architecture Blueprint  
**Target Platform**: Asterim Local-First AI Engineering Operating System  

---

> [!IMPORTANT]
> **AUTHORITATIVE DIRECTIVE**  
> This document is the **SINGLE CANONICAL SOURCE OF TRUTH** for everything related to Environments in Asterim.  
> No other document, comment, or code file may override or contradict the principles, specifications, or architectures defined here. All future phase implementations (Developer Workstation, MCP, Skills, Extensions, Cloud Sync, Teams, Enterprise, Marketplace, Remote Workstations) MUST derive their architecture directly from this blueprint.

---

## 1. Philosophy & Core Purpose

### What is an Environment?
An **Environment** is a self-contained, isolated digital universe inside Asterim.

It is **NOT** a folder on disk.  
It is **NOT** a generic SaaS team billing account.  
It is **NOT** a sub-workspace or a window tab.  

An Environment is the complete operational runtime profile for a developer’s work—a dedicated universe that encapsulates attached code repositories, running agent processes, agent profiles, chat histories, Model Context Protocol (MCP) tools, custom AI skills, extensions, Knowledge Items, secrets, API credentials, RAG vector indexes, AST symbol graphs, git author identities, execution profiles, and security audit streams.

### What Problem Does It Solve?
Modern software engineers constantly context-switch across radically different domains:
1. **Personal side projects & open-source code**: High iteration speed, personal API keys, relaxed command approvals, zero corporate telemetry.
2. **Company production codebases**: Strict zero-trust compliance, corporate SSO credentials, enterprise MCP servers, mandatory audit logging, strict command approval policies.
3. **Freelance & client contract work**: Client-segregated API keys, custom database tools, strict confidentiality requirements, isolated git author emails (`developer@client.com`).

In traditional software tools, switching context requires logging out, toggling browser profiles, maintaining messy `.env` files, or opening multiple IDE windows. Crucially, traditional tools suffer from **context leakage**: personal API keys bleed into corporate repositories, enterprise MCP database tools remain exposed while editing personal side projects, and git commits in client repositories accidentally use personal `@gmail.com` addresses.

Generic SaaS collaboration tools attempt to solve this by creating administrative web dashboards (e.g. GitHub Organizations or Slack Workspaces), forcing developers out of their code editor and treating multi-user governance as a web-first billing construct.

### Why Asterim Uses Environments Instead of Workspaces
Asterim is **NOT** a web SaaS application. It is a **local-first developer operating system for AI software engineering**.

| Vector | Traditional SaaS "Workspace" | Asterim "Environment" |
| :--- | :--- | :--- |
| **Primary Concept** | Administrative billing group & user roster | Isolated runtime execution container & digital universe |
| **Network Dependency** | Cloud-first; breaks offline or air-gapped | Local-first; 100% offline, 0 network blocking |
| **Context Leakage** | Global settings & extensions bleed across workspaces | Zero leakage; 100% strict isolation of tools, keys, and indexes |
| **Switching Latency** | Slow web navigation & page reloads (>2s) | Instant OS-level profile swap (<100ms) |
| **Solo Developer Overhead**| High; mandates team setup & cloud login prompts | Zero; Personal Environment requires zero config or cloud identity |
| **Scope of Ownership** | User seats & cloud project lists | Repositories, Agents, Profiles, MCP, Skills, Knowledge, Secrets, Git Identity |

### How It Differs From Other Systems

- **vs. GitHub Organizations**: GitHub Orgs are web administrative containers for repositories, teams, and billing. They do not manage local IDE toolchains, local agent processes, local secrets, or local code search indexes.
- **vs. Slack Workspaces**: Slack Workspaces are communication channels for human chat messages. They have no concept of software code repositories, AI agent executions, or system toolings.
- **vs. Notion Workspaces**: Notion Workspaces are document trees. They do not handle subprocess lifecycles, git identities, or local developer execution kernels.
- **vs. VSCode Workspaces**: VSCode Workspaces are `.code-workspace` JSON files listing local folder paths. They do not isolate AI agent sessions, API credentials, custom skills, vector search indexes, or team RBAC governance.
- **vs. Cursor**: Cursor applies AI code generation on top of VSCode windows with per-window indexing. It has no concept of environment isolation containers, client secret segregation, team RBAC guards, or multi-user peer presence.

---

## 2. Mental Model & Attached Repositories

### The Virtual Developer OS Profile
Users MUST NOT think of an Environment as a settings page, a sub-folder, or a team dashboard.

The correct mental model is a **Virtual Developer OS Profile** or a **Parallel Operating System Universe**.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                   ASTERIM DESKTOP OS                                   │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  ┌─────────────────────────────┐  ⌘E  ┌─────────────────────────────┐  ⌘E  ┌────────┐ │
│  │   PERSONAL ENVIRONMENT      │ ───> │    ACME CORP ENVIRONMENT    │ ───> │ CLIENT │ │
│  ├─────────────────────────────┤      ├─────────────────────────────┤      └────────┘ │
│  │ • Attached: Asterim, Relay  │      │ • Attached: Asterim, CoreApp│               │
│  │ • Execution: Fast Iteration │      │ • Execution: Corporate Audit│               │
│  │ • Agent Profile: Dev Fast   │      │ • Agent Profile: Security   │               │
│  │ • user@gmail.com Git Author │      │ • user@acme.com Git Author   │               │
│  └─────────────────────────────┘      └─────────────────────────────┘               │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Repositories are Attached (NOT Bound 1:1)
A critical architectural principle of Asterim is that **Repositories are ATTACHED to Environments, not owned 1:1**.

One local git repository on disk (e.g. `/home/user/code/Asterim`) **MAY exist simultaneously in multiple Environments**:

```
                              ┌───────────────────────────┐
                              │  LOCAL REPOSITORY ON DISK │
                              │ /home/user/code/Asterim   │
                              └─────────────┬─────────────┘
                                            │
               ┌────────────────────────────┼────────────────────────────┐
               │                            │                            │
               v                            v                            v
┌──────────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────────┐
│   PERSONAL ENVIRONMENT   │  │   COMPANY ENVIRONMENT    │  │ CLIENT SANDBOX ENV       │
├──────────────────────────┤  ├──────────────────────────┤  ├──────────────────────────┤
│ • Model: GPT-5 / Ollama  │  │ • Model: Claude 3.5 Sonnet│  │ • Model: Azure OpenAI    │
│ • MCP: Personal SQLite   │  │ • MCP: Enterprise Postgres│  │ • MCP: Client Staging DB │
│ • Approvals: Auto-Read   │  │ • Approvals: Manual Audit│  │ • Approvals: Strict      │
│ • Git: dev@gmail.com     │  │ • Git: dev@company.com   │  │ • Git: dev@client.com    │
└──────────────────────────┘  └──────────────────────────┘  └──────────────────────────┘
```

- **The repository path stays identical on disk**.
- **The runtime operational context changes completely when switching Environments**.
- When switching Environments, Asterim rebinds the MCP toolset, secrets, skills, agent profiles, execution rules, and git author identities without duplicating repository files on disk.

---

## 3. Environment Manifest (`.asterim-environment`)

Internally, every Environment behaves as a portable, serializable runtime profile defined by an **Environment Manifest** (`.asterim-environment`):

```json
{
  "$schema": "https://asterim.dev/schemas/v2/environment-manifest.json",
  "id": "env_acme_prod_98a7",
  "name": "Acme Corp Production",
  "slug": "acme-corp-production",
  "preset": "company",
  "version": "1.0.0",
  "gitIdentity": {
    "name": "Sarah Jenkins",
    "email": "sarah.jenkins@acme.com",
    "signingKey": "3AA011B9928F"
  },
  "executionProfile": {
    "id": "exec_corporate_strict",
    "name": "Corporate Compliance",
    "autoApproveReadCommands": false,
    "requireApprovalForShell": true,
    "auditLoggingEnabled": true,
    "filesystemScope": "restricted"
  },
  "attachedProjects": [
    { "id": "proj_asterim", "path": "/home/sarah/code/Asterim", "defaultBranch": "main" },
    { "id": "proj_relay", "path": "/home/sarah/code/Relay", "defaultBranch": "main" }
  ],
  "agentProfiles": [
    {
      "id": "prof_dev",
      "name": "Development Agent",
      "defaultModel": "claude-3-5-sonnet",
      "temperature": 0.2,
      "mcpVisibility": ["mcp_postgres_acme", "mcp_github_acme"],
      "skills": ["git-commit", "refactor-clean"],
      "approvalLevel": "standard"
    },
    {
      "id": "prof_security",
      "name": "Security Audit Agent",
      "defaultModel": "gpt-4o",
      "temperature": 0.0,
      "mcpVisibility": ["mcp_audit_scanner"],
      "skills": ["security-scan", "gcs-security-assessment"],
      "approvalLevel": "strict"
    }
  ],
  "mcpServers": [
    {
      "id": "mcp_postgres_acme",
      "name": "Acme Staging DB",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://..."]
    }
  ],
  "skills": ["git-commit", "refactor-clean", "gcp-data-pipelines"],
  "extensions": ["ext_github_integration", "ext_linear_tracker"],
  "knowledgeItems": ["ki_architecture_overview", "ki_coding_conventions"],
  "secrets": ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ACME_DB_PASSWORD"]
}
```

---

## 4. Environment Lifecycle

An Environment moves through a clear state lifecycle:

```
    ┌──────────┐      Import / Create      ┌──────────┐
    │ Template │ ────────────────────────> │  Active  │ <────┐
    └──────────┘                           └────┬─────┘      │
                                                │            │ Switch
                                         Switch │            │
                                                v            │
    ┌──────────┐         Archive           ┌──────────┐      │
    │ Deleted  │ <──────────────────────── │ Inactive │ ─────┘
    └──────────┘                           └──────────┘
```

### Lifecycle Actions
- **Create**: Instantiate from scratch or a preset (`Personal`, `Company`, `Client Sandbox`, `Experimental`). Generates `env_...` ID and initializes local state partition.
- **Open / Switch**: Atomic, instant context swap (<100ms). Rebinds attached projects, MCP toolset, active skills, secrets, agent profiles, execution profiles, RAG vector search caches, and git identities.
- **Duplicate**: Clones an Environment Manifest into a new Environment container without copying local code files or private API keys.
- **Export**: Exports Environment configuration into a portable `.asterim-environment` file (with scrubbed secret values).
- **Import**: Instantiates an Environment from an `.asterim-environment` file or invite deep-link (`asterim://join?token=...`).
- **Archive**: Soft-deactivates an Environment, hiding it from daily switchers while retaining historical thread records and RAG caches.
- **Delete**: Permanently purges Environment metadata, credentials, and local MCP bindings from the database. **NEVER deletes local code files on disk**.
- **Restore**: Unarchives or recovers an archived Environment with 100% state restoration.

---

## 5. Agent Profiles Architecture

Environment decouples Agent Configuration from Environment Configuration by owning **Agent Profiles**.

An **Agent Profile** defines a specialized agent persona tailored for specific engineering workflows:

```
                          ┌───────────────────────────┐
                          │   ENVIRONMENT CONTAINER   │
                          └─────────────┬─────────────┘
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           │                            │                            │
           v                            v                            v
┌────────────────────┐        ┌────────────────────┐       ┌────────────────────┐
│ DEVELOPMENT AGENT  │        │   REVIEW AGENT     │       │  SECURITY AGENT    │
├────────────────────┤        ├────────────────────┤       ├────────────────────┤
│ • Model: Sonnet    │        │ • Model: GPT-4o    │       │ • Model: Claude    │
│ • Temp: 0.2        │        │ • Temp: 0.0        │       │ • Temp: 0.0        │
│ • MCP: All DB & Git│        │ • MCP: Read-only   │       │ • MCP: Scanner Only│
│ • Skills: Refactor │        │ • Skills: PR Review│       │ • Skills: Sec Audit│
└────────────────────┘        └────────────────────┘       └────────────────────┘
```

### Standard Agent Profiles
1. **Development Agent**: High-speed coding persona, full MCP tool access, interactive approvals.
2. **Review Agent**: Read-only code review persona, low temperature (0.0), automated diff inspection skills.
3. **Architecture Agent**: High-reasoning model (Claude 3.5 Sonnet / O3-Mini), AST symbol graph access, system design prompt templates.
4. **Documentation Agent**: Markdown formatting persona, Knowledge Item access, low approval overhead.
5. **Security Agent**: Zero-trust auditing persona, strict approval rules, security scanner MCP access.
6. **Experiment Agent**: Sandbox testing persona, high temperature (0.7), relaxed execution approvals.

**Hierarchy Rule**: Environment chooses which Agent Profiles exist. Threads choose which Agent Profile to dispatch.

---

## 6. MCP Ownership Hierarchy

Model Context Protocol (MCP) server availability follows a strict 4-tier inheritance hierarchy:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        MCP OWNERSHIP HIERARCHY                         │
├────────────────────────────────────────────────────────────────────────┤
│  1. GLOBAL MCPs         Optional system-wide defaults (e.g. OS File)   │
│         │                                                              │
│         v                                                              │
│  2. ENVIRONMENT MCPs    Primary ownership container (Postgres, GCP)    │
│         │                                                              │
│         v                                                              │
│  3. AGENT PROFILE MCPs  Visibility filter (Dev agent gets DB, Review   │
│         │               agent gets Git read-only)                      │
│         v                                                              │
│  4. THREAD INSTANCE     Active runtime MCP tool execution connection   │
└────────────────────────────────────────────────────────────────────────┘
```

- **Global MCPs**: Optional system-level fallbacks.
- **Environment MCPs**: The **primary ownership container** for MCP servers. Connections to database, cloud telemetry, or issue trackers belong strictly to their parent Environment.
- **Agent Profile Visibility**: Filters which Environment MCPs are exposed to a specific agent profile.
- **Thread Usage**: Active execution context during a live chat or mission thread.

---

## 7. Skills Ownership Hierarchy

Agent Skills (`.agents/skills/`) follow a 4-tier resolution hierarchy:

```
┌────────────────────────────────────────────────────────────────────────┐
│                       SKILLS OWNERSHIP HIERARCHY                       │
├────────────────────────────────────────────────────────────────────────┤
│  1. GLOBAL SKILLS       Pre-installed OS core skills (e.g. git-commit) │
│         │                                                              │
│         v                                                              │
│  2. ENVIRONMENT SKILLS  Reusable team/domain skills (e.g. gcp-pipelines)│
│         │                                                              │
│         v                                                              │
│  3. AGENT PROFILE SKILLS Skills bound to specific agent profile       │
│         │                                                              │
│         v                                                              │
│  4. THREAD SKILLS       Temporary inline session slash commands         │
└────────────────────────────────────────────────────────────────────────┘
```

- **Environment Skills**: The primary owner of reusable domain knowledge, workflows, and prompts.
- **Thread Skills**: One-off skills invoked during a specific agent mission session.

---

## 8. Knowledge System & RAG Layer

Environment is the authoritative owner of the **Knowledge System**, preparing the foundation for Phase 6:

### Knowledge Items (KI)
A **Knowledge Item** is a structured, localized piece of technical or domain context stored inside the Environment:
- **Architecture Blueprints**: Core system design documents (`ARCHITECTURE.md`, `blueprint/`).
- **Coding Conventions**: Style guidelines, linter configurations, language rules.
- **Business Rules**: Pricing rules, subscription plan tiers, domain constraints.
- **Glossary & Domain Terms**: Terminology dictionaries.
- **Product Decisions**: Key architectural records (ADRs).

```
┌────────────────────────────────────────────────────────────────────────┐
│                     ENVIRONMENT KNOWLEDGE SYSTEM                       │
├────────────────────────────────────────────────────────────────────────┤
│  Environment Knowledge Items (Architecture, Conventions, Glossary)     │
│                                 │                                      │
│                                 v                                      │
│                  Local Vector RAG & AST Indexer                        │
│                                 │                                      │
│                                 v                                      │
│             Isolated Environment Context Retrieval Engine              │
└────────────────────────────────────────────────────────────────────────┘
```

- Environment owns Knowledge Items.
- Knowledge Items are automatically parsed and indexed into the Environment's RAG vector database and AST symbol graph (`graphify-out/`).

---

## 9. Extensions Architecture

Asterim Extensions (integrations with external platforms and tools) belong strictly to Environments:

- **Supported Integrations**: GitHub, Linear, Jira, Slack, Custom Webhooks, Community Plugins, Asterim Marketplace extensions.
- **Isolation Rule**: An extension configured in Environment $A$ (e.g. *Acme Linear Integration*) is completely invisible and inactive in Environment $B$. Credentials, OAuth tokens, and webhook listeners remain 100% isolated.

---

## 10. Execution Profiles & Approval Engine

An **Execution Profile** defines the runtime execution rules and security approval policy for an Environment:

> [!NOTE]
> **Execution Profile vs. Environment Preset**  
> An **Environment Preset** is a creation template (Personal, Company, Client, Experimental).  
> An **Execution Profile** defines the **active runtime execution behavior** and security enforcement rules.

### Execution Profile Modes

| Execution Profile | Auto-Approve Reads | Require Shell Approval | Audit Logging | Filesystem Scope |
| :--- | :---: | :---: | :---: | :---: |
| **Fast Iteration (Personal)** | ✅ | ❌ (Ask on write) | Minimal | Unrestricted local path |
| **Corporate Compliance** | ❌ | ✅ (Strict confirmation) | Full Audit Stream | Repository workspace only |
| **Client Restricted** | ❌ | ✅ (Strict confirmation) | Full Audit Stream | Isolated sandbox container |
| **Unsafe Sandbox (Experimental)**| ✅ | ✅ (Auto-approve all) | Disabled | Temporary container |

---

## 11. Environment Switching Specification

When a user switches Environments (`⌘E` or TopBar click), Asterim performs an **atomic context rebind (<100ms)**:

```
Step 1: Save outgoing Environment thread scroll state & active inputs.
Step 2: Unbind outgoing MCP client tools & disconnect socket rooms.
Step 3: Swap Zustand activeEnvironmentId state.
Step 4: Rebind attached projects list & thread history.
Step 5: Rebind incoming Environment MCP servers & custom skills.
Step 6: Swap active API secrets & git author identity in execution kernel.
Step 7: Rebind RAG vector search indexes & AST symbol graphs.
Step 8: Update TopBar single-line location breadcrumb & preset badge color.
```

**CRITICAL RULE**: Environment switching MUST NOT duplicate code repositories or touch files on disk. It rebinds the virtual runtime operating context attached to local repos.

---

## 12. Precise State Isolation & Boundary Rules

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                SCOPING TIERS MATRIX                                    │
├───────────────────┬───────────────────┬────────────────────┬───────────────────────────┤
│    GLOBAL (IDE)   │    ENVIRONMENT    │      PROJECT       │          THREAD           │
├───────────────────┼───────────────────┼────────────────────┼───────────────────────────┤
│ • Window Shell    │ • MCP Toolset     │ • Attached Path    │ • Active Prompt           │
│ • Theme Styling   │ • API Secrets     │ • Git Branch       │ • Message History         │
│ • Keybindings     │ • Agent Profiles  │ • .gitignore       │ • Active Agent Profile    │
│ • Hardware Audio  │ • Skills & Prompts│ • Package Manifest │ • Pending Approvals       │
│ • Update Engine   │ • Knowledge (KI)  │ • Local Files      │ • Terminal Scrollback     │
│ • User Account ID │ • Execution Profile                   │                           │
│                   │ • Extensions      │                    │                           │
│                   │ • RAG / AST Index │                    │                           │
│                   │ • Git Identity    │                    │                           │
│                   │ • Audit Stream    │                    │                           │
└───────────────────┴───────────────────┴────────────────────┴───────────────────────────┘
```

---

## 13. User Experience (UX) Architecture

### Walkthrough Highlights
- **First Boot**: Instant local boot into **Personal Environment**. Zero cloud login popups, 100% offline ready.
- **Environment Creation**: `⌘E` -> `+ Create Environment` -> Select preset (Personal, Company, Client, Experimental) -> Instant transition.
- **Environment Switching**: Hit `⌘E` or click TopBar breadcrumb -> high-density dropdown opens -> press arrow keys + Enter -> instant <100ms cross-fade transition.
- **Attaching Repositories**: Drag folder or click `Add Project` -> select target Environment attachment.
- **Collaboration & Invites**: Generate invite link (`asterim://join?token=...`) -> Invitee accepts -> real-time peer presence indicators appear on shared threads.

---

## 14. User Interface (UI) Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ [P] Personal Environment  /  Asterim  /  Refactor Auth Thread        [● Working]  ⌘K   │ TopBar
├──────────────┬──────────────────────────────────────────────────────────┬──────────────┤
│ ENV PROJECTS │                                                          │ INSPECTOR    │
│              │ MAIN WORKSPACE SHELL                                     │              │
│ ▾ Personal   │                                                          │ • Active Env │
│   • Asterim  │  [ Chat ]   [ Terminal ]   [ Changes ]   [ Environment ] │ • Agent Prof │
│   • Relay    │                                                          │ • MCP Tools  │
│              │                                                          │ • Peer Avatars│
│ ▾ Acme Corp  │                                                          │              │
│   • Asterim  │                                                          │              │
└──────────────┴──────────────────────────────────────────────────────────┴──────────────┤
```

### Surface Specifications
1. **TopBar Breadcrumb**: Single-line horizontal path (`[Badge] Environment / Project / Mission`) with preset badge colors (Personal Emerald `#10b981`, Company Royal Blue `#3b82f6`, Client Amber `#f59e0b`, Experimental Purple `#8b5cf6`).
2. **Navigation Sidebar**: Header displays active Environment; projects tree groups attached repositories by Environment; right-click context menu opens `Attach to Environment...`.
3. **Command Palette (`⌘K`)**: Searchable actions: `Switch Environment...` (`⌘E`), `Environment Settings`, `Create Environment`, `Export Manifest`.
4. **Native `EnvironmentSettingsView` Tab**: Rendered natively in main shell with 8 sub-tabs (`General & Presets`, `Members & Governance`, `Projects & Repositories`, `Secrets & Credentials`, `MCP Tools`, `Skills & Prompts`, `Knowledge & RAG`, `Danger Zone`).

---

## 15. Collaboration Philosophy & Team Governance

- **RBAC Roles**: `Owner`, `Admin`, `Member`, `Viewer`.
- **Selective Sharing**: Share Environment (full team), Share Project, Share Thread Transcript (read-only link/markdown export), Share Custom Skill.
- **Peer Presence**: Avatar pills on TopBar and thread headers.
- **Session Leases**: Lock concurrent agent executions on shared git branches to prevent repository corruption.

---

## 16. Future Commercial & Roadmap Compatibility

The Environment architecture natively supports all future roadmap items:
- **Phase 5 Cloud Sync**: `ISyncAdapter` syncing environment state to Supabase/Postgres.
- **Phase 6 Marketplaces**: Pull verified MCP servers, skills, extensions, and agent profiles directly into Environment storage.
- **Phase 7 Enterprise**: SAML 2.0 / SSO, zero-trust audit log export, centralized RBAC policies.
- **Phase 8 Remote Workstations**: Swap execution kernel from local host to cloud GPU instances inside Environment.

---

## 17. Technical Architecture & Data Model

### Relational Database Schema (SQLite DDL)

```sql
-- Environments Table
CREATE TABLE IF NOT EXISTS environments (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  preset TEXT NOT NULL DEFAULT 'personal',
  execution_profile_id TEXT NOT NULL DEFAULT 'exec_default',
  avatar_url TEXT,
  is_personal INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Environment Project Attachments Table (Many-to-Many)
CREATE TABLE IF NOT EXISTS environment_project_attachments (
  id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  attached_at TEXT NOT NULL,
  FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE(environment_id, project_id)
);

-- Agent Profiles Table
CREATE TABLE IF NOT EXISTS agent_profiles (
  id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL,
  name TEXT NOT NULL,
  default_model TEXT NOT NULL,
  temperature REAL NOT NULL DEFAULT 0.2,
  mcp_visibility TEXT NOT NULL, -- JSON array of MCP server IDs
  skills TEXT NOT NULL, -- JSON array of skill IDs
  prompt_template TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE
);

-- Environment Knowledge Items Table
CREATE TABLE IF NOT EXISTS environment_knowledge_items (
  id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL, -- 'architecture', 'convention', 'glossary', 'decision'
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE
);

-- Environment Secrets Table
CREATE TABLE IF NOT EXISTS environment_secrets (
  id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL,
  secret_key TEXT NOT NULL,
  secret_value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE
);

-- Environment Audit Logs Table
CREATE TABLE IF NOT EXISTS environment_audit_logs (
  id TEXT PRIMARY KEY,
  environment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE
);
```

### TypeScript Interfaces (`@asterim/shared`)

```typescript
export type EnvironmentPreset = 'personal' | 'company' | 'client' | 'experimental';
export type EnvironmentRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface AgentProfile {
  id: string;
  environmentId: string;
  name: string;
  defaultModel: string;
  temperature: number;
  mcpVisibility: string[];
  skills: string[];
  promptTemplate?: string;
}

export interface KnowledgeItem {
  id: string;
  environmentId: string;
  title: string;
  category: 'architecture' | 'convention' | 'glossary' | 'decision';
  content: string;
  createdAt: string;
}

export interface ExecutionProfile {
  id: string;
  name: string;
  autoApproveReadCommands: boolean;
  requireApprovalForShell: boolean;
  auditLoggingEnabled: boolean;
  filesystemScope: 'unrestricted' | 'restricted' | 'sandbox';
}

export interface Environment {
  id: string;
  accountId: string;
  name: string;
  slug: string;
  preset: EnvironmentPreset;
  executionProfileId: string;
  avatarUrl?: string;
  isPersonal: boolean;
  createdAt: string;
  updatedAt: string;
}
```

---

## 18. Verification Checklist

Every implementation phase MUST pass this verification gate before being merged:

- [ ] **Zero Context Leakage**: Verify API keys, MCP tools, and Knowledge Items from Environment $A$ are completely inaccessible within Environment $B$.
- [ ] **Multi-Environment Repository Attachment**: Verify a single repository path on disk can be attached to multiple Environments simultaneously with independent runtime configurations.
- [ ] **Offline Execution**: Verify Personal Environment functions with 100% features when network interfaces are disabled.
- [ ] **Instant Switch Latency**: Confirm Environment switching completes in <100ms without full web app reloads.
- [ ] **Single-Line TopBar Breadcrumb**: Verify location breadcrumb remains on a single horizontal line with colored preset badge identity.
- [ ] **Clean Monorepo Build**: Confirm all 7 monorepo packages (`@asterim/shared`, `@asterim/adapters`, `@asterim/relay`, `@asterim/marketing`, `@asterim/web`, `asterim`, `@asterim/eslint-config`) compile cleanly with zero errors.
