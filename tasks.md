# Phase 3.5.2 Tasks

- [x] **PR 1: Personal Environment Experience**
  - [x] Implement conditional rendering in `EnvironmentSettingsView.tsx` based on `environment.preset === "personal"` or `isPersonal`.
  - [x] Hide `Members & Governance`, `Invitations`, and `Audit Stream` in Personal Environment.
  - [x] Ensure non-personal presets (`company`, `client`, `experimental`) render enterprise tabs.
  - [x] Verify manually and run monorepo build.

- [x] **PR 2: Environment Switcher UX**
  - [x] Implement auto-focused search field in `WorkspaceSwitcher.tsx`.
  - [x] Implement keyboard navigation (`ArrowUp`, `ArrowDown`, `Enter`, `Escape`).
  - [x] Display rich metadata (badge, preset name, attached projects count).
  - [x] Implement environment ordering (Pinned, Recent, All).
  - [x] Verify manually and run monorepo build.

- [x] **PR 3: Project Scalability**
  - [x] Implement real-time sidebar search filter in `NavigationSidebar.tsx`.
  - [x] Implement compact list mode toggle for dense project display.
  - [x] Implement environment-specific project pinning architecture.
  - [x] Verify manually and run monorepo build.

- [x] **PR 4: Project Management UX**
  - [x] Implement search and sorting in Environment Settings Projects tab.
  - [x] Implement search filter in `AddProjectModal.tsx`.
  - [x] Verify manually and run monorepo build.

---

## 🐛 Resolved Bug Fixes

- [x] **BUG-004: Environment Deletion Failure in Danger Zone**
  - [x] Implement/Fix environment deletion action in `EnvironmentSettingsView.tsx` (Danger Zone tab).
  - [x] Trigger `DELETE /api/v1/workspaces/:id`, refresh store, and fallback active environment to Personal.

- [x] **BUG-005: "Open Project" Button in Projects Tab Navigation**
  - [x] Update `onClick` handler in `EnvironmentSettingsView.tsx` to set `activeProjectId` and navigate to `/workspace/project/:id`.

- [x] **BUG-006: Environment Switcher Project Counts Displaying 0**
  - [x] Update `getProjectCount` in `WorkspaceSwitcher.tsx` to compute project counts per environment across all environments instead of filtering active environment projects only.

- [x] **BUG-007: Sync Changes Button Silent Failure & Git Execution Fix**
  - [x] Restrict non-zero exit code stdout fallback in `GitProvider.ts` strictly to `git diff --no-index`.
  - [x] Ensure `RemoteManager.ts` catches non-interactive credential prompts (`could not read Username`) and surfaces explicit actionable error banners in `ChangesView.tsx`.
  - [x] Verify monorepo build and Git push diagnostics.

---

# Phase 4 — Developer Workstation (Local Engine Hardening) Tasks

- [x] **PR 1: Fault-Tolerant Subprocess & Agent Execution Engine**
  - [x] Implement `ProcessTreeManager` for tracking child process PID trees and `SIGTERM` -> `SIGKILL` cascading shutdown.
  - [x] Implement `AgentCrashRecovery` in `AgentService.ts` to auto-recover session state and prevent restart loops (max 3 retries / 60s).
  - [x] Implement periodic orphan and zombie process sweeper.
  - [x] Verify manually and run monorepo build.

- [x] **PR 2: Hardened Terminal & PTY Streaming with Backpressure Throttling**
  - [x] Implement `TerminalStreamThrottler` for xterm.js output buffer queueing with 16ms frame chunking.
  - [x] Implement cross-platform shell auto-detection (bash, zsh, powershell, wsl).
  - [x] Implement terminal session re-attachment and scroll buffer retention.
  - [x] Verify manually and run monorepo build.

- [x] **PR 3: Hardened Safety & Security Engine (Command AST & Path Traversal)**
  - [x] Implement real-time shell command AST/Regex security scanner in `ApprovalManager.ts`.
  - [x] Implement path traversal guard (`../` sandbox escape protection).
  - [x] Implement command diff preview generator.
  - [x] Verify manually and run monorepo build.

- [x] **PR 4: Git Subsystem Polish & One-Click Commit Generator**
  - [x] Implement `GitStatusService` for real-time status tracking, branch management, and staged/unstaged diff inspection.
  - [x] Implement `✨ Generate Commit` context analyzer for conventional commit messages.
  - [x] Verify manually and run monorepo build.

- [x] **PR 5: Persistent Workspace File Indexer & Symbol Parser**
  - [x] Implement `SymbolIndexer` for fast AST symbol extraction (TS/JS, Python, Go, Rust).
  - [x] Implement workspace file watcher with debounced re-indexing (`chokidar`).
  - [x] Implement token-budget context window builder for agent prompts.
  - [x] Verify manually and run monorepo build.


