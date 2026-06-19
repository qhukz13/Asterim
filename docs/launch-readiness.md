# AgentDeck — Launch Readiness Audit

**Audit Date:** 2026-06-19  
**Auditor:** CTO / Lead Engineer  
**Method:** Full codebase inspection — every source file read and verified against claimed status

> **WARNING:** Several roadmap phases are marked complete but critical gaps exist.  
> This product is **NOT ready for public beta**. Read every section before proceeding.

---

## Summary Scorecard

| Category | Status | Risk |
|---|---|---|
| Installation | PARTIAL | HIGH |
| Build System | PARTIAL | MEDIUM |
| Cross-Platform Compatibility | PARTIAL | HIGH |
| Agent Integrations | PARTIAL | HIGH |
| WebSocket Reliability | PARTIAL | MEDIUM |
| Event System | PARTIAL | MEDIUM |
| Approval Flow | PARTIAL | HIGH |
| Security | BLOCKED | CRITICAL |
| Persistence | PARTIAL | HIGH |
| Error Handling | PARTIAL | MEDIUM |
| Mobile Experience | PARTIAL | MEDIUM |
| Documentation | PARTIAL | LOW |
| Release Packaging | BLOCKED | HIGH |
| Developer Experience | PARTIAL | MEDIUM |

---

## 1. Installation

**Status: PARTIAL** | **Risk: HIGH**

### Evidence
- `package.json` (root): Declares `engines: { node: ">=18", pnpm: ">=9" }` — correct constraints
- `apps/server/package.json`: Has `bin: { agentdeck: "./dist/index.js" }` — installable via npm
- No install script, no `postinstall` setup, no first-run wizard exists
- `node-pty` requires native compilation (`node-gyp`). On Windows this requires Visual Studio Build Tools. Zero documentation of this dependency exists
- `bonjour-service` requires mDNS/Zeroconf runtime — blocked by Windows Firewall by default with no setup guidance
- No `.env.example`, no configuration guide, no `README` install steps that actually work end-to-end
- Push notifications require HTTPS in production but `VAPID` email is hardcoded as `agentdeck@example.com` (`PushService.ts:35`)

### Missing Work
- [ ] First-run setup wizard (P0-005 in backlog)
- [ ] Native dependency installation guide for `node-pty` / Windows
- [ ] Configuration documentation for relay server URL, ports
- [ ] `.env` support and `.env.example` file
- [ ] Replace placeholder VAPID email with real contact

---

## 2. Build System

**Status: PARTIAL** | **Risk: MEDIUM**

### Evidence
- `turbo.json`: Pipeline is defined — `build` depends on `^build`, correct dependency order
- `apps/server/package.json build script`: `tsup && node -e "require('fs').cpSync(...)"` — copies web dist into server dist. This works but is fragile on Windows (`rm -rf` in `clean` script fails on Windows)
- `tsup.config.ts`: Externalizes `node-pty`, `chokidar`, `bonjour-service` etc. — these will not be bundled. A bare `node dist/index.js` will fail unless `node_modules` is present
- `turbo.json outputs`: Contains a typo — `"!-next/cache/**"` should be `"!.next/cache/**"` (non-critical for this project but shows config sloppiness)
- No CI/CD pipeline (no `.github/workflows/` directory exists)
- No test runner configured anywhere in the monorepo

### Missing Work
- [ ] Fix `clean` script for Windows (`rm -rf` → `rimraf`)  
- [ ] Add CI pipeline (GitHub Actions)
- [ ] Add at minimum smoke tests for server startup and WebSocket connection
- [ ] Document build prerequisites clearly

---

## 3. Cross-Platform Compatibility

**Status: PARTIAL** | **Risk: HIGH**

### Evidence
- `ClaudeAdapter.ts:20-21` and `AiderAdapter.ts:21-22`: Platform check exists — `process.platform === 'win32'` uses `cmd.exe`, else `bash`. This is correct in principle
- However: On Windows with `cmd.exe`, shell command construction `['/c', binPath, ...args]` will fail for paths containing spaces — no quoting
- `DatabaseService.ts:12`: Uses `process.cwd()` for DB path — CWD depends on where the process is launched, not where the binary is installed. **On Windows this will create a DB in an unexpected location when run as a global npm package**
- `apps/server/package.json clean script`: `rm -rf dist` — fails on Windows PowerShell without `rimraf`
- mDNS via `bonjour-service` has known issues on Windows (Firewall blocks UDP multicast by default)
- `GitMonitor.ts:46`: Runs `git diff` via `exec` — assumes `git` is on `PATH`. No error surfacing if git is not installed (silently swallowed at line 64)

### Missing Work
- [ ] Fix Windows path-with-spaces issue in adapter PTY spawning
- [ ] Fix DB path resolution to use `__dirname`/binary location, not `process.cwd()`
- [ ] Replace `rm -rf` with cross-platform solution (`rimraf`)
- [ ] Document mDNS firewall requirement for Windows users
- [ ] Surface git-not-installed error to UI instead of silent swallow

---

## 4. Agent Integrations

**Status: PARTIAL** | **Risk: HIGH**

### Evidence

**Implemented adapters:**
- `ClaudeAdapter.ts` — implemented via PTY, approval detection via regex
- `AiderAdapter.ts` — implemented via PTY, approval detection via regex

**Claimed but NOT implemented adapters (0 files exist):**
- ❌ Codex CLI — no adapter file
- ❌ Roo Code — no adapter file  
- ❌ Google Antigravity — no adapter file

**Adapter quality issues:**
- `ClaudeAdapter.ts:91`: Approval regex `/?\\s*(.*?)\\s*\\([yY]\\/[nN]\\)/i` — fragile. Claude's prompts vary significantly across versions. Will miss many real approval requests
- `AiderAdapter.ts:93`: Regex `/(Allow.*|Run command.*)\\s*\\([yY]\\/[nN]\\)/i` — Aider's prompts change with each release
- **No adapter reconnection logic** — if the PTY process dies unexpectedly, `ptyProcess` is set to `null` but no restart is attempted and no persistent alert is sent
- `AgentService.ts:77`: Only `claude` and `aider` are valid `agentType` values. The UI shows only these two, consistent, but roadmap claims 5 agents
- No adapter version pinning — Aider/Claude CLI updates will silently break adapters

### Missing Work
- [ ] Implement Codex CLI adapter
- [ ] Implement Roo Code adapter  
- [ ] Implement Google Antigravity adapter
- [ ] Harden approval regex with versioned patterns and fallback detection
- [ ] Add PTY process auto-restart with backoff
- [ ] Add adapter health-check mechanism

---

## 5. WebSocket Reliability

**Status: PARTIAL** | **Risk: MEDIUM**

### Evidence
- `socketManager.ts`: Uses Socket.IO v4 — reconnection is handled by the library client-side ✓
- `useSocket.ts:114-118`: `disconnect` handler resets state to `idle` — correct
- **No reconnection state restoration on the server side**: When a client disconnects and reconnects, `syncHistory` fires (`socketManager.ts:33`) and replays up to 1000 events — this is correct behavior ✓
- **Relay mode bug** (`useSocket.ts:61`): `sharedSecret` is captured via React closure at `useEffect` creation time. When `sharedSecret` state updates, the `tunnel_message` handler registered on the old socket instance still holds the old (null) `sharedSecret`. This means **the first encrypted message after handshake will always fail to decrypt** — the relay E2E path is functionally broken for live events
- `RelayClient.ts:25`: Relay URL hardcoded as `http://localhost:4000` — the relay is supposed to be a cloud service but points to localhost
- `useSocket.ts:26`: Same hardcoded relay URL on the client side — mobile clients cannot reach `localhost:4000`
- No Socket.IO namespace isolation — all events share the default namespace
- No socket room cleanup on agent stop

### Missing Work
- [ ] Fix E2E relay `sharedSecret` stale closure bug in `useSocket.ts`
- [ ] Make relay URL configurable (env var or settings)
- [ ] Deploy relay server to actual cloud host OR document self-hosting
- [ ] Add socket room cleanup when agent stops
- [ ] Add connection timeout handling

---

## 6. Event System

**Status: PARTIAL** | **Risk: MEDIUM**

### Evidence
- `EventBus.ts`: Clean singleton pub/sub on Node `EventEmitter` ✓
- `EventBus.ts:27`: Emits `'*'` catch-all — but `EventEmitter` does not support wildcard listeners natively. The `'*'` is treated as a literal event name. Only subscribers to the exact string `'*'` receive it. **This works only because `socketManager.ts:70` and `RelayClient.ts:75` both subscribe to `'*'` explicitly** — functional but misleading and fragile
- `socketManager.ts:70-96`: Catch-all bridge persists all events to SQLite and emits them to the appropriate socket room ✓
- **No event deduplication** — the same event is persisted once to DB and also forwarded to relay. If relay is also bridging, events could double-fire
- **No event throttling or batching** — high-frequency PTY output (Claude streaming responses) generates one DB insert per log line. Under heavy use this will saturate SQLite writes
- `EventBus.ts:11`: `setMaxListeners(100)` — correct for the use case ✓
- No dead-letter queue or event replay outside of `syncHistory`
- `events.ts`: Types are clean and comprehensive ✓

### Missing Work
- [ ] Replace wildcard emitter pattern with proper event bus library (e.g., `mitt`) or document the `'*'` literal contract
- [ ] Add log event batching/throttling (flush every 100ms or 50 events)
- [ ] Add event deduplication key to prevent double-processing
- [ ] Add DB event pruning (no pruning logic exists — DB will grow unboundedly)

---

## 7. Approval Flow

**Status: PARTIAL** | **Risk: HIGH**

### Evidence

**What works:**
- `ApprovalManager.ts`: Creates a promise that resolves when `client.approval_response` arrives on EventBus ✓
- `ApprovalManager.ts:46`: 5-minute timeout with auto-deny ✓
- `ClaudeAdapter.ts:70-81`: Sends `y\r` or `n\r` to PTY on approval response ✓
- `useSocket.ts:99-101`: UI shows approval dialog when `agent.approval_request` arrives ✓
- `PushService.ts:88-98`: Sends push notification on approval request ✓

**What is broken or missing:**
- **`ApprovalManager` is instantiated but never called** — `approvalManager.requestApproval()` is never invoked anywhere in the codebase. The approval system is **parallel to** the adapter system, not integrated with it. Adapters detect approvals internally and emit events themselves. `ApprovalManager` is dead code
- **Approval state is in-memory only** — server crash loses all pending approvals. No persistence
- **No approval timeout surfaced to UI** — the 5-minute timer fires silently server-side
- **Relay approval loop is broken** — the E2E stale closure bug means approval responses from remote clients via relay may not be decrypted
- `ClaudeAdapter.ts:94`: `if (match && !this.currentActionId)` — only one approval tracked at a time. If Claude presents a second prompt before the first resolves, it is silently dropped
- No approval history (no way to audit what was approved and when)

### Missing Work
- [ ] Either integrate `ApprovalManager` into adapter flow OR remove it (it is currently dead code)
- [ ] Persist pending approvals to SQLite so they survive server restart
- [ ] Surface approval timeout countdown to UI
- [ ] Fix relay E2E closure bug so remote approvals work
- [ ] Add approval audit log to database

---

## 8. Security

**Status: BLOCKED** | **Risk: CRITICAL**

### Evidence
- `socketManager.ts:14`: `origin: '*'` — accepts connections from any origin. Any website the user visits while the server is running can connect to the WebSocket and read all agent output, including code, secrets, and diffs
- `index.ts:31`: `cors: { origin: '*' }` — REST API accepts requests from any origin
- `socketManager.ts:37-39`: Any incoming `client_event` is immediately published to the EventBus. **There is zero authentication, authorization, or validation**. Any device on the same network (or any origin in the browser) can start/stop agents, send commands, and respond to approvals
- **No device pairing system exists** — `architecture.md:63` documents "A pairing PIN or QR code system is required" but zero implementation exists
- **No access tokens** — no session tokens, no API keys, nothing
- `RelayClient.ts:17`: Tunnel ID is 6 hex chars = 16.7 million combinations. A brute-force attack against an unprotected relay is trivially feasible
- `PushService.ts:35`: VAPID contact email is `agentdeck@example.com` — invalid for production push service registration
- `system.ts:6-9`: `/api/v1/system` exposes the tunnel ID unauthenticated — anyone who knows the server's local IP can get the tunnel ID

### Missing Work
- [ ] **P0**: Implement device pairing (QR code + PIN) before any other feature
- [ ] **P0**: Add authentication middleware to all WebSocket connections and REST endpoints
- [ ] **P0**: Validate and sanitize all `client_event` payloads before publishing to EventBus
- [ ] **P0**: Restrict CORS to local network origins only
- [ ] Replace 6-char tunnel ID with cryptographically secure 32-char token
- [ ] Replace placeholder VAPID email
- [ ] Add rate limiting on the relay and REST API

---

## 9. Persistence

**Status: PARTIAL** | **Risk: HIGH**

### Evidence
- `DatabaseService.ts`: SQLite tables are created on startup ✓ — `projects`, `events`, `settings`, `push_subscriptions`
- `socketManager.ts:78-91`: Events are persisted to SQLite on every event ✓
- `socketManager.ts:48-61`: History sync replays up to 1000 events on client reconnect ✓
- **No log pruning** — the `events` table will grow indefinitely. Architecture doc states "auto-prune" is required but zero pruning code exists
- **Dual DB files**: Root `agentdeck.db` (24KB) exists alongside `apps/server/agentdeck.db` (1.2MB). `DatabaseService.ts:12` uses `process.cwd()` — if run from the monorepo root vs the server directory, different DB files are used. This is a data consistency bug
- **No database migration system** — schema changes require manual intervention or data loss
- **Agent session state is not persisted** — `AgentService.activeAdapters` is an in-memory Map. Server restart loses all running agent sessions with no recovery path
- **Approval state not persisted** — pending approvals are lost on crash
- `ProjectManager.ts`: Projects are persisted to SQLite ✓ — but no validation of project path existence

### Missing Work
- [ ] Add DB event pruning (e.g., keep last 7 days or 50,000 events per project)
- [ ] Fix DB path to be deterministic regardless of CWD
- [ ] Add database migration system (e.g., `better-sqlite3-migrate`)
- [ ] Persist active agent session references for crash recovery
- [ ] Add project path validation on creation

---

## 10. Error Handling

**Status: PARTIAL** | **Risk: MEDIUM**

### Evidence
- `index.ts:13-24`: Crash logger writes to `~/.agentdeck/crash.log` — `uncaughtException` and `unhandledRejection` are caught ✓
- `AgentService.ts:40-42`: Top-level command handler wraps in try/catch and logs ✓
- `AgentService.ts:100-113`: Agent start failure emits a status event to the UI ✓
- **PTY process crash is handled** (`ClaudeAdapter.ts:36-39`, `AiderAdapter.ts:37-40`): `onExit` emits idle status ✓ — but no restart attempt
- `DatabaseService.ts`: No error handling on `db.exec()` calls — schema creation errors will crash the server silently
- `socketManager.ts:89-91`: DB persist errors are caught and logged but not surfaced to UI ✓ (acceptable)
- `workspaceMonitor.ts:74-76`: File diff errors are caught and logged ✓
- `GitMonitor.ts:63-66`: Git errors are silently swallowed — no UI signal if git is missing
- No structured error types — all errors are raw `console.error` calls
- No health degradation signals — no way to know if a subsystem is failing without reading server logs
- `mDNSService.ts:18-20`: mDNS failure is caught and logged but service continues — correct ✓

### Missing Work
- [ ] Add error handling to `DatabaseService.init()` (schema creation)
- [ ] Add structured error events to EventBus for subsystem failures (DB, mDNS, Git)
- [ ] Surface git-not-found and agent-binary-not-found errors to UI clearly
- [ ] Add health endpoint that reflects subsystem status (extend `/health`)

---

## 11. Mobile Experience

**Status: PARTIAL** | **Risk: MEDIUM**

### Evidence
- CSS `index.css:334-435`: Responsive breakpoint at 1024px, sidebar hidden, bottom nav shown ✓
- `index.html:5`: `viewport-fit=cover` and `user-scalable=no` ✓
- `index.css:392-399`: `env(safe-area-inset-bottom)` applied to nav bar ✓
- `vite.config.ts:13-32`: PWA manifest configured with icons ✓ — but `pwa-192x192.png` and `pwa-512x512.png` **do not exist** in `public/` directory (only `sw.js` is present). The PWA manifest points to non-existent icon files — **installable PWA is broken**
- `sw.js:7-8`: Service worker uses `vite.svg` as notification icon — placeholder, not a real icon
- `push.ts`: Push notification flow works architecturally but requires HTTPS, which is not set up
- **No QR code generation** — architecture says users scan a QR code to connect; this feature doesn't exist anywhere
- **No mDNS auto-discovery in mobile UI** — users must manually enter server IP or tunnel ID
- **Relay mode detection** (`useSocket.ts:21`): `projectId.length === 6` — dangerously fragile heuristic. A project UUID could theoretically be 6 chars if the DB is manipulated
- Mobile layout has no loading states for slow connections
- No offline mode indicator beyond connection badge

### Missing Work
- [ ] Create/add PWA icons (`pwa-192x192.png`, `pwa-512x512.png`)
- [ ] Implement QR code display for local network connection
- [ ] Implement QR code scan for mobile-side connection (or manual IP entry flow)
- [ ] Replace 6-char relay detection heuristic with explicit mode flag
- [ ] Set up HTTPS for local server (self-signed cert) to enable push in local network
- [ ] Add offline/reconnecting state to mobile UI

---

## 12. Documentation

**Status: PARTIAL** | **Risk: LOW**

### Evidence
- `docs/architecture.md`: Comprehensive system design ✓
- `docs/roadmap.md`: Phase descriptions ✓ — but **all phases are implicitly marked complete** with no actual completion verification
- `docs/decisions.md`: 6 ADRs, well-written ✓ — but ADR-006 references a JSON config that no longer exists (SQLite was implemented but the ADR was never updated)
- `docs/tasks.md`: Tasks list — **`TODO` section is empty** and **`IN PROGRESS` is "None"** despite significant work remaining
- No `CONTRIBUTING.md`
- No `CHANGELOG.md`
- No `SECURITY.md` (required for public GitHub release)
- No API documentation (Swagger/OpenAPI)
- No setup guide beyond the bare-bones `README.md`
- `README.md` has no installation steps, no screenshots, no quick start

### Missing Work
- [ ] Update `decisions.md` ADR-006 to reflect SQLite migration
- [ ] Update `tasks.md` with all pending work
- [ ] Create `CONTRIBUTING.md`
- [ ] Create `CHANGELOG.md`  
- [ ] Create `SECURITY.md` with responsible disclosure policy
- [ ] Add OpenAPI/Swagger spec for REST endpoints
- [ ] Write end-to-end setup guide

---

## 13. Release Packaging

**Status: BLOCKED** | **Risk: HIGH**

### Evidence
- `apps/server/package.json`: `bin` field defined — npm installable in principle ✓
- `tsup.config.ts`: Builds CJS bundle — correct for Node.js CLI ✓
- **But**: All native dependencies (`node-pty`, `chokidar`, `bonjour-service`) are externalized — the bundle requires `node_modules` to be present. This is **not a standalone binary**
- No `pkg` or `nexe` configuration for true standalone binaries
- No Windows installer (`.msi`, `.exe`)
- No macOS installer (`.dmg`, `.pkg`)
- No Linux package (`.deb`, `.rpm`, AppImage)
- No auto-update mechanism
- No versioning strategy (version is `0.1.0` with no changelog)
- No GitHub release workflow
- No npm publish workflow
- No signing of binaries

### Missing Work
- [ ] Decide: npm package vs. standalone binary (current setup is npm, not binary)
- [ ] If npm: ensure `postinstall` compiles native deps correctly on each platform
- [ ] If binary: configure `pkg` or `nexe` with proper native module handling
- [ ] Create GitHub release workflow
- [ ] Create npm publish workflow
- [ ] Add code signing for macOS and Windows

---

## 14. Developer Experience

**Status: PARTIAL** | **Risk: MEDIUM**

### Evidence
- Turborepo + pnpm workspaces: Clean monorepo structure ✓
- `turbo run dev`: Starts all packages — functional ✓
- TypeScript across all packages ✓
- Shared types package (`@agentdeck/shared`) eliminates drift ✓
- No linting configuration in most packages (only `apps/marketing` has `eslint.config.js`)
- No Prettier configuration
- No pre-commit hooks
- No test suite anywhere in the codebase
- `turbo.json`: Has a typo in outputs (`"!-next/cache/**"`)
- Agent binary prerequisites (Claude Code, Aider) have no detection or helpful error message at startup
- No debug mode / verbose logging flag

### Missing Work
- [ ] Add ESLint configuration to server, web, adapters packages
- [ ] Add Prettier configuration at monorepo root
- [ ] Add Husky pre-commit hooks
- [ ] Add at minimum integration tests for the golden loop
- [ ] Fix turbo.json typo
- [ ] Add startup validation that checks for required agent binaries
- [ ] Add `DEBUG=agentdeck:*` verbose logging support
