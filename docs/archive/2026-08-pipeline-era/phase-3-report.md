# Asterim Phase 3 — Comprehensive Status & Architecture Report

**Document Version**: 1.0.0  
**Date**: August 7, 2026  
**Status**: Phase 3 Feature Delivery Complete & Audited  

---

## 1. Executive Overview & Current State

Asterim Phase 3 (**Teams & Workspaces**) introduces multi-user collaborative workspace capabilities, team-level role-based access control (RBAC), shared project scoping, real-time WebSocket execution streams, and team audit logging.

All 10 planned Pull Requests (**PR29** through **PR38**) have been built and verified across all 7 monorepo packages (`@asterim/shared`, `@asterim/config-eslint`, `@asterim/adapters`, `@asterim/relay`, `@asterim/marketing`, `@asterim/web`, and `asterim` server).

---

## 2. Design & Architecture Decisions Made

During Phase 3 development, the following core design and architectural decisions were established based on product requirements and user feedback:

### A. Visual & Placement Aesthetics
- **Breadcrumb TopBar Selector**: The workspace switcher is integrated directly into the TopBar header next to the Asterim brand mark as a minimal, non-flashy breadcrumb item (`[P] Personal Workspace`).
- **Minimal Dark Emerald Theme**: Adheres strictly to Asterim's visual tokens (`#10b981` emerald accent, `#34d399` text highlights, `#080c14` background, glassmorphism overlays).
- **Single-Line Breadcrumbs**: Enforced `whiteSpace: 'nowrap'` and `flexShrink: 0` so location paths (e.g. `Personal Workspace / All Projects`) remain on a single horizontal line without wrapping.

### B. Workspace Logic & Team Boundaries
- **Collaborative Team Boundary**: Workspaces act as organizational team boundaries containing shared projects, team member rosters, RBAC role permissions (`Owner`, `Admin`, `Member`, `Viewer`), and team-level audit logs.
- **Dedicated Tab View (No Modal Windows)**: In accordance with user feedback, the Workspace & Team menu opens as a dedicated main view tab (`WorkspaceTabView`) within the IDE shell rather than a floating modal popup window.
- **Unauthenticated Development Fallback**: To preserve zero-config local development, unauthenticated dev loopback requests (`http://localhost:5173` / `3000`) fall back to `usr_dev` / `acc_dev` context, ensuring offline local use is never blocked by auth errors.

---

## 3. What's Working

### Monorepo Build & Infrastructure
- **100% Monorepo Build Pass**: `pnpm run build` succeeds across all 7 packages with 0 compilation or linting errors.
- **SQLite Database Migrations**: `DatabaseService.ts` handles DDL for `workspaces`, `workspace_memberships`, `workspace_invitations`, `audit_logs`, and project columns `workspace_id`, `visibility`.
- **REST Endpoints**:
  - `GET /api/v1/workspaces`: Fetch user's workspaces.
  - `POST /api/v1/workspaces`: Create team workspace.
  - `GET /api/v1/workspaces/:id/members`: Fetch workspace roster.
  - `POST /api/v1/workspaces/:id/invite`: Generate invitation token.
  - `POST /api/v1/workspaces/join`: Redeem invitation token.
  - `GET /api/v1/workspaces/:id/audit-log`: Fetch team audit feed.
  - `GET /api/v1/projects?workspaceId=...`: Fetch workspace-scoped projects with fallback query for pre-existing projects.
- **RBAC Policy Guard**: `RbacService.ts` evaluates permissions (`workspace:read`, `workspace:write`, `member:invite`, `member:role`, `member:remove`, `agent:spawn`, `agent:approve`), reinforced by `requireWorkspacePermission` route middleware.
- **Multi-User WebSocket Room Synchronization**: `SocketManager.ts` supports `join_workspace` and broadcasts thread events and agent telemetry to `workspace:<id>` rooms.

---

## 4. What's Not Working (Known Bug & Defect Analysis)

### Issue: "Workspace & Team Menu doesnt open completely"
- **Symptom**: Selecting `"⚙ Workspace & Team View"` from the workspace dropdown dropdown does not display the full workspace view when no project or thread is actively selected in the router state.
- **Root Cause**:
  1. `WorkspaceSwitcher.tsx` triggers `useViewStore.getState().setActiveView('workspace')`.
  2. In `App.tsx`, `<WorkspaceTabView />` is mounted inside `ProjectWorkspace` (lines 718-721), which is only rendered when `selectedProject` is active (`/workspace/project/:projectId/...`).
  3. If the user is on the main landing screen (`/` or `/workspace`) without an active project open, `activeTab === 'workspace'` is ignored by the top-level layout router, so `WorkspaceTabView` is not rendered.

---

## 5. Recommended Next Steps

1. **Fix Workspace Tab View Routing**:
   - Move `<WorkspaceTabView />` rendering to top-level `App.tsx` layout shell so that clicking `"⚙ Workspace & Team View"` renders `WorkspaceTabView` as a full tab regardless of whether a project is currently open.
2. **Refine Project Assignment & Filter Controls**:
   - Add explicit project assignment controls inside `WorkspaceTabView` under the **Shared Projects** sub-tab to allow moving existing local projects between personal and team workspaces.
3. **Transition to Phase 4**:
   - Begin **Phase 4 — Developer Workstation (Local Engine Hardening)** (sub-process lifecycle resilience, zero-lag xterm.js rendering, AST shell command parsing, git diff inspector, and debounced file watcher).
