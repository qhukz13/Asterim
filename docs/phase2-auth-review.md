# Asterim Phase 2 — Authentication & Security Audit Review

**Document Version**: 2.0.0  
**Date**: August 7, 2026  
**Author**: Lead Architecture & Security Engineering Team  
**Status**: Approved & Normative Architectural Baseline  

---

## 1. Executive Summary

Asterim Phase 1 and Phase 1.5 successfully established the core local developer experience, local agent orchestration, and UI design language. To prepare Asterim for commercial launch (Phase 5+), Phase 2 builds the **Authentication & Account Platform**. 

This document presents a comprehensive security, architecture, and commercial-readiness audit of Asterim's existing authentication mechanisms. The current system relies on a local 6-digit PIN pairing mechanism designed for local MVP developer sessions. To scale to a multi-tenant commercial SaaS platform with local desktop execution, identity management must be completely decoupled from execution and centralized on the public website (`asterim.dev`).

---

## 2. Comprehensive Category-by-Category Audit

### Category 1: Current Login Flow
* **Current Status**: Local 6-digit PIN pairing flow. On server startup, `PairingService` generates a random 6-digit PIN, outputs it to the stdout console, and writes it to `pairing_pin.txt`. The web app presents a `PinScreen` modal requesting this PIN and submits a `POST /api/v1/auth/pair` request.
* **Problems**:
  1. Requires local file/console inspection, creating unacceptable friction for non-local or remote users.
  2. No concept of user registration, user accounts, passwords, or OAuth providers.
  3. Registration logic occurs inside the application UI layer rather than on the public identity owner (`asterim.dev`).
  4. Single-tenant local model cannot support multi-user teams, subscription gating, or account recovery.
* **Commercial Quality Score**: **15 / 100** (F)
* **Improvement Plan**: Deprecate direct PIN entry as primary auth. Implement Centralized Web OAuth Login on `asterim.dev` with deep-link authorization flow (`asterim://auth/callback?code=...`) for the desktop application. Local-only offline fallback mode will use local machine authentication or secret dev token bypass.
* **Priority**: **P0 (Critical Blocker)**

---

### Category 2: Backend Auth Architecture
* **Current Status**: Fastify route middleware (`authMiddleware.ts`) intercepting `/api/v1/*` HTTP routes (except `/api/v1/auth/pair`). Validates `Authorization: Bearer <token>` using `pairingService.validateToken(token)`.
* **Problems**:
  1. Custom HMAC-SHA256 payload signing (`${base64Payload}.${signature}`) instead of RFC 7519 standard JWTs.
  2. Stateless token validation without session storage in database—revocation is impossible before the 30-day expiration.
  3. No scope verification or role-based authorization (RBAC).
  4. No user ID or identity attached to request context (`request.user` does not exist).
* **Commercial Quality Score**: **25 / 100** (D-)
* **Improvement Plan**: Introduce standard RS256 / HS256 JWT access tokens (short-lived, 15 mins) coupled with opaque, DB-backed refresh tokens (long-lived, 30 days) with token rotation. Implement Fastify plugin decorating `request.user` and `request.session`.
* **Priority**: **P0 (Critical Blocker)**

---

### Category 3: Frontend Auth Architecture
* **Current Status**: `useAuth` hook managing state in `localStorage`. Automatically attaches token to fetch requests and WebSocket handshakes.
* **Problems**:
  1. `localStorage` is vulnerable to Cross-Site Scripting (XSS) token exfiltration.
  2. No token expiration handling or silent refresh mechanism. When the 30-day token expires, API requests fail without automated re-authentication.
  3. Web app and marketing site share no common authentication context or SSO state.
* **Commercial Quality Score**: **30 / 100** (D)
* **Improvement Plan**: Utilize secure `HttpOnly`, `SameSite=Lax`, `Secure` cookies for web browser sessions on `asterim.dev`. For desktop app, store refresh tokens in OS Secure Keychain (via Electron `safeStorage` / system keyring) and access tokens in memory. Implement silent background token refresh interceptor.
* **Priority**: **P0 (Critical Blocker)**

---

### Category 4: Session Lifecycle & Management
* **Current Status**: Fixed 30-day token lifetime. No session records stored in database.
* **Problems**:
  1. Zero visibility into active sessions.
  2. No remote session logout or revocation capability.
  3. Server restart keeps tokens valid if HMAC secret is persistent, but if HMAC secret is cleared, all clients are forcibly disconnected with zero session recovery.
  4. No tracking of login timestamps, IP addresses, or User-Agents.
* **Commercial Quality Score**: **10 / 100** (F)
* **Improvement Plan**: Build a central `user_sessions` database table tracking `session_id`, `user_id`, `device_id`, `ip_address`, `user_agent`, `created_at`, `last_active_at`, and `revoked_at`. Provide single-click remote session invalidation in the account portal.
* **Priority**: **P0 (Critical Blocker)**

---

### Category 5: WebSocket Auth Architecture
* **Current Status**: Socket.IO connection middleware in `socketManager.ts` verifying `socket.handshake.auth.token` via `pairingService.validateToken()`.
* **Problems**:
  1. Validation happens only at connection handshake. If a token is revoked or expires mid-session, the WebSocket connection remains active indefinitely.
  2. Socket instance carries no user identity, organization context, or entitlement scope.
  3. No periodic re-authentication or token rotation over active WebSocket connections.
* **Commercial Quality Score**: **35 / 100** (D)
* **Improvement Plan**: Bind WebSocket connection instance to active session ID. Implement periodic session heartbeat verification and server-initiated disconnect on session revocation event (`session.revoked`).
* **Priority**: **P1 (High)**

---

### Category 6: Adapter & Subprocess Auth Scoping
* **Current Status**: Agent subprocesses (Claude, Aider, PTY adapters) run locally as subprocesses spawned by `@asterim/server` with full system user permissions.
* **Problems**:
  1. No identity or entitlement context passed down to subprocess execution.
  2. No audit trail linking specific agent command executions to user accounts or session IDs.
  3. Enterprise customers cannot verify which user initiated specific agent file/shell mutations.
* **Commercial Quality Score**: **20 / 100** (F)
* **Improvement Plan**: Inject structured audit headers (`userId`, `sessionId`, `orgId`, `traceId`) into all EventBus events emitted during adapter execution. Store immutable execution logs linking agent mutations to user identities.
* **Priority**: **P1 (High)**

---

### Category 7: Token & Credential Storage
* **Current Status**: Server stores HMAC secret in SQLite `settings` table in plaintext. Web client stores token in browser `localStorage`.
* **Problems**:
  1. Plaintext storage of signing keys in local database file.
  2. No key rotation strategy (changing HMAC secret invalidates all issued tokens globally).
  3. Web app vulnerable to XSS credential extraction.
* **Commercial Quality Score**: **20 / 100** (F)
* **Improvement Plan**: Implement JWKS (JSON Web Key Set) key rotation for JWT signatures. Store web session refresh tokens in `HttpOnly` encrypted cookies. Store desktop credentials in OS Keychain.
* **Priority**: **P0 (Critical Blocker)**

---

### Category 8: Device Trust & Management
* **Current Status**: Completely missing. No tracking of client devices.
* **Problems**:
  1. Unable to distinguish between desktop app instances, browser sessions, mobile clients, or CLI tools.
  2. No device revocation capability.
  3. No hardware-assisted or OS fingerprint tracking.
* **Commercial Quality Score**: **0 / 100** (F)
* **Improvement Plan**: Design `trusted_devices` entity tracking `device_id`, `user_id`, `device_name`, `os_type`, `os_version`, `client_version`, `fingerprint_hash`, `last_active_at`, and `is_trusted`. Implement automatic desktop device registration during OAuth deep-link exchange.
* **Priority**: **P1 (High)**

---

### Category 9: Security Controls & Hardening
* **Current Status**: Simple in-memory rate limiting (10 attempts / 15 mins per IP) on `/api/v1/auth/pair`. Direct string equality check (`===`) for PIN.
* **Problems**:
  1. In-memory rate limiting state is lost on server restart and does not scale across multiple process instances.
  2. PIN validation string comparison is vulnerable to timing attacks (though mitigated by short 6-digit space).
  3. No password hashing infrastructure (Argon2id / bcrypt missing).
  4. Missing security headers (Helmet), CSRF protection, and CORS domain restriction.
* **Commercial Quality Score**: **30 / 100** (D)
* **Improvement Plan**: Implement Argon2id password hashing, Redis/DB-backed distributed rate limiting, OWASP compliant security headers (`@fastify/helmet`), CSRF protection for cookie-based web routes, and constant-time string comparisons.
* **Priority**: **P0 (Critical Blocker)**

---

### Category 10: Future Commercial & SaaS Readiness
* **Current Status**: Zero alignment with commercial SaaS requirements. No user profiles, subscription plans, billing status, feature flags, or team organizations.
* **Problems**:
  1. Hardcoded assumption that local app user is an anonymous single user with full rights.
  2. Codebase lacks entitlement checks (`canAccessFeature(...)`), making feature gating impossible without complete rewrites.
  3. Public website (`asterim.dev` / `apps/marketing`) is currently an unauthenticated landing page stub.
* **Commercial Quality Score**: **10 / 100** (F)
* **Improvement Plan**: Build complete Account & Entitlements platform in `@asterim/shared` and `@asterim/server`. Create full commercial identity portal on `apps/marketing` (`asterim.dev`). decouple authentication from entitlements.
* **Priority**: **P0 (Critical Blocker)**

---

## 3. Overall Audit Summary Matrix

| Category | Current Status | Commercial Score | Target Score | Priority |
| :--- | :--- | :---: | :---: | :---: |
| 1. Login Flow | Local 6-digit PIN | 15 / 100 | 100 / 100 | P0 |
| 2. Backend Auth | Custom SHA256 HMAC token | 25 / 100 | 100 / 100 | P0 |
| 3. Frontend Auth | LocalStorage token storage | 30 / 100 | 100 / 100 | P0 |
| 4. Session Lifecycle | Fixed 30-day token, no DB tracking | 10 / 100 | 100 / 100 | P0 |
| 5. WebSocket Auth | Handshake-only token check | 35 / 100 | 100 / 100 | P1 |
| 6. Adapter Auth | Local subprocess execution, un-scoped | 20 / 100 | 100 / 100 | P1 |
| 7. Token Storage | Plaintext DB secret, LocalStorage | 20 / 100 | 100 / 100 | P0 |
| 8. Device Trust | Missing | 0 / 100 | 100 / 100 | P1 |
| 9. Security Controls | Basic in-memory rate limit | 30 / 100 | 100 / 100 | P0 |
| 10. SaaS Readiness | Local-only assumption | 10 / 100 | 100 / 100 | P0 |
| **OVERALL AVERAGE** | **Legacy Local MVP Auth** | **19.5 / 100 (F)** | **100 / 100 (A+)** | **P0 Baseline** |

---

## 4. Architectural Transformation Strategy

To bridge the gap from 19.5% to commercial launch quality, Phase 2 implements a strict separation of concerns:

1. **Identity Ownership**: Centralized exclusively on `asterim.dev` (`apps/marketing`).
2. **Execution Environment**: Asterim Desktop/Web (`apps/web` & `apps/server`) consumes identity via OAuth deep-links or access tokens.
3. **Decoupled Entitlements**: Authorization checks query account capabilities (`canAccessFeature('cloud_sync')`) rather than plan strings (`isPro()`).
4. **Multi-Tenant Foundation**: Database models, JWT claims, and session records support local, self-hosted, and commercial SaaS environments seamlessly.
