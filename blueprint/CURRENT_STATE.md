# Current State of Asterim

This document records the current snapshot of development, recent achievements, and known issues that have been deferred for later. It acts as a bridge between active tasks and the high-level roadmap.

## 🚨 CRITICAL BUGS (High Priority for Tomorrow)

### 1. Project Switching Regression (P0)

- **Status:** **FIXED** (2026-07-24)
- **Root Cause:** `NavigationSidebar` and `App.tsx` were calling `setActiveProject()` on Zustand directly without updating the URL. Since `RouterSync` is now URL-first, it immediately overwrote the Zustand state back to the old project from the stale URL params, causing the bounce-back.
- **Fix:** All project navigation now goes through `setLocation('/workspace/project/{id}')`. `RouterSync` also handles the root route (`/`) by clearing `activeProjectId` when no route matches.

## Phase 1 Status

- **Status:** **100% COMPLETE** (2026-08-06)
- **Summary:** All Phase 1 Product UX deliverables (Workspace Shell, Design System, Command Palette, Terminal & Chat UX, Dashboard, and Readability Pass) have been completed, audited, and verified against production builds and automated E2E tests.

## Recent Work & Achievements

### 1. Phase 1 — Product UX & Readability Overhaul (PR1–PR7.5)

- **Goal:** Redesign Asterim into a high-density, professional developer interface matching commercial standards (Linear, Cursor, Raycast).
- **Deliverables Completed:**
  - **Structured Workspace Shell**: 3-column layout with collapsible `NavigationSidebar`, `SessionSidebar`, `TopBar`, and `Inspector`.
  - **Component Design System & Tokens**: Elevated HSL surface stack, 20px thread title focal anchors, 15px body text (1.55 line height), 42px primary buttons, 48px input command bar, and 40px workspace navigation tabs.
  - **Monospace Code Stack**: `JetBrains Mono` code rendering across chat blocks, inline diff previews, and PTY terminal stream.
  - **Linear-Style Command Palette (`Cmd+K`)**: Global keyboard launcher for rapid navigation, git operations, and thread switching.
  - **Project & Mission Dashboard**: Consolidated view of active projects, thread execution states, and recent activity.

### 2. Terminal & Agent Output Pipeline Hardening

- **ECMA-48 ANSI Escape Stripping**: Updated ANSI regex parsing in `TerminalFSM.ts` to `/\x1B(?:[@-Z\\-_]|\[[0-9?]*[ -/]*[@-~])/g`, preventing hidden ANSI residue from stalling state transitions.
- **TUI Frame-Based Prompt Detection**: Refined user prompt boundary extraction in `extractLastResponse` to require TUI divider framing (`─────`), preventing markdown blockquotes (`> Note:...`) or shell commands from truncating responses.
- **Chat Clear Isolation (`/clear`)**: Added `isClearing` flag handling so executing `/clear` transitions to `Idle` silently without re-emitting CLI banners or previous history into the chat.
- **Output Artifact Cleaning**: Added regex filtering for braille spinners (`⣾`, `⠋`), tool headers (`● ReadFile...`), thought titles (`▸ Thought`), and box drawing characters.
- **Message ID Lifecycle**: Reset `currentMessageId` upon turn completion in `AntigravityParser.ts`, preventing new responses from overwriting previous ones.

### 3. Developer Workstation Mode (LAN Connectivity)

- **Goal:** Allow developers to run the Asterim UI on a lightweight laptop while the Core runs on a powerful desktop in the same local network.
- **Implementation:** Built dynamic WebSocket and API connection logic (`useSocket` and `useAuth`) that can connect to arbitrary `activeBackendUrl`s instead of just `localhost`.
- **Auth Separation:** Updated token management to save access tokens keyed by workstation URL (`asterim_token_<url>`), preventing login loops during machine switching.

### 4. Product Rebranding

- **Achievement:** Migrated product identity from "AgentDeck" to **Asterim**.
- **Details:** Refactored package names to `@asterim/*`, updated database directories, renamed environment variables, and aligned core components.

### 5. ESLint & Prettier Standardization

- **Achievement:** Established a global linting and formatting pipeline across the monorepo.
- **Details:** Created a shared `@asterim/eslint-config` Flat Config, ensuring builds fail only on strict errors and ignore legacy warnings.

## Known Issues & Deferred Tasks

### 1. Workstation Discovery (mDNS)

- **Status:** Deferred.
- **Issue:** The `mDNS` zero-configuration protocol is currently not successfully discovering the main workstation from the laptop. Users must manually type the IP address (`192.168.x.x:5173`) to connect.

### 2. Workstation Authentication UX

- **Status:** Deferred.
- **Issue:** Manual PIN entry during workstation switching is functional but can be further streamlined in future iterations.

## Next Steps

- Begin **Phase 2 — Authentication** on the Roadmap (Auth backend services, JWT token rotation, protected API/WebSocket routes, user login/registration screens, and machine-to-machine API key management).
