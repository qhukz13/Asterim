# Execution Report: P5.6-03 — Production Cloud Relay Hardening & Authentication

**Task ID:** P5.6-03  
**Phase:** Phase 5.6 — SaaS Foundation & Commercial Beta Release  
**Status:** IMPLEMENTED & VERIFIED  
**Date:** 2026-08-15  
**Author:** Claude Code  

---

## 1. Summary

`apps/relay` is no longer an open prototype. Tunnel registration is authenticated with an
HMAC-SHA256 signature over `tunnelId:timestamp`, compared in constant time and refused outside a
five-minute freshness window, so a captured registration cannot be replayed to hijack a tunnel id.
Per-address limits cap concurrent sockets (50) and registration/join events (20/minute), and an idle
reaper closes tunnels whose host has gone or that have been silent for 15 minutes. `GET /health` and
`GET /metrics` report operational telemetry — counters only, never a tunnel id, which is itself a
join credential.

`RelayClient` signs its registration when `ASTERIM_RELAY_SECRET` (or `RELAY_SECRET`) is set and
falls back to the legacy bare-string payload when it is not, so a development relay keeps working.

The relay's single `index.ts` was split into a testable `createRelayServer()` factory plus a thin
entry point. A new **71-assertion** suite drives a real relay on an ephemeral port with real
socket.io clients, and is wired into `pnpm run test` — now **23 suites / 1,700 assertions**. The
whole thing was also verified end to end by running the real Core against the real relay with a
matching and then a deliberately wrong secret (§4.3). All four CI gates pass.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `apps/relay/src/relayServer.ts` | Created | `createRelayServer()`: HMAC authorisation, rate limiting, idle reaper, tunnel routing, `/health`, `/metrics` |
| `apps/relay/src/index.ts` | Modified | Reduced to a config-from-environment entry point |
| `apps/relay/src/__tests__/relay.test.ts` | Created | 71 assertions over auth, joining, forwarding, isolation, cleanup, telemetry, limits, reaping |
| `apps/relay/package.json` | Modified | `test` script; `socket.io-client` devDependency (the suite needs a client) |
| `apps/server/src/services/RelayClient.ts` | Modified | `buildRegistration()` signs when a secret is configured; logs the relay's verdict |
| `pnpm-lock.yaml` | Modified | Lockfile for the added devDependency |

## 3. Implementation Details

### 3.1 HMAC-signed registration

```
signature = HMAC-SHA256(`${tunnelId}:${timestamp}`, secret)   // hex
```

`authorizeRegistration(payload, { secret, now, timestampToleranceMs })` is a pure function returning
a verdict, which is why most of the security surface is testable without a socket:

| Condition | Verdict |
| :--- | :--- |
| Tunnel id outside `^[A-Za-z0-9_.-]{1,64}$` | `INVALID_TUNNEL` |
| No secret configured | accepted (development mode) |
| Secret set, no signature or timestamp | `AUTH_FAILED` |
| `|now − timestamp| > 5 min` | `AUTH_FAILED` |
| Signature mismatch | `AUTH_FAILED` |
| Otherwise | `{ ok: true, tunnelId }` |

Comparison is `crypto.timingSafeEqual` over the hex buffers, guarded by a length check first —
`timingSafeEqual` throws on unequal lengths, so a truncated signature would otherwise crash the
handler rather than be rejected. Asserted directly.

The tunnel-id pattern matters beyond hygiene: the id becomes a socket.io room name and a map key, so
an unbounded string is a memory-growth vector from an unauthenticated event.

Development mode (no `RELAY_SECRET`) accepts the legacy bare-string payload and prints a startup
warning naming the risk. `authMode` on `/health` reports `development_open` vs `hmac_enabled`, so an
operator can see from outside which mode a deployment is in.

### 3.2 Rate limiting and resource protection

| Control | Default | Behaviour |
| :--- | :--- | :--- |
| Concurrent sockets per address | 50 (`RELAY_MAX_CONNECTIONS_PER_IP`) | Over the cap: `tunnel_error { code: 'RATE_LIMITED' }`, then disconnect on the next tick so the reason actually reaches the client |
| `register_tunnel` + `join_tunnel` per address | 20/minute (`RELAY_MAX_EVENTS_PER_MINUTE`) | Sliding window; over budget emits `RATE_LIMITED` and the event is dropped |
| Idle tunnels | 15 min (`RELAY_IDLE_TUNNEL_MS`) | Swept every 60s: host gone or no traffic since the window → `tunnel_closed` to the room, record deleted |

Both limiter maps are bounded: connection counts are deleted at zero, and the event window is pruned
on every sweep, so scanning source addresses cannot grow them without bound.

Two routing fixes came with this:

- **A socket may host more than one tunnel.** The old disconnect handler `break`s after the first
  match, leaking every other tunnel that socket owned. It now closes all of them.
- **Knowing a tunnel id was enough to broadcast into it.** `tunnel_message` now requires the sender
  to actually be in the room (`NOT_IN_TUNNEL` otherwise). Both legitimate parties — the host, which
  joins on register, and the client, which joins on `join_tunnel` — are members already, so no
  existing flow changes.

### 3.3 Telemetry

`GET /health` → `{ status, service, version, uptime, activeTunnels, connectedSockets, authMode }`.
`GET /metrics` → the same header fields plus `totalConnections`, `activeConnections`,
`totalTunnelsCreated`, `activeTunnels`, `messagesForwarded`, `authRejections`,
`rateLimitRejections`, `tunnelsReaped`.

JSON rather than Prometheus text, to avoid adding a dependency to a process whose deployment surface
should stay minimal; the counters are named so a text exposition is a formatting change if it is
wanted later. **No tunnel id appears in either response** — asserted explicitly for five live tunnel
ids, because a tunnel id is the credential a mobile client uses to join.

### 3.4 `RelayClient` (`apps/server`)

`buildRegistration()` reads `ASTERIM_RELAY_SECRET` (falling back to `RELAY_SECRET`). With a secret it
emits `{ tunnelId, signature, timestamp }`; without one, the bare tunnel id, so an unhardened local
relay still works. The client now also logs `tunnel_registered` and `tunnel_error`, so a
misconfigured secret is visible in the Core's console instead of a silently dead tunnel.

The HMAC computation is deliberately duplicated (five lines) rather than shared through
`@asterim/shared`: adding a workspace dependency edge to the relay would enlarge the dependency graph
of the one process that gets deployed to public cloud infrastructure. Noted in §8.

### 3.5 Structural change

`createRelayServer(config)` builds Fastify + Socket.IO and returns `{ fastify, io, listen, close,
reapNow, metrics, authMode }`. `index.ts` reads the environment, creates one, and listens — `build`
(`tsc`) and `start` (`node dist/index.js`) are unchanged. The factory exists because the suite needs
to start and stop relays on ephemeral ports with an injected clock; `reapNow()` is exposed for the
same reason, and is the exact code the interval runs.

## 4. Verification

### 4.1 Gates

```
pnpm run typecheck  → 11 successful, 11 total (0 errors)
pnpm run lint       → 7 successful, 7 total   (0 errors)
pnpm run test       → 9 successful, 9 total   (23 suites, 1,700 assertions), exit 0
pnpm run build      → 7 successful, 7 total
```

### 4.2 The new suite — 71/71

`pnpm --filter @asterim/relay exec tsx src/__tests__/relay.test.ts`

| Group | Assertions | Covers |
| :--- | ---: | :--- |
| `authorizeRegistration` | 19 | valid signature; wrong signature; truncated signature (no throw); signature from another secret; signature bound to another tunnel; stale and future timestamps; drift inside the window; unsigned payload refused when a secret is set and accepted when not; six unusable tunnel ids; empty payload |
| Development relay | 3 | bare string accepted, `authMode: development_open`, tunnel counted |
| Signed relay over real sockets | 6 | signed registration opens the tunnel; impostor, legacy bare string and correctly-signed-but-stale all refused with `AUTH_FAILED`; rejections counted; no tunnel opened for them |
| Joining | 3 | host notified via `client_joined`; unknown tunnel → `TUNNEL_NOT_FOUND` with the message existing clients match on |
| Forwarding | 3 | client→host and host→client byte-for-byte; the sender is not echoed |
| Isolation | 4 | a message in tunnel A never reaches tunnel B; a non-member that knows a tunnel id is refused `NOT_IN_TUNNEL` and nothing is forwarded |
| Disconnect cleanup | 3 | `tunnel_closed` delivered, tunnel released, no longer joinable |
| `/health` + `/metrics` | 15 | field-by-field shape, counter accuracy, and no tunnel id in either body |
| Rate limiting | 4 | budget spent then `RATE_LIMITED`; registration draws on the same budget; no tunnel opened |
| Connection limiting | 5 | cap enforced, refusal delivered before disconnect, a freed slot is reusable |
| Idle reaping | 8 | young tunnel survives; traffic resets the clock; silence past the window reaps and notifies; counted; a vanished host closes its tunnel |

### 4.3 The real Core against the real relay

A relay was started with `RELAY_SECRET`, then the actual Core (`apps/server`) was started twice
against it — once with a matching `ASTERIM_RELAY_SECRET`, once with a wrong one — and the relay's
`/metrics` read between runs:

| Run | `totalTunnelsCreated` | `authRejections` | Relay log |
| :--- | :--- | :--- | :--- |
| Matching secret | 0 → **1** | 0 → 0 | `Registered a tunnel for socket …` |
| Wrong secret | 1 → **1** (unchanged) | 0 → **1** | `Rejected registration from 127.0.0.1: AUTH_FAILED` |

This exercises the signature end to end across two processes: the Core signs, the relay verifies, and
a mismatched secret opens nothing. The Core-side `tunnel_error` log line was not separately captured
in that run; the listener is three lines and its delivery path is the same one the suite asserts for
other clients.

Incidentally: after the first Core was `SIGKILL`ed, the relay still showed its tunnel as active,
because socket.io only notices a peer that vanished without a close frame at ping timeout. That is
precisely the case the idle reaper exists for.

### 4.4 No regression in the cross-process relay E2E

`pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/relay_e2e.test.ts` → **24/24**.
(That suite exercises the MCP → Core loopback relay, not `apps/relay`; it boots a real Core, whose
`RelayClient` now builds a registration on connect. Unchanged.)

## 5. Acceptance Criteria Review

- [x] **1. HMAC validation enforced when `RELAY_SECRET` is set** — `authorizeRegistration()` with
      `crypto.timingSafeEqual`; 19 unit assertions plus 6 over real sockets; confirmed against the
      real Core in §4.3.
- [x] **2. `RelayClient` signs using `ASTERIM_RELAY_SECRET`** — `buildRegistration()`; a matching
      secret registers, a wrong one is rejected (§4.3). Falls back to the bare id with no secret, so
      development relays keep working.
- [x] **3. Rapid attempts are throttled per IP** — sliding-window event limiter (20/min) and a
      concurrent-socket cap (50), both asserted, both counted in `/metrics`.
- [x] **4. `/health` and `/metrics` report accurate telemetry without exposing tunnel keys** — 15
      assertions, including an explicit check that none of five live tunnel ids appears in either
      response body.
- [x] **5. `relay.test.ts` passes cleanly** — 71/71.
- [x] **6. All 23 suites pass via `pnpm run test` (1,650+ assertions)** — 23 suites,
      **1,700/1,700**, exit 0.
- [x] **7. `typecheck`, `lint`, `build` pass with 0 errors** — 11/11, 7/7 (0 errors), 7/7.

Definition of Done:

- [x] HMAC signature verification implemented on `apps/relay`
- [x] `RelayClient.ts` updated to transmit HMAC signatures
- [x] Rate limiting and idle tunnel cleanup active
- [x] `apps/relay/src/__tests__/relay.test.ts` created and passing
- [x] `pnpm run test` passes across all packages (including `apps/relay`)
- [x] Monorepo CI gates pass: typecheck, lint, test, build

## 6. Git Diff Review

Four modified files (two of them `package.json`/lockfile) and two new files, all inside `apps/relay`
plus one server service. Reviewed against §6:

- **The blind-forwarder invariant holds.** `tunnel_message` handles `payload: unknown` and passes it
  to `socket.to(room).emit(...)` untouched — it is never parsed, decrypted, inspected, or logged.
  The forwarding path logs nothing at all; the connection and registration logs deliberately omit the
  tunnel id, which the previous implementation printed on every registration. Asserted by the
  byte-for-byte forwarding tests.
- **`relay_e2e.test.ts` is untouched and still passes 24/24.** No change to its protocol: a
  development relay still accepts the bare string, and `tunnel_registered` still carries
  `{ success: true }`.
- **Nothing is persisted.** State is three in-memory `Map`s and a counter object. No file is written,
  no database is opened, and every map is bounded (connection counts deleted at zero, event windows
  pruned each sweep, tunnels reaped).

Behaviour deliberately changed, all in service of the hardening:

1. `tunnel_message` from a socket that has not joined the tunnel is refused (`NOT_IN_TUNNEL`) instead
   of forwarded.
2. A disconnecting host closes **all** its tunnels, not just the first found.
3. `tunnel_error` payloads now carry a machine-readable `code` alongside `message`. The
   "Tunnel not found or local server disconnected" text is preserved verbatim for existing clients,
   and asserted.
4. Fastify's request logger is off in the factory (it was `logger: true`). A blind forwarder logging
   every request is noise at best; the counters on `/metrics` are the operational signal.

The new files are Prettier-clean, and `RelayClient.ts` was reformatted after editing because it was
Prettier-clean at `HEAD` and my addition broke it. `@asterim/relay` reports **0 lint problems**
(it had 1 warning before — an `any` in the old `tunnel_message` handler, now `unknown`).

## 7. Problems Discovered

1. **`crypto.timingSafeEqual` throws on unequal lengths.** A one-character signature would have
   crashed the registration handler rather than being rejected — a trivial DoS. Length is compared
   first, and the truncated-signature case is asserted.
2. **The refusal was being lost with the transport.** Emitting `tunnel_error` and calling
   `socket.disconnect(true)` in the same tick dropped the frame, so a client hitting the connection
   cap learned nothing. The disconnect moved to `setImmediate`; no handlers are bound to that socket
   in the meantime, so it can do nothing with the extra tick.
3. **The old disconnect handler leaked tunnels.** `break` after the first match meant a socket
   hosting two tunnels left one behind forever — which mattered more once tunnels were also memory
   the reaper had to account for.
4. **A tunnel id is a credential and was being logged on every registration.** The relay now logs the
   socket id only.
5. **`socket.io` does not notice a killed peer promptly** (§4.3): the relay showed a dead Core's
   tunnel as active well after the process was gone. Independent evidence that host-liveness checking
   in the reaper — not just the idle timer — is load-bearing.

## 8. Architectural Concerns

1. **The signing algorithm now exists in two places.** Five lines in `RelayClient.buildRegistration`
   and the verification half in `relayServer.authorizeRegistration`. `@asterim/shared` is the
   architecturally correct home for a contract that crosses the WebSocket boundary, and it is already
   a dependency of `apps/server` — but not of `apps/relay`, and the relay is the one process deployed
   to public cloud infrastructure, where a smaller dependency graph is a security property. I chose
   duplication and am flagging it: if the payload shape grows beyond `{tunnelId, signature,
   timestamp}`, move it to `@asterim/shared` and accept the edge.
2. **The relay authenticates the *registrant*, not the *joiner*.** `join_tunnel` is still open to
   anyone who knows a tunnel id — which is by design (the id is a pairing code and the payload is E2E
   encrypted, so a joiner without the ECDH handshake and the PIN gets nothing), but it means a leaked
   tunnel id still lets a stranger sit in the room and count traffic. Worth an explicit decision
   record rather than leaving it implicit.
3. **`/metrics` and `/health` are unauthenticated.** They expose no tunnel ids, but they do expose
   deployment activity. On Fly.io/AWS these should sit behind an internal listener or a bearer token
   before the relay is public.
4. **`RELAY_VERSION` is a constant in the source.** Reading `package.json` at runtime breaks the
   `tsc` build (`rootDir: src`), so the version is duplicated and can drift from `package.json`.
   A generated constant at build time would fix it; not worth a build step today.
5. **The rate limits are per-process and per-address.** Behind a load balancer every request appears
   to come from the balancer unless `trustProxy` and `X-Forwarded-For` are configured, which would
   collapse all clients into one bucket; and a multi-instance deployment gives each instance its own
   counters. Both need settling as part of the actual deployment task.

## 9. Recommended Next Step

**`P5.6-04` — relay deployment configuration.** The relay is now safe to expose, but nothing yet
describes *how* it gets exposed: a `Dockerfile`/`fly.toml`, `trustProxy` plus `X-Forwarded-For`
handling so the per-IP limits mean something behind a load balancer (§8.5), an internal-only or
token-guarded `/metrics` (§8.3), and the operational runbook for generating and rotating
`RELAY_SECRET` across the relay and every workstation that talks to it. That last part is the real
gap: the authentication implemented here is only as good as the secret distribution around it, and
today there is no documented way for an operator to set one.

Alternatively, **`P5.6-04b` — argument-safe git execution** (carried over from P5.6-02 §9):
`GitProvider.exec` still shells out through `child_process.exec`, and `setRemoteUrl` interpolates a
user-supplied URL into that command. `blueprint/GIT.md` §Security names it; it remains the largest
known injection surface in the Core.
