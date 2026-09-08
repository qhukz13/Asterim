# Asterim Phase 4.5 — Marketing Content & Implementation Truth Contract

**Document Version**: 1.0.0 — SOURCE OF TRUTH FOR MARKETING CLAIMS  
**Author**: CTO & Product Architect  
**Date**: August 11, 2026  
**Status**: Normative Contract  
**Target Platform**: `@asterim/marketing` (`asterim.dev`)  

---

## 1. Executive Rule & Purpose

The marketing website (`asterim.dev`) is the commercial face of Asterim. Under no circumstances shall the website advertise functionality as live, operational, or available if it does not exist in the current codebase (`apps/server`, `apps/web`, `@asterim/adapters`, `@asterim/shared`).

Every public product claim must be backed by empirical implementation evidence in the repository. Unreleased roadmap features must be explicitly tagged with their respective release phases (`BETA`, `PHASE 5`, `PLANNED`).

---

## 2. Classification Matrix

Capabilities are strictly classified into 6 categories:

| Status Tag | Definition | Marketing Presentation Rule |
| :--- | :--- | :--- |
| **AVAILABLE NOW** | Fully implemented, tested, and active in the codebase. | Highlight as core operational feature. |
| **PARTIAL** | Core mechanics exist, but full UX or sub-feature set is in progress. | Present exact scope; do not claim completeness. |
| **BETA** | Functional for early testing, but undergoing active refinement. | Mark explicitly with a **BETA** badge. |
| **PHASE 5** | Scheduled for Phase 5 (SaaS Foundation & Public Beta). | Mark explicitly as **Phase 5 Cloud Feature**. |
| **PLANNED** | Scheduled for Phase 6+ (AI Ecosystem, Extensions, Enterprise). | Reference in long-term roadmap only. |
| **NOT IMPLEMENTED** | Concept defined in specification, zero implementation exists. | **STRICTLY FORBIDDEN** from public feature lists. |

---

## 3. Comprehensive Subsystem Audit & Truth Table

### 3.1 Subprocess Execution & Engine Hardening

| Feature / Claim | Status | Implementation Evidence | Marketing Copy Rule |
| :--- | :--- | :--- | :--- |
| **Fault-Tolerant Subprocess Lifecycle** | **AVAILABLE NOW** | `apps/server/src/services/ProcessTreeManager.ts`<br>`apps/server/src/services/AgentService.ts` | Describe process tree tracking and `SIGTERM` -> `SIGKILL` cascading shutdown. |
| **Agent Crash Recovery** | **AVAILABLE NOW** | `AgentCrashRecovery` in `AgentService.ts` | Highlight exponential backoff recovery (max 3 retries in 60s) for agent sessions. |
| **Zombie & Orphan Process Sweeper** | **AVAILABLE NOW** | `ProcessTreeManager.ts` periodic cleanup | Mention automatic process garbage collection on workspace switch or app shutdown. |

---

### 3.2 Security, Command Parsing & Safety Sandbox

| Feature / Claim | Status | Implementation Evidence | Marketing Copy Rule |
| :--- | :--- | :--- | :--- |
| **Real-time Shell Command AST Scanner** | **AVAILABLE NOW** | `apps/server/src/services/ApprovalManager.ts` | Highlight real-time regex/AST parsing for dangerous commands (`rm -rf /`, `dd`, `chmod 777`). |
| **Path Traversal Sandbox Guard** | **AVAILABLE NOW** | `ApprovalManager.ts` path validator | Explain strict sandbox isolation preventing agents from mutating files outside workspace root. |
| **Interactive Mutation Diff Preview** | **AVAILABLE NOW** | `ApprovalManager.ts`, `apps/web/src/components/approval/` | Highlight file diff visual inspection before approving command execution. |

---

### 3.3 Terminal & PTY Streaming

| Feature / Claim | Status | Implementation Evidence | Marketing Copy Rule |
| :--- | :--- | :--- | :--- |
| **Backpressure Throttled PTY Output** | **AVAILABLE NOW** | `apps/web/src/components/terminal/TerminalView.tsx`, `TerminalService.ts` | Showcase zero UI freezing during 10,000+ line/s terminal output streaming via 16ms frame chunking. |
| **Cross-Platform Shell Auto-Detection** | **AVAILABLE NOW** | `apps/server/src/services/TerminalService.ts` | Highlight native shell support (bash/zsh on macOS/Linux, PowerShell & WSL on Windows). |

---

### 3.4 Multi-Environment Isolation System

| Feature / Claim | Status | Implementation Evidence | Marketing Copy Rule |
| :--- | :--- | :--- | :--- |
| **Environment Presets (Personal, Company, Client, Experimental)** | **AVAILABLE NOW** | `apps/web/src/components/environment/EnvironmentSettingsView.tsx`, `WorkspaceStore.ts` | Explain isolation of agent credentials, skills, projects, and UI tabs per environment. |
| **Personal Environment Simplified UX** | **AVAILABLE NOW** | `EnvironmentSettingsView.tsx` (conditional rendering) | Explain how single developers get a streamlined UI hiding enterprise governance noise. |
| **Environment Switcher Keyboard Search** | **AVAILABLE NOW** | `apps/web/src/components/environment/WorkspaceSwitcher.tsx` | Showcase quick environment switching with auto-focused keyboard search & project counts. |

---

### 3.5 Git Subsystem & AI Commit Generator

| Feature / Claim | Status | Implementation Evidence | Marketing Copy Rule |
| :--- | :--- | :--- | :--- |
| **Real-Time Git Status & Branch Control** | **AVAILABLE NOW** | `apps/server/src/services/git/GitService.ts`, `GitStatusService.ts` | Highlight instant git status tracking, branch management, and staged/unstaged diff inspector. |
| **`✨ Generate Commit` Engine** | **AVAILABLE NOW** | `GitService.ts`, `apps/web/src/components/git/ChangesView.tsx` | Highlight one-click conventional commit message generation using local git diff context. |

---

### 3.6 Workspace Context Indexer & Symbol Parsing

| Feature / Claim | Status | Implementation Evidence | Marketing Copy Rule |
| :--- | :--- | :--- | :--- |
| **AST Symbol Extraction (TS/JS, Python, Go, Rust)** | **AVAILABLE NOW** | `apps/server/src/services/SymbolIndexer.ts`, `ContextService.ts` | Explain workspace symbol parsing and token-budget context window assembly for prompts. |
| **Debounced File Watcher** | **AVAILABLE NOW** | `chokidar` integration in `SymbolIndexer.ts` | Highlight background file index synchronization without CPU spikes. |

---

### 3.7 Authentication, Account Portal & Identity

| Feature / Claim | Status | Implementation Evidence | Marketing Copy Rule |
| :--- | :--- | :--- | :--- |
| **Central Web Account Registration & Auth** | **AVAILABLE NOW** | `/api/v1/auth/*`, `apps/marketing/src/pages/Login.tsx` & `Register.tsx` | Explain central identity creation on `asterim.dev` separate from local execution. |
| **Session & Device Management** | **AVAILABLE NOW** | `/api/v1/sessions`, `/api/v1/devices`, `apps/marketing/src/components/AccountLayout.tsx` | Highlight remote session listing, active device tracking, and single-click remote logout. |
| **Machine-to-Machine API Keys** | **AVAILABLE NOW** | `/api/v1/apikeys`, `AccountLayout.tsx` | Explain token creation for CLI integration and external service adapters. |

---

### 3.8 Cloud Relay, Remote Sync & Mobile Monitoring

| Feature / Claim | Status | Implementation Evidence | Marketing Copy Rule |
| :--- | :--- | :--- | :--- |
| **Web Workspace Management** | **BETA** | `apps/web` client accessible locally or via web port | Present as Web Workspace Control (Beta). |
| **Cloud Relay WebSocket Tunneling** | **PHASE 5** | Prototype in `apps/relay`; production infrastructure in Phase 5 | **MUST BE TAGGED AS PHASE 5 BETA**. Do NOT claim live public relay service. |
| **Mobile Push Approvals & Native PWA** | **PHASE 5** | PWA manifest configured; push relay in Phase 5 | **MUST BE TAGGED AS PHASE 5 BETA**. Do NOT claim live iOS/Android mobile apps. |

---

### 3.9 Monetization, Billing & Enterprise Extensions

| Feature / Claim | Status | Implementation Evidence | Marketing Copy Rule |
| :--- | :--- | :--- | :--- |
| **Pricing Tiers (Community, Pro, Enterprise)** | **AVAILABLE NOW (STATIC INFO)** | `blueprint/BUSINESS.md` specification | Present plan breakdown as static product information. Do NOT attempt live Stripe checkout. |
| **Stripe / LemonSqueezy Payments Backend** | **NOT IMPLEMENTED** | Deferred to Phase 5 SaaS implementation | **NO LIVE PAYMENT CHECKOUT**. Display "Join Public Beta / Reserve Spot" CTAs instead. |
| **In-App Graphical MCP Marketplace** | **PLANNED** | Scheduled for Phase 6 | Mention MCP environment variable support today; highlight visual marketplace as Phase 6. |
| **Extension SDK & Marketplace** | **PLANNED** | Scheduled for Phase 7 | Mention as long-term extensibility vision only. |

---

## 4. Marketing Copywriting Directives

1. **Local-First Core**: Always present the local engine as **100% free, MIT open-core, and operational fully offline**.
2. **No Fake Screenshots**: All product UI preview components must strictly model actual Asterim workspace components (`WorkspaceShell`, `TerminalView`, `EnvironmentSettingsView`, `GitInspectorView`).
3. **Transparent Cloud Boundaries**: Clearly communicate that code and repository contents reside on the local workstation, with cloud infrastructure serving solely for identity, device management, and optional remote tunnels.
