# Architecture Decision Records (ADR)

## ADR-001: Event Driven Architecture
**Context:** AgentDeck needs to coordinate multiple asynchronous streams of data from various agent CLIs, file system watchers, and websocket clients.
**Options Considered:**
1. Direct function calls / tight coupling.
2. Centralized Event Bus (Pub/Sub).
**Selected Option:** Centralized Event Bus.
**Rationale:** Tight coupling makes adding new agent adapters difficult. An event bus allows components (like the websocket broadcaster or the database logger) to subscribe to events without the adapters needing to know about them.
**Consequences:** Debugging flow can be slightly more complex due to indirection. Requires strict typing for event payloads.

## ADR-002: Monorepo
**Context:** The project will consist of a server, a frontend client, shared types, and multiple adapters.
**Options Considered:**
1. Multi-repo (separate repositories for each).
2. Monorepo (pnpm workspaces + Turborepo).
**Selected Option:** Monorepo.
**Rationale:** Simplifies dependency management, allows easy sharing of TypeScript interfaces between the server and the client, and makes cross-cutting refactors significantly easier.
**Consequences:** Requires upfront tooling setup. CI/CD pipelines will need to be configured to handle monorepo builds.

## ADR-003: SQLite for MVP
**Context:** We need a local database to store project metadata, configurations, and historical event logs.
**Options Considered:**
1. JSON files.
2. SQLite.
3. Local MongoDB/Postgres.
**Selected Option:** SQLite.
**Rationale:** JSON files do not scale for high-frequency logs and are prone to corruption on concurrent writes. Local MongoDB/Postgres requires the user to install a database engine, breaking the "zero setup" rule. SQLite is fast, embedded, and requires zero setup.
**Consequences:** Write concurrency is limited, but this is acceptable for a local single-user system.

## ADR-004: Socket.IO
**Context:** Real-time bidirectional communication is required between the local server and the mobile browser.
**Options Considered:**
1. Native WebSockets (ws).
2. Socket.IO.
3. Server-Sent Events (SSE).
**Selected Option:** Socket.IO.
**Rationale:** Socket.IO provides built-in reconnection logic, broadcasting rooms, and fallbacks. This is critical for mobile devices which frequently lose connection when locking the screen or switching networks.
**Consequences:** Slightly more overhead than raw WebSockets. Ties the client to the Socket.IO library.

## ADR-005: Fastify for the API Server
**Context:** The backend server needs to serve REST endpoints, host the Socket.IO server, and serve static frontend files.
**Options Considered:**
1. Express.js.
2. Fastify.
**Selected Option:** Fastify.
**Rationale:** Fastify is modern, highly performant, has built-in schema validation, and excellent TypeScript support. It is the modern standard for new Node.js projects.
**Consequences:** Different middleware ecosystem compared to Express.

## ADR-006: JSON Config for Local MVP (SUPERSEDED)

**Context:** We needed a way to manage multiple projects quickly to test the Agent Adapters, but setting up SQLite with an ORM right now would delay the core adapter logic testing.
**Options Considered:**
1. Stick with SQLite immediately.
2. Temporary JSON configuration file.
**Selected Option (ORIGINAL):** Temporary JSON configuration file (`agentdeck.config.json`).
**ACTUAL OUTCOME:** The JSON config file was never implemented. SQLite was integrated directly in Phase 4, making this ADR obsolete. The `agentdeck.config.json` file does not exist anywhere in the codebase. This ADR is kept for historical context only.
**Current State:** SQLite is the only persistence layer, implemented in `apps/server/src/services/DatabaseService.ts`.

## ADR-007: Security Model — Deferred Authentication (TECHNICAL DEBT)

**Date:** 2026-06-19  
**Context:** During MVP development, authentication (device pairing, session tokens) was deferred in favor of shipping core features. The server was intentionally left open with `origin: '*'` CORS and no WebSocket authentication.  
**Decision:** Accept this technical debt through Phase 1-5 development only.  
**Resolution Required:** Authentication must be implemented before any public release. See `release-blockers.md` BLK-001, BLK-002, BLK-003 and `production-backlog.md` P0-001, P0-002.  
**Consequences:** The codebase in its current state is not safe to expose to untrusted networks. All development and testing should be on trusted local networks only.

## ADR-008: EventBus Wildcard Pattern — Literal String Convention

**Date:** 2026-06-19  
**Context:** `EventBus.ts` emits `'*'` as a literal event name (not a true wildcard, since Node.js `EventEmitter` doesn't support wildcards). `SocketManager` and `RelayClient` both subscribe to `'*'` explicitly.  
**Decision:** Document this as an intentional convention, not a real wildcard. Any component that wants to receive ALL events must subscribe to the literal string `'*'`.  
**Future Option:** Replace `EventEmitter` with `mitt` (2KB, supports wildcards natively) when this pattern causes confusion or a true wildcard is needed.  
**Consequences:** Engineers unfamiliar with this pattern may misuse it. The convention must be documented in `architecture.md`.


### [2026-06-19] Device Pairing and Authentication Flow
- **Context**: AgentDeck exposes a local control plane that could be accessed by anyone on the local network or via the cloud relay.
- **Decision**: Implemented a 6-digit PIN system that is generated on startup. Users must enter this PIN to receive an HMAC-SHA256 signed session token. This token is required for all REST endpoints and WebSocket connections.
- **Consequences**: Secure by default. Local network attackers cannot control agents without seeing the console PIN. Remote attackers cannot blindly guess Tunnel IDs to execute commands, as E2E payloads now require the PIN for an auth handshake.

