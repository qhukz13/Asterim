# Phase 5 Reconciliation — SaaS Foundation & Beta Release

**Audit Date:** 2026-08-14  
**Auditor / Orchestrator:** Antigravity (CTO / Lead Architect)  
**Target Milestone:** Original Roadmap Phase 5 (SaaS Foundation & Beta Release)  
**Governance Authority:** `blueprint/ROADMAP.md`, `decisions.md` (DEC-028), `AGENTS.md`  

---

## 1. Executive Verdict

### **REVISE PHASE 5**

The Project Memory and Continuous Governance subsystem (Phases 5.0–5.4 + SEC-01 + Phase 5.5 Hardening) is **100% complete and production-verified** (1,540 assertions passing across 21 test suites, 0 `tsc` errors, clean monorepo build).

However, the **Original Phase 5 (SaaS Foundation & Beta Release)** in `blueprint/ROADMAP.md` contains a mixture of:
1. **Implemented & Verified Components** (E2E Encrypted Relay Client, Subscription Data Model & Webhooks, Non-Interactive Git Execution, Monorepo Typecheck CI).
2. **Missing Production-Grade Components** (Git SSH/Credential auto-detection, Stripe Checkout Session creation & signature verification, Relay authentication & Docker deployment, CI test suite automation & Lint cleanup).
3. **Architecturally Obsolete Assumptions** (Centralized cloud PostgreSQL database and cloud state sync for project memory/code, which directly violate the `DEC-028` Local-First Data Sovereignty mandate).

Phase 5 must be **reconciled and revised**: we must complete the genuine SaaS & release engineering capabilities without compromising the local-first, data-sovereign architecture.

---

## 2. Audit of Original Phase 5 Deliverables

### 2.1 Cloud API & Relay Orchestrator
* **Status:** **PARTIAL (PROTOTYPE)**
* **Evidence:**
  * [`apps/relay/src/index.ts`](file:///c:/Projects/Asterim/apps/relay/src/index.ts): Lightweight Fastify + Socket.IO server implementing `register_tunnel`, `join_tunnel`, and `tunnel_message`.
  * [`apps/server/src/services/RelayClient.ts`](file:///c:/Projects/Asterim/apps/server/src/services/RelayClient.ts): Workstation client that establishes an **End-to-End Encrypted (E2E)** tunnel via ECDH (`P-256`) and AES-GCM (`AES-GCM-256`).
  * [`packages/mcp-memory-server/src/__tests__/relay_e2e.test.ts`](file:///c:/Projects/Asterim/packages/mcp-memory-server/src/__tests__/relay_e2e.test.ts): Proves 3-process loopback relay.
* **Missing Work:**
  * `apps/relay` lacks authentication/authorization on `register_tunnel` (open to tunnel ID spoofing).
  * No connection rate limiting or abuse mitigation on the cloud relay.
  * No Redis adapter for multi-instance horizontal scaling.
  * No production Dockerfile / deployment config for `apps/relay`.
* **Risk:** **Medium**. The cryptographic E2E encryption design is sound, but the relay broker requires authentication and container packaging for public cloud hosting.

---

### 2.2 Production Database & Multi-Tenancy
* **Status:** **OBSOLETE / ARCHITECTURALLY REDEFINED (DEC-028)**
* **Evidence:**
  * [`apps/server/src/services/DatabaseService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/DatabaseService.ts): Production-hardened local SQLite engine with Write-Ahead Logging (`WAL`), `PRAGMA busy_timeout = 5000;`, and owner-only `0700`/`0600` permissions.
  * [`decisions.md`](file:///c:/Projects/Asterim/decisions.md) (DEC-028): Establishes Asterim as a **Local-First, Data-Sovereign Operating System**.
* **Architectural Reconciliation:**
  * The original roadmap proposed migrating Asterim to a multi-tenant cloud PostgreSQL database.
  * Storing local project memory, AST decision history, terminal sessions, and source code in a centralized multi-tenant cloud database **directly contradicts DEC-028**.
  * **Resolution:** Workstation persistence is permanently, securely local SQLite. Cloud PostgreSQL is strictly confined to hosted SaaS account management and billing metadata if a separate cloud SaaS portal is deployed.
* **Risk:** **None (Architectural Clarification)**.

---

### 2.3 Billing & Subscription Engine
* **Status:** **PARTIAL (SKELETON READY)**
* **Evidence:**
  * [`apps/server/src/services/PlanService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/PlanService.ts): Implements plan definitions (`Free`, `Pro`, `Team`, `Enterprise`), feature limits, and entitlement checks.
  * [`apps/server/src/routes/webhooks.ts`](file:///c:/Projects/Asterim/apps/server/src/routes/webhooks.ts): Implements `/api/v1/webhooks/stripe` handling `customer.subscription.created/updated/deleted`.
  * [`apps/marketing/src/pages/PricingPage.tsx`](file:///c:/Projects/Asterim/apps/marketing/src/pages/PricingPage.tsx): Renders complete pricing tiers.
* **Missing Work:**
  * Stripe SDK integration for creating checkout sessions (`/api/v1/billing/checkout`) and customer billing portal sessions (`/api/v1/billing/portal`).
  * Cryptographic webhook signature verification (`stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`).
  * Entitlement gating in Asterim Core (e.g. Pro tier unlocks cloud relay remote tunneling and team governance features).
* **Risk:** **Low-Medium**. Straightforward vertical integration with well-defined boundaries.

---

### 2.4 Git Credential & SSH Auto-Detection
* **Status:** **PARTIAL**
* **Evidence:**
  * [`apps/server/src/services/git/GitProvider.ts`](file:///c:/Projects/Asterim/apps/server/src/services/git/GitProvider.ts): Executes Git commands with `GIT_TERMINAL_PROMPT: '0'` and `GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new'`.
  * [`apps/server/src/services/git/RemoteManager.ts`](file:///c:/Projects/Asterim/apps/server/src/services/git/RemoteManager.ts): Handles `push`, `pull`, `fetch`, upstream branch tracking, and error messaging.
* **Missing Work:**
  * Explicit discovery and pass-through of `SSH_AUTH_SOCK` (and Windows named pipe ssh-agent).
  * System Git credential helper integration (`git config --get-all credential.helper`) for non-interactive HTTPS token retrieval.
  * Automatic silent fallback conversion between HTTPS and SSH remote URLs on push failure.
* **Risk:** **Low**. Substantially improves developer workstation usability.

---

### 2.5 State Synchronization
* **Status:** **RE-EVALUATED UNDER DEC-028**
* **Evidence:**
  * Zero proprietary cloud sync services currently exist.
* **Architectural Reconciliation:**
  * Under DEC-028, project memory, decisions, transcripts, and code **never sync through cloud servers**.
  * Multi-agent and multi-developer synchronization occurs via **Git** and **local MCP memory servers**.
  * Only non-sensitive user preferences (e.g. UI theme, layout flags) should optionally synchronize across paired devices via the E2E encrypted relay tunnel.
* **Risk:** **Low**. Prevents architectural leakage of sensitive project data.

---

### 2.6 CI/CD & Deployment Pipeline
* **Status:** **PARTIAL**
* **Evidence:**
  * [`.github/workflows/ci.yml`](file:///c:/Projects/Asterim/.github/workflows/ci.yml): Runs Typecheck, Lint, and Build on push and PRs.
* **Missing Work:**
  * Multi-stage production `Dockerfile` for `apps/server`, `apps/relay`, `apps/marketing`, `apps/web`.
  * Wire the **21 test suites (1,540 assertions)** into `.github/workflows/ci.yml` so automated tests run on every commit.
  * Clear 64 pre-existing ESLint errors across `apps/server` and `@asterim/adapters` so `pnpm run lint` passes in CI.
  * Automated release workflow (`release.yml`) for publishing npm packages and GitHub release binaries.
* **Risk:** **High Value**. Essential for beta distribution and CI stability.

---

## 3. Security & Data Sovereignty Boundary Matrix

| Data Category | Storage Location | Encryption | Cloud Ingress/Egress | Sovereign Mode Guarantee |
| :--- | :--- | :---: | :---: | :---: |
| **Source Code & Git Working Tree** | Local Workstation Filesystem | OS Filesystem | **NEVER** crosses Asterim cloud | 100% Offline |
| **Project Memory & Architectural Decisions** | Local `~/.asterim/asterim.db` | Mode `0600` (Owner-only) | **NEVER** crosses Asterim cloud | 100% Offline |
| **Agent Sessions & Terminal PTY Logs** | Local `~/.asterim/asterim.db` | Mode `0600` | **NEVER** crosses Asterim cloud | 100% Offline |
| **Local Device Pairing PIN & Tokens** | Local Memory / `server.json` | Mode `0600` / constant-time | **NEVER** leaves local machine | 100% Offline |
| **Remote Tunnel Stream (Web/Mobile)** | Transits `apps/relay` | **E2E Encrypted (ECDH + AES-GCM)** | Encrypted bytes only; Relay has 0 plaintext access | Disabled in Sovereign Mode |
| **User Account & Billing Status** | Local DB + Stripe Webhooks | Hashed tokens / Stripe API | Only Account ID & Plan ID | Disabled in Sovereign Mode |

---

## 4. Remaining Scope Breakdown

### **P0 (Critical for Commercial Beta & CI Stability)**
1. **P5.6-01: CI Test Automation & ESLint Debt Resolution**
   - Wire the 21 test suites (1,540 assertions) into `.github/workflows/ci.yml`.
   - Clear all 64 pre-existing ESLint errors across `apps/server` and `@asterim/adapters` so CI is 100% green.
2. **P5.6-02: Zero-Friction Git Credential & SSH Auto-Detection Engine**
   - Implement `SSH_AUTH_SOCK` inheritance, `credential.helper` discovery, and automatic HTTPS/SSH fallback in `GitProvider.ts` / `RemoteManager.ts`.
3. **P5.6-03: Production Cloud Relay Hardening & Authentication**
   - Add token authentication to `register_tunnel` on `apps/relay`.
   - Implement rate limiting, connection cleanup, and health metrics on relay.

### **P1 (SaaS Commercial Readiness)**
4. **P5.6-04: Stripe Checkout, Customer Portal & Webhook Verification**
   - Implement Stripe SDK checkout session creation (`/api/v1/billing/checkout`) and portal management (`/api/v1/billing/portal`).
   - Implement cryptographic signature verification for Stripe webhooks (`STRIPE_WEBHOOK_SECRET`).
   - Wire plan entitlements in Asterim Core.
5. **P5.6-05: Multi-Stage Production Docker & Release Pipeline**
   - Create production Dockerfiles for `apps/server`, `apps/relay`, `apps/web`, `apps/marketing`.
   - Create `.github/workflows/release.yml` with semantic versioning and release packaging.

### **P2 (Polish & Optional)**
6. **P5.6-06: E2E Encrypted User Preference Sync Over Relay**
   - Sync non-sensitive client preferences (theme, layout) between paired devices over existing E2E relay tunnel.

---

## 5. Recommended Phase 5 Completion Sequence

```text
Phase 5.6 Task Sequence:
┌────────────────────────────────────────────────────────────────────────┐
│  P5.6-01: CI Test Suite Automation & ESLint Cleanup (P0)              │
│      ↓                                                                 │
│  P5.6-02: Git Credential & SSH Auto-Detection Engine (P0)             │
│      ↓                                                                 │
│  P5.6-03: Production Cloud Relay Hardening & Authentication (P0)       │
│      ↓                                                                 │
│  P5.6-04: Stripe Checkout, Portal & Webhook Signature Security (P1)   │
│      ↓                                                                 │
│  P5.6-05: Production Containerization & Release Pipeline (P1)          │
│      ↓                                                                 │
│  Phase 5 Final Commercial Production Gate (GATE-P5-BETA)               │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Phase 5 Completion Criteria

Before declaring the entire Phase 5 SaaS Foundation & Beta Release milestone complete, the following objective criteria must be met:

1. **Continuous Integration**: `.github/workflows/ci.yml` runs Typecheck, Lint, and all 21 test suites (1,540+ assertions) and passes with 100% green status on `main`.
2. **Git Synchronization**: Non-interactive Git push/pull executes automatically across SSH-agent and credential-helper configured repositories without terminal hangs.
3. **Cloud Relay Security**: Cloud Relay requires authentication tokens to register tunnels, routes E2E encrypted traffic with zero plaintext access, and handles disconnects cleanly.
4. **Commercial Billing**: Stripe checkout session creation and signature-verified webhook handling update account plans and enforce entitlements end-to-end.
5. **Release Distribution**: Production Docker containers build successfully and release workflow packages Asterim binaries.
6. **Data Sovereignty**: 100% of Project Memory and local source code remain on the local workstation with zero telemetry or unapproved cloud egress.

---

## 7. Recommendation

**REVISE PHASE 5 AND EXECUTE THE P5.6 TASK SEQUENCE.**

Proceed to decompose Phase 5.6 into vertical execution tasks in `docs/phase5-remaining-plan.md`, starting with **Task P5.6-01 (CI Test Automation & ESLint Debt Resolution)**.
