# Phase 5 Remaining Implementation Plan — SaaS Foundation & Beta Release

**Document Version:** 1.0.0  
**Phase:** Phase 5.6 — SaaS Foundation & Commercial Beta Release  
**Orchestrator:** Antigravity (CTO / Lead Architect)  
**Execution Agent:** Claude Code (Execution Engineer)  
**Verification Agent:** Claude Code (QA / Test Runner)  
**Governance Source:** `docs/phase5-reconciliation.md`, `blueprint/ROADMAP.md`, `decisions.md` (DEC-028)  

---

## 1. Executive Strategy & Task Sequencing

Following the Phase 5 Reconciliation Audit (`docs/phase5-reconciliation.md`), the remaining SaaS Foundation deliverables are decomposed into 5 high-impact, vertical, and independently verifiable tasks.

```text
Phase 5.6 Master Task Progression:
┌────────────────────────────────────────────────────────────────────────┐
│  [P5.6-01] CI Test Suite Automation & ESLint Debt Resolution (P0)      │
│      │                                                                 │
│      ▼                                                                 │
│  [P5.6-02] Git Credential & SSH Auto-Detection Engine (P0)             │
│      │                                                                 │
│      ▼                                                                 │
│  [P5.6-03] Production Cloud Relay Hardening & Authentication (P0)       │
│      │                                                                 │
│      ▼                                                                 │
│  [P5.6-04] Stripe Checkout, Portal & Webhook Security (P1)             │
│      │                                                                 │
│      ▼                                                                 │
│  [P5.6-05] Multi-Stage Containerization & Release Pipeline (P1)        │
│      │                                                                 │
│      ▼                                                                 │
│  [GATE-P5-BETA] Commercial Public Beta Production Gate                 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Vertical Task Specifications

---

### Task P5.6-01: CI Test Suite Automation & ESLint Debt Resolution (P0)

#### 1. Objective
Clear all 64 pre-existing ESLint errors across `apps/server` and `@asterim/adapters`, wire the 21 Phase 5 test suites into a consolidated `pnpm run test` command in `turbo.json`, and update `.github/workflows/ci.yml` so that CI runs Typecheck, Lint, Tests, and Build with 100% green status.

#### 2. Why This Task Exists
Currently, the 21 test suites (1,540 assertions) only run when invoked manually, and `pnpm run lint` fails on `main` due to 64 mechanical lint errors. Integrating test execution and fixing lint debt converts the hand-rolled test battery into a standing CI regression gate before touching SaaS networking or billing.

#### 3. Context & Architecture
* `CLAUDE.md` and `docs/phase5-production-gate.md` §8.1.
* Lint errors primarily consist of:
  - `no-empty` (empty catch blocks without comment or logger).
  - `no-useless-assignment` (variables assigned but overwritten before read).
  - `preserve-caught-error` (rethrown errors lacking `{ cause: err }`).
  - `no-this-alias` (retained `const self = this`).

#### 4. Repository Evidence
* [`.github/workflows/ci.yml`](file:///c:/Projects/Asterim/.github/workflows/ci.yml)
* [`turbo.json`](file:///c:/Projects/Asterim/turbo.json)
* [`apps/server/src/`](file:///c:/Projects/Asterim/apps/server/src)
* [`packages/adapters/src/`](file:///c:/Projects/Asterim/packages/adapters/src)

#### 5. Implementation Scope
* **Files to Modify:**
  - `apps/server/src/**` (Fix ~40 lint errors cleanly).
  - `packages/adapters/src/**` (Fix ~24 lint errors cleanly).
  - `package.json` (root) & `apps/server/package.json`, `packages/mcp-memory-server/package.json`, `apps/web/package.json` (Add `test` scripts).
  - `turbo.json` (Add `"test": { "dependsOn": ["^build"] }`).
  - `.github/workflows/ci.yml` (Add `pnpm run test` step).
* **Files NOT to Modify:**
  - Do NOT alter any application business logic or database schemas.
  - Do NOT disable ESLint rules in `.eslintrc` / `eslint.config.js`.

#### 6. Acceptance Criteria
1. `pnpm run lint` passes across the entire monorepo with **0 errors and 0 warnings**.
2. `pnpm run test` executes all 21 test suites via Turbo and passes with **0 failures**.
3. `pnpm run typecheck` continues to pass with 0 errors.
4. `.github/workflows/ci.yml` executes Typecheck, Lint, Test, and Build in sequence.

#### 7. Verification Commands
```bash
pnpm run lint
pnpm run test
pnpm run typecheck
pnpm run build
```

---

### Task P5.6-02: Zero-Friction Git Credential & SSH Auto-Detection Engine (P0)

#### 1. Objective
Implement automatic inheritance and discovery of local SSH agent sockets (`SSH_AUTH_SOCK`, Windows OpenSSH / Pageant named pipes), query OS credential helpers (`git config --get-all credential.helper`), and provide automatic fallback conversion between HTTPS and SSH remote URLs on push failures.

#### 2. Why This Task Exists
When Asterim runs non-interactive Git synchronization (`push`, `pull`, `fetch`), developers' SSH keys or HTTPS tokens stored in OS credential managers (Git Credential Manager, macOS Keychain, Linux libsecret) must be detected automatically so Git operations never hang or fail with silent authentication errors.

#### 3. Context & Architecture
* `blueprint/ROADMAP.md` Phase 5 Deliverable 4.
* `GitProvider.ts` currently injects `GIT_TERMINAL_PROMPT: '0'` and static `GIT_SSH_COMMAND`. It must dynamically resolve the host environment's SSH agent and credential helper configuration.

#### 4. Repository Evidence
* [`apps/server/src/services/git/GitProvider.ts`](file:///c:/Projects/Asterim/apps/server/src/services/git/GitProvider.ts)
* [`apps/server/src/services/git/RemoteManager.ts`](file:///c:/Projects/Asterim/apps/server/src/services/git/RemoteManager.ts)
* [`apps/server/src/services/git/GitService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/git/GitService.ts)

#### 5. Implementation Scope
* **Files to Modify:**
  - `apps/server/src/services/git/GitProvider.ts`: Add `resolveGitEnvironment(cwd)` capturing active `SSH_AUTH_SOCK`, Windows named pipes, and system PATH.
  - `apps/server/src/services/git/RemoteManager.ts`: Implement `convertRemoteUrl(url, targetProtocol)` (HTTPS ↔ SSH) and retry fallback on authentication failure.
  - `apps/server/src/services/git/__tests__/RemoteManager.test.ts` (Create unit test suite covering URL conversion and retry logic).
* **Files NOT to Modify:**
  - Do NOT hardcode credentials or log sensitive token strings.
  - Do NOT modify `GitDriftDetector.ts` or `ProjectMemoryService.ts`.

#### 6. Acceptance Criteria
1. `GitProvider` discovers and passes `SSH_AUTH_SOCK` and Windows SSH agent configurations to child git processes.
2. `RemoteManager.push()` automatically converts `https://github.com/user/repo` to `git@github.com:user/repo.git` (or vice-versa) when initial authentication indicates protocol failure, and retries.
3. Automated unit tests verify URL conversion (HTTPS ↔ SSH) across standard GitHub, GitLab, and Bitbucket URL formats.
4. All Git test suites pass cleanly.

#### 7. Verification Commands
```bash
pnpm --filter asterim exec tsx src/services/git/__tests__/RemoteManager.test.ts
pnpm --filter asterim exec tsx src/services/git/__tests__/GitDriftDetector.test.ts
pnpm run typecheck
pnpm run build
```

---

### Task P5.6-03: Production Cloud Relay Hardening & Authentication (P0)

#### 1. Objective
Harden `apps/relay` into a secure, production-ready WebSocket broker by adding cryptographically signed tunnel registration authentication, client connection rate limiting, automatic idle tunnel reaping, and health monitoring endpoints.

#### 2. Why This Task Exists
`apps/relay` currently allows unauthenticated `register_tunnel` calls, creating a vulnerability where an unauthorized party could register an existing tunnel ID or exhaust server resources. Adding authentication tokens and rate limiting ensures safe public cloud hosting.

#### 3. Context & Architecture
* `blueprint/ROADMAP.md` Phase 5 Deliverable 1.
* `RelayClient.ts` uses ECDH + AES-GCM for payload encryption.
* Tunnel registration must require an authenticated token (`x-asterim-relay-token` or HMAC signed tunnel ID) issued by the Asterim SaaS control plane or server config.

#### 4. Repository Evidence
* [`apps/relay/src/index.ts`](file:///c:/Projects/Asterim/apps/relay/src/index.ts)
* [`apps/server/src/services/RelayClient.ts`](file:///c:/Projects/Asterim/apps/server/src/services/RelayClient.ts)
* [`packages/mcp-memory-server/src/__tests__/relay_e2e.test.ts`](file:///c:/Projects/Asterim/packages/mcp-memory-server/src/__tests__/relay_e2e.test.ts)

#### 5. Implementation Scope
* **Files to Modify:**
  - `apps/relay/src/index.ts`: Add token authentication middleware for `register_tunnel`, connection rate limiter, and idle timeout cleaner.
  - `apps/relay/src/services/TunnelAuth.ts`: HMAC signature verification for tunnel IDs.
  - `apps/server/src/services/RelayClient.ts`: Pass signed tunnel token during registration.
  - `apps/relay/src/__tests__/relay.test.ts` (Create test suite for relay authentication, rate limiting, and message forwarding).
* **Files NOT to Modify:**
  - Do NOT alter ECDH key exchange or payload encryption in `@asterim/shared`.
  - Do NOT allow plaintext payloads in the relay.

#### 6. Acceptance Criteria
1. `apps/relay` rejects unauthenticated or improperly signed `register_tunnel` attempts.
2. Legitimate workstations pair and register tunnels successfully with signed tokens.
3. E2E encrypted messages flow between mobile/web clients and local workstations with sub-50ms broker latency.
4. Tunnel connections time out and release resources cleanly upon disconnect.
5. All relay unit and E2E tests pass.

#### 7. Verification Commands
```bash
pnpm --filter @asterim/relay exec tsx src/__tests__/relay.test.ts
pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/relay_e2e.test.ts
pnpm run typecheck
pnpm run build
```

---

### Task P5.6-04: Stripe Checkout, Customer Portal & Webhook Security (P1)

#### 1. Objective
Implement end-to-end commercial Stripe billing in `apps/server`: create Stripe checkout session endpoints (`POST /api/v1/billing/checkout`), customer portal session endpoints (`POST /api/v1/billing/portal`), cryptographic webhook signature verification (`stripe.webhooks.constructEvent`), and active plan entitlement enforcement.

#### 2. Why This Task Exists
Asterim requires commercial subscription readiness for its public beta release. Users must be able to upgrade from Community (Free) to Pro / Team tiers, with automated account provisioning and entitlement updates.

#### 3. Context & Architecture
* `blueprint/ROADMAP.md` Phase 5 Deliverable 3.
* `PlanService.ts` defines tiers (`Free`, `Pro`, `Team`, `Enterprise`) and entitlement checks.
* `apps/server/src/routes/webhooks.ts` handles Stripe events, but requires signature verification via `STRIPE_WEBHOOK_SECRET`.

#### 4. Repository Evidence
* [`apps/server/src/services/PlanService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/PlanService.ts)
* [`apps/server/src/routes/webhooks.ts`](file:///c:/Projects/Asterim/apps/server/src/routes/webhooks.ts)
* [`apps/marketing/src/pages/PricingPage.tsx`](file:///c:/Projects/Asterim/apps/marketing/src/pages/PricingPage.tsx)

#### 5. Implementation Scope
* **Files to Modify:**
  - `apps/server/src/services/BillingService.ts` (New service creating Stripe Checkout and Customer Portal sessions).
  - `apps/server/src/routes/billing.ts` (New routes: `POST /checkout`, `POST /portal`, `GET /subscription`).
  - `apps/server/src/routes/webhooks.ts` (Add raw body parser and Stripe signature verification).
  - `apps/server/src/services/__tests__/BillingService.test.ts` (Unit test suite with mocked Stripe SDK).
* **Files NOT to Modify:**
  - Do NOT require credit cards for Community (Free) tier.
  - Do NOT break Sovereign Mode (BillingService must cleanly no-op when running locally without Stripe keys).

#### 6. Acceptance Criteria
1. `POST /api/v1/billing/checkout` generates valid Stripe checkout URLs with metadata mapping `accountId` and `planId`.
2. `POST /api/v1/webhooks/stripe` verifies `stripe-signature` header against `STRIPE_WEBHOOK_SECRET` before processing.
3. Valid webhook events update the account's `current_plan_id`, `subscription_status`, and `stripe_customer_id` in SQLite.
4. Pro tier entitlements (remote tunnel access, unlimited workspaces) activate immediately upon subscription update.
5. All billing test suites pass.

#### 7. Verification Commands
```bash
pnpm --filter asterim exec tsx src/services/__tests__/BillingService.test.ts
pnpm run typecheck
pnpm run build
```

---

### Task P5.6-05: Multi-Stage Production Containerization & Release Pipeline (P1)

#### 1. Objective
Create lightweight, hardened, multi-stage production Dockerfiles for `apps/server`, `apps/relay`, `apps/marketing`, and `apps/web`, and author a GitHub Actions release pipeline (`.github/workflows/release.yml`) for automated container building and npm package distribution.

#### 2. Why This Task Exists
Commercial and self-hosted deployments require reproducible, secure, minimal container images (Node.js 22 Alpine / Distroless) with zero build-tool bloat, non-root user execution, and automated release tagging.

#### 3. Context & Architecture
* `blueprint/ROADMAP.md` Phase 5 Deliverable 6.
* Packages must be built using Turbo prune and multi-stage Docker builds.

#### 4. Repository Evidence
* [`apps/server/tsup.config.ts`](file:///c:/Projects/Asterim/apps/server/tsup.config.ts)
* [`apps/relay/src/index.ts`](file:///c:/Projects/Asterim/apps/relay/src/index.ts)
* [`.github/workflows/ci.yml`](file:///c:/Projects/Asterim/.github/workflows/ci.yml)

#### 5. Implementation Scope
* **Files to Create/Modify:**
  - `Dockerfile.server` (Multi-stage build for Asterim Core + Web static bundle).
  - `Dockerfile.relay` (Multi-stage build for Cloud Relay).
  - `.dockerignore` (Exclude `node_modules`, `.turbo`, `.git`, `.asterim`).
  - `.github/workflows/release.yml` (Automated build, test, Docker image publish, and GitHub release creation on git tags `v*`).
* **Files NOT to Modify:**
  - Do NOT alter package version dependencies.

#### 6. Acceptance Criteria
1. `docker build -f Dockerfile.server -t asterim-server:test .` builds cleanly and produces an image under 180MB.
2. `docker build -f Dockerfile.relay -t asterim-relay:test .` builds cleanly and produces an image under 100MB.
3. Containers run as non-root user (`node` or `asterim`) and pass container healthchecks.
4. `.github/workflows/release.yml` validates types, tests, and builds before generating release artifacts.

#### 7. Verification Commands
```bash
docker build -f Dockerfile.server -t asterim-server:test .
docker build -f Dockerfile.relay -t asterim-relay:test .
pnpm run typecheck
pnpm run build
```

---

## 3. Immediate Next Action

The highest-value P0 task is **Task P5.6-01: CI Test Suite Automation & ESLint Debt Resolution**.

Upon approval from the Product Director, Task P5.6-01 will be written to `tasks/current.md` for Claude Code to execute.
