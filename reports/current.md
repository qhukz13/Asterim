# Execution Report: P5.6-05 — Multi-Stage Production Containerization, Dockerfiles & Release Pipeline

**Task ID:** P5.6-05  
**Phase:** Phase 5.6 — SaaS Foundation & Commercial Beta Release  
**Status:** IMPLEMENTED & VERIFIED  
**Date:** 2026-08-15  
**Author:** Claude Code  

---

## 1. Summary

Both images exist, were **actually built and run** (podman is available on this
machine), and behave correctly: `asterim-server` at **333 MB** and
`asterim-relay` at **182 MB**, multi-stage, no toolchain or source in the final
layer, both running as `node` (uid 1000).

Building them for real rather than authoring them on faith found three things
that would have shipped broken:

1. **The relay's compiled output could not run at all.** `apps/relay` builds with
   plain `tsc` under the workspace default (`module: esnext`), which emits
   extensionless ESM imports Node cannot resolve. It went unnoticed because the
   relay was a single file until P5.6-03 split it; `node dist/index.js` failed
   with `ERR_MODULE_NOT_FOUND`. No gate covers running the built artifact.
2. **`.dockerignore` patterns are not recursive.** `*.tsbuildinfo` matched only
   the repository root, so the host's incremental build state entered the
   context and `tsc` skipped emitting entirely — an empty `dist` in a
   "successful" build.
3. **`puppeteer` was a production dependency of the workspace root**, so
   `pnpm deploy --prod` pulled it and its browser into the server image.

`docs/operations-runbook.md` documents every environment variable the code
actually reads — enumerated from the source, not from memory — plus deployment
recipes and three rotation playbooks. `.github/workflows/release.yml` gates a
`v*` tag behind typecheck, lint, test and build, then builds, smoke-tests and
archives both images and opens a draft release.

All four CI gates pass: **24 suites / 1,802 assertions**, 0 errors.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `Dockerfile.server` | Created | Multi-stage Core image: builds via turbo, deploys production-only, prunes native build artefacts, runs as `node` with a healthcheck |
| `Dockerfile.relay` | Created | Multi-stage relay image: no native deps, no volume, healthcheck |
| `.dockerignore` | Created | Keeps host build output, databases, PINs, secrets and workflow files out of the context |
| `docs/operations-runbook.md` | Created | Configuration, deployment recipes, secret generation and rotation playbooks (287 lines) |
| `.github/workflows/release.yml` | Created | Tag-triggered verify → images (+ smoke test) → draft release |
| `apps/relay/tsconfig.json` | Modified | `module: commonjs`, `moduleResolution: node` — the emitted output has to be runnable by `node dist/index.js` |
| `apps/relay/package.json` | Modified | `main`, `files: ["dist"]` |
| `apps/server/package.json` | Modified | `files: ["dist"]` |
| `apps/server/src/index.ts` | Modified | Honour `HOST` (see §6) |
| `package.json` (root) | Modified | `puppeteer` moved to `devDependencies` |
| `pnpm-lock.yaml` | Modified | Follows the puppeteer move |

## 3. Implementation Details

### 3.1 `Dockerfile.server`

**Builder** (`node:22-alpine`) installs `python3 make g++` for `node-pty`'s
native build, enables pnpm through corepack, copies manifests and the lockfile
*before* the sources so a code change reuses the dependency layer, then:

```
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=asterim     # asterim#build → @asterim/web#build
pnpm --filter=asterim --prod deploy /app       # production tree, no dev deps
```

turbo is what makes one command enough: `asterim#build` depends on
`@asterim/web#build`, and the server's own build script copies `apps/web/dist`
into `dist/web`, which the packaged binary serves. The marketing site and the
relay are not built — they are not part of this image.

Then two prunes, both measured: node-gyp's intermediate objects, and node-pty's
prebuilt addons for macOS and Windows. node-pty ships **no** Linux prebuild — on
Linux it loads the addon compiled in the builder — so those 58 MB can never be
opened. That single step took the image from 455 MB to **333 MB**, and a real
PTY spawn inside the pruned image proves nothing load-bearing was removed (§4.2).

**Runner** copies only `/app`, sets `NODE_ENV=production` and
`ASTERIM_DATA_DIR=/home/node/.asterim`, declares that path as a volume, chowns
it to `node`, drops to `USER node`, exposes 3000, and declares a `HEALTHCHECK`
that probes `/health` with Node's built-in `fetch` — no `curl` or `wget` needed
in the image.

### 3.2 `Dockerfile.relay`

Same shape without the native build. Two details worth naming:

- `pnpm install --frozen-lockfile --ignore-scripts`: a workspace install
  otherwise runs `apps/server`'s node-pty postinstall, which fails without a C
  toolchain the relay has no reason to carry. Nothing the relay depends on has a
  build step.
- `rm -rf /app/dist/__tests__`: the relay's `tsconfig` compiles `src/**`, which
  includes its test suite. Excluding tests from the tsconfig instead would have
  dropped them out of `typecheck` too, so they are removed from the image rather
  than from the build.

No volume is declared: the relay's routing tables are in memory by design and
must not be persisted.

### 3.3 `.dockerignore`

Excludes dependencies and build output (`node_modules`, `dist`, `.turbo`,
`**/*.tsbuildinfo`), local data that must never enter an image (`**/*.db`,
`pairing_pin.txt`, `**/.env*`), VCS and CI metadata, the agent workflow
directories (`tasks/`, `reports/`, `docs/`, `blueprint/`, `.agents/`) and the
leftover debug scripts `CLAUDE.md` warns about.

Every pattern that needs to match at depth is spelled `**/…`. Docker's ignore
patterns are not implicitly recursive, which is what caused §7.2.

### 3.4 The runbook

`docs/operations-runbook.md` covers, for both processes: every variable with its
default and effect, the endpoints and what authenticates them, image sizes and
contents, `docker run` recipes (including a Sovereign Mode one), healthcheck
configuration for orchestrators that ignore the image directive, reverse-proxy
caveats, secret generation, and rotation playbooks for `RELAY_SECRET`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY` and the pairing PIN.

The variable list was enumerated from the source rather than from the task text,
which turned up two corrections:

- **`HOST` did not exist.** The Core hardcoded `host: '::'`. Since the runbook
  scope names `HOST` as an operator-facing variable, and documenting a variable
  that does nothing is exactly the failure `.env.example` already demonstrates,
  it is now read (§6).
- **`VAPID_*` are not environment variables.** `CLAUDE.md` says they are; the
  keys are in fact generated on first run and stored in the `settings` table.
  The runbook says so.

Rotation is documented honestly. `STRIPE_WEBHOOK_SECRET` genuinely rotates with
zero downtime, because Stripe signs with both secrets during a roll and the
verifier accepts any matching `v1` (asserted in P5.6-04). `RELAY_SECRET` does
**not**: the relay verifies against exactly one secret, so the playbook is a
blue/green pair of relays, with the single-instance restart written out as the
accept-a-few-seconds alternative and the missing multi-secret support flagged as
a gap.

### 3.5 `release.yml`

Three jobs. `verify` runs the same four gates as CI on Node 22. `images` builds
both Dockerfiles with buildx and GHA layer caching, then **smoke-tests them**:
starts both containers, waits for `/health` on each, asserts `id -u` is 1000 in
both (the non-root requirement, enforced rather than assumed) and that the relay
reports `authMode: hmac_enabled`. It then saves gzipped image archives as
artifacts. `release` downloads those and opens a **draft** GitHub Release with
generated notes — a human decides when it goes public. Images are built, not
pushed, because no registry has been chosen; the runbook says so.

## 4. Verification

### 4.1 Gates

```
pnpm run typecheck  → 11 successful, 11 total (0 errors)
pnpm run lint       → 7 successful, 7 total   (0 errors)
pnpm run test       → 9 successful, 9 total   (24 suites, 1,802 assertions), exit 0
pnpm run build      → 7 successful, 7 total
```

### 4.2 The images, built and run

Built with `podman build` (Docker-compatible) and exercised as containers:

| Check | `asterim-server` | `asterim-relay` |
| :--- | :--- | :--- |
| Image size | **333 MB** | **182 MB** (base `node:22-alpine` is 167 MB) |
| `/app` contents | `dist`, `node_modules`, `package.json` | `dist`, `node_modules`, `package.json` |
| Runs as | `uid=1000(node)` | `uid=1000(node)` |
| `GET /health` | `{"status":"ok","service":"asterim-server",…}` | `{"status":"ok","service":"asterim-relay","version":"0.1.0","authMode":"hmac_enabled",…}` |
| `GET /metrics` | — | counters returned |
| Dashboard | `GET /` → **200** (the web build reached `dist/web`) | — |
| Data volume | `/home/node/.asterim` → `drwx------`, `asterim.db` and both WAL sidecars `-rw-------` | none, by design |
| Sovereign Mode | `ASTERIM_SOVEREIGN_MODE=true` → log reads `[RelayClient] Sovereign Mode active: Cloud Relay connection disabled.` | — |
| Production auth | `GET /api/v1/system` → 401 without a token (`NODE_ENV=production` disables the dev fallback user) | — |
| Native addon | `pty.spawn('/bin/sh', …)` inside the pruned image returned `pty-works` | n/a |

The permission row is worth calling out: the `0700`/`0600` enforcement written
in P5.5-01 is confirmed here inside a container, on a fresh volume.

### 4.3 Workflow validation

`release.yml` and `ci.yml` both parse as YAML; `release.yml` resolves to three
jobs with the intended `needs` graph (`verify` → `images` → `release`). GitHub
Actions cannot be executed locally, so the workflow is verified structurally
only — every command inside it (`pnpm run …`, `docker build -f …`) is one that
was run by hand here.

## 5. Acceptance Criteria Review

- [x] **1. Both Dockerfiles build minimal, production-ready images with
      multi-stage builds and run as non-root** — built and run (§4.2); two
      stages each, no compiler/pnpm/source in the runner, `USER node` verified
      as `uid=1000` inside both containers.
- [x] **2. The runbook documents all environment variables, secret rotation and
      deployment recipes** — 287 lines; the variable list was enumerated from
      the source and corrected two inaccuracies (§3.4); three rotation
      playbooks, with `RELAY_SECRET`'s limitation stated rather than glossed.
- [x] **3. `release.yml` triggers on version tags and enforces all gates before
      packaging** — `on: push: tags: ['v*']`; `images` and `release` both
      `needs: verify`, which runs typecheck → lint → test → build.
- [x] **4. All 24 suites pass (1,802+ assertions, 0 failures)** — 24 suites,
      1,802/1,802, exit 0.
- [x] **5. CI gates pass with 0 errors** — typecheck 11/11, lint 7/7 (0 errors),
      test 24/24, build 7/7.

Definition of Done:

- [x] `Dockerfile.server` created and valid *(built, run, probed)*
- [x] `Dockerfile.relay` created and valid *(built, run, probed)*
- [x] `.dockerignore` created
- [x] `docs/operations-runbook.md` authored
- [x] `.github/workflows/release.yml` created
- [x] All 24 test suites pass (1,802 assertions)
- [x] Monorepo CI gates pass cleanly

## 6. Git Diff Review

Five new files and six modified. Reviewed against §6:

- **Nothing runs as root.** Both runners end with `USER node`; `id` inside each
  running container returns `uid=1000(node)`. The release workflow asserts the
  same thing on every tagged build, so a regression fails CI rather than
  shipping.
- **No secret is baked into an image.** Neither Dockerfile has an `ARG` or `ENV`
  carrying a credential; every secret is supplied at `docker run`. `.dockerignore`
  excludes `**/.env*`, `pairing_pin.txt` and `**/*.db` so a developer's local
  state cannot enter a layer. Verified: the built server image's `/app` holds
  only `dist`, `node_modules` and `package.json`.
- **No test or build command broke.** All four gates pass, at the same 24
  suites / 1,802 assertions as the previous task.

Changes to existing files, each with a reason:

1. **`apps/relay/tsconfig.json` → `module: commonjs`, `moduleResolution: node`.**
   Not cosmetic: without it the relay's built output does not run (§7.1). The
   suite still passes 71/71 and `tsc --noEmit` is unaffected.
2. **`files: ["dist"]` on both apps.** `pnpm deploy` copies a package's publish
   file set; without this the image carried `src/`, `tsconfig.json`,
   `tsup.config.ts`, `eslint.config.js` and two leftover debug scripts.
3. **`puppeteer` moved to root `devDependencies`.** It is a visual-QA tool
   (`CLAUDE.md` § Visual QA); as a production dependency it was deployed into
   the server image. Still resolvable for the QA scripts — verified by requiring
   it after the move.
4. **`HOST` is now read** (`process.env.HOST || '::'`), a one-line change. The
   runbook scope names `HOST` as operator-facing; the alternative was to
   document that it does not work. Flagged here because it is product behaviour
   touched by a task whose implementation scope is Dockerfiles, docs and CI.

The new Dockerfiles and `.dockerignore` have no Prettier parser; the runbook and
`release.yml` are Prettier-clean. `apps/server/src/index.ts` was already
non-compliant before this task, so it was not reflowed.

## 7. Problems Discovered

1. **The relay's build output was not runnable.** `tsc` under the workspace
   default emits `import { … } from './relayServer'` — extensionless ESM — which
   Node resolves as ESM (it has no `"type": "module"`, but Node 22 detects module
   syntax) and then fails with `ERR_MODULE_NOT_FOUND`. The relay was a single
   file with no relative imports until P5.6-03 split it, so this broke then and
   nothing caught it: `build` compiles, `typecheck` passes, and the tests run the
   TypeScript through `tsx`. **No gate runs the built artifact.** Fixed by
   emitting CommonJS; found only because the image was actually started.
2. **`.dockerignore` patterns are not recursive.** `*.tsbuildinfo` matched the
   repository root only, so `apps/relay/tsconfig.tsbuildinfo` from the host went
   into the build context. `tsc` read it, concluded everything was up to date,
   and emitted nothing — producing an image with an empty `dist` from a build
   that reported success. Every depth-matching pattern is now `**/…`.
3. **`puppeteer` was a production dependency of the workspace root**, so
   `pnpm deploy --prod` put it — and its downloaded browser — into the server
   image. Moving it to `devDependencies` plus `PUPPETEER_SKIP_DOWNLOAD=true` in
   the builder removed ~50 MB and a large download from every build.
4. **`pnpm deploy --legacy` does not exist in pnpm 9.0.0** (added later). The
   flag is unnecessary here; removed.
5. **A workspace install compiles `node-pty` even when the target does not need
   it** — the relay build failed on a missing Python until `--ignore-scripts`.
6. **`podman` ignores `HEALTHCHECK` in OCI image format** (`--format docker`
   restores it). A Dockerfile concern only in that the runbook now tells
   operators to configure the probe themselves where the directive is dropped —
   Kubernetes ignores it too.
7. **`server.log` inside the data directory is `0644`** and contains the pairing
   PIN, which the Core prints on start. The `0700` directory keeps other users
   out, so it is contained rather than exposed — but the file's own mode is not
   covered by the `0600` enforcement that protects the database.

## 8. Architectural Concerns

1. **Nothing runs the built output.** Four gates, 24 suites, and the one failure
   mode that reaches a user first — "does the artifact start?" — is covered by
   none of them. `release.yml`'s smoke test now does this for the containers,
   but only on a tag. A `node dist/index.js --version`-style check in CI, or
   moving the container smoke test into `ci.yml`, would have caught §7.1 the day
   it was introduced.
2. **The server image cannot actually drive an agent.** `claude`, `aider` and
   `agy` are not in it, and `GET /health` in the running container reports
   `claude: false, aider: false`. A containerized Core is useful for the API,
   the dashboard and memory, but the agent adapters need their binaries mounted
   in or installed — worth a decision about whether an "agents included" image
   variant exists, because today the image quietly can't do the product's
   central job.
3. **`antigravity: true` in a container with no `agy` binary.** The same
   `/health` response claims the Antigravity adapter is available. Either the
   detection in `StartupService` has a false positive or it is reporting
   something other than binary presence; either way an operator reading `/health`
   is being told something untrue.
4. **`/app` must remain writable** because the Core writes `pairing_pin.txt` to
   its working directory. That blocks `read_only: true` root filesystems, which
   is otherwise the obvious hardening for this image. Writing the PIN into the
   (already `0700`) data directory instead would remove the constraint.
5. **Image publishing is deliberately not wired.** The workflow builds and
   archives; pushing needs a registry, an org account and credentials — all
   decisions rather than code. The archives are 7-day artifacts, which is a
   stopgap, not a distribution channel.

## 9. Recommended Next Step

**`P5.6-06` — make the gates cover the artifact, then choose a registry.** In
order:

1. **Run what is built.** Add the container smoke test from `release.yml` to
   `ci.yml`, or at minimum a `node dist/index.js` start-and-probe step for both
   apps. §7.1 was a runtime-breaking regression that lived through three tasks
   and four green gates.
2. **Settle the agent-binary question** (§8.2) and fix the `/health` binary
   report (§8.3) — an operator-facing endpoint that misreports capability is
   worse than one that reports nothing.
3. **Pick a registry** (GHCR is the path of least resistance from GitHub
   Actions) and turn the two `push: false` steps into real publishes with
   `docker/login-action`, then replace the archive artifacts in the draft release
   with image references.

Local images `asterim-server:test` and `asterim-relay:test` were left on this
machine as evidence; `podman rmi localhost/asterim-server:test
localhost/asterim-relay:test` removes them.
