# Development Setup

## Requirements

- Node 22 or newer (`node:sqlite` is used directly; Node 18 to 21 will not start the Core).
- pnpm 9.
- Git.
- Claude Code (`claude` on PATH, or `ASTERIM_CLAUDE_BIN`) to run the primary adapter. Optional: the Antigravity CLI (`agy`).
- Windows: a compiler toolchain for `node-pty` is pulled in by pnpm on install; PowerShell is the default terminal shell.

## Install and run

```bash
pnpm install
pnpm run build            # shared → adapters → web → server (+ marketing, relay, mcp)
pnpm --filter asterim dev # Core on http://localhost:3001 (dev channel), data in ~/.asterim-dev
```

`pnpm --filter asterim dev` runs the Core from source with `tsx watch`. It serves the last built dashboard from `apps/web/dist`. For live dashboard editing run the Vite dev server as well:

```bash
ASTERIM_CHANNEL=dev pnpm --filter @asterim/web dev   # http://localhost:5173, proxies /api, /ws, /socket.io to :3001
```

The dashboard always talks to the origin that served it, so the proxy is required in Vite dev; there is no hard-coded backend port anymore.

The PIN is printed on start and written to `pairing_pin.txt` in the working directory. Open `http://localhost:3001/?pin=<pin>` to pair in one step.

## Channels and data directories

| | Stable | Dev |
| --- | --- | --- |
| Selected by | default, or `ASTERIM_CHANNEL=stable` | `ASTERIM_CHANNEL=dev` or `NODE_ENV=development` |
| Port | 3000 | 3001 |
| Data dir | `~/.asterim` | `~/.asterim-dev` |

`ASTERIM_DATA_DIR` overrides the directory on either channel. Every test suite points it at a temp directory. Never run a dev build against `~/.asterim`.

## Running the packaged binary

```bash
pnpm run build
node apps/server/dist/index.js         # stable channel, port 3000
node apps/server/dist/index.js db:status
```

The bundle contains the Core, the dashboard (`dist/web`) and the mock agent script (`dist/mock-antigravity.js`). `MOCK_AGENT=true` makes the Antigravity adapter run the mock.

## Useful environment variables

See `.env.example`. The ones you will actually touch while developing: `ASTERIM_CHANNEL`, `ASTERIM_DATA_DIR`, `PORT`, `HOST`, `MOCK_AGENT`, `ASTERIM_CLAUDE_BIN`, `ASTERIM_DEV_AUTH_BYPASS` (loopback-only, dev only).

## Where things are

See `PROJECT_CONTEXT.md` for the map. Short version: `apps/server` is the Core, `apps/web` the dashboard, `packages/adapters` the agent drivers, `packages/shared` the event and type contract, `apps/marketing` the website.

## Verifying a change

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

Then the manual gate in `docs/release-gate.md` for anything touching the core loop. Screenshots for visual changes go through a puppeteer script in `scratch/` and land in `docs/screenshots/<topic>/`.
