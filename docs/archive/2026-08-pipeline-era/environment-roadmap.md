# Asterim Environment Architecture — Canonical Implementation Roadmap

**Document Status**: AUTHORITATIVE IMPLEMENTATION SCHEDULE  
**Author**: CTO, Product Architect & Lead UX Engineer  
**Date**: August 7, 2026  
**Reference Blueprint**: [docs/environment-blueprint.md](file:///home/qhukz/Documents/Projects/Asterim/docs/environment-blueprint.md)  

---

> [!IMPORTANT]
> **EXECUTION DIRECTIVE**  
> Every Pull Request in this roadmap derives directly from [`docs/environment-blueprint.md`](file:///home/qhukz/Documents/Projects/Asterim/docs/environment-blueprint.md).  
> Do NOT begin implementation of any PR until explicit user approval is granted at the User Review Gate.

---

## PR Schedule Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                   CANONICAL ENVIRONMENT PR SCHEDULE                    │
├─────────┬──────────────────────────────────────────────────────────────┤
│  PR1    │ Environment Manifest (.asterim-environment) & Domain Types   │
├─────────┼──────────────────────────────────────────────────────────────┤
│  PR2    │ Environment Store & Storage Abstraction                      │
├─────────┼──────────────────────────────────────────────────────────────┤
│  PR3    │ TopBar Environment Switcher, Single-Line Breadcrumb & ⌘E     │
├─────────┼──────────────────────────────────────────────────────────────┤
│  PR4    │ Native Environment Settings View (EnvironmentSettingsView)   │
├─────────┼──────────────────────────────────────────────────────────────┤
│  PR5    │ Agent Profiles Layer Architecture                            │
├─────────┼──────────────────────────────────────────────────────────────┤
│  PR6    │ MCP Ownership & Visibility Layer                             │
├─────────┼──────────────────────────────────────────────────────────────┤
│  PR7    │ Skills Ownership & Inheritance Layer                         │
├─────────┼──────────────────────────────────────────────────────────────┤
│  PR8    │ Knowledge System & Local RAG Layer                           │
├─────────┼──────────────────────────────────────────────────────────────┤
│  PR9    │ Extensions & Integration Scoping Layer                       │
├─────────┼──────────────────────────────────────────────────────────────┤
│  PR10   │ Execution Profiles & Command Approval Engine                 │
├─────────┼──────────────────────────────────────────────────────────────┤
│  PR11   │ Multi-Environment Repository Attachment Engine               │
├─────────┼──────────────────────────────────────────────────────────────┤
│  PR12   │ Zero-Leakage Audit & Full Monorepo Build Verification        │
└─────────┴──────────────────────────────────────────────────────────────┘
```

---

## Detailed PR Specifications

### PR1 — Environment Manifest (`.asterim-environment`) & Domain Types

- **Purpose**: Define the serializable `.asterim-environment` manifest specification and export domain interfaces (`Environment`, `EnvironmentPreset`, `EnvironmentMember`, `AgentProfile`, `KnowledgeItem`, `ExecutionProfile`) in `@asterim/shared` alongside SQLite relational DDL updates.
- **Files**:
  - `packages/shared/src/types/workspace.ts` (or `environment.ts`)
  - `apps/server/src/services/DatabaseService.ts`
- **Dependencies**: None.
- **Risks**: Type mismatches across monorepo packages consuming legacy `Workspace` interfaces.
- **Verification**:
  - Automated Typecheck: `pnpm --filter @asterim/shared typecheck`
  - Build Verification: `pnpm --filter @asterim/shared build`
- **Screenshots Required**: N/A (Backend domain types).

---

### PR2 — Environment Store & Storage Abstraction

- **Purpose**: Implement `useEnvironmentStore` Zustand state manager and `IEnvironmentProvider` storage abstraction to handle environment loading, state caching, and persistence.
- **Files**:
  - `apps/web/src/stores/useWorkspaceStore.ts` (refactored to Environment store)
  - `apps/server/src/routes/workspaces.ts` (aliased to `/api/v1/environments`)
  - `apps/server/src/services/WorkspaceService.ts`
- **Dependencies**: PR1.
- **Risks**: Latency or race conditions when fetching environments on desktop startup.
- **Verification**:
  - Automated Typecheck: `pnpm --filter @asterim/web typecheck`
  - Build Verification: `pnpm run build`
- **Screenshots Required**: N/A (State engine layer).

---

### PR3 — TopBar Environment Switcher, Single-Line Breadcrumb & `⌘E` Hotkey

- **Purpose**: Implement single-line horizontal TopBar location breadcrumb (`[Badge] Environment / Project / Mission`), `⌘E` hotkey switcher, and Command Palette integration (`⌘K`).
- **Files**:
  - `apps/web/src/components/TopBar.tsx`
  - `apps/web/src/components/WorkspaceSwitcher.tsx` (EnvironmentSwitcher)
  - `apps/web/src/components/CommandPalette.tsx`
- **Dependencies**: PR2.
- **Risks**: TopBar text wrapping on small display screens.
- **Verification**:
  - Hotkey Verification: Test `⌘E` and `⌘K` triggers.
  - Build Verification: `pnpm --filter @asterim/web build`
- **Screenshots Required**:
  - TopBar single-line location breadcrumb with colored preset badge.
  - `⌘E` Environment switcher dropdown menu.

---

### PR4 — Native Environment Settings View (`EnvironmentSettingsView`) & Shell Routing

- **Purpose**: Build native `EnvironmentSettingsView` tab in main workspace shell with 8 sub-tabs, and update `App.tsx` shell routing so opening Environment view with no project selected renders cleanly without fallback crashes.
- **Files**:
  - `apps/web/src/components/environment/EnvironmentSettingsView.tsx`
  - `apps/web/src/App.tsx`
  - `apps/web/src/stores/useViewStore.ts`
- **Dependencies**: PR3.
- **Risks**: View state misalignments when toggling between Chat, Terminal, Changes, and Environment.
- **Verification**:
  - Manual UI Walkthrough: Navigate through all 8 sub-tabs in `EnvironmentSettingsView`.
  - Build Verification: `pnpm run build`
- **Screenshots Required**:
  - Full `EnvironmentSettingsView` native tab layout.
  - Sub-tab views (Governance, Projects, Secrets, MCP, Skills, Audit Stream).

---

### PR5 — Agent Profiles Layer Architecture

- **Purpose**: Implement Environment-owned Agent Profiles (Development, Review, Architecture, Documentation, Security, Experiment), allowing threads to select active agent personas.
- **Files**:
  - `packages/shared/src/types/workspace.ts`
  - `apps/web/src/components/environment/EnvironmentSettingsView.tsx`
  - `apps/web/src/stores/useThreadStore.ts`
- **Dependencies**: PR4.
- **Risks**: Thread store failing to persist selected Agent Profile ID.
- **Verification**:
  - Create custom Agent Profile and select it within a chat thread.
  - Build Verification: `pnpm run build`
- **Screenshots Required**:
  - Agent Profile management screen in Environment Settings.
  - Agent Profile selector dropdown in Thread Header.

---

### PR6 — MCP Ownership & Visibility Layer

- **Purpose**: Enforce 4-tier MCP server hierarchy (Global -> Environment -> Agent Profile Visibility -> Thread Instance), ensuring MCP servers are owned by Environment and filtered by Agent Profile.
- **Files**:
  - `apps/server/src/services/ProjectManager.ts`
  - `apps/web/src/components/environment/EnvironmentSettingsView.tsx`
- **Dependencies**: PR5.
- **Risks**: Disconnected MCP servers bleeding across Environment boundaries.
- **Verification**:
  - Configure Environment MCP server and verify it is inaccessible from other Environments.
  - Build Verification: `pnpm run build`
- **Screenshots Required**:
  - MCP Server configuration tab in Environment Settings.

---

### PR7 — Skills Ownership & Inheritance Layer

- **Purpose**: Implement 4-tier Skills hierarchy (Global -> Environment -> Agent Profile -> Thread), allowing Environment to own reusable domain skills (`.agents/skills/`).
- **Files**:
  - `packages/shared/src/types/workspace.ts`
  - `apps/web/src/components/environment/EnvironmentSettingsView.tsx`
- **Dependencies**: PR6.
- **Risks**: Global skills masking Environment-scoped skills.
- **Verification**:
  - Add custom Environment skill and execute via slash command in chat thread.
  - Build Verification: `pnpm run build`
- **Screenshots Required**:
  - Skills management tab in Environment Settings.

---

### PR8 — Knowledge System & Local RAG Layer

- **Purpose**: Implement Knowledge Items (Architecture, Conventions, Business Rules, Glossary, Decisions) owned by Environment and indexed into local vector search caches.
- **Files**:
  - `packages/shared/src/types/workspace.ts`
  - `apps/server/src/services/DatabaseService.ts`
  - `apps/web/src/components/environment/EnvironmentSettingsView.tsx`
- **Dependencies**: PR7.
- **Risks**: RAG vector search index leakage across Environment boundaries.
- **Verification**:
  - Create Knowledge Item and verify RAG context retrieval within Environment threads.
  - Build Verification: `pnpm run build`
- **Screenshots Required**:
  - Knowledge Items sub-tab in Environment Settings.

---

### PR9 — Extensions & Integration Scoping Layer

- **Purpose**: Scope platform extensions (GitHub, Linear, Jira, Slack, Custom Webhooks) strictly to Environments.
- **Files**:
  - `packages/shared/src/types/workspace.ts`
  - `apps/web/src/components/environment/EnvironmentSettingsView.tsx`
- **Dependencies**: PR8.
- **Risks**: Integration webhook triggers firing across un-scoped Environments.
- **Verification**:
  - Verify Extension credentials remain isolated per Environment.
  - Build Verification: `pnpm run build`
- **Screenshots Required**:
  - Extensions management screen in Environment Settings.

---

### PR10 — Execution Profiles & Command Approval Engine

- **Purpose**: Implement Execution Profiles (Fast Iteration, Corporate Compliance, Client Restricted, Unsafe Sandbox) defining active runtime execution behavior and command approval rules.
- **Files**:
  - `packages/shared/src/types/workspace.ts`
  - `apps/server/src/middleware/rbacGuard.ts`
  - `apps/web/src/App.tsx`
- **Dependencies**: PR9.
- **Risks**: Command approval prompts bypassing Execution Profile rules.
- **Verification**:
  - Toggle Execution Profile to Corporate Compliance and verify strict shell approval prompts.
  - Build Verification: `pnpm run build`
- **Screenshots Required**:
  - Execution Profile selection card in Environment Settings.

---

### PR11 — Multi-Environment Repository Attachment Engine

- **Purpose**: Implement Many-to-Many Repository Attachment DDL (`environment_project_attachments`), allowing a single git repository on disk to be attached to multiple Environments with independent runtime contexts.
- **Files**:
  - `apps/server/src/services/DatabaseService.ts`
  - `apps/server/src/services/ProjectManager.ts`
  - `apps/web/src/components/NavigationSidebar.tsx`
- **Dependencies**: PR10.
- **Risks**: Deleting an Environment attachment accidentally deleting project records.
- **Verification**:
  - Attach single repo to Personal and Company Environments; verify switching Environments swaps MCP/secrets/git identity without duplicating disk files.
  - Build Verification: `pnpm run build`
- **Screenshots Required**:
  - Navigation Sidebar showing repo attached across multiple Environment trees.

---

### PR12 — Zero-Leakage Audit & Full Monorepo Build Verification

- **Purpose**: Quality assurance, zero-leakage security audit across API keys, MCP tools, and RAG indexes, and full monorepo production build.
- **Files**: Monorepo verification test suite.
- **Dependencies**: PR1–PR11.
- **Risks**: Latent build error in sub-package.
- **Verification**:
  - Run `pnpm run build` across all 7 monorepo packages (`@asterim/shared`, `@asterim/adapters`, `@asterim/relay`, `@asterim/marketing`, `@asterim/web`, `asterim`, `@asterim/eslint-config`).
  - Run `pnpm run typecheck`.
- **Screenshots Required**:
  - Monorepo build log showing 7/7 packages built with 0 errors.
