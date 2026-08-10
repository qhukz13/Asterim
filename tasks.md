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

- [x] **BUG-007: Sync Changes Button Execution & Status Synchronization Failure**
  - [x] Investigate Git subprocess execution, authentication handling, and state synchronization in `GitService.ts`, `RemoteManager.ts`, and `ChangesView.tsx`.
  - [x] Fix Sync Changes button behavior, resolve polling error erasure, add remote status validation, and introduce Connect GitHub / Remote URL configuration modal.

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

---

# Phase 4.5 — Marketing Website & Product Presentation Refinement Tasks

- [x] **PR 0: Marketing Truth & Content Contract Audit**
  - [x] Create `docs/phase4-5-content-truth.md` auditing codebase capabilities into 6 categories (AVAILABLE NOW, PARTIAL, BETA, PHASE 5, PLANNED, NOT IMPLEMENTED).
  - [x] Create `docs/phase4-5-legal-checklist.md` establishing public release legal readiness framework.
  - [x] Update `docs/phase4-5-roadmap.md`, `decisions.md`, `tasks.md`, `blueprint/ROADMAP.md`.

- [x] **PR 1: Marketing Router Architecture, Navigation & Layout Shell**
  - [x] Implement client-side route matcher in `App.tsx` for `/`, `/pricing`, `/docs`, `/download`, `/account/*`.
  - [x] Implement active path states and GitHub star counter link in `Navbar.tsx`.
  - [x] Create `Footer.tsx` multi-column layout component with legal links (`/privacy`, `/terms`, `/security`).
  - [x] Create `MobileNavDrawer.tsx` responsive drawer component.
  - [x] Update `index.html` with title, meta tags, Google Fonts (`Inter`, `JetBrains Mono`).
  - [x] Clean up unused Vite template styles in `App.css`.

- [x] **PR 2: Homepage Hero & "Why Asterim?" Positioning Section**
  - [x] Create `HeroSection.tsx` with headline, subhead, status badge, and primary CTAs.
  - [x] Create `WhyAsterimSection.tsx` communicating 30-second product story & control plane differentiation.
  - [x] Create `TerminalCopyBlock.tsx` for interactive `$ npm install -g asterim` snippet.

- [x] **PR 3: Interactive Product Demonstration Components**
  - [x] Create `InteractiveProductDemo.tsx` tabbed live preview component modeling real Asterim app states (`apps/web`).
  - [x] Create `AgentStreamTab.tsx` PTY output streaming preview with 16ms backpressure throttling.
  - [x] Create `SecurityGuardTab.tsx` command AST approval & diff inspector preview.
  - [x] Create `EnvironmentTab.tsx` isolated environment switcher preview (Personal, Company, Client).
  - [x] Create `MobileTunnelTab.tsx` remote tunnel & mobile monitoring status preview.

- [x] **PR 4: Problem/Solution, Core Capabilities & Platform Matrix**
  - [x] Create `ProblemSolutionSection.tsx` comparing agent chaos vs Asterim control plane.
  - [x] Create `CapabilitiesGrid.tsx` visual cards for the 5 core product pillars.
  - [x] Create `PlatformMatrixSection.tsx` detailing Desktop (Available Now), Web (Beta), and Mobile (Phase 5).
  - [x] Create `OpenSourceSection.tsx` highlighting local-first and MIT core philosophy.

- [x] **PR 5: Dedicated Pages: Pricing, Download & Lightweight Docs**
  - [x] Create `PricingPage.tsx` with static Community vs Pro vs Enterprise comparison table (presentation only).
  - [x] Create `DownloadPage.tsx` with OS support matrix and CLI instructions.
  - [x] Create `DocsPage.tsx` lightweight documentation viewer covering 8 core guides (Quickstart, What is Asterim?, Environments, AI Agents, Security, MCP & Skills, Architecture, CLI).

- [ ] **PR 6: Responsive UX, Mobile Polish & Accessibility Audit**
  - [ ] Refine mobile CSS media queries in `index.css`.
  - [ ] Audit ARIA attributes, touch targets, and keyboard navigation.

- [ ] **PR 7: Final Polish, Production Verification & Build Validation**
  - [ ] Run end-to-end production build (`pnpm --filter @asterim/marketing build`).
  - [ ] Verify 0 TypeScript/ESLint errors across marketing app.

---

# Phase 5 — SaaS Foundation & Beta Release Tasks

- [ ] **PR 1: Zero-Friction Git Credentials & SSH Auto-Detection**
  - [ ] Implement `SSH_AUTH_SOCK` socket auto-discovery and inheritance in `GitProvider.ts`.
  - [ ] Implement global `credential.helper` resolution and non-interactive Git credential provider integration.
  - [ ] Implement automatic silent retry & format conversion (HTTPS <-> SSH) on initial push failure.




