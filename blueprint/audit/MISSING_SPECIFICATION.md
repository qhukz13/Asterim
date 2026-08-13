# Missing Specification

The following features or implementations exist in the codebase but are currently lacking deep coverage in the Blueprint.

## 1. Antigravity Adapter

- **Implementation**: The `packages/adapters/src/AntigravityAdapter.ts` exists and handles complex state transitions.
- **Missing Spec**: The specific edge cases, regexes, and security assumptions for Google Antigravity are not defined in `ARCHITECTURE.md`.

## 2. Event Pruning Logic

- **Implementation**: `PruningService.ts` deletes logs older than 7 days or caps at 25,000.
- **Missing Spec**: The data retention policy is an implementation detail that should be elevated to a Product Requirement in `PRODUCT.md` (e.g., "The system MUST NOT grow local storage unbounded").

## 3. PTY ANSI Parsing

- **Implementation**: The Client UI strips or parses ANSI codes to display terminal streams.
- **Missing Spec**: The exact support matrix for ANSI codes (colors, cursor movements, screen clearing) is undefined in `DESIGN_SYSTEM.md`.

## 4. Cross-Process Event Broadcasting

- **Implementation**: `EventBus` is a process-local singleton wrapping a Node `EventEmitter`. Since Phase 5.1 the Core server is no longer the only process performing domain writes: each `@asterim/mcp-memory-server` process an agent spawns constructs its own `ProjectMemoryService`, which publishes `memory.decision_created` and friends onto **its own** EventBus — one with no subscribers. The events are emitted, reach nothing, and the process exits.
- **Consequence**: A decision an agent records is durable in SQLite but invisible to the running Core. The dashboard does not react; the user sees it on the next fetch, not when it happens. Demonstrated in the P5.1-06 dogfood scenario, where two decisions were recorded across two sessions and the Core learned of neither.
- **Missing Spec**: `ARCHITECTURE.md` § 8 requires memory mutations to be broadcast, but assumes a single process. It does not say what should happen when a domain write originates outside the Core. Three shapes are possible and the Blueprint chooses none of them:
  1. **Agent writes go through the Core** over IPC or the existing REST surface, so there is still exactly one writer and one event bus.
  2. **The Core observes the database** (polling, or SQLite's update hooks / a change table) and republishes what it finds.
  3. **A cross-process transport** — a socket or named pipe — carries events between Asterim processes.
- **Why it needs deciding rather than implementing**: This is the point where "the Core is the only privileged process" stops being true (see `IMPLEMENTATION_DRIFT.md` § 10). The Golden Loop's premise is that the user sees what an agent is doing; a decision written into project memory with no visible trace is a hole in that premise, not merely a missing feature. The choice also constrains the Phase 5 cloud relay, which will need the same answer for remote agents.
