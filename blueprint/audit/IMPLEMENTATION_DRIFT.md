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

- **Current Implementation**: Every workspace now carries its own flat `eslint.config.js` re-exporting the shared `@asterim/eslint-config`, and `.prettierrc` / `.prettierignore` exist at the monorepo root. There is no root `eslint.config.js`; `turbo run lint` fans out to the per-package configs instead.
- **Expected Behavior**: Strict Monorepo Rules per `ENGINEERING.md`.
- **Impact**: `pnpm run lint` currently fails on `@asterim/adapters` (24 errors, mostly `no-useless-escape` in regex literals), which halts the turbo pipeline before later packages are linted. CI (`lint` + `build`) is therefore red on `main` independently of any feature work.
- **Recommended Action**: Fix or explicitly waive the `@asterim/adapters` violations so the lint gate is meaningful again. *(This entry previously stated that only `apps/marketing` used ESLint and that no Prettier configuration existed; both were out of date as of 2026-08-13 and have been corrected.)*

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

## 9. `packages/mcp-memory-server` Deep-Imports `apps/server` Source

- **Current Implementation**: The MCP memory server depends on the `asterim` workspace package and imports from its **source tree**, past any public surface:

  ```ts
  import { dbService }           from 'asterim/src/services/DatabaseService';
  import { projectMemoryService,
           DECISION_STATUSES,
           DECISION_PROVENANCES } from 'asterim/src/services/ProjectMemoryService';
  import type { CreateCodeRefInput } from 'asterim/src/services/ProjectMemoryService';
  ```

  `apps/server` declares no `exports` map, and its `"main"` is `dist/index.js` — the bundled Fastify server that calls `listen()`. The deep path is the only way to reach these modules without starting a web server, and `tsup` bundles the reached source correctly (`noExternal: ['@asterim/shared', 'asterim']`), so the emitted binary contains `DatabaseService` and `ProjectMemoryService` with no Fastify or Socket.IO.
- **Expected Behavior**: A package consumed by two runtimes should expose a declared surface. Persistence and domain logic that both the Core and out-of-process tools need should not live behind an application entrypoint.
- **Impact**: Nothing records this coupling in either manifest. Adding an `exports` field to `apps/server` — a normal, well-intentioned change — breaks the MCP server with a confusing resolution error. The surface has grown at every Phase 5.1 task: one module at P5.1-02, two at P5.1-03/04, four symbols across two modules at P5.1-05.
- **Recommended Action**: Extract a `packages/memory-core` holding `DatabaseService` and `ProjectMemoryService`, consumed by both `apps/server` and `packages/mcp-memory-server`. Until then, add an explicit note to both `package.json` files so the coupling is discoverable from the manifests rather than only from the imports.

## 10. Two Processes Write the Same SQLite File

- **Current Implementation**: `~/.asterim/asterim.db` is opened read-write by the Core server *and* by every MCP memory server process an agent spawns. Each constructs its own `DatabaseService`, and each therefore runs `init()` — `PRAGMA journal_mode = WAL`, the idempotent `CREATE TABLE IF NOT EXISTS` block, and the try/catch-wrapped `ALTER TABLE` statements — against a file another process may be writing.
- **Expected Behavior**: `ARCHITECTURE.md` describes the Core as "the only privileged process" owning SQLite. That is no longer literally true, and the specification has not caught up.
- **Impact**: Measured on 2026-08-13. WAL keeps readers clear, so `get_project_briefing` and `query_decisions` are unaffected by a concurrent Core write. Writers still serialize, and SQLite's default busy timeout is zero — before Phase 5.1, `record_decision` failed within ~1 ms with `database is locked` whenever the Core held the write lock, losing the decision. `PRAGMA busy_timeout = 5000` (added in P5.1-07) makes the writer wait instead: measured across processes, a lock held 800 ms resolved in 846 ms and one held 2500 ms in 2544 ms, while a 6000 ms hold still failed, bounded at 5023 ms. Startup is unaffected — `CREATE TABLE IF NOT EXISTS` takes no write lock when the tables already exist.
- **Recommended Action**: Update `ARCHITECTURE.md` to describe SQLite as a shared local store with the Core as its primary writer, and state the concurrency contract (WAL, bounded busy timeout, in-band failure on timeout) rather than leaving it as an implementation detail. If sustained multi-writer load ever becomes normal, route agent writes through the Core over IPC instead of widening the timeout.
