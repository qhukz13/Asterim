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

## 4. Cross-Process Event Broadcasting (RESOLVED)

- **Resolution**: Resolved in Phase 5.4 (Task P5.4-01) via **DEC-026: Local Loopback Notification Bridge**. Core writes `~/.asterim/server.json` (mode 0600) with loopback URL and ephemeral token; MCP writes send non-blocking POST to `/api/v1/internal/memory-events`, publishing onto Core's `EventBus` and pushing live 0ms updates over Socket.IO to connected web clients.

## 5. Sovereign / Zero-Cloud Mode Specification

- **Context**: Phase 5.4-S Security Audit established that Asterim must support 100% air-gapped local workstation operations without background connection attempts to external cloud relays.
- **Missing Spec**: `ARCHITECTURE.md` must formalize `ASTERIM_SOVEREIGN_MODE=true` requirements:
  1. `RelayClient` completely dormant (no outbound socket attempts).
  2. `PushService` disabled by default in sovereign mode.
  3. Strict local AI execution via `ActiveAgentProvider` (local CLI).
  4. Complete air-gap guarantee with zero network requests outside `127.0.0.1`.

## 6. Pairing PIN Rate Limiting & Brute-Force Defense

- **Context**: The device pairing PIN is a 6-digit numeric code validated via `/api/v1/auth/pair`.
- **Missing Spec**: Security specification must mandate exponential backoff and temporary IP/device lockouts after 5 consecutive failed pairing attempts to prevent local-network PIN brute-forcing.
