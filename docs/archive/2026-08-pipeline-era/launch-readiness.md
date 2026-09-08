# Commercial Launch Readiness Assessment

## Overview

This document tracks Asterim's readiness criteria for entering public commercial beta. It evaluates the current codebase against five critical launch domains: Product UX, Authentication & Security, Team Collaboration, Local Workstation Stability, and SaaS Infrastructure.

---

## Launch Readiness Matrix

| Domain | Target Standard | Current Status | Readiness Score | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Product UX** | Modern Cursor/Linear-tier high-density layout | Basic prototype shell with tabbed views | 35% | 🛑 Not Ready |
| **Authentication** | Multi-tenant auth, session rotation, RBAC, API keys | Local pairing PIN code only | 20% | 🛑 Not Ready |
| **Teams & Collaboration** | Orgs, Workspaces, Shared Threads & RBAC | Single-user local workspace only | 10% | 🛑 Not Ready |
| **Developer Workstation** | 99.9% stable PTY streaming, approvals, git, context | Functional local adapters, minor PTY/FSM edge cases | 75% | 🟡 In Progress |
| **SaaS Infrastructure** | Cloud Relay, Stripe Billing, Multi-tenant DB, CI/CD | Experimental Relay prototype | 15% | 🛑 Not Ready |

---

## Domain Criteria & Gap Analysis

### 1. Product UX & Design
* **Required for Beta**:
  * Unified workspace shell (collapsible nav, top bar, command palette `Cmd+K`, inspector panel).
  * Professional dark theme design tokens (no default HTML inputs or unstyled buttons).
  * High-density thread viewer with line-wrapped terminal & side-by-side git diff view.
* **Current Gaps**:
  * `App.tsx` contains monolithic state handling.
  * Command palette lacks full navigation capabilities.
  * Layout lacks modern high-density feel expected in commercial engineering tools.

### 2. Authentication & Security
* **Required for Beta**:
  * Full user lifecycle (Register, Login, Password Reset, Profile, Logout).
  * JWT access token + refresh token rotation with HTTP-only cookies.
  * API tokens for CLI adapters & headless execution.
  * Strict authentication guards on 100% of REST and WebSocket endpoints.
* **Current Gaps**:
  * Server relies on temporary `pairingToken` setup.
  * No user account table or password management.

### 3. Team Collaboration
* **Required for Beta**:
  * Organizations, Workspaces, Teams, Member rosters.
  * Email invitations & link joining flows.
  * Shared project threads & live multi-user observation.
  * RBAC role permissions (Owner, Admin, Member, Viewer).
* **Current Gaps**:
  * SQLite DB schema is single-tenant (`projects`, `sessions`, `logs`).
  * No RBAC middleware or workspace scoping in REST routes.

### 4. Developer Workstation (Local Engine)
* **Required for Beta**:
  * Process lifecycle stability (zero zombie node-pty processes).
  * Backpressure handling for fast output bursts (10k+ lines/min).
  * Hardened approval gate regex/AST validation.
  * Robust Git diff inspector & status service.
* **Current Gaps**:
  * Terminal backpressure requires further stress testing.
  * Git context service needs full integration with LLM commit/diff generation.

### 5. SaaS & Commercial Infrastructure
* **Required for Beta**:
  * Production Postgres + Prisma/Drizzle DB for SaaS backend.
  * Stripe billing integration (Free, Pro, Team subscription plans).
  * Production WebSocket Cloud Relay for remote client access.
  * Sentry error logging + OpenTelemetry monitoring.
* **Current Gaps**:
  * Relay app is early proof-of-concept.
  * No payment infrastructure integrated.

---

## Release Verification Checklist

- [ ] Product UX refactor complete & verified across 1080p, 2K, 4K, and mobile breakpoints.
- [ ] Security audit of Auth & API token endpoints passed.
- [ ] Multi-tenant workspace isolation verified (0 cross-tenant data leakage).
- [ ] 24-hour continuous agent execution stress test passed without process crash or memory leak.
- [ ] End-to-end user registration, workspace creation, team invitation, and Stripe subscription checkout verified.
