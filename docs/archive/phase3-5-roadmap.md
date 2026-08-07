# Asterim Phase 3.5 — Canonical Product Roadmap

**Document Status**: AUTHORITATIVE IMPLEMENTATION SCHEDULE  
**Author**: Product Design & UX Architecture Team  
**Date**: August 7, 2026  
**Reference Product Spec**: [docs/environment-product-spec.md](file:///home/qhukz/Documents/Projects/Asterim/docs/environment-product-spec.md)  
**Reference Gap Analysis**: [docs/environment-gap-analysis.md](file:///home/qhukz/Documents/Projects/Asterim/docs/environment-gap-analysis.md)  

---

## Executive Overview

Phase 3.5 aligns Asterim’s implementation with the **Environment Product Specification**.

All legacy "Workspace & Team" UI elements are removed or refactored into **Environment** features. Every PR in this schedule is buildable, testable, and backwards compatible with existing local SQLite data.

---

## PR Schedule

```
┌────────────────────────────────────────────────────────────────────────┐
│                   CANONICAL PHASE 3.5 PR SCHEDULE                      │
├─────────┬──────────────────────────────────────────────────────────────┤
│  PR39   │ Environment Domain Model & Zustand Store Refactor            │
├─────────┼──────────────────────────────────────────────────────────────┤
│  PR40   │ Native Environment Settings View (EnvironmentSettingsView)   │
├─────────┼──────────────────────────────────────────────────────────────┤
│  PR41   │ TopBar Environment Selector, ⌘E Hotkey & Command Palette     │
├─────────┼──────────────────────────────────────────────────────────────┤
│  PR42   │ Project Migration & Environment Assignment Controls          │
├─────────┼──────────────────────────────────────────────────────────────┤
│  PR43   │ Environment Presets & Visual Badge Identity                  │
├─────────┼──────────────────────────────────────────────────────────────┤
│  PR44   │ Environment Security Audit & Full Monorepo Verification      │
└─────────┴──────────────────────────────────────────────────────────────┘
```

---

## PR Detailed Specifications

### PR39 — Environment Domain Model & Zustand Store Refactor
- **Goal**: Align domain types and state stores with Environment terminology.
- **Key Changes**:
  - Update `@asterim/shared`: `Environment`, `EnvironmentPreset`, `EnvironmentMember`, `EnvironmentRole`, `EnvironmentPermission`.
  - Update `useWorkspaceStore` -> add `environments`, `activeEnvironment`, `fetchEnvironments`, `setActiveEnvironment`.
  - Update `useViewStore` -> alias `activeView = 'environment'`.
- **Verification**: `@asterim/shared` and `@asterim/web` compile cleanly.

---

### PR40 — Native Environment Settings View (`EnvironmentSettingsView`)
- **Goal**: Replace legacy `WorkspaceTabView` with full `EnvironmentSettingsView` native tab.
- **Key Changes**:
  - Create `EnvironmentSettingsView.tsx` inside `apps/web/src/components/environment/`.
  - Sub-tabs:
    1. `General & Presets`
    2. `Members & Governance` (Team Environments)
    3. `Projects & Assignment`
    4. `Secrets & Credentials`
    5. `MCP Servers & Tools`
    6. `Skills & Prompts`
    7. `Audit Stream`
    8. `Danger Zone`
  - Mount `<EnvironmentSettingsView />` at top-level layout shell in `App.tsx` when `activeView === 'environment'`.
- **Verification**: Clicking `⚙ Environment Settings` opens `EnvironmentSettingsView` with all sub-tabs regardless of active project selection.

---

### PR41 — TopBar Environment Selector, `⌘E` Hotkey & Command Palette
- **Goal**: Implement single-line TopBar location breadcrumb and instant keyboard switcher.
- **Key Changes**:
  - Refine `EnvironmentSwitcher.tsx` with clean breadcrumb style (`[P] Personal Environment`).
  - Add hotkey listener (`⌘E` / `Ctrl+E`) to toggle Environment Switcher dropdown directly.
  - Update `CommandPalette.tsx` commands: `Switch Environment...`, `Environment Settings`, `Create Environment`.
- **Verification**: Test hotkeys `⌘E` and `⌘K` command palette navigation.

---

### PR42 — Project Migration & Environment Assignment Controls
- **Goal**: Allow assigning and moving projects between Environments.
- **Key Changes**:
  - Add Environment dropdown selector on project cards under `Projects & Assignment` sub-tab.
  - Add right-click context menu item (`Move to Environment...`) in navigation sidebar.
  - Call REST endpoint `PATCH /api/v1/projects/:id/workspace` to persist environment assignment.
- **Verification**: Reassign a project to another Environment and verify immediate UI update and persistence.

---

### PR43 — Environment Presets & Visual Badge Identity
- **Goal**: Implement visual badge identity for environment presets.
- **Key Changes**:
  - Presets: `Personal` (Emerald `#10b981`), `Company` (Blue `#3b82f6`), `Client Sandbox` (Amber `#f59e0b`), `Experimental` (Purple `#8b5cf6`).
  - Update Environment cards and TopBar breadcrumbs to render preset badge colors.
- **Verification**: Verify preset creation and color badge rendering across TopBar and Settings.

---

### PR44 — Environment Security Audit & Full Monorepo Verification
- **Goal**: Quality assurance, security audit, and end-to-end verification of Phase 3.5.
- **Key Changes**:
  - Run full monorepo build (`pnpm run build`).
  - Verify 100% pass across all 7 packages.
  - Confirm zero-auth offline local dev flow (`usr_dev` / `acc_dev`).
- **Verification**: All 6 turbo packages build with 0 errors.
