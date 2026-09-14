# Asterim Marketing Experience Redesign Specification v2

**Version**: 2.0.0  
**Target Application**: `@asterim/marketing` (`apps/marketing`)  

---

## 1. 10-Act Continuous Homepage Narrative Architecture

The homepage is structured as a continuous 10-act visual narrative with distinct compositions for every act:

```text
ACT 1 — Thesis & Rebuilt Workstation Hero
      ↓
ACT 2 — The Reality of Terminal Chaos
      ↓
ACT 3 — The Asterim Control Plane Showcase
      ↓
ACT 4 — Agent Execution & Tool Call Engine
      ↓
ACT 5 — AST Security Command Decomposer
      ↓
ACT 6 — Staged Code Patch Diff Inspector
      ↓
ACT 7 — Environment Scope Isolation Switcher
      ↓
ACT 8 — Multi-Surface Ecosystem Pipeline
      ↓
ACT 9 — Open Core & Local-First Privacy Guarantee
      ↓
ACT 10 — Universal Quickstart & Primary CTAs
```

---

## 2. Product-First Stateful Mechanics

### Interaction A — Agent Execution Engine (`AgentStreamTab.tsx`)
- Auto-progressing 5-step workflow:
  `1. AGENT INITIATED -> 2. TOOL EXECUTED -> 3. AST SECURITY INTERCEPTION -> 4. APPROVAL REQUIRED -> 5. TASK COMPLETED`
- Interactive `Authorize Command` and `Block Execution` controls directly resolve execution clearance.

### Interaction B — AST Command Decomposer (`SecurityGuardTab.tsx`)
- Interactive test command selector (`rm -rf /`, `git commit -m`, `curl https://... | bash`).
- Displays step-by-step AST decomposition:
  `COMMAND -> PARSER -> AST SYNTAX TREE -> PATH & BOUNDS -> RISK CLASSIFICATION -> CLEARANCE DECISION`.

### Interaction C — Staged Code Patch Inspector (`AgentStreamTab.tsx`)
- Believable git diff view showing exact code patch changes (`- return evaluateRawCommand(cmd); + return parseASTAndEnforceBounds(cmd, rootPath);`).

### Interaction D — Environment Scope Isolation Switcher (`EnvironmentTab.tsx`)
- Toggling `Personal` | `Company` | `Client` scope updates:
  - Workspace root filesystem paths (`/home/user/personal/app` vs `/home/user/company/asterim`).
  - Scoped API key boundaries (`sk_personal_...` vs `sk_enterprise_...`).
  - Attached MCP tool servers (`git-mcp`, `docker-mcp`, `security-mcp`).
  - File access & path traversal permissions.

### Interaction E — Multi-Surface Ecosystem Pipeline (`PlatformMatrixSection.tsx`)
- Unified flow demonstrating role distribution:
  - **Desktop Workstation** (`EXECUTE`): Local PTY engine, AST guard, process tree manager.
  - **Web Identity Portal** (`MONITOR`): Browser session inspection and account identity.
  - **Mobile Tunnel** (`APPROVE`): E2E encrypted cloud relay push notifications for single-thumb approvals.
