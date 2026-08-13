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

## 4. `supersededBy` Carries Two Opposite Meanings

- **Current Implementation**: `supersedeDecision` writes a bidirectional link. On a `SUPERSEDED` decision, `supersededBy` names the decision that replaced it; on the `ACTIVE` replacement, the same field names the decision it replaced. The field is documented in `packages/shared/src/types/memory.ts` as the former only, and it reaches clients through both the REST surface and the `memory.decision_superseded` event.
- **Expected Behavior**: One field, one meaning. A consumer should not have to read `status` to know which direction the link points.
- **Impact**: The back-link is also not durable — superseding B with C overwrites B's record of having replaced A. The forward chain survives; the reverse does not.
- **Recommended Action**: Introduce a distinct `supersedes` field (a second column, or a derived reverse lookup on `superseded_by`) and restore `supersededBy` to a single direction. Cheapest before a client is written against the API.

## 5. `ProjectDecision.relatedFiles` Has No Storage

- **Current Implementation**: The shared type declares `relatedFiles: string[]`, but `project_decisions` has no such column. The service derives the field from the distinct `file_path` values of the decision's code refs, and persists incoming `relatedFiles` entries as file-only `decision_code_refs` rows.
- **Expected Behavior**: If related files are a distinct concept from code anchors, they need their own storage; if they are not, the field should be removed from the type and clients should read `codeRefs`.
- **Impact**: Round-tripping a decision returns a synthetic code ref for every related file, so the two fields are not independent.
- **Recommended Action**: Decide which of the two the domain actually needs. Adding `related_files_json TEXT NOT NULL DEFAULT '[]'` via the existing idempotent `ALTER TABLE` pattern is trivial now and a data migration later.

## 6. `scope_pattern` Default Disagrees With Its Documentation

- **Current Implementation**: `architectural_rules.scope_pattern` defaults to `'*'` in the schema and in `ProjectMemoryService.createRule`, while the doc comment on `ArchitecturalRule` in `packages/shared/src/types/memory.ts` names `'**'` as the project-wide sentinel.
- **Expected Behavior**: One documented sentinel for "applies to the whole project".
- **Impact**: In glob semantics `*` does not cross path separators. A matcher written against the type comment would apply project-wide rules only to top-level files. No matcher exists yet, so nothing is currently wrong at runtime.
- **Recommended Action**: Settle the sentinel before rule matching is implemented.

## 7. Memory Events Are Not Forwarded to Clients

- **Current Implementation**: `ProjectMemoryService` publishes four `memory.*` events on the Event Bus, but `socketManager` forwards only a specific set of event types to project rooms, and `memory.*` is not among them.
- **Expected Behavior**: `ARCHITECTURE.md` § 8 requires memory mutations to be broadcast; a dashboard should react live to a decision recorded over REST.
- **Recommended Action**: Add the four types to the Socket.IO forwarding set when a memory UI is built. Note that the payloads embed full decision objects with all code refs — cheap in-process, less so over a WebSocket.

## 8. Memory Routes Carry No Authorization Beyond the Global Middleware

- **Current Implementation**: `/api/v1/projects/:id/memory/*` relies on the global `authMiddleware`, which falls back to a `defaultDevUser` whenever `NODE_ENV !== 'production'`. No `rbacGuard` or `entitlementGuard` is applied. Additionally, a cross-project supersede returns a 400 whose message discloses the owning project's id.
- **Expected Behavior**: Project-scoped resources should enforce workspace membership, and error messages should not disclose the existence or ownership of resources outside the caller's scope.
- **Impact**: Shared with `projects.ts` and `context.ts`, so this is a subsystem-wide gap rather than one introduced by Project Memory — but memory is the first store to hold durable, sensitive project reasoning.
- **Recommended Action**: Apply the existing guards to project-scoped routes as a group, and return a generic 404 for cross-project references.
