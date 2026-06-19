# AgentDeck — Production Backlog

**Date:** 2026-06-19  
**Source:** Launch readiness audit, golden loop verification, and release blockers analysis  
**Process:** Items are drawn directly from verified code gaps — not assumed

> Items marked 🔒 are prerequisites for public release (see `release-blockers.md`).  
> Work is executed strictly in P0 → P1 → P2 order.

---

## P0 — Critical (Blocks Release)

Items in this tier prevent any meaningful public release. They represent security holes, broken core features, or data integrity problems.

---

### P0-001: Device Pairing System 🔒

**Status:** Not Started  
**Blocks:** BLK-001, BLK-002  
**Description:** No device can be trusted without a pairing mechanism. Currently any device on the local network has full control of the server.

**Requirements:**
- Server generates a 6-digit PIN on startup, displayed in console and UI
- PIN entry screen in the web UI before any project can be accessed
- Server issues a signed session token (HMAC-SHA256 of `pin + timestamp + randomBytes`) on correct PIN entry
- Token stored in `localStorage`, sent as `Authorization: Bearer <token>` header on HTTP requests and as a handshake auth on Socket.IO connection
- Token expires after 30 days; renewal is automatic on active sessions
- Server stores trusted tokens in `settings` table with expiry timestamp
- QR code encodes `agentdeck://pair?host=<ip>&port=3000&pin=<pin>` for mobile convenience

**Files to create/modify:**
- `NEW` `apps/server/src/services/PairingService.ts`
- `NEW` `apps/server/src/middleware/authMiddleware.ts`
- `MODIFY` `apps/server/src/index.ts` — register auth middleware
- `MODIFY` `apps/server/src/sockets/socketManager.ts` — validate token on connection
- `MODIFY` `apps/web/src/ProjectSelector.tsx` — add pairing/PIN entry screen
- `MODIFY` `apps/web/src/hooks/useSocket.ts` — attach token to Socket.IO handshake

---

### P0-002: Authentication Layer 🔒

**Status:** Not Started  
**Blocks:** BLK-001, BLK-003  
**Description:** All API endpoints and WebSocket connections must be authenticated. CORS must be restricted.

**Requirements:**
- Fastify `preHandler` hook validates Bearer token on all `/api/v1/*` routes
- Socket.IO `io.use()` middleware validates token in `socket.handshake.auth.token`
- Unauthenticated connections receive `401` HTTP or `disconnect` with `reason: 'unauthorized'`
- CORS origin restricted to `null` (direct access) and any configured relay domain
- Rate limiting: 10 failed auth attempts per IP per 15 minutes → temporary ban

**Files to create/modify:**
- `NEW` `apps/server/src/middleware/authMiddleware.ts`
- `MODIFY` `apps/server/src/index.ts` — CORS config, middleware registration
- `MODIFY` `apps/server/src/sockets/socketManager.ts` — Socket.IO auth middleware
- `MODIFY` `apps/server/src/routes/projects.ts` — apply auth preHandler
- `MODIFY` `apps/server/src/routes/system.ts` — apply auth preHandler

---

### P0-003: Event Persistence & Log Pruning 🔒

**Status:** Partial (storage works, pruning missing)  
**Blocks:** BLK-008  
**Description:** Events are stored but the table grows unboundedly. Over 24 hours of active use, the DB will be hundreds of MB.

**Requirements:**
- On startup: prune events older than 7 days per project
- Periodic pruning every hour: `DELETE FROM events WHERE timestamp < now - 7days`
- Per-project soft cap: if a project exceeds 50,000 events, prune oldest 25,000
- DB path fixed to `~/.agentdeck/agentdeck.db` (resolves BLK-007)
- Add `AGENTDECK_DB_PATH` environment variable override
- Add migration: `ALTER TABLE events ADD COLUMN pruned INTEGER DEFAULT 0` for soft-delete option

**Files to create/modify:**
- `MODIFY` `apps/server/src/services/DatabaseService.ts` — fix path, add pruning methods
- `NEW` `apps/server/src/services/PruningService.ts` — scheduled pruning job

---

### P0-004: Session Recovery After Crash 🔒

**Status:** Not Started  
**Blocks:** BLK-006  
**Description:** Server restart or crash loses all active agent sessions and pending approvals silently.

**Requirements:**
- New `sessions` table: `(id, project_id, agent_type, status, pid, started_at, updated_at)`
- `AgentService.startAgent()` writes session record with status `running`
- `AgentService.stopAgent()` updates session record to status `stopped`
- On PTY `onExit`, update session to status `crashed` or `exited`
- On server startup: query sessions with status `running` → emit `agent.status: error` event for each → user sees agent crashed on reconnect
- New `approvals` table: `(id, project_id, action_id, description, command, status, created_at)` — status: `pending | approved | denied | expired`
- `ApprovalManager.requestApproval()` writes to `approvals` table
- On server startup: republish any `pending` approvals to EventBus

**Files to create/modify:**
- `MODIFY` `apps/server/src/services/DatabaseService.ts` — add sessions and approvals tables
- `MODIFY` `apps/server/src/services/AgentService.ts` — persist session state
- `MODIFY` `apps/server/src/services/ApprovalManager.ts` — persist approvals, integrate into adapter flow
- `MODIFY` `apps/server/src/index.ts` — call recovery logic on startup

---

### P0-005: Launch Wizard (First-Run Setup) 🔒

**Status:** Not Started  
**Blocks:** BLK-013 (partial), GitHub Release UX  
**Description:** A new user running `agentdeck` for the first time has no guidance. The server starts but the user doesn't know what to do next.

**Requirements:**
- On first run (no settings in DB), display setup wizard to console:
  ```
  ╔═══════════════════════════════════════╗
  ║       Welcome to AgentDeck v0.1       ║
  ║  Your AI Agent Control Plane is ready ║
  ╠═══════════════════════════════════════╣
  ║  Dashboard: http://localhost:3000     ║
  ║  Pairing PIN: 4 2 7 8 1 9             ║
  ║  Tunnel ID:   A3F2E9                  ║
  ╚═══════════════════════════════════════╝
  ```
- Agent binary detection: check if `claude` and `aider` are on PATH; warn if not found
- QR code in terminal (using `qrcode-terminal` package) encoding local URL + PIN
- Web UI first-run screen: agent selection, brief feature tour
- Settings saved to DB so wizard only shows once

**Files to create/modify:**
- `NEW` `apps/server/src/services/StartupService.ts` — first-run detection, console display
- `MODIFY` `apps/server/src/index.ts` — call StartupService on boot
- `MODIFY` `apps/web/src/ProjectSelector.tsx` — add first-run UI state

---

### P0-006: Fix Database Path 🔒

**Status:** Not Started  
**Blocks:** BLK-007  
**Description:** Two DB files already exist in the repo. The DB path must be deterministic.

**Requirements:**
- Use `path.join(os.homedir(), '.agentdeck', 'agentdeck.db')`
- Create `~/.agentdeck/` directory on first run if it doesn't exist
- Support `AGENTDECK_DATA_DIR` env var override
- Delete stale DB files from repo (add to `.gitignore`)

**Files to modify:**
- `MODIFY` `apps/server/src/services/DatabaseService.ts`
- `MODIFY` `.gitignore` (root) — add `*.db`

---

### P0-007: Fix E2E Relay Stale Closure 🔒

**Status:** Bug identified, not fixed  
**Blocks:** BLK-005  
**Description:** The relay E2E encryption is broken due to React stale closure. 30-minute fix.

**Requirements:**
- Replace `useState` for `sharedSecret` with `useRef` in `useSocket.ts`
- All reads of `sharedSecret` inside event handlers use `.current`
- Verify fix: handshake completes → events encrypted → mobile decrypts successfully

**Files to modify:**
- `MODIFY` `apps/web/src/hooks/useSocket.ts`

---

### P0-008: Make Relay URL Configurable 🔒

**Status:** Not Started  
**Blocks:** BLK-004  
**Description:** Relay URL is `localhost:4000` in both server and client. Remote access is impossible.

**Requirements:**
- Add `AGENTDECK_RELAY_URL` environment variable (server)
- Expose relay URL via `/api/v1/system` response: `{ tunnelId, relayUrl }`
- Client reads relay URL from system API instead of hardcoding
- Default to `http://localhost:4000` in development only
- Document self-hosting the relay server

**Files to modify:**
- `MODIFY` `apps/server/src/services/RelayClient.ts`
- `MODIFY` `apps/server/src/routes/system.ts`
- `MODIFY` `apps/web/src/hooks/useSocket.ts`

---

### P0-009: Create PWA Icons 🔒

**Status:** Missing assets  
**Blocks:** BLK-009  
**Description:** `vite.config.ts` references icon files that don't exist.

**Requirements:**
- Create `apps/web/public/pwa-192x192.png` — AgentDeck logo, 192×192px
- Create `apps/web/public/pwa-512x512.png` — AgentDeck logo, 512×512px
- Create `apps/web/public/apple-touch-icon.png` — 180×180px for iOS
- Update `sw.js` icon reference from `vite.svg` to actual icon
- Add `<link rel="apple-touch-icon">` in `index.html`

---

### P0-010: ApprovalManager — Integrate or Remove 🔒

**Status:** Dead code  
**Blocks:** BLK-010  
**Description:** `ApprovalManager` is instantiated but never used. Decision required.

**Decision:** **Integrate** — `ApprovalManager` provides correct persistence and timeout semantics that adapters currently lack.

**Requirements:**
- Adapters detect approval prompts and call `approvalManager.requestApproval(projectId, description, command)`
- `ApprovalManager` emits `agent.approval_request` (already does this ✓)
- Adapters wait on the promise returned by `requestApproval()`
- On `approved: true` → adapter writes `y\r` to PTY
- On `approved: false` or timeout → adapter writes `n\r`
- This suspends the adapter coroutine correctly during approval wait

**Files to modify:**
- `MODIFY` `packages/adapters/src/ClaudeAdapter.ts`
- `MODIFY` `packages/adapters/src/AiderAdapter.ts`
- `MODIFY` `apps/server/src/services/ApprovalManager.ts` — add persistence (after P0-004)

---

### P0-011: SECURITY.md and README 🔒

**Status:** Missing  
**Blocks:** BLK-013, BLK-014  

**Requirements:**
- `SECURITY.md`: responsible disclosure email, known limitations, local-only warning
- `README.md`: prerequisites, quick install, screenshots, link to docs
- `.env.example`: document all environment variables

---

## P1 — Important (Required for Quality Beta)

Items that don't block release but significantly impact user experience and reliability.

---

### P1-001: Push Notification Reliability

**Status:** Partially implemented  
**Description:** VAPID email is placeholder; push requires HTTPS; no fallback for HTTP.

**Requirements:**
- Replace `agentdeck@example.com` with real contact
- Generate self-signed TLS cert for local HTTPS (using `selfsigned` package)
- Serve via HTTPS by default so push notifications work on local network
- Gracefully degrade: if HTTPS unavailable, hide push notification option in UI
- Add push notification action buttons ("Approve" / "Deny") in `sw.js`

---

### P1-002: Approval Timeout UI

**Status:** Not implemented  
**Description:** 5-minute approval timeout fires silently. User doesn't know they're running out of time.

**Requirements:**
- Approval dialog shows countdown timer
- At 60 seconds remaining, dialog pulses red
- On timeout: dialog closes automatically with "Timed out — action was denied" message

---

### P1-003: Agent Binary Detection at Startup

**Status:** Not implemented  
**Description:** If `claude` or `aider` is not on PATH, the server starts fine but agent start silently fails.

**Requirements:**
- On startup, check `which claude` and `which aider` (or Windows equivalent)
- If not found, log a clear warning with installation instructions
- Surface missing binary status in `/health` endpoint
- Show warning in UI when selecting an unavailable agent type

---

### P1-004: Hardened Approval Regex

**Status:** Fragile  
**Description:** Single regex per adapter. Version updates to Claude/Aider will break detection silently.

**Requirements:**
- Maintain versioned regex patterns per agent (primary + fallback)
- Log when a pattern matches so misses can be diagnosed
- Add configurable custom regex override in settings
- Add integration test with fixture output from current agent versions

---

### P1-005: QR Code Connection Flow

**Status:** Not implemented (mentioned in roadmap as done)  
**Description:** Mobile users need to scan a QR to connect. Currently only manual text ID entry works.

**Requirements:**
- Display QR code on server console (ASCII) and in web UI
- QR encodes: `agentdeck://connect?host=<ip>&port=3000&pin=<pin>`
- Web UI QR visible on ProjectSelector screen
- Add deep-link handler or manual entry fallback on mobile

---

### P1-006: Multi-Agent Dashboard

**Status:** Partially implemented (UI shows only one project at a time)  
**Description:** Users with multiple projects should see all agent statuses at a glance.

**Requirements:**
- Project list shows live status badge for each project (idle/working/waiting)
- Status updates in real-time without entering a project
- Quick-approve from project list for pending approvals
- Count of pending approvals shown as badge

---

### P1-007: Agent Auto-Restart

**Status:** Not implemented  
**Description:** PTY process crash leaves agent in dead state with no recovery.

**Requirements:**
- On `onExit`, wait 2 seconds then attempt restart (up to 3 times)
- Emit `agent.status: restarting` between attempts
- After 3 failures, emit `agent.status: error` with message
- User can manually restart from UI at any time

---

### P1-008: ESLint + Prettier Configuration

**Status:** Missing  
**Description:** Only `apps/marketing` has ESLint. Code style is inconsistent.

**Requirements:**
- Add `eslint.config.js` to server, web, adapters, shared packages
- Add `.prettierrc` at monorepo root
- Add `lint-staged` + `husky` pre-commit hook

---

### P1-009: CI Pipeline

**Status:** Missing  
**Description:** No automated checks on pull requests.

**Requirements:**
- GitHub Actions workflow: `build`, `typecheck`, `lint` on every PR
- Check that all packages build without errors
- Run any available tests

---

### P1-010: Windows PATH and Spaces Fix

**Status:** Bug  
**Description:** Adapter PTY spawn on Windows fails for paths with spaces.

**Requirements:**
- Wrap binary path in quotes on Windows: `["\"${binPath}\"", ...args]`
- Test with project paths containing spaces
- Document that spaces in agent binary path may require manual quoting

---

## P2 — Nice To Have (Post-Beta Features)

Items that improve the product but are not blocking.

---

### P2-001: Cloud Sync

**Status:** Out of scope for MVP  
**Description:** Allow project data and settings to sync between machines via optional cloud backend.

**Requirements:**
- Optional account system (email + password or OAuth)
- Encrypted project metadata sync
- Event history sync (opt-in, privacy-first)

---

### P2-002: Team Features

**Status:** Out of scope for MVP  
**Description:** Multiple developers sharing access to a single AgentDeck instance.

**Requirements:**
- Multi-user pairing (multiple trusted devices per server)
- Role-based access: viewer vs. approver vs. admin
- Approval delegation: "Assign approval to teammate"
- Team notification channels (Slack/Discord webhooks)

---

### P2-003: Analytics & Telemetry

**Status:** Stub exists (console.log only)  
**Description:** Understand how users use AgentDeck to guide roadmap decisions.

**Requirements:**
- Privacy-first: opt-in only, no code or file content ever sent
- Track: session count, approval rate, agent types used, error rate
- Local analytics dashboard: "Your AgentDeck Stats"
- Optional anonymous aggregate telemetry

---

### P2-004: Codex CLI Adapter

**Status:** Not implemented  
**Description:** Extend adapter coverage to OpenAI Codex CLI.

**Requirements:**
- PTY-based adapter following `IAgentAdapter` interface
- Approval regex for Codex prompts
- Test with current Codex CLI version

---

### P2-005: Roo Code Adapter

**Status:** Not implemented  
**Description:** Extend adapter coverage to Roo Code (VS Code extension).

**Requirements:**
- Investigate Roo Code's extension API for programmatic control
- If PTY-based: standard adapter
- If API-based: REST/socket adapter implementation

---

### P2-006: Google Antigravity Adapter

**Status:** Not implemented  
**Description:** Extend adapter coverage to Google Antigravity (this tool).

**Requirements:**
- Investigate Antigravity's communication interface
- Implement adapter following `IAgentAdapter` interface

---

### P2-007: Event Throttling & Batching

**Status:** Not implemented  
**Description:** High-frequency PTY output creates one DB write per log line. Needs batching.

**Requirements:**
- Buffer log events for 100ms before flushing to DB
- Send batched events over WebSocket as a single message
- Apply backpressure if client is slow to consume
- Configurable throttle interval via settings

---

### P2-008: Dark/Light Mode Toggle

**Status:** Dark mode only  
**Description:** Some users prefer light mode.

**Requirements:**
- CSS custom properties already structured for easy theming ✓
- Add theme toggle in sidebar / settings
- Persist preference to localStorage

---

### P2-009: Native Mobile App Wrapper

**Status:** PWA currently  
**Description:** PWA has limitations for push notifications and background operation. Native wrapper improves reliability.

**Requirements:**
- React Native or Capacitor wrapper around existing web app
- Native push notification handling (APNs, FCM)
- Background session monitoring
- App Store / Play Store distribution

---

### P2-010: Approval Audit Log UI

**Status:** Not implemented  
**Description:** Users should be able to review what they approved and denied.

**Requirements:**
- New "History" tab in dashboard
- Shows all approval decisions with: timestamp, description, command, decision, project
- Filterable by project, date range, decision
- Exportable as CSV

---

### P2-011: Database Migration System

**Status:** Not implemented  
**Description:** Schema changes currently require manual DB deletion.

**Requirements:**
- Use `better-sqlite3` migration pattern with version table
- Migrations run automatically on server startup
- Each migration is a numbered SQL file in `src/migrations/`
- Migrations are irreversible; backups taken before migrating

---

## Execution Order

```
P0-006 (DB Path)         → 30 min
P0-007 (E2E Closure)     → 30 min
P0-003 (DB Pruning)      → 2 hours
P0-008 (Relay URL)       → 4 hours
P0-009 (PWA Icons)       → 2 hours
P0-010 (ApprovalManager) → 4 hours
P0-002 (Auth Layer)      → depends on P0-001
P0-001 (Device Pairing)  → 2-3 days
P0-004 (Session Recovery)→ 1-2 days (depends on P0-003)
P0-005 (Launch Wizard)   → 1 day (depends on P0-001)
P0-011 (Docs)            → 2 hours

[GitHub Release Gate]

P1-003 (Binary Detection)→ 4 hours
P1-005 (QR Code)         → 4 hours (depends on P0-001)
P1-001 (Push HTTPS)      → 1 day
P1-002 (Approval Timer)  → 4 hours
P1-004 (Hardened Regex)  → 2 days
P1-007 (Auto-restart)    → 4 hours
P1-006 (Multi-agent UI)  → 2 days
P1-008 (ESLint/Prettier) → 4 hours
P1-009 (CI Pipeline)     → 4 hours
P1-010 (Windows Fix)     → 2 hours

[Beta Release Gate]

P2 items in any order based on user feedback
```
