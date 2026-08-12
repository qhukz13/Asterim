# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Specification-First Workflow (non-negotiable)

This repo is Architecture-First. `blueprint/` is the normative Source of Truth; the code is the implementation of it.

- Before non-trivial work, read `blueprint/AI_CONTEXT.md` — it holds the Source of Truth Matrix mapping a domain (architecture, UI, git, business, engineering) to the one document that governs it.
- Full operating rules live in `.agents/AGENT_RULES.md` and `.agents/TASK_WORKFLOW.md`; the completion bar is `.agents/DEFINITION_OF_DONE.md`.
- Do not invent architecture, subsystems, dependencies, or product behavior. If the spec must change, write a Change Proposal from `.agents/templates/` instead of quietly changing the implementation.
- Never duplicate Blueprint rationale into code comments or `.agents/` — reference the domain document instead.

Root-level working files (not the Blueprint): `tasks.md` (current phase checklist), `decisions.md` (DEC-0XX record), `product-bugs.md`. Phase/PR/design work also produces a written report in `docs/` (e.g. `docs/phase4-5-roadmap.md`, `docs/design-00X-report.md`) — a chat summary alone doesn't close such a task.

## Commands

pnpm + turbo monorepo (`apps/*`, `packages/*`). Node ≥18, pnpm ≥9.

```bash
pnpm install
pnpm run dev              # all apps in parallel (turbo, persistent)
pnpm run build            # all packages + apps
pnpm run lint             # eslint across the repo
pnpm run format           # prettier --write .
pnpm run format:check
```

Single workspace (names matter — the server package is `asterim`, not `@asterim/server`):

```bash
pnpm --filter asterim dev              # core server, tsx watch, :3000
pnpm --filter @asterim/web dev         # dashboard PWA, vite :5173 (proxies /api and /ws to :3000)
pnpm --filter @asterim/marketing dev   # marketing/account site, vite :5174 (proxies /api to :3000)
pnpm --filter @asterim/relay dev       # cloud relay, :4000
pnpm --filter @asterim/web build
```

There is **no test runner or test script anywhere in the repo** — CI (`.github/workflows/ci.yml`) runs only `pnpm run lint` and `pnpm run build`. "Verify" in this codebase means a clean monorepo build plus manual/puppeteer checks (see Visual QA). Don't claim tests pass; say what you actually ran.

`pnpm --filter asterim build` runs `tsup` and then copies `apps/web/dist` into `apps/server/dist/web`, so the server build depends on the web build (encoded as `asterim#build` in `turbo.json`). The packaged `asterim` binary serves the dashboard as static files with an SPA catch-all that 404s only under `/api`.

## Environment

Runtime env vars actually read by the code are `PORT`, `ASTERIM_DATA_DIR`, `ASTERIM_RELAY_URL`, `MOCK_AGENT=true` (mocks the Antigravity adapter), plus `VAPID_*` for push. **`.env.example` is stale** — it documents `AGENTDECK_*` names that nothing reads, and a `~/.agentdeck` path; the real default data dir is `~/.asterim` (`asterim.db`, `crash.log`).

## Architecture

Three runtimes plus shared packages:

- **`apps/server`** (package `asterim`) — Fastify core, the only privileged process. Owns SQLite, the EventBus, agent lifecycle, git, auth, mDNS.
- **`apps/web`** (`@asterim/web`) — React 18 + Vite + zustand PWA dashboard, talks REST + Socket.IO.
- **`apps/marketing`** (`@asterim/marketing`) — React 19 marketing site *and* the account portal (login/register/pricing/docs) with hand-rolled `history.pushState` routing, no router library.
- **`packages/shared`** (`@asterim/shared`) — the contract across the WebSocket boundary: event payloads, domain types, crypto helpers. Duplicating types in server and web is an explicit anti-pattern.
- **`packages/adapters`** (`@asterim/adapters`) — the agent SDK and built-in providers.

### Event flow

Everything asynchronous goes through the singleton `EventBus` (`apps/server/src/services/EventBus.ts`), a Node `EventEmitter` that also re-emits every event on the literal `'*'` channel (ADR-008; known technical debt).

`client.*` events (from `socketManager`) → `AgentService` → `SessionManager`/adapter → PTY process. Adapter output is parsed into typed `AsterimEvent`s → EventBus → persisted to SQLite *and* broadcast over Socket.IO to the project room. Socket rooms are keyed by `projectId` and `workspace:<workspaceId>`; on join the server replays history and re-emits pending approvals.

Events carry `projectId`/`threadId` in the payload — routing and filtering depend on both being set.

### Adapters

`BaseAdapter` (`packages/adapters/src/sdk/`) wraps a `node-pty` process, owns a busy/idle command queue (commands issued while busy are queued; `y`/`n` approval replies bypass the queue), and delegates stdout parsing to a per-provider `IParser`. Providers self-register into `globalProviderRegistry` as a side effect of importing `@asterim/adapters` — `claude`, `aider`, `antigravity`. Adding a provider means a `BaseAdapter` subclass plus a `registerProvider` line in `packages/adapters/src/index.ts`. Adapter crashes must never take down the Core.

### Storage

`node:sqlite` via `DatabaseService`, a singleton with an idempotent `init()`: `CREATE TABLE IF NOT EXISTS` blocks followed by `ALTER TABLE ... ADD COLUMN` statements each wrapped in try/catch. There is no migration framework — schema changes follow that same pattern, and existing user databases at `~/.asterim/asterim.db` must keep opening.

### Auth

Two coexisting mechanisms: a 6-digit device **pairing PIN** regenerated each server start (printed to console, written to `pairing_pin.txt`; validated by `PairingService` and enforced in Socket.IO middleware) and full **user accounts** (`users`/`user_sessions`/`api_keys`, `authMiddleware` + `rbacGuard` + `entitlementGuard`). REST routes are all under `/api/v1/...`.

### Web state

Store hierarchy is specified in `blueprint/STORE_ARCHITECTURE.md` and must be respected: global `useWorkspaceStore` / `usePanelStore` / `useCommandPaletteStore` / `useInspectorStore`; scoped `useProjectStore` → `useThreadStore` → `useExecutionStore` + `useViewStore`. `InspectorStore` holds only a selection reference, never business data. The URL is the single source of truth for navigation — `Router.tsx` (`wouter`) syncs `/workspace/project/:projectId/thread/:threadId/view/:viewId` into the stores.

### Git subsystem

`GitService` orchestrates focused managers (Repository/Status/Diff/Commit/Branch/Remote/History) over `GitProvider`, which shells out to the local `git` CLI. Never use GitHub/GitLab REST APIs for routine repo operations, never store credentials (rely on the user's ssh-agent/credential manager), and agents must never commit without explicit user approval. In UI copy the feature is called **Changes**, not Git.

## UI conventions

`blueprint/DESIGN_SYSTEM.md` governs: monochrome surfaces with a single emerald accent, no "AI magic" gradients/sparkles, animations ≤200ms, everything keyboard-navigable. Colors come from CSS custom properties in `apps/web/src/styles/tokens.css` — use the tokens, don't hardcode hex values, and reuse existing components before inventing new ones.

## Visual QA

Screenshot verification uses the root `puppeteer` dependency with ad-hoc scripts in `scratch/`; captures land in `docs/screenshots/<task>/`. A stale dev server on :3000 will make captures render in a logged-in state — check what's listening before trusting a screenshot.

## Housekeeping

The repo root and `apps/*` contain leftover debug scripts (`test-*.js`, `run-loop-test*.js`, `scratch/`, `apps/server/test_*.ts`). They are not part of any build — don't treat them as reference implementations, and don't add new ones outside `scratch/`.
