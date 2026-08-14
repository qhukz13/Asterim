# [P5.6-03] — Production Cloud Relay Hardening & Authentication

**Task ID:** P5.6-03  
**Phase:** Phase 5.6 — SaaS Foundation & Commercial Beta Release  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-15  

---

## 1. Objective

Harden `apps/relay` into a secure, production-ready WebSocket broker by implementing HMAC-signed tunnel registration authentication, connection and registration rate limiting, automatic idle tunnel reaping, health and telemetry metrics endpoints, and update `RelayClient.ts` in `apps/server` to sign tunnel registrations.

---

## 2. Why This Task Exists

`apps/relay` currently operates as an unauthenticated prototype where any client can register or join any tunnel ID. In a production cloud deployment, unauthenticated tunnel registration permits tunnel ID hijacking, griefing, and resource exhaustion attacks.

Adding HMAC signature authentication, per-IP rate limiting, idle tunnel garbage collection, and observability metrics ensures Asterim's Cloud Relay can be deployed safely to public cloud infrastructure (Fly.io / AWS / GCP) while maintaining blind E2E encryption where the relay has zero plaintext access to project data.

---

## 3. Context

* **Blueprint Reference**: `blueprint/ROADMAP.md` Phase 5 Deliverable 1.
* **Phase 5 Reconciliation**: [`docs/phase5-reconciliation.md`](file:///c:/Projects/Asterim/docs/phase5-reconciliation.md) (§2.1 & §4 Task P5.6-03).
* **DEC-028 (Local-First Data Sovereignty)**: The relay server acts strictly as an untrusted blind packet forwarder. All payload data transiting `apps/relay` is End-to-End Encrypted (ECDH `P-256` + AES-GCM `256`).

---

## 4. Repository Evidence

Inspect:
* [`apps/relay/src/index.ts`](file:///c:/Projects/Asterim/apps/relay/src/index.ts)
* [`apps/relay/package.json`](file:///c:/Projects/Asterim/apps/relay/package.json)
* [`apps/server/src/services/RelayClient.ts`](file:///c:/Projects/Asterim/apps/server/src/services/RelayClient.ts)
* [`packages/mcp-memory-server/src/__tests__/relay_e2e.test.ts`](file:///c:/Projects/Asterim/packages/mcp-memory-server/src/__tests__/relay_e2e.test.ts)
* [`turbo.json`](file:///c:/Projects/Asterim/turbo.json)

---

## 5. Implementation Scope

1. **HMAC-Signed Tunnel Registration (`apps/relay` & `apps/server`)**:
   - In `apps/relay/src/`:
     - Implement signature verification for `register_tunnel`:
       - Payload format: `{ tunnelId: string, signature?: string, timestamp?: number }` (or backward-compatible string if secret is unset).
       - When `RELAY_SECRET` environment variable is present, compute `HMAC-SHA256(tunnelId + ":" + timestamp, RELAY_SECRET)` and verify with `crypto.timingSafeEqual`.
       - Enforce timestamp freshness (e.g. within 5 minutes of server time) to prevent replay attacks.
       - If `RELAY_SECRET` is unset (local development mode), permit registration while logging a development notice.
       - Emit `tunnel_registered` on success, `tunnel_error` (`{ code: 'AUTH_FAILED', message }`) on failure.
   - In `apps/server/src/services/RelayClient.ts`:
     - Read `ASTERIM_RELAY_SECRET` (or `RELAY_SECRET`) from environment.
     - When secret is present, generate timestamp and HMAC signature and transmit `{ tunnelId, signature, timestamp }` during `register_tunnel`.

2. **Rate Limiting & Resource Protection (`apps/relay/src/index.ts`)**:
   - Connection limiter: Cap maximum active socket connections per IP address (default: 50).
   - Event rate limiter: Cap `register_tunnel` and `join_tunnel` events per IP (e.g. max 20 events per minute). Emit `tunnel_error` with `RATE_LIMITED` code when exceeded.
   - Automatic Idle Tunnel Reaper: Sweep tunnels where the host server disconnected or where no messages have flowed for > 15 minutes, freeing memory.

3. **Health & Observability Metrics (`apps/relay/src/index.ts`)**:
   - Enhance `GET /health` to return:
     ```json
     {
       "status": "ok",
       "service": "asterim-relay",
       "version": "0.1.0",
       "uptime": 123.4,
       "activeTunnels": 3,
       "connectedSockets": 5,
       "authMode": "hmac_enabled" // or "development_open"
     }
     ```
   - Add `GET /metrics` returning JSON / Prometheus counters (total connections, total tunnels created, messages forwarded, auth rejections).

4. **Automated Unit Test Suite**:
   - Create `apps/relay/src/__tests__/relay.test.ts`:
     - Test tunnel registration with valid HMAC signature → success.
     - Test tunnel registration with invalid signature / expired timestamp → rejected with `AUTH_FAILED`.
     - Test development mode (no secret) → accepts registration.
     - Test mobile client joining an existing tunnel vs non-existent tunnel.
     - Test E2E message forwarding between workstation and mobile client within a tunnel.
     - Test tunnel isolation (messages in Tunnel A never leak to Tunnel B).
     - Test disconnect cleanup and client notification.
     - Test rate limiting on rapid repeated connections.
   - Add `"test": "tsx src/__tests__/relay.test.ts"` to `apps/relay/package.json`.

---

## 6. Explicitly Forbidden Changes

* Do **NOT** decrypt, log, or inspect payload bytes in `apps/relay` (blind forwarder invariant).
* Do **NOT** break backward compatibility of `packages/mcp-memory-server/src/__tests__/relay_e2e.test.ts`.
* Do **NOT** store plaintext persistent data in `apps/relay` (in-memory routing tables only).

---

## 7. Acceptance Criteria

1. `apps/relay` enforces HMAC signature validation on `register_tunnel` when `RELAY_SECRET` is set.
2. `RelayClient.ts` signs tunnel registrations using `ASTERIM_RELAY_SECRET` when configured.
3. Rapid invalid connection/registration attempts are throttled by per-IP rate limiting.
4. `GET /health` and `GET /metrics` report accurate operational telemetry without exposing sensitive tunnel keys.
5. `apps/relay/src/__tests__/relay.test.ts` passes all test cases cleanly.
6. All 23 monorepo test suites pass via `pnpm run test` (1,650+ assertions, 0 failures).
7. `pnpm run typecheck`, `pnpm run lint`, `pnpm run build` all pass with 0 errors.

---

## 8. Definition of Done

- [ ] HMAC signature verification implemented on `apps/relay`
- [ ] `RelayClient.ts` updated to transmit HMAC signatures
- [ ] Rate limiting and idle tunnel cleanup active
- [ ] `apps/relay/src/__tests__/relay.test.ts` created and passing
- [ ] `pnpm run test` passes across all packages (including `apps/relay`)
- [ ] Monorepo CI gates pass: typecheck, lint, test, build

---

## 9. Verification Commands

```bash
# Run relay unit test suite
pnpm --filter @asterim/relay exec tsx src/__tests__/relay.test.ts

# Run cross-process relay E2E test
pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/relay_e2e.test.ts

# Run full monorepo CI pipeline
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 10. Self-Review Requirements

- Verify timing-safe comparison (`crypto.timingSafeEqual`) is used for HMAC verification.
- Verify `relay_e2e.test.ts` passes without regressions.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
