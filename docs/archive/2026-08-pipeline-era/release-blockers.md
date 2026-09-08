# Commercial Beta Release Blockers

## Overview

This document tracks all critical issues, security vulnerabilities, missing core features, and technical debt items that MUST be resolved prior to launching the commercial beta of Asterim.

---

## 🚨 Critical Release Blockers

### Blockers Summary

| ID | Domain | Issue Description | Impact | Target Phase | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **BLK-01** | UX | Monolithic UI state in `App.tsx` lacks scalable routing & team views | High visual clutter; cannot support multi-page onboarding, auth, or settings | Phase 1 | Open |
| **BLK-02** | Auth | Absence of true user authentication layer (only local PIN code pairing) | Unsafe for public multi-user deployment; zero password/session management | Phase 2 | Open |
| **BLK-03** | Teams | Single-tenant SQLite schema without multi-user or organization scoping | Inability to share workspaces, assign RBAC permissions, or collaborate | Phase 3 | Open |
| **BLK-04** | Engine | PTY terminal backpressure lockup during 10,000+ line stdout bursts | Browser UI freeze / crash during heavy agent command execution | Phase 4 | Open |
| **BLK-05** | SaaS | Missing payment & billing integration (Stripe / LemonSqueezy) | Inability to charge users or manage commercial subscription tiers | Phase 5 | Open |

---

## Detailed Blocker Specifications

### BLK-01: Legacy Monolithic UI Architecture
* **Component**: `apps/web/src/App.tsx`
* **Problem**: The main application view renders all sidebars, chat, settings modals, and terminals directly inside a single 30KB component with global state hooks.
* **Resolution**: Refactor into a clean shell architecture with React Router / route layout boundaries, separating Navigation, Workspace, Auth, Settings, and Dashboard views.

### BLK-02: Absence of Authentication & Identity Layer
* **Component**: `apps/server/src/routes/auth.ts`, `apps/web/src/PinScreen.tsx`
* **Problem**: Asterim currently assumes a local single-user setup paired via a raw 6-digit PIN. There are no User tables, password hashing routines, JWT refresh token rotation, or protected API routes.
* **Resolution**: Build full authentication system (User DB, JWT cookies, route guards, register/login forms, API key management).

### BLK-03: Single-Tenant Storage & Data Isolation
* **Component**: `@asterim/server` database service & routes
* **Problem**: SQLite database structure (`projects`, `sessions`, `agent_logs`) lacks `org_id`, `user_id`, or workspace boundary scoping.
* **Resolution**: Introduce multi-tenant schema with Organizations, Workspaces, Memberships, and RBAC middleware.

### BLK-04: Terminal Output Backpressure & Memory Leaks
* **Component**: `apps/web/src/XTerminal.tsx`, `@asterim/adapters`
* **Problem**: High-speed agent stdout streams (e.g. `npm install` or massive search outputs) overwhelm xterm.js rendering buffer, causing browser tab unresponsiveness.
* **Resolution**: Implement buffer throttling, chunk batching, and virtualized scrollback rendering.

### BLK-05: Missing Billing & Entitlement Gateway
* **Component**: Commercial Infrastructure / SaaS layer
* **Problem**: No subscription management or usage limit enforcement exists.
* **Resolution**: Implement Stripe Billing checkout, webhook listeners, plan entitlement checks, and customer portal.
