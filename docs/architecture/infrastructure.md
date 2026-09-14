# Infrastructure and Operations

## WHAT

There is no hosted Asterim. The deliverables are:

- the `asterim` npm package (Core + bundled dashboard + mock agent), run on the developer's machine;
- the static marketing site (`apps/marketing`), hostable on any static host;
- optionally the Cloud Relay container (`Dockerfile.relay`), frozen at launch;
- a Core container (`Dockerfile.server`) that only makes sense with the mock agent, since agent CLIs are not in the image.

## Build and release

- `pnpm run build` (turbo): `shared → adapters → web → server` (server copies `apps/web/dist` to `dist/web` and `mock-antigravity.js` to `dist/`), plus marketing, relay, mcp-memory-server.
- CI: `.github/workflows/ci.yml` runs typecheck, lint, test, build on push/PR. `release.yml` drafts a release and smoke-tests the images on tags. Publishing to npm is task P0-06 (founder owns the npm account).
- Versioning: `apps/server/package.json` `version` is what `/api/v1/system/channel` reports and what the footer status line should show.

## Runtime configuration

See `.env.example` (rewritten 2026-09-08; the `AGENTDECK_*` names are gone). Defaults: port 3000, `HOST=::`, data in `~/.asterim`, stable channel, no relay, no push, no Stripe.

## Logs, crashes, backups

- `<dataDir>/server.log` (stdout/stderr redirected, truncated on start), `<dataDir>/crash.log` (uncaught errors), `<dataDir>/audit.log` (frozen enterprise feature).
- Backup is the data directory. `asterim db:snapshot` writes a consistent copy; `asterim data:backup` / `data:restore` wrap it.
- No error tracking or analytics service exists, by decision: the MVP ships a local usage summary and transmits nothing (`docs/product/metrics.md`, task P0-11). Whether anything is ever sent is FD-F, decided after the first users.

## Security posture of a default install

- Listens on all interfaces so phones can pair; set `HOST=127.0.0.1` on shared networks.
- Plain HTTP; TLS is out of scope for a LAN tool at launch (document, do not pretend).
- Every `/api/v1/` route needs a token; the dev bypass needs an explicit flag and loopback.

## Monitoring (launch minimum)

Nothing runs server-side, and nothing is transmitted. The founder's instruments are the soft-launch interviews (`docs/product/experiments.md`) and the local usage summary a user chooses to share (P0-11). The "copy diagnostics" button (P0-12) is the support tool.
