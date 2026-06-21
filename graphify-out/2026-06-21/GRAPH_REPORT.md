# Graph Report - AgentDeck  (2026-06-21)

## Corpus Check
- 86 files · ~72,438 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 736 nodes · 860 edges · 58 communities (45 shown, 13 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 2 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `5b56edc8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_Server Core & Services|Server Core & Services]]
- [[_COMMUNITY_Relay & WebSockets|Relay & WebSockets]]
- [[_COMMUNITY_Authentication & Projects API|Authentication & Projects API]]
- [[_COMMUNITY_Server Dependencies & Configuration|Server Dependencies & Configuration]]
- [[_COMMUNITY_Monorepo Configuration|Monorepo Configuration]]
- [[_COMMUNITY_Marketing Site Configuration|Marketing Site Configuration]]
- [[_COMMUNITY_Web Frontend Configuration|Web Frontend Configuration]]
- [[_COMMUNITY_Shared Type Definitions|Shared Type Definitions]]
- [[_COMMUNITY_Web Frontend Core|Web Frontend Core]]
- [[_COMMUNITY_Marketing Site Typescript Config|Marketing Site Typescript Config]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 13|Community 13]]
- [[_COMMUNITY_Community 14|Community 14]]
- [[_COMMUNITY_Community 15|Community 15]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 17|Community 17]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 19|Community 19]]
- [[_COMMUNITY_Community 20|Community 20]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 23|Community 23]]
- [[_COMMUNITY_Community 24|Community 24]]
- [[_COMMUNITY_Community 25|Community 25]]
- [[_COMMUNITY_Community 26|Community 26]]
- [[_COMMUNITY_Community 27|Community 27]]
- [[_COMMUNITY_Community 28|Community 28]]
- [[_COMMUNITY_Community 29|Community 29]]
- [[_COMMUNITY_Community 31|Community 31]]
- [[_COMMUNITY_Community 34|Community 34]]
- [[_COMMUNITY_Community 35|Community 35]]
- [[_COMMUNITY_Community 36|Community 36]]
- [[_COMMUNITY_Community 37|Community 37]]
- [[_COMMUNITY_Community 42|Community 42]]
- [[_COMMUNITY_Community 45|Community 45]]
- [[_COMMUNITY_Community 46|Community 46]]
- [[_COMMUNITY_Community 47|Community 47]]
- [[_COMMUNITY_Community 48|Community 48]]
- [[_COMMUNITY_Community 49|Community 49]]
- [[_COMMUNITY_Community 50|Community 50]]
- [[_COMMUNITY_Community 51|Community 51]]
- [[_COMMUNITY_Community 52|Community 52]]
- [[_COMMUNITY_Community 53|Community 53]]
- [[_COMMUNITY_Community 54|Community 54]]
- [[_COMMUNITY_Community 55|Community 55]]
- [[_COMMUNITY_Community 56|Community 56]]
- [[_COMMUNITY_Community 57|Community 57]]

## God Nodes (most connected - your core abstractions)
1. `AgentDeckEvent` - 25 edges
2. `compilerOptions` - 17 edges
3. `compilerOptions` - 16 edges
4. `AgentDeck Architecture` - 16 edges
5. `AgentDeck — Launch Readiness Audit` - 16 edges
6. `EventBus` - 14 edges
7. `AntigravityAdapter` - 14 edges
8. `PairingService` - 13 edges
9. `AiderAdapter` - 13 edges
10. `ClaudeAdapter` - 13 edges

## Surprising Connections (you probably didn't know these)
- `Architecture Specification` --references--> `DatabaseService`  [EXTRACTED]
  docs/architecture.md → apps/server/src/services/DatabaseService.ts
- `Architecture Specification` --references--> `EventBus`  [EXTRACTED]
  docs/architecture.md → apps/server/src/services/EventBus.ts
- `Golden Loop Verification` --references--> `EventBus`  [EXTRACTED]
  docs/golden-loop.md → apps/server/src/services/EventBus.ts
- `Release Blockers` --references--> `PairingService`  [EXTRACTED]
  docs/release-blockers.md → apps/server/src/services/PairingService.ts
- `Golden Loop Verification` --references--> `AgentService`  [EXTRACTED]
  docs/golden-loop.md → apps/server/src/services/AgentService.ts

## Import Cycles
- None detected.

## Communities (58 total, 13 thin omitted)

### Community 0 - "Server Core & Services"
Cohesion: 0.06
Nodes (22): fastify, start(), Architecture Specification, authMiddleware, authRoutes(), projectRoutes(), systemRoutes(), PendingApproval (+14 more)

### Community 1 - "Relay & WebSockets"
Cohesion: 0.07
Nodes (32): fastify, RelayClient, arrayBufferToBase64(), base64ToArrayBuffer(), decryptPayload(), deriveSharedSecret(), EncryptedPayload, encryptPayload() (+24 more)

### Community 2 - "Authentication & Projects API"
Cohesion: 0.24
Nodes (3): Production Backlog, Release Blockers, PairingService

### Community 3 - "Server Dependencies & Configuration"
Cohesion: 0.06
Nodes (33): bin, agentdeck, dependencies, @agentdeck/adapters, @agentdeck/shared, bonjour-service, chokidar, fastify (+25 more)

### Community 4 - "Monorepo Configuration"
Cohesion: 0.07
Nodes (28): devDependencies, turbo, typescript, engines, node, pnpm, name, packageManager (+20 more)

### Community 5 - "Marketing Site Configuration"
Cohesion: 0.08
Nodes (25): dependencies, react, react-dom, devDependencies, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh (+17 more)

### Community 6 - "Web Frontend Configuration"
Cohesion: 0.09
Nodes (22): dependencies, @agentdeck/shared, react, react-dom, socket.io-client, xterm, xterm-addon-fit, devDependencies (+14 more)

### Community 7 - "Shared Type Definitions"
Cohesion: 0.10
Nodes (19): AgentDeckEvent, AgentLogEvent, AgentLogPayload, AgentStatusEvent, AgentStatusPayload, ApprovalRequestEvent, ApprovalRequestPayload, ClientApprovalResponseEvent (+11 more)

### Community 8 - "Web Frontend Core"
Cohesion: 0.16
Nodes (12): App(), useAuth(), useSocket(), ApprovalOverlayProps, Dashboard(), Project, PinScreen(), Project (+4 more)

### Community 9 - "Marketing Site Typescript Config"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection, moduleResolution (+10 more)

### Community 10 - "Community 10"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+9 more)

### Community 11 - "Community 11"
Cohesion: 0.15
Nodes (6): AgentConfig, IAgentAdapter, arrayBufferToBase64(), base64ToArrayBuffer(), decryptPayload(), encryptPayload()

### Community 12 - "Community 12"
Cohesion: 0.12
Nodes (16): dependencies, fastify, @fastify/cors, socket.io, devDependencies, tsx, @types/node, typescript (+8 more)

### Community 13 - "Community 13"
Cohesion: 0.12
Nodes (15): compilerOptions, allowImportingTsExtensions, isolatedModules, jsx, lib, module, moduleResolution, noEmit (+7 more)

### Community 14 - "Community 14"
Cohesion: 0.13
Nodes (14): dependencies, @agentdeck/shared, node-pty, devDependencies, @types/node, typescript, main, name (+6 more)

### Community 15 - "Community 15"
Cohesion: 0.18
Nodes (3): Golden Loop Verification, AgentService, ApprovalManager

### Community 16 - "Community 16"
Cohesion: 0.17
Nodes (11): devDependencies, @types/node, typescript, main, name, private, scripts, build (+3 more)

### Community 17 - "Community 17"
Cohesion: 0.18
Nodes (10): compilerOptions, composite, declaration, declarationMap, outDir, rootDir, exclude, extends (+2 more)

### Community 18 - "Community 18"
Cohesion: 0.18
Nodes (10): compilerOptions, composite, declaration, declarationMap, outDir, rootDir, types, exclude (+2 more)

### Community 19 - "Community 19"
Cohesion: 0.18
Nodes (10): compilerOptions, esModuleInterop, forceConsistentCasingInFileNames, isolatedModules, module, moduleResolution, resolveJsonModule, skipLibCheck (+2 more)

### Community 20 - "Community 20"
Cohesion: 0.20
Nodes (9): compilerOptions, composite, outDir, rootDir, types, exclude, extends, include (+1 more)

### Community 21 - "Community 21"
Cohesion: 0.12
Nodes (16): Adapter System Design, AgentDeck Architecture, API Design, Database Strategy, Deployment Strategy, Event System Design, Future Cloud Synchronization Strategy, High Level Diagram (+8 more)

### Community 22 - "Community 22"
Cohesion: 0.22
Nodes (8): compilerOptions, composite, outDir, rootDir, types, exclude, extends, include

### Community 23 - "Community 23"
Cohesion: 0.25
Nodes (7): compilerOptions, allowSyntheticDefaultImports, composite, module, moduleResolution, skipLibCheck, include

### Community 27 - "Community 27"
Cohesion: 0.50
Nodes (3): AgentState, ProjectState, Task

### Community 42 - "Community 42"
Cohesion: 0.04
Nodes (44): 10. Error Handling, 11. Mobile Experience, 12. Documentation, 13. Release Packaging, 14. Developer Experience, 1. Installation, 2. Build System, 3. Cross-Platform Compatibility (+36 more)

### Community 45 - "Community 45"
Cohesion: 0.05
Nodes (37): AgentDeck — Production Backlog, Execution Order, P0-001: Device Pairing System 🔒, P0-002: Authentication Layer 🔒, P0-003: Event Persistence & Log Pruning 🔒, P0-004: Session Recovery After Crash 🔒, P0-005: Launch Wizard (First-Run Setup) 🔒, P0-006: Fix Database Path 🔒 (+29 more)

### Community 46 - "Community 46"
Cohesion: 0.08
Nodes (23): AgentDeck — Release Blockers, BLK-001: No Authentication on WebSocket or REST API, BLK-002: No Device Pairing System, BLK-003: CORS Allows All Origins, BLK-004: Relay URL Hardcoded to localhost, BLK-005: E2E Relay — Stale Closure Bug, BLK-006: No Session Recovery After Server Crash, BLK-007: Database Path Non-Deterministic (Dual DB Files) (+15 more)

### Community 47 - "Community 47"
Cohesion: 0.12
Nodes (16): AgentDeck — Golden Loop Verification, Local Mode Golden Loop, Missing Links Summary, Relay Bugs, Relay Golden Loop Sequence, Relay Mode Golden Loop, Relay Path (Remote Mobile Access), Sequence Diagram (+8 more)

### Community 48 - "Community 48"
Cohesion: 0.20
Nodes (10): [2026-06-19] Device Pairing and Authentication Flow, ADR-001: Event Driven Architecture, ADR-002: Monorepo, ADR-003: SQLite for MVP, ADR-004: Socket.IO, ADR-005: Fastify for the API Server, ADR-006: JSON Config for Local MVP (SUPERSEDED), ADR-007: Security Model — Deferred Authentication (TECHNICAL DEBT) (+2 more)

### Community 49 - "Community 49"
Cohesion: 0.08
Nodes (6): AgentConfig, IAgentAdapter, AiderAdapter, AntigravityAdapter, ClaudeAdapter, ClientApprovalResponsePayload

### Community 50 - "Community 50"
Cohesion: 0.22
Nodes (4): AgentDeck Tasks, DONE, IN PROGRESS, TODO

### Community 51 - "Community 51"
Cohesion: 0.50
Nodes (3): Expanding the ESLint configuration, React Compiler, React + TypeScript + Vite

### Community 54 - "Community 54"
Cohesion: 0.22
Nodes (9): 1. Core Runtimes, 2. Native Compilation Tools, 3. Supported AI Agents (Install on PATH), AgentDeck, Documentation, Getting Started, Key Features, Prerequisites (+1 more)

### Community 55 - "Community 55"
Cohesion: 0.25
Nodes (8): AgentDeck Roadmap, PHASE 0: Research, PHASE 1: Local MVP, PHASE 2: Agent Integrations, PHASE 3: Mobile-first Experience, PHASE 4: Multi-device Support, PHASE 5: Cloud Features, PHASE 6: Commercial Release

### Community 57 - "Community 57"
Cohesion: 0.29
Nodes (6): Authentication & Authorization, Known Limitations, Local Network & Public Deployment Warnings, Reporting a Vulnerability, Security Model, Security Policy

## Knowledge Gaps
- **419 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+414 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `AgentDeckEvent` connect `Server Core & Services` to `Web Frontend Core`, `Relay & WebSockets`, `Community 49`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `PairingService` connect `Authentication & Projects API` to `Server Core & Services`, `Relay & WebSockets`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **Why does `AntigravityAdapter` connect `Community 49` to `Server Core & Services`?**
  _High betweenness centrality (0.007) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _419 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Server Core & Services` be split into smaller, more focused modules?**
  _Cohesion score 0.058173076923076925 - nodes in this community are weakly interconnected._
- **Should `Relay & WebSockets` be split into smaller, more focused modules?**
  _Cohesion score 0.06533776301218161 - nodes in this community are weakly interconnected._
- **Should `Server Dependencies & Configuration` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._