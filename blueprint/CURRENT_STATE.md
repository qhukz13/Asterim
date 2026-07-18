# Current State of Asterim

This document records the current snapshot of development, recent achievements, and known issues that have been deferred for later. It acts as a bridge between active tasks and the high-level roadmap.

## Recent Work & Achievements

### 1. Developer Workstation Mode (LAN Connectivity)
- **Goal:** Allow developers to run the Asterim UI on a lightweight laptop while the Core runs on a powerful desktop in the same local network.
- **Implementation:** Built dynamic WebSocket and API connection logic (`useSocket` and `useAuth`) that can connect to arbitrary `activeBackendUrl`s instead of just `localhost`.
- **Auth Separation:** Updated the token management to save access tokens keyed by the specific workstation URL (`asterim_token_<url>`) to prevent cross-contamination or looping login prompts when switching between local and remote machines.

### 2. Terminal State Machine Stability (TerminalFSM)
- **Bug Fixed:** "Stuck in working mode" / "Repeating previous messages".
- **Root Cause:** The `TerminalFSM` was prematurely concluding that the agent was `Idle` due to slow start times from `Antigravity` CLI, and extracting the previous response from the terminal scrollback buffer. Furthermore, the FSM failed to detect the `❯ ` prompt because the Antigravity TUI prints a fixed horizontal divider and a Gemini status footer that blocked the FSM's bottom-up scan.
- **Resolution:** 
  - Implemented `hasSeenWorkingIndicator` to strictly enforce that the agent must enter a working state before it is allowed to become idle.
  - Rewrote the idle prompt scanner to search upwards through the last 10 non-empty lines, successfully bypassing the TUI dividers and footer.

### 3. Session Isolation
- **Bug Fixed:** Clearing the chat did not clear the underlying PTY terminal buffer, causing old scrollback to confuse the FSM on the next interaction.
- **Resolution:** Modified `client.clear_chat` in `AgentService.ts` to actively kill and rebuild the adapter, ensuring a 100% clean terminal session.

## Known Issues & Deferred Tasks

### 1. Workstation Discovery (mDNS)
- **Status:** Deferred.
- **Issue:** The `mDNS` zero-configuration protocol is currently not successfully discovering the main workstation from the laptop. Users must manually type the IP address (`192.168.x.x:5173`) to connect. We are leaving this "as is" for now.

### 2. Workstation Authentication UX
- **Status:** Deferred.
- **Issue:** Users still find the workflow of entering a PIN code for each new workstation switch slightly inconvenient. While the cross-contamination bugs are fixed, the fundamental UX of the handoff is functional but raw.

## Next Steps
- Consult the user or Product Roadmap for the next feature priority, given that Workstation improvements are currently paused.
