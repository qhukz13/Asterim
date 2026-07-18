# Current State of Asterim

This document records the current snapshot of development, recent achievements, and known issues that have been deferred for later. It acts as a bridge between active tasks and the high-level roadmap.

## Recent Work & Achievements

### 1. Developer Workstation Mode (LAN Connectivity)

- **Goal:** Allow developers to run the Asterim UI on a lightweight laptop while the Core runs on a powerful desktop in the same local network.
- **Implementation:** Built dynamic WebSocket and API connection logic (`useSocket` and `useAuth`) that can connect to arbitrary `activeBackendUrl`s instead of just `localhost`.
- **Auth Separation:** Updated the token management to save access tokens keyed by the specific workstation URL (`asterim_token_<url>`) to prevent cross-contamination or looping login prompts when switching between local and remote machines.

### 2. Product Rebranding

- **Achievement:** Successfully migrated the product identity from "AgentDeck" to **Asterim**.
- **Details:** Refactored package names to `@asterim/*`, updated the database directories, renamed environment variables, and aligned the core components to the new brand identity while maintaining stability.

### 3. ESLint & Prettier Standardization

- **Achievement:** Established a global linting and formatting pipeline across the monorepo.
- **Details:** Created a shared `@asterim/eslint-config` Flat Config. Ensured that builds only fail on strict errors and ignore legacy warnings or unused service worker scripts in `dev-dist` and `public`, giving developers an unobstructed CI workflow.

### 4. Terminal Fixes (Interactivity & Windows Support)

- **Interactivity Bug:** Fixed an issue where the TerminalFSM became stuck in a `WAITING_QUESTION` lock state upon receiving unhandled output, allowing developers to type and interact with the terminal manually again.
- **Windows PTY Paths & Spaces:** Addressed severe node-pty `winpty` crashes on Windows by conditionally launching terminals in safe directories (e.g. `USERPROFILE`) with stripped `PATH` quotes and subsequently navigating to project folders via a `cd` command.
- **Session Isolation:** Clearing the chat actively rebuilds the PTY adapter, guaranteeing a clean scrollback buffer.

### 5. Repository Cleanup

- **Achievement:** Cleaned up the root directory of the monorepo.
- **Details:** Moved scattered test scripts and scratch files into `scripts/sandbox/` to improve project organization and maintain a tidy root space.

## Known Issues & Deferred Tasks

### 1. Workstation Discovery (mDNS)

- **Status:** Deferred.
- **Issue:** The `mDNS` zero-configuration protocol is currently not successfully discovering the main workstation from the laptop. Users must manually type the IP address (`192.168.x.x:5173`) to connect. We are leaving this "as is" for now.

### 2. Workstation Authentication UX

- **Status:** Deferred.
- **Issue:** Users still find the workflow of entering a PIN code for each new workstation switch slightly inconvenient. While the cross-contamination bugs are fixed, the fundamental UX of the handoff is functional but raw.

## Next Steps

- Proceed with remaining tasks on the ROADMAP (e.g., Agent Auto-Restart, Hardened Approval Regex, or CI Pipeline setup).
