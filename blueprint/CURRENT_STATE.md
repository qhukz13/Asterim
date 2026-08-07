# Current State of Asterim

This document records the current snapshot of development, recent achievements, and known issues that have been deferred for later. It acts as a bridge between active tasks and the high-level roadmap.

## 🚨 CRITICAL BUGS (High Priority for Tomorrow)

### 1. Project Switching Regression (P0)

- **Status:** **FIXED** (2026-07-24)
- **Root Cause:** `NavigationSidebar` and `App.tsx` were calling `setActiveProject()` on Zustand directly without updating the URL. Since `RouterSync` is now URL-first, it immediately overwrote the Zustand state back to the old project from the stale URL params, causing the bounce-back.
- **Fix:** All project navigation now goes through `setLocation('/workspace/project/{id}')`. `RouterSync` also handles the root route (`/`) by clearing `activeProjectId` when no route matches.

## Phase 1 Status

- **Status:** **100% COMPLETE** (2026-08-06)
- **Summary:** All Phase 1 Product UX deliverables (Workspace Shell, Design System, Command Palette, Terminal & Chat UX, Dashboard, and Readability Pass) have been completed, audited, and verified against production builds and automated E2E tests.

## Phase 2 Status

- **Status:** **100% COMPLETE** (2026-08-07)
- **Summary:** All Phase 2 Authentication & Commercial Account Platform deliverables (**PR16** through **PR28**) have been completed, audited, and verified against production builds across all 7 monorepo packages.
- **Key Capabilities Delivered:**
  - **Decoupled Identity Ownership**: Centralized web authentication on `asterim.dev` (`apps/marketing`).
  - **Desktop OAuth Deep-Link Callback**: Desktop application consumes identity via `asterim://auth/callback` PKCE exchange.
  - **Decoupled Feature Entitlement Layer**: Capability authorization querying `canAccessFeature('...')` policy checks.
  - **Session & Device Governance**: Real-time session invalidation, hardware fingerprinting, and remote device revocation UI.
  - **Day-One Subscription Architecture**: Declarative plan tiers (`Free`, `Pro`, `Team`, `Enterprise`), usage meters, and Stripe webhook handlers.
  - **Developer API Keys**: Machine-to-machine API keys (`ast_ak_live_...`) with SHA-256 key hashing and scope control.

## Recent Work & Achievements

### 1. Phase 2 — Authentication & Account Platform (PR16–PR28)

- **Goal:** Build the commercial hub and account identity platform for Asterim via `asterim.dev`, separating web identity ownership from desktop execution, laying the subscription, entitlement, session, and device management architecture.
- **Deliverables Completed:**
  - **Auth Foundation & Types**: Shared DTOs, session interfaces, entitlement definitions in `@asterim/shared`.
  - **Database Migration**: SQLite DDL for `users`, `accounts`, `user_sessions`, `trusted_devices`, `feature_entitlements`, `api_keys`, `workspace_memberships`, `team_memberships`.
  - **Password & JWT Security Engine**: scrypt password hashing with unique salts, RS256/HS256 JWT access token signing (15 mins), opaque refresh token rotation (30 days).
  - **Centralized Web Auth APIs**: `/api/v1/auth/register`, `/login`, `/refresh`, `/logout`, `/me` with secure `HttpOnly` cookies.
  - **Public Website Auth Portal**: Login, Register, Overview, Active Sessions, Trusted Devices, API Keys, and Billing pages on `apps/marketing`.
  - **Desktop OAuth PKCE Exchange**: `/api/v1/auth/oauth/token` deep-link callback exchange.
  - **Multi-Session & Trusted Device Revocation**: `/api/v1/sessions` and `/api/v1/devices` remote logout controls.
  - **Feature Entitlements Engine**: `EntitlementService` and `entitlementGuard` middleware for capability-based authorization.
  - **Subscription Plan Engine**: `PlanService` definitions and `/api/v1/webhooks/stripe` webhook handlers.

## Next Steps

- Proceed to **Phase 3 — Teams & Workspaces** on the Roadmap (multi-user collaborative workspaces, team permissions, organization switcher, member invitations, and shared agent execution logs).
