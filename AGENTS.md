# AgentDeck — Agent Guide

## Commands

```
pnpm install          # install all workspaces
pnpm dev              # turbo run dev (all apps in parallel)
pnpm build            # turbo run build
pnpm lint             # turbo run lint
pnpm clean            # turbo run clean
```

- **Server dev**: `apps/server` — `tsx watch src/index.ts`
- **Web dev**: `apps/web` — Vite on `:5173` (PWA with auto-update)
- **Relay dev**: `apps/relay` — `tsx watch src/index.ts`
- To run one workspace: `pnpm --filter <name> <script>` (e.g. `pnpm --filter agentdeck dev`)

No test framework is configured.

## Monorepo Map

| Path | Package | Entry | Build |
|---|---|---|---|
| `apps/server` | `agentdeck` (CLI) | `src/index.ts` | `tsup` → CJS, `tsx watch` for dev |
| `apps/web` | `@agentdeck/web` (React PWA) | `src/main.tsx` | `tsc && vite build` |
| `apps/relay` | `@agentdeck/relay` (cloud relay) | `src/index.ts` | `tsc` |
| `apps/marketing` | `@agentdeck/marketing` (landing) | Vite React app | `tsc -b && vite build` |
| `packages/shared` | `@agentdeck/shared` | `src/index.ts` | `tsc` |
| `packages/adapters` | `@agentdeck/adapters` | `src/index.ts` | `tsc` |

See `pnpm-workspace.yaml` for the workspace glob.

## Server Build Quirks

- `tsup.config.ts` bundles `@agentdeck/shared` and `@agentdeck/adapters` via `noExternal`, but externalizes `node:sqlite`, `node-pty`, `chokidar`, `fastify`, `socket.io`, `socket.io-client`, `simple-git`, `web-push`, `@fastify/cors`, `@fastify/static`, `bonjour-service`.
- The server **build copies** `apps/web/dist` into its own `dist/web/` — the CJS output must serve the frontend from `__dirname + '/web'`.
- `apps/server` has a shebang banner (`#!/usr/bin/env node`), making it a CLI.

## Database

- Built-in `node:sqlite` (Node 22+). No ORM — raw SQL via `DatabaseSync`.
- **Location**: `~/.agentdeck/agentdeck.db` (override via `AGENTDECK_DATA_DIR` env).
- **Tables**: `projects`, `events`, `settings`, `sessions`.
- Schema is created on startup (`CREATE TABLE IF NOT EXISTS`).
- Crash logs written to `~/.agentdeck/crash.log`.

## Authentication

- **Public**: `POST /api/v1/auth/pair` (body: `{ pin }`) → returns `{ token }`
- **Protected**: All other `/api/v1/` routes require `Authorization: Bearer <token>`
- Token: HMAC-SHA256, 30-day expiry. Pin is 6 digits, regenerated on server restart.
- Rate limit: 10 attempts per 15 minutes per IP (in-memory, resets on restart).
- **The `*` CORS origin has been removed** — see `apps/server/src/index.ts` for the `isLocalOrigin` check (loopback, LAN subnets, `.local`, relay URL).
- `pairing_pin.txt` written to CWD on startup.

## Architecture Notes

- **EventBus** (`apps/server/src/services/EventBus.ts`): singleton Node `EventEmitter` with increased max listeners (100). Catch-all uses literal `'*'` string (not a real wildcard). Subscribers must listen on `'*'` explicitly.
- **Socket.IO** for real-time: `SocketManager` in `apps/server/src/sockets/socketManager.ts`.
- **Adapter interface** in `@agentdeck/shared` (`IAgentAdapter`). Implementations: `AiderAdapter`, `ClaudeAdapter`, `AntigravityAdapter`.
- `EventBus` ADR is documented in `docs/decisions.md` (ADR-008).
- **Graphify knowledge graph** exists at `graphify-out/` → see `.agents/rules/graphify.md`.
- `.agents/skills/` contains caveman-mode skills for OpenCode sessions.

## Linting

- ESLint per-package (no root config). Run `turbo run lint` for the whole repo.
- `apps/marketing` uses ESLint flat config (`eslint.config.js`); others likely older format.
- No formatter (prettier) configured.

## Prerequisites

- `node >=18`, `pnpm >=9`
- `node-pty` requires native build tools (VS Build Tools / Xcode CLT / build-essential)
- Supported agents on PATH: `claude` (Claude Code), `aider` (Aider Chat)

## Docs

- `docs/architecture.md` — system design, event system, security model
- `docs/decisions.md` — ADR log (includes ADR-008 EventBus wildcard convention)
- `docs/roadmap.md`, `docs/tasks.md`
- `SECURITY.md` — pairing / token / CORS details
