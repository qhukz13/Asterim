# Implementation Drift

Areas where the codebase has drifted from the ideal Product Specification.

## 1. Event Bus Wildcards

- **Current Implementation**: Uses the literal string `'*'` on the native Node.js `EventEmitter` to catch events (documented in legacy ADR-008).
- **Expected Behavior**: A robust pub/sub system that inherently supports wildcard namespaces (e.g., `agent.*`, `system.*`).
- **Recommended Action**: Migrate to `mitt` or `RxJS` to satisfy the `ARCHITECTURE.md` requirement without hacking the native emitter.

## 2. Database Synchronization (Client/Server)

- **Current Implementation**: The client relies on WebSocket broadcasts to update its state. If it disconnects, it might miss events and must re-fetch history on reconnect.
- **Expected Behavior**: A seamless CRDT or robust event-sourcing model where the UI never falls out of sync.
- **Recommended Action**: Formalize the reconnection and state recovery logic in `ARCHITECTURE.md` and implement it in `useSocket.ts`.

## 3. Linting & Formatting

- **Current Implementation**: `apps/marketing` uses ESLint Flat Config, while the rest of the repo does not. No Prettier configuration exists.
- **Expected Behavior**: Strict Monorepo Rules per `ENGINEERING.md`.
- **Recommended Action**: Enforce a global `eslint.config.js` and `prettierrc` at the monorepo root.
