# P0-06: Publish the `asterim` package to npm from the release workflow

**Objective.** `npm install -g asterim && asterim` works on a clean machine and matches the landing page.

**Context.** The site and docs give one install command. The package name is free on npm (checked 2026-09-08). `apps/server` is already `"private": false` with a `bin` entry and a `files: ["dist"]` list; `pnpm --filter asterim build` produces `dist/index.js` (Core + adapters bundled by tsup), `dist/web/` (dashboard) and `dist/mock-antigravity.js`.

**Why this exists.** Without a published package every visitor fails at minute one (feature inventory, Marketing rows; roadmap Phase 2).

**Files and systems involved.** `apps/server/package.json`, `apps/server/tsup.config.ts`, `.github/workflows/release.yml`, `README.md`.

**Current behaviour.** `npm view asterim` → 404. The release workflow drafts a GitHub release and smoke-tests Docker images; it does not publish to npm.

**Desired behaviour.** Tagging `v0.2.0` publishes `asterim@0.2.0` with `dist/` only, provenance enabled, and the README shown on npm is the root README.

**Implementation requirements.**
- Add `description`, `repository`, `license: MIT`, `keywords`, `engines.node: ">=22"` to `apps/server/package.json`; set `version` to `0.2.0`.
- Dependencies that tsup marks `external` (`node-pty`, `fastify`, `socket.io`, `simple-git`, `web-push`, `@fastify/*`, `bonjour-service`, `chokidar`, `socket.io-client`) must be in `dependencies` (they are). `node:sqlite` needs no package.
- Copy the root `README.md` into `apps/server/` at build time (or add a short package README) so npm shows something honest.
- In `release.yml`: on `v*` tags run `pnpm install --frozen-lockfile`, `pnpm run build`, then `npm publish --provenance --access public` inside `apps/server` with `NODE_AUTH_TOKEN` from a repository secret. Founder creates the npm token.
- Verify on a clean VM (or a fresh user account): install, run, pair, first task.

**Constraints.** Do not publish `@asterim/*` workspace packages; only `asterim`. Do not change the bundle layout the Core expects (`dist/web`, `dist/mock-antigravity.js`).

**Edge cases.** `node-pty` needs a prebuilt binary or a compiler on the target; document the failure mode in Docs → Troubleshooting. Windows path with spaces in the global npm prefix.

**Acceptance criteria.**
- [ ] `npm install -g asterim@0.2.0` succeeds on Windows 11, macOS and Ubuntu 24.04 with Node 22.
- [ ] `asterim` prints the URL and PIN; the dashboard pairs; the first-run wizard detects Claude Code.
- [ ] `npm view asterim` shows the honest README and the MIT licence.
- [ ] The release workflow publishes only on tags and only after typecheck, lint, test and build pass.

**Testing requirements.** Run `tools/e2e/core-loop.mjs` against the installed binary on at least one platform; record the output in the release notes.

**Done definition.** Package live, three-platform install verified, landing page install command unchanged and true.
