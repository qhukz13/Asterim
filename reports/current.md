# Execution Report: P5.4-01 — Cross-Process Memory Event Relay & Live Sync

**Task ID:** P5.4-01
**Phase:** Phase 5.4 — Intelligent Memory & Continuous Governance
**Status:** VERIFIED
**Date:** 2026-08-14
**Author:** Claude Code
**Branch:** `main` (working tree)

---

## 1. Summary

The loopback relay is implemented and **proven end to end**: an agent records a decision through the MCP binary in one process, and a paired Socket.IO client in a third process is told about it — no polling, no reload. With the Core stopped, the same write succeeds unchanged and the relay costs nothing.

**+98 assertions** across three new suites (51 / 23 / 24), every existing suite unchanged, `pnpm run build` 7/7.

This closes `blueprint/audit/MISSING_SPECIFICATION.md` § 4, open since P5.1-05.

Two things shaped the implementation beyond the written design, both found by reading the code rather than by testing:

- **The relay would have 401'd in production.** The global auth middleware guards everything under `/api/v1/`, and the relay carries no user session. It would have failed *silently*, because the relay swallows errors by design (§ 3.2).
- **The server binds `::`.** A token-only guard would have left the endpoint reachable from the LAN, so the route also requires a loopback source address (§ 3.3).

---

## 2. Files Changed

**Created**

| File | Lines | Purpose |
| :-- | --: | :-- |
| `apps/server/src/services/ServerRegistry.ts` | 116 | Ephemeral token + `server.json` lifecycle |
| `apps/server/src/routes/internal.ts` | 99 | Loopback endpoint, address guard, event validation |
| `apps/server/src/routes/__tests__/internal.test.ts` | 232 | Guards, HTTP paths, descriptor lifecycle |
| `packages/mcp-memory-server/src/relay-client.ts` | 92 | Descriptor discovery, fire-and-forget POST |
| `packages/mcp-memory-server/src/__tests__/relay-client.test.ts` | 226 | Real HTTP server; offline/stale/hung paths |
| `packages/mcp-memory-server/src/__tests__/relay_e2e.test.ts` | 291 | Core + MCP + Socket.IO client, three processes |

**Modified**

| File | Change |
| :-- | :-- |
| `apps/server/src/index.ts` | Registers `internalRoutes`; publishes the descriptor after `listen()` |
| `apps/server/src/middleware/authMiddleware.ts` | Exempts `/api/v1/internal/` (§ 3.2) |
| `apps/server/src/services/DatabaseService.ts` | `resolveDataDir` exported rather than re-derived |
| `packages/mcp-memory-server/src/index.ts` | `record_decision` notifies the Core |
| `packages/mcp-memory-server/package.json` | `socket.io-client` devDependency for the e2e test |

Four files were mutated for negative controls and restored.

**Not modified:** no daemon dependency, nothing written to `process.stdout` in the MCP process, no `ProjectMemoryService` logic duplicated. The § 5 prohibitions hold.

---

## 3. Implementation Details

### 3.1 Discovery is the file's existence

`ServerRegistry` writes `server.json` (mode `0600`) immediately after `listen()` resolves, so the descriptor never advertises a port that is not yet accepting connections. The token is minted per start, so a descriptor left by a crashed process cannot authorise anything against the next one — asserted directly.

On the MCP side the descriptor path is derived from `path.dirname(dbService.dbPath)` rather than re-reading `ASTERIM_DATA_DIR`, so the relay cannot point at a different data directory than the one it just wrote to.

Every failure to read it — absent, unparseable, truncated, missing fields — returns `null` and is a complete answer. The Core not running is a supported state, not an error.

### 3.2 The relay would have failed silently in production

`authMiddleware` is registered globally and guards everything under `/api/v1/` with a public-path allowlist. The relay presents a loopback token, not a Bearer session, so with `NODE_ENV=production` it would have received **401 before reaching the route** — and because `notifyCoreServer` swallows every failure by design, nothing would have surfaced. The feature would have worked in development and been dead in production, quietly.

`/api/v1/internal/` is now exempt, and the route carries its own credential instead. Mutation D removes the exemption and the assertion for it fails, so the trap cannot be reintroduced unnoticed.

### 3.3 Two guards, because the server is not loopback-only

`fastify.listen({ port, host: '::' })` — the Core binds all interfaces so phones on the LAN can reach it. An endpoint that publishes straight onto the EventBus therefore needs more than a shared secret:

1. **Loopback source address**, including the `::ffff:127.0.0.1` form a dual-stack socket reports. The token is the credential; this is why a LAN attacker never gets to guess it.
2. **Constant-time token comparison.** `===` on a secret leaks its prefix through timing, and this is cheap to do properly.

Both are covered, including a LAN request bearing a *valid* token (403, nothing published).

### 3.4 The relay is not a general event injector

`validateRelayedEvent` accepts only `memory.*` types carrying a `projectId`, and **overwrites `source` to `relay:mcp`**. Without the type check any local process could inject arbitrary event types into every connected browser's stream and into the `events` table; without the source overwrite a caller could claim to be the Core.

### 3.5 Incapable of costing the agent anything

`notifyCoreServer` returns a boolean and never throws. No descriptor returns in under 50 ms without attempting a connection; a stale descriptor pointing at a dead port fails fast on `ECONNREFUSED`; a hung Core is abandoned at 500 ms rather than when it eventually answers. All three are asserted with elapsed-time bounds, because "does not block the agent" is the actual requirement and a functional assertion would not catch a five-second stall.

The call site is `void notifyCoreServer(...)` — not awaited — so `record_decision` returns at the same speed whether or not a dashboard is open.

---

## 4. Tests / Verification

```
apps/server
  internal.test.ts ...............  51/51    (new)
  memory.test.ts .................  98/98
  ProjectMemoryService.test.ts ... 231/231

packages/mcp-memory-server
  relay-client.test.ts ...........  23/23    (new)
  relay_e2e.test.ts ..............  24/24    (new)
  resolver 42/42 · stdio_scaffold 28/28 · retrieval_tools 71/71
  record_decision 82/82 · dogfood_scenario 62/62

tsc --noEmit (mcp)  0 errors   ·   eslint (mcp)  0 errors, 3 warnings
apps/server tsc: 4 pre-existing errors, none in a file this task touched
pnpm run build:  7 successful, 7 total
```

### 4.1 Acceptance criteria

| # | Criterion | Result |
| :-- | :-- | :-- |
| 1 | Descriptor written on boot, removed on shutdown | **Met** — e2e asserts both, including `0600` permissions |
| 2 | Endpoint rejects unauthorized, publishes authorized | **Met** — 6 rejection cases, each also asserted to publish nothing |
| 3 | MCP `record_decision` reaches Socket.IO clients live | **Met** — proven across three real processes (§ 4.2) |
| 4 | Core offline: MCP completes normally, no delay | **Met** — asserted with elapsed-time bounds and durability re-read from SQLite |
| 5 | Suites pass, build clean | **Met** |

### 4.2 The end-to-end test is a standing test, not a probe

`relay_e2e.test.ts` starts the real Fastify server in its own process, pairs by PIN, connects a real Socket.IO client, then drives the built MCP binary over stdio. The assertions follow one decision the whole way:

```
PASS  the client was told, without polling or reloading
PASS  carrying the decision the agent recorded
PASS  and agent provenance preserved end to end
PASS  the Core marks itself as the relay source
```

It then kills the Core and records again:

```
PASS  the Core removed its descriptor on shutdown
PASS  record_decision still succeeds
PASS  both decisions are durable regardless of the relay
```

I recommended exactly this in the P5.3-01 report § 6.1 — cross-client sync had been argued three times by composing a store test, a listener registration, and a temporary probe, and that argument had to be re-derived each time and could not fail in CI. It now can.

### 4.3 Observed on the running dev server

The user's Asterim dev server on port 3000 picked up the change and wrote a valid descriptor to the real `~/.asterim/server.json` — live pid, correct port, `0600`. Incidental, but it is the feature working outside a fixture.

---

## 5. Negative Controls

| # | Mutation | Result | Verdict |
| :-- | :-- | --: | :-- |
| A | Loopback address check removed | 48/51 | caught — a LAN request with a valid token succeeds and publishes |
| B | Token comparison accepts any string | 45/51 | caught — 6 failures incl. the stale-token case |
| C | Relay rethrows instead of swallowing | 16/17 + uncaught | caught — the suite dies exactly as an agent's tool call would |
| D | `authMiddleware` exemption removed | 50/51 | caught — "the relay 401s under `NODE_ENV=production`" |

**D is the one worth keeping.** It is the failure I found by reading rather than by testing, it only appears in production, and it is silent. The assertion that catches it also verifies auth is still *present* (an unknown `/api/v1/` path still 404s rather than being waved through), so the exemption cannot be widened into a hole.

**C** is instructive in a different way: the mutation does not merely fail an assertion, it takes the whole test process down — which is precisely what it would do to an agent mid-`record_decision`.

---

## 6. Problems Discovered & Concerns

### 6.1 A SIGKILL'd Core leaves a stale descriptor

`registerCleanup` covers `exit`, `SIGINT` and `SIGTERM`. `SIGKILL` and a hard power loss cannot be trapped, so a descriptor can outlive its process.

The cost is bounded and measured: the next MCP write attempts one connection to a dead port and fails fast on `ECONNREFUSED`, well inside the 500 ms timeout (asserted). The decision is already committed by then, so nothing is lost. But it is a per-write cost that persists until the Core next starts.

Cheap improvement: `readDescriptor` could check `process.kill(descriptor.pid, 0)` and treat a dead pid as no descriptor. The e2e test already uses that call, so the technique is proven here. Not done because it is beyond the task's design and the current cost is a failed TCP connect on loopback.

### 6.2 Fire-and-forget vs. a short-lived process

`void notifyCoreServer(...)` is deliberate — criterion 4 requires `record_decision` not to wait. The consequence is that a process exiting immediately after the tool response could be torn down before the POST leaves. MCP servers are long-lived for a session, so this is theoretical in normal use; the e2e test allows 400 ms before killing the child for exactly this reason.

If it ever matters, the fix is to await pending relays in the SIGTERM handler rather than to await the call itself.

### 6.3 The relay covers `record_decision` only

That is complete today — it is the MCP server's only write tool. But `supersedeDecision`, status changes and rule/intent writes all exist on `ProjectMemoryService` and are published to the MCP process's own subscriber-less EventBus. The moment P5.4 or later adds a second MCP write tool, that tool will need the same two lines, and nothing structurally reminds anyone.

A tidier shape would relay from `publishMemoryEvent` itself, so any memory event a process produces is forwarded regardless of which tool caused it. That would mean touching `ProjectMemoryService`, which is shared with the Core — where relaying would be wrong, since the Core is the destination. Worth solving deliberately rather than by adding a third call site.

### 6.4 Events relayed from MCP are persisted twice over

`socketManager` writes every event carrying a `projectId` into the `events` table. A relayed `memory.decision_created` embeds the full decision, so the decision's text now lands in `project_decisions` *and* in `events.payload_json` — where it is subject to `PruningService` retention designed for transient agent telemetry.

This is the cost recorded in `IMPLEMENTATION_DRIFT.md` § 7, now reached by a second path. Not a defect, but the relay makes it easier to hit.

### 6.5 Carried forward

- **`MemoryStore` still absent from `STORE_ARCHITECTURE.md`** (P5.2-01 § 6.3).
- **Rules cannot be edited or removed; intent cannot be cleared** (P5.3-03 § 6.2, § 6.3) — both still open, both in the domain model rather than the UI.
- **No DOM test environment** (P5.2-02 § 6.3). Unchanged, though this task's suites are all non-UI and unaffected.
- `pnpm run lint` red on `@asterim/adapters`; `apps/server` has 4 pre-existing `tsc` errors. All figures local.

---

## 7. Recommended Next Step

Proceed to **P5.4-02 — Git Staleness & Drift Engine** (DEC-027). Three things to carry in:

1. **Close `MISSING_SPECIFICATION.md` § 4.** That entry lists three candidate shapes and says the Blueprint chooses none; DEC-026 chose one and it now works end to end. Leaving the audit saying the question is open is the same staleness that produced two corrections earlier in this phase (`IMPLEMENTATION_DRIFT.md` § 3 and § 7). It is a documentation edit, not a code change.
2. **Decide § 6.3 before adding a write tool.** Drift detection will want to mark decisions `STALE`, which is a write — and if it goes through MCP it needs the relay too. That is the second call site, and the right moment to choose between "every tool relays" and "the service relays".
3. **Reuse the e2e harness.** `relay_e2e.test.ts` establishes the pattern for asserting a change made in one process becomes visible in another. Drift flags will need exactly that, and the setup — Core, pairing, socket, MCP binary — is the expensive part.

One design note for drift: DEC-027 is explicit that human-confirmed decisions are never automatically mutated. If a drift flag is stored as a `STALE` status transition, it *is* a mutation, and it will emit `memory.decision_updated` with `previousStatus: 'ACTIVE'` — indistinguishable from a human marking it stale. Drift may need its own field rather than borrowing the lifecycle, or the event needs to say who caused it.
