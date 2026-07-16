# AgentDeck Tasks

This file is the single source of truth for project progress.



## TODO

- **TSK-033**: Implement Parallel Agent Execution & Multiple Chats
  - *Description*: Update database schema and UI to support running multiple agents simultaneously in the same project. (e.g., Aider executing tasks while Claude orchestrates and Antigravity writes code). Allow users to switch between these parallel chat threads easily.
  - *Priority*: High
  - *Status*: TODO

- **TSK-032**: Advanced File Viewer and Git Diff UI
  - *Description*: Build a dedicated file explorer component and a robust split-pane (or unified) Git diff viewer. Allow users to easily review changes before approving commands.
  - *Priority*: High
  - *Status*: TODO

- **TSK-031**: Full Terminal Support / Redesign
  - *Description*: The current terminal tab does not work. Either completely replace it with a fully functional standalone terminal (e.g., using `xterm.js` and `node-pty` for direct bash access) or remove it if deemed unnecessary. If kept, it must allow manual user input and full shell interaction.
  - *Priority*: Critical
  - *Status*: TODO

- **TSK-030**: Subscription Tiers & License Verification
  - *Description*: Implement the licensing model (Community, Pro, Enterprise). Users will register and purchase subscriptions on the website. The local AgentDeck app will prompt users to log in, checking their subscription status to unlock Cloud Relay, Push Notifications, and Sync capabilities for Pro/Enterprise users.
  - *Priority*: High
  - *Status*: TODO

- **TSK-029**: UI Redesign (Global Dashboard & Project Sidebar)
  - *Description*: Overhaul the application layout. The root page should display general info/User Profile. Move the project selector into a persistent collapsible sidebar for quick switching.
  - *Priority*: High
  - *Status*: TODO

## IN PROGRESS

(None)

## DONE

- **TSK-028**: Fix Antigravity PTY Syncing and Message Drop Bugs
  - *Description*: The Antigravity adapter is currently failing to emit messages to the chat after the initial startup. Further investigation is required to stabilize the PTY parsing pipeline, handle LLM output chunking gracefully, and ensure reliable two-way message flow without freezing the UI in a "WORKING" state.
  - *Priority*: Critical
  - *Dependencies*: None
  - *Status*: DONE


- **TSK-027**: Chat UI Overhaul & Antigravity Adapter Setup
  - *Description*: Redesigned the sidebar navigation (tabs to segmented controls) and chat layout. Styled chat bubbles with responsive max-widths, user/agent alignment, drop shadows, and typing animations. Repositioned the Clear Chat button and added a global "Restart Agent" control. Addressed `node-pty` ANSI escape code parsing to clean up terminal artifacts like cursor movement scrambling, history leaks, and Windows newline truncation.
  - *Priority*: High
  - *Status*: DONE

- **TSK-026**: P0-011 — SECURITY.md + README Installation Guide
  - *Description*: Created SECURITY.md specifying pairing protocols and vulnerability disclosure guidelines. Overwrote README.md detailing complete PATH requirements, compiler pre-requisites (node-gyp, VC++ tools), QR onboarding instructions, and embedded a mockup dashboard diagram asset.
  - *Priority*: High
  - *Blocker resolved*: BLK-013, BLK-014
  - *Status*: DONE

- **TSK-025**: P0-005 — Launch Wizard (First-Run Setup + QR Code)
  - *Description*: Added console setup splash and path audit checks for Claude Code and Aider, QR pairing codes using qrcode-terminal with auto-pairing parameter support on the frontend, and an onboarding Web UI tour to pick default agent setups.
  - *Priority*: Critical
  - *Blocker resolved*: GitHub Release UX
  - *Status*: DONE

- **TSK-024**: P0-004 — Session Recovery After Server Crash
  - *Description*: Added SQLite sessions/approvals persistence, added getPid/onExit to adapters/shared interfaces, and implemented startup recovery logic to clear running sessions (marking them crashed) and republish pending approvals.
  - *Priority*: Critical
  - *Blocker resolved*: BLK-006
  - *Status*: DONE

- **TSK-023**: P0-002 — Authentication Layer (Fastify + Socket.IO middleware)
  - *Description*: Implemented authentication middleware using JWT-like HMAC signatures for Fastify REST endpoints and Socket.IO connections. Secured all REST routes (except pairing) and Socket.IO namespace handshakes. Added auto-redirects/reloads on client auth failures.
  - *Priority*: Critical
  - *Blocker resolved*: BLK-001, BLK-003
  - *Status*: DONE

- **TSK-022**: P0-001 — Device Pairing System (PIN + Session Token)
  - *Description*: Created PairingService which generates secure 6-digit PINs on server startup and manages DB-persisted HMAC session secrets. Implemented a pairing screen UI in the client, remote connect PIN support, and LAN/CORS allowance for all private network subnets.
  - *Priority*: Critical
  - *Blocker resolved*: BLK-001, BLK-002
  - *Status*: DONE

- **TSK-021**: P0-010 — Integrate ApprovalManager into Adapter Flow
  - *Description*: Refactored `IAgentAdapter` to accept a promise-based `requestApproval` callback in `AgentConfig`. Updated `AiderAdapter` and `ClaudeAdapter` to await this callback instead of manually managing approval state. Updated `AgentService` to inject `ApprovalManager.requestApproval` into the adapters. This decouples the adapters from the EventBus approval response handling and ensures proper timeouts.
  - *Priority*: Critical
  - *Blocker resolved*: BLK-006
  - *Status*: DONE

- **TSK-020**: P0-009 — Create PWA Icons
  - *Description*: Generated the AgentDeck app icon and created `pwa-192x192.png`, `pwa-512x512.png`, and `apple-touch-icon.png` in the `apps/web/public` directory. Updated `sw.js` to reference the new icons instead of `vite.svg`. Added meta tags for `apple-touch-icon` and `favicon` to `index.html`. Web build passes and PWA manifest correctly bundles the icons.
  - *Priority*: Critical
  - *Blocker resolved*: BLK-009
  - *Status*: DONE

- **TSK-019**: P0-008 — Make Relay URL Configurable
  - *Description*: `RelayClient.ts` now reads `AGENTDECK_RELAY_URL` env var (defaults to `localhost:4000`). Exposed `relayUrl` on the class and via `/api/v1/system`. `useSocket.ts` now accepts `relayUrl` as explicit second parameter (removes global hack). `ProjectSelector.tsx` fetches and stores `relayUrl` from system API, passes it through `onSelect`. `App.tsx` threads it to `Dashboard` → `useSocket`. Created `.env.example` documenting all env vars.
  - *Priority*: Critical
  - *Blocker resolved*: BLK-004
  - *Status*: DONE

- **TSK-018**: P0-003 — Event Persistence & DB Log Pruning
  - *Description*: Created `PruningService.ts`. On server start, prunes all events older than 7 days. Repeats every hour. Also enforces a 50,000-event cap per project (trims to 25,000 on breach). Wired into `index.ts` `start()`. SQL logic verified with a standalone test.
  - *Priority*: Critical
  - *Blocker resolved*: BLK-008
  - *Status*: DONE

- **TSK-017**: P0-007 — Fix E2E Relay Stale Closure
  - *Description*: Replaced `useState<CryptoKey>` with `useRef` in `useSocket.ts`. All event handlers now read `sharedSecretRef.current` (always live) instead of the stale closure value (always null). Also migrated socket to `socketRef` so `sendInternalEvent` doesn't need the socket in its dependency array. Added `connectedRef` for the same reason. Relay mode E2E decryption and send are now functionally correct.
  - *Priority*: Critical
  - *Blocker resolved*: BLK-005
  - *Status*: DONE

- **TSK-016**: P0-006 — Fix Database Path
  - *Description*: Changed DB path from `process.cwd()/agentdeck.db` to `~/.agentdeck/agentdeck.db`. Added `AGENTDECK_DATA_DIR` env var override. Created root `.gitignore` to exclude `*.db` files. DB path is now deterministic regardless of launch directory.
  - *Priority*: Critical
  - *Blocker resolved*: BLK-007
  - *Status*: DONE

- **TSK-015**: Mobile UI Optimization
  - *Description*: Update the dashboard to be fully mobile-responsive.
  - *Priority*: High
  - *Dependencies*: TSK-006
  - *Status*: DONE


- **TSK-010**: Implement Aider adapter
  - *Description*: Create the adapter to interface with the Aider CLI tool.
  - *Priority*: High
  - *Dependencies*: TSK-004, TSK-003
  - *Status*: DONE
- **TSK-011**: Implement Claude Code adapter
  - *Description*: Create the adapter to interface with Claude Code.
  - *Priority*: Medium
  - *Dependencies*: TSK-004, TSK-003
  - *Status*: DONE

- **TSK-013**: Approval System
  - *Description*: Mechanism to pause agent execution and request client approval.
  - *Priority*: High
  - *Dependencies*: TSK-004, TSK-005
  - *Status*: DONE

- **TSK-012**: Git monitoring module
  - *Description*: Watch local git repositories for changes and diffs.
  - *Priority*: Medium
  - *Dependencies*: TSK-004
  - *Status*: DONE

- **TSK-014**: Project Management API
  - *Description*: Endpoints to list, add, and remove projects.
  - *Priority*: Medium
  - *Dependencies*: TSK-002
  - *Status*: DONE

- **TSK-006**: Basic dashboard
  - *Description*: Scaffold the React frontend for the control center.
  - *Priority*: High
  - *Dependencies*: TSK-005
  - *Status*: DONE

- **TSK-005**: Websocket communication
  - *Description*: Set up Socket.IO server and client connection logic.
  - *Priority*: High
  - *Dependencies*: TSK-004
  - *Status*: DONE

- **TSK-004**: Event bus
  - *Description*: Implement the internal pub/sub event system.
  - *Priority*: High
  - *Dependencies*: TSK-003
  - *Status*: DONE

- **TSK-003**: Shared types
  - *Description*: Define the core TypeScript interfaces (Events, Adapters, Project state) in a shared package.
  - *Priority*: High
  - *Dependencies*: TSK-002
  - *Status*: DONE

- **TSK-002**: Monorepo setup
  - *Description*: Initialize the monorepo using standard tooling (e.g., pnpm workspaces, Turbo).
  - *Priority*: High
  - *Dependencies*: TSK-001
  - *Status*: DONE
- **TSK-001**: Documentation
  - *Description*: Create foundational architecture, roadmap, decisions, and tasks documents.
  - *Priority*: Critical
  - *Dependencies*: None
  - *Status*: DONE
