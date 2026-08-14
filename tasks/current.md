# [P5.6-05] — Multi-Stage Production Containerization, Dockerfiles & Release Pipeline

**Task ID:** P5.6-05  
**Phase:** Phase 5.6 — SaaS Foundation & Commercial Beta Release  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-15  

---

## 1. Objective

Create hardened, minimal, multi-stage production Dockerfiles for Asterim Core Server (`Dockerfile.server`) and Cloud Relay (`Dockerfile.relay`), configure `.dockerignore`, author a comprehensive operations runbook (`docs/operations-runbook.md`) detailing all environment variables and secret rotation procedures, and establish the GitHub Actions automated release pipeline (`.github/workflows/release.yml`).

---

## 2. Why This Task Exists

Asterim's Core Server and Cloud Relay are now feature-complete, authenticated, type-checked, and test-verified. To launch the commercial public beta, operators and developers require reproducible, minimal, and secure container images (Node 22 Alpine, non-root user, container healthchecks), clear operations documentation for `RELAY_SECRET` and `STRIPE_*` configuration, and automated CI/CD release packaging on version tags.

---

## 3. Context

* **Blueprint Reference**: `blueprint/ROADMAP.md` Phase 5 Deliverable 6.
* **Phase 5 Reconciliation**: [`docs/phase5-reconciliation.md`](file:///c:/Projects/Asterim/docs/phase5-reconciliation.md) (§2.6 & §4 Task P5.6-05).
* **DEC-028 (Local-First & Data Sovereignty)**: Containerized deployment must support `ASTERIM_SOVEREIGN_MODE=true` for 100% offline operation as well as connected cloud mode.

---

## 4. Repository Evidence

Inspect:
* [`apps/server/package.json`](file:///c:/Projects/Asterim/apps/server/package.json)
* [`apps/relay/package.json`](file:///c:/Projects/Asterim/apps/relay/package.json)
* [`apps/relay/src/index.ts`](file:///c:/Projects/Asterim/apps/relay/src/index.ts)
* [`.github/workflows/ci.yml`](file:///c:/Projects/Asterim/.github/workflows/ci.yml)
* [`turbo.json`](file:///c:/Projects/Asterim/turbo.json)
* [`.gitignore`](file:///c:/Projects/Asterim/.gitignore)

---

## 5. Implementation Scope

1. **Multi-Stage Production Containerization**:
   - Create `Dockerfile.server`:
     - Stage 1 (Builder): Uses `node:22-alpine`, installs pnpm, prunes and builds `@asterim/shared`, `@asterim/web`, and `asterim` (server).
     - Stage 2 (Runner): Minimal `node:22-alpine` image, non-root execution (`USER node`), exposes port `3000`, defines volume `/home/node/.asterim`, sets `NODE_ENV=production`.
     - Includes built-in `HEALTHCHECK` probing `GET /health` or `GET /api/v1/system`.
   - Create `Dockerfile.relay`:
     - Stage 1 (Builder): Prunes and builds `apps/relay`.
     - Stage 2 (Runner): Minimal `node:22-alpine` image, non-root execution (`USER node`), exposes port `4000`, sets `NODE_ENV=production`.
     - Includes built-in `HEALTHCHECK` probing `GET /health`.
   - Create `.dockerignore` excluding `.git`, `node_modules`, `.turbo`, `*.log`, `agentdeck.db`, `~/.asterim`, and scratch files.

2. **Operations & Environment Runbook (`docs/operations-runbook.md`)**:
   - Create authoritative operations runbook documenting:
     - **Core Server Configuration**: `PORT`, `HOST`, `ASTERIM_DATA_DIR`, `ASTERIM_SOVEREIGN_MODE`.
     - **Cloud Relay Configuration & Secret Generation**: `RELAY_SECRET`, `ASTERIM_RELAY_URL`, `ASTERIM_RELAY_SECRET`, `RELAY_MAX_CONNECTIONS_PER_IP`, `RELAY_MAX_EVENTS_PER_MINUTE`, `RELAY_IDLE_TUNNEL_MS`.
     - **Stripe SaaS Billing Configuration**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM`.
     - **Docker Deployment Recipes**: `docker run` commands for Core Server (with volume mount) and standalone Cloud Relay.
     - **Secret Rotation Playbook**: Zero-downtime rotation instructions for Relay HMAC secrets and Stripe webhook keys.

3. **Release Automation Pipeline (`.github/workflows/release.yml`)**:
   - Trigger on git tag push `v*` (e.g. `v0.1.0`).
   - Executes validation jobs:
     - `Typecheck` (`pnpm run typecheck`)
     - `Lint` (`pnpm run lint`)
     - `Test` (`pnpm run test`)
     - `Build` (`pnpm run build`)
   - Builds Docker images (`asterim-server`, `asterim-relay`).
   - Publishes GitHub Release draft with generated release assets.

---

## 6. Explicitly Forbidden Changes

* Do **NOT** run containers as `root` (enforce `USER node`).
* Do **NOT** bake secrets, private keys, or API tokens into Docker images.
* Do **NOT** break any existing tests or build commands.

---

## 7. Acceptance Criteria

1. `Dockerfile.server` and `Dockerfile.relay` build minimal, production-ready images using multi-stage builds and run as non-root user.
2. `docs/operations-runbook.md` provides complete, accurate documentation of all environment variables, secret rotation, and deployment recipes.
3. `.github/workflows/release.yml` triggers on version tags and enforces all quality gates before release packaging.
4. All 24 test suites pass via `pnpm run test` (1,802+ assertions, 0 failures).
5. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`, `pnpm run build`.

---

## 8. Definition of Done

- [ ] `Dockerfile.server` created and valid
- [ ] `Dockerfile.relay` created and valid
- [ ] `.dockerignore` created
- [ ] `docs/operations-runbook.md` authored
- [ ] `.github/workflows/release.yml` created
- [ ] All 24 test suites pass (1,802 assertions)
- [ ] Monorepo CI gates pass cleanly

---

## 9. Verification Commands

```bash
# Verify test suites
pnpm run test

# Run full monorepo CI pipeline
pnpm run typecheck
pnpm run lint
pnpm run build
```

---

## 10. Self-Review Requirements

- Verify Dockerfiles use Alpine non-root `USER node` and proper volume declarations.
- Verify `docs/operations-runbook.md` covers all environment variables introduced across Phase 5.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
