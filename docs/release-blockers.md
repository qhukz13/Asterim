# AgentDeck — Release Blockers

**Date:** 2026-06-19  
**Purpose:** Every issue that prevents public launch. Nothing launches until this list is resolved.

> **Rule:** Each blocker must be resolved and verified before the associated release gate can open.  
> Being "mostly done" is not resolved.

---

## Release Gates

| Gate | Description | Ready? |
|---|---|---|
| 🟦 GitHub Public Release | Open-source the repository | ❌ NO |
| 🟨 Public Beta | Invite external users to test | ❌ NO |
| 🟩 Commercial Release | Charge money, SLA applies | ❌ NO |

---

## CRITICAL BLOCKERS — Security

### BLK-001: No Authentication on WebSocket or REST API

**Severity:** CRITICAL  
**Impacts:** GitHub Release, Beta, Commercial  
**Description:**  
Any device on the same local network can connect to the AgentDeck WebSocket and:
- Start or stop AI agents
- Send arbitrary commands to running agents
- Respond to pending approvals (approve malicious operations)
- Read all agent output including code, secrets, and API keys

Evidence: `socketManager.ts:37-40` — all `client_event` messages published directly to EventBus with no validation.

**Resolution Plan:**
1. Implement device pairing flow (BLK-002 below)
2. Add WebSocket middleware that validates pairing token on connection
3. Add Fastify `preHandler` hook to validate token on all `/api/v1/*` routes
4. Reject unauthenticated connections before they reach the EventBus

**Estimated Effort:** 2-3 days

---

### BLK-002: No Device Pairing System

**Severity:** CRITICAL  
**Impacts:** GitHub Release, Beta, Commercial  
**Description:**  
Architecture doc (`architecture.md:63`) states "A pairing PIN or QR code system is required for a new device on the local network to authenticate." Zero implementation exists. The `tunnelId` is treated as a pseudo-pairing code but has no authentication semantics — it is freely accessible at `/api/v1/system` without any token.

**Resolution Plan:**
1. Generate a random 6-digit PIN on server startup
2. Display PIN in server console output
3. Web UI: Add PIN entry screen before joining a project room
4. Server: Validate PIN, issue a signed session token (JWT or HMAC)
5. All subsequent WebSocket messages must include the session token
6. QR code can encode the local IP + PIN for mobile convenience

**Estimated Effort:** 2-3 days

---

### BLK-003: CORS Allows All Origins

**Severity:** HIGH  
**Impacts:** GitHub Release, Beta, Commercial  
**Description:**  
Both the Fastify REST API (`index.ts:31`) and the Socket.IO server (`socketManager.ts:14`) use `origin: '*'`. Any webpage the user visits can make requests to `localhost:3000` and read agent output or send commands. This is a Cross-Site Request Forgery (CSRF) vector.

**Resolution Plan:**
1. After pairing is implemented, restrict CORS to specific origins
2. For local network: allow same-IP or `null` origin (direct access)
3. For relay: validate that requests come from the relay domain only
4. Add CSRF token for state-changing REST endpoints

**Estimated Effort:** 4 hours

---

### BLK-004: Relay URL Hardcoded to localhost

**Severity:** CRITICAL (blocks relay/remote feature)  
**Impacts:** Beta (relay mode), Commercial  
**Description:**  
`RelayClient.ts:25` and `useSocket.ts:26` both point to `http://localhost:4000`. An external mobile device cannot reach `localhost`. The relay feature (remote mobile access) is completely non-functional.

**Resolution Plan:**
1. Make relay URL configurable via environment variable `AGENTDECK_RELAY_URL`
2. Provide a publicly hosted relay server OR document self-hosting
3. Update mobile client to use the configured relay URL (passed from server via `/api/v1/system`)
4. Default to `http://localhost:4000` only in development

**Estimated Effort:** 4 hours + relay server hosting cost

---

### BLK-005: E2E Relay — Stale Closure Bug

**Severity:** CRITICAL (blocks relay/remote feature)  
**Impacts:** Beta (relay mode), Commercial  
**Description:**  
In `useSocket.ts:61`, the `tunnel_message` event handler captures `sharedSecret` from the React state at the time the `useEffect` runs (initially `null`). After `setSharedSecret()` is called, the registered handler still holds the old reference. All encrypted payloads from the server are silently dropped.

**Resolution Plan:**
```typescript
// Fix: use useRef to hold mutable reference
const sharedSecretRef = useRef<CryptoKey | null>(null);

// On handshake:
sharedSecretRef.current = secret;
setSharedSecret(secret);

// In handler:
} else if (message.type === 'encrypted_payload' && sharedSecretRef.current) {
  const decryptedEvent = await decryptPayload(sharedSecretRef.current, message.encrypted);
```

**Estimated Effort:** 30 minutes

---

## CRITICAL BLOCKERS — Stability

### BLK-006: No Session Recovery After Server Crash

**Severity:** HIGH  
**Impacts:** Beta, Commercial  
**Description:**  
`AgentService.activeAdapters` is an in-memory `Map`. When the server restarts (crash or update), all running agent sessions are lost with no notification to the user. Any pending approvals are silently dropped. The agent process itself may still be running as an orphaned process.

**Resolution Plan:**
1. Persist active session references to SQLite (`sessions` table: projectId, agentType, pid, status)
2. On startup, check for sessions with status `running` and attempt to reconnect or emit a recovery event
3. Persist pending approvals with `status: 'pending'` to SQLite
4. On startup, republish any pending approvals to the EventBus

**Estimated Effort:** 1-2 days

---

### BLK-007: Database Path Non-Deterministic (Dual DB Files)

**Severity:** HIGH  
**Impacts:** GitHub Release (data reliability)  
**Description:**  
`DatabaseService.ts:12` uses `process.cwd()` to resolve the DB path. When run as `agentdeck` from a global install, `cwd` is the user's current terminal directory. This creates a new DB file in every directory the user runs `agentdeck` from. Two DB files already exist in the repo proving this is happening:
- `c:\Projects\AgentDeck\agentdeck.db` (24KB)
- `c:\Projects\AgentDeck\apps\server\agentdeck.db` (1.2MB)

**Resolution Plan:**
```typescript
// Replace:
const dbPath = path.resolve(process.cwd(), 'agentdeck.db');
// With:
import os from 'os';
const dbPath = path.join(os.homedir(), '.agentdeck', 'agentdeck.db');
```

**Estimated Effort:** 30 minutes

---

### BLK-008: No Database Event Pruning

**Severity:** MEDIUM  
**Impacts:** Beta, Commercial  
**Description:**  
The `events` table grows indefinitely. A busy agent session with streaming output can produce thousands of rows per minute. Architecture doc explicitly states "auto-prune logs older than X days." No pruning code exists.

**Resolution Plan:**
1. Add pruning on startup: `DELETE FROM events WHERE timestamp < (strftime('%s','now') - 604800) * 1000` (7 days)
2. Add periodic pruning job (every hour)
3. Add per-project event limit (max 50,000 events per project)

**Estimated Effort:** 2 hours

---

## HIGH BLOCKERS — Product Completeness

### BLK-009: PWA Icons Missing — Installable PWA Broken

**Severity:** HIGH  
**Impacts:** GitHub Release, Beta  
**Description:**  
`vite.config.ts:20-31` references `pwa-192x192.png` and `pwa-512x512.png`. Neither file exists in `apps/web/public/`. The PWA manifest points to non-existent files. The app cannot be "installed" to a mobile home screen correctly. Service worker icon is `vite.svg` (Vite default).

**Resolution Plan:**
1. Create proper AgentDeck icons at 192×192 and 512×512 pixels
2. Replace `vite.svg` reference in `sw.js` with the new icon
3. Add `apple-touch-icon` meta tag for iOS

**Estimated Effort:** 2 hours

---

### BLK-010: ApprovalManager is Dead Code

**Severity:** HIGH  
**Impacts:** GitHub Release (misleading architecture)  
**Description:**  
`ApprovalManager.ts` is instantiated (`approvalManager` singleton) but `requestApproval()` is never called anywhere. The adapters handle approvals internally by detecting PTY output and directly emitting events. The `ApprovalManager` was designed to be the centralized approval authority but was never integrated. This means:
1. The architecture doc's approval system description is partially wrong
2. `ApprovalManager` provides persistence and timeout management that the adapters lack
3. Future contributors will be confused by the dead code

**Resolution Plan (Option A — Integrate):**
- Modify adapters to call `approvalManager.requestApproval()` instead of directly emitting events
- This gives approval persistence and proper timeout management

**Resolution Plan (Option B — Remove):**
- Delete `ApprovalManager.ts` and document that adapters own approval flow
- Update architecture doc

**Estimated Effort:** 4 hours (integration) or 30 minutes (removal)

---

### BLK-011: 3 of 5 Claimed Adapters Not Implemented

**Severity:** HIGH  
**Impacts:** GitHub Release (accuracy), Beta  
**Description:**  
Product documentation and marketing claim support for: Claude Code, Google Antigravity, Codex CLI, Aider, Roo Code.  
Implemented: Claude Code, Aider.  
Not implemented: Google Antigravity, Codex CLI, Roo Code.

**Resolution Plan:**
1. Either implement the missing adapters before public release OR
2. Update all documentation and UI to accurately reflect only 2 supported agents
3. Add "Coming Soon" placeholder in UI for planned adapters

**Estimated Effort:** 2-3 days per adapter (implementation + testing)

---

### BLK-012: No QR Code Connection Flow

**Severity:** MEDIUM  
**Impacts:** Beta (mobile UX), Commercial  
**Description:**  
The roadmap (Phase 3) and architecture describe QR code connection. The UI shows only a text tunnel ID and a manual input field. Mobile users have no ergonomic way to connect.

**Resolution Plan:**
1. Add QR code generation library (`qrcode.react` or similar)
2. Generate QR code encoding `agentdeck://connect?host=<local-ip>&tunnelId=<id>&pin=<pin>`
3. Display QR code on the server UI and in console output
4. Mobile: Use QR scanner or manual entry to connect

**Estimated Effort:** 4 hours

---

### BLK-013: No README Installation Guide

**Severity:** MEDIUM  
**Impacts:** GitHub Release  
**Description:**  
The `README.md` has no installation steps. A developer cannot onboard themselves from the README alone.

**Resolution Plan:**
1. Add prerequisites section (Node.js 18+, pnpm 9+, Aider or Claude Code)
2. Add quick start steps: `npm install -g agentdeck && agentdeck`
3. Add screenshots of the dashboard
4. Add link to documentation

**Estimated Effort:** 2 hours

---

### BLK-014: No SECURITY.md

**Severity:** MEDIUM  
**Impacts:** GitHub Release  
**Description:**  
A public GitHub repository without a `SECURITY.md` file has no responsible disclosure policy. Given that AgentDeck runs arbitrary shell commands and reads code from user machines, security vulnerabilities are high-impact.

**Resolution Plan:**
1. Create `SECURITY.md` with responsible disclosure email
2. Explain that AgentDeck is local-first and should not be exposed to the internet
3. List known security limitations of the MVP

**Estimated Effort:** 1 hour

---

## Summary Table

| ID | Blocker | Severity | Gate | Effort |
|---|---|---|---|---|
| BLK-001 | No Authentication | CRITICAL | All | 2-3 days |
| BLK-002 | No Device Pairing | CRITICAL | All | 2-3 days |
| BLK-003 | CORS Wildcard | HIGH | All | 4 hours |
| BLK-004 | Relay URL Hardcoded | CRITICAL | Beta+ | 4 hours |
| BLK-005 | E2E Stale Closure | CRITICAL | Beta+ | 30 min |
| BLK-006 | No Session Recovery | HIGH | Beta+ | 1-2 days |
| BLK-007 | Non-Deterministic DB | HIGH | All | 30 min |
| BLK-008 | No DB Pruning | MEDIUM | Beta+ | 2 hours |
| BLK-009 | PWA Icons Missing | HIGH | All | 2 hours |
| BLK-010 | ApprovalManager Dead Code | HIGH | All | 4 hours |
| BLK-011 | 3/5 Adapters Missing | HIGH | All | 2-3 days/ea |
| BLK-012 | No QR Code Flow | MEDIUM | Beta+ | 4 hours |
| BLK-013 | No README Guide | MEDIUM | GitHub | 2 hours |
| BLK-014 | No SECURITY.md | MEDIUM | GitHub | 1 hour |

### Minimum for GitHub Public Release

BLK-001, BLK-002, BLK-003, BLK-007, BLK-009, BLK-010, BLK-013, BLK-014

### Minimum for Public Beta

All GitHub blockers + BLK-004, BLK-005, BLK-006, BLK-008, BLK-012

### Minimum for Commercial Release

All Beta blockers + BLK-011 (all adapters) + full security audit
