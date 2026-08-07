# Asterim Environment Product Specification

**Document Status**: AUTHORITATIVE CANONICAL PRODUCT SPECIFICATION  
**Author**: Product Design & UX Architecture Team  
**Target Product**: Asterim Local-First AI Engineering OS  
**Milestone**: Phase 3.5 & Commercial Foundation  

---

## 1. What is an Environment?

### The Product Concept
An **Environment** is an isolated runtime universe inside Asterim.

It is **NOT** an administrative SaaS team account like Slack or GitHub Organizations.  
It is **NOT** a billing group.  
It is **NOT** a sub-folder.

An Environment is the digital container for a developer’s context—a dedicated workspace world that holds your local code repositories, agent subprocesses, chat threads, knowledge indexes, API credentials, Model Context Protocol (MCP) servers, custom AI skills, and extensions.

### The Problem It Solves
Modern developers switch constantly between different contexts:
- Private side projects and open-source experiments.
- Company production repositories with zero-trust compliance requirements.
- Freelance client projects requiring isolated secrets and custom MCP database tools.

In traditional tools, switching contexts means logging out, changing browser profiles, or leaking personal API keys and local tools into corporate codebases. Generic SaaS workspaces try to solve this by creating administrative web dashboards, forcing developers away from their code editor.

### Why Environments Are Superior to Workspaces
1. **Zero Context Leakage**: Switching an Environment in Asterim instantly rebinds the entire IDE—secrets, tools, AI models, skills, and indexed files—with 0% leakage between personal and corporate worlds.
2. **Local-First Native**: An Environment does not require a cloud connection. Your **Personal Environment** is 100% offline, local, and zero-overhead.
3. **Instant OS-Style Switching**: Changing your Environment feels like switching virtual desktops or switching OS profiles on a workstation—instantaneous, total, and complete.

---

## 2. The User Experience Lifecycle

### A. First Launch
- When a user opens Asterim for the very first time, they land directly inside their **Personal Environment**.
- No login popups, no account creation prompts, no mandatory team setup.
- The top bar displays a subtle breadcrumb: `[P] Personal Environment`.
- The user can immediately add local git repositories and start running AI agents offline.

### B. Second Launch
- Asterim remembers the exact Environment and active project from the last session.
- Boot time is under 200ms with zero network auth blocking.

### C. Creating an Environment
- Triggered via `⌘E` hotkey, top bar breadcrumb switcher, or Command Palette (`⌘K` -> `Create Environment`).
- Modal/Overlay prompt asks for:
  - **Name** (e.g. *Acme Production*, *Client X Freelance*, *Sandbox*).
  - **Environment Preset**:
    - `Personal` (Solo offline mode).
    - `Team / Company` (Collaborative, shared team tools, audit stream).
    - `Client Sandbox` (Isolated secrets, custom client MCP servers).
    - `Experimental` (Relaxed approvals for fast AI iteration).
- Upon creation, Asterim switches instantly to the new Environment.

### D. Switching Environments
- Triggered via `⌘E` or `⌘K` -> `Switch Environment`.
- Switching is instant (<100ms).
- The IDE smoothly transitions:
  - Left navigation sidebar updates to display only projects belonging to the target Environment.
  - Active thread history and agent sessions scope strictly to the target Environment.
  - Active MCP servers, secrets, and custom skills rebind to the new Environment definitions.
  - Top bar breadcrumb updates to reflect the active Environment badge.

### E. Deleting an Environment
- Accessible under `Environment Settings` -> `Danger Zone`.
- Personal Environment cannot be deleted (serves as default fallback).
- Deleting a team/client Environment removes the Environment metadata, secrets, and local MCP bindings, but **never deletes local code files on disk**.

### F. Sharing & Joining an Environment
- **Sharing**: An Environment owner clicks `Environment Settings` -> `Members & Invites` -> `Generate Invite Link`.
- **Joining**: Opening an invite link (`asterim://join?token=...` or `http://localhost:5173/join?token=...`) prompts the user:
  ```
  Join "Acme Corp Engineering" Environment?
  Role: Member
  [ Join Environment ]
  ```
- **Leaving**: Members can leave an Environment at any time from `Environment Settings`.

---

## 3. Navigation & Information Architecture

Navigation in Asterim follows a strict 3-tier hierarchy:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        ASTERIM TOP BAR                                 │
├────────────────────────────────────────────────────────────────────────┤
│ [P] Personal Environment  /  Asterim  /  Refactor Auth Thread          │
└────────────────────────────────────────────────────────────────────────┘
```

### A. Environment Selector Placement
1. **Top Bar Breadcrumb**:
   - The first segment of the top bar location bar is the Environment selector.
   - Text is formatted on a single line (`whiteSpace: 'nowrap'`):
     `[Badge] Environment Name  /  Project Name  /  Thread Name`
   - Clicking `[Badge] Environment Name` opens the **Environment Switcher Menu**.
2. **Keyboard Shortcut (`⌘E` / `Ctrl+E`)**:
   - Pressing `⌘E` anywhere in the IDE opens the Environment Switcher immediately.
3. **Command Palette (`⌘K`)**:
   - Searchable items: `Switch Environment...`, `Environment Settings`, `Create Environment`.

### B. Farewell to "Workspace & Team View"
- The generic SaaS label "Workspace & Team View" is **REMOVED**.
- In its place, Asterim provides **Environment Settings**:
  - Accessible via `⌘E` dropdown -> `⚙ Environment Settings` or Command Palette (`⌘K` -> `Environment Settings`).
  - Rendered as a native, full view tab in the main IDE area (`EnvironmentSettingsView`) alongside Chat, Terminal, Changes, and Settings.
  - Sub-tabs:
    1. `General & Presets`
    2. `Members & Governance` (Team Environments)
    3. `Projects & Assignment`
    4. `Secrets & Credentials`
    5. `MCP Servers & Tools`
    6. `Agent Skills & Prompts`
    7. `Audit Stream`
    8. `Danger Zone`

---

## 4. Environment Switching Behavior

When a user switches Environments, **EVERY VISIBLE AND EXECUTABLE CONTEXT IN ASTERIM INSTANTLY REBINDS**:

| System Component | Visible & Executable Behavior on Environment Switch |
| :--- | :--- |
| **Projects Sidebar** | Filters immediately to reveal ONLY projects assigned to the target Environment. |
| **Active Threads** | Sidebar thread history updates to display threads originating in the target Environment. |
| **Agent Execution Kernel** | Active background agent sessions scope to the target Environment. Running agents in other Environments continue in background without UI bleed. |
| **Knowledge Items (KI)** | Local code search, AST symbol graphs, and RAG context indexes switch to target Environment indexes. |
| **Secrets & Keys** | API keys (OpenAI, Anthropic, Custom LLMs) swap to Environment-specific secrets. |
| **MCP Servers** | Model Context Protocol tools (Postgres MCP, GitHub MCP, GCP MCP) disconnect and reconnect to the active Environment's server set. |
| **Agent Skills** | Custom skills (`.agents/skills/`) and prompt templates rebind to Environment definitions. |
| **Git Settings** | Git author identities (`name`, `email`), commit signing keys, and default push remotes rebind. |
| **Audit Log** | Real-time audit ticker switches to the target Environment stream. |

---

## 5. Personal vs. Team Environments

### Personal Environment
- **Default & Primary**: Pre-installed, zero-config, 100% local and offline.
- **Visuals**: Emerald badge `[P] Personal Environment`.
- **Governance**: Zero member roster, zero invite controls, zero cloud network dependencies.
- **Approvals**: Relaxed developer approvals (quick local iterations).

### Team / Company Environment
- **Collaborative**: Team roster with RBAC roles (`Owner`, `Admin`, `Member`, `Viewer`).
- **Visuals**: Blue or custom company badge `[C] Acme Engineering`.
- **Governance**: Real-time team audit stream, shared MCP servers, shared agent skills, strict command approval policies.

---

## 6. Project Assignment UX

Projects can be moved or assigned between Environments effortlessly:
1. **From Environment Settings**:
   - Navigate to `Environment Settings` -> `Projects & Assignment`.
   - Grid displays all projects on disk with an **Environment Dropdown** on each card.
   - Changing the dropdown reassigns the project instantly.
2. **From Navigation Sidebar**:
   - Right-click any project card in the left sidebar -> `Move to Environment...` -> Select target Environment.

---

## 7. Visual Identity & Aesthetic Feeling

Switching Environments in Asterim should feel like **switching virtual operating systems or workspaces on a high-end workstation**:
- **Smooth Transition**: A subtle 150ms cross-fade animation across the IDE shell.
- **Distinct Accent Badges**:
  - Personal: Emerald (`#10b981`)
  - Company: Royal Blue (`#3b82f6`)
  - Client Sandbox: Amber (`#f59e0b`)
  - Experimental: Purple (`#8b5cf6`)
- **Intentional & Cohesive**: The developer feels a clear mental shift into a distinct, focused workspace universe.
