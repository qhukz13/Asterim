# Asterim Environment Implementation Gap Analysis

**Document Status**: AUDIT FINDINGS & DISCREPANCY REPORT  
**Author**: Product Design & UX Architecture Team  
**Date**: August 7, 2026  
**Reference Document**: [docs/environment-product-spec.md](file:///home/qhukz/Documents/Projects/Asterim/docs/environment-product-spec.md)  

---

## Executive Summary

An audit of Asterim's current implementation against `docs/environment-product-spec.md` reveals several architectural and UX discrepancies. 

While Phase 3 implemented functional backend tables and routes, the frontend UI and state models still reflect a traditional SaaS "Workspace & Team" dashboard rather than Asterim's **Local-First Environment Architecture**.

This gap analysis documents every discrepancy, why it violates product design rules, the affected source files, and its resolution priority.

---

## Discrepancy Ledger

### Discrepancy 1: Legacy "Workspace" Language in User Interface
- **Expected Behavior**: All developer-facing UI text, breadcrumbs, dropdowns, and command palette items must use **Environment** terminology (`Personal Environment`, `Environment Settings`, `Switch Environment`, `Create Environment`).
- **Current Behavior**: UI labels present legacy text: `"Personal Workspace"`, `"Workspace & Team View"`, `"Create Team Workspace"`, `"Workspace Settings"`.
- **Why It Is Wrong**: Confuses developers by making Asterim look like a traditional SaaS web application rather than an OS-level developer environment container.
- **Affected Files**:
  - [WorkspaceSwitcher.tsx](file:///home/qhukz/Documents/Projects/Asterim/apps/web/src/components/WorkspaceSwitcher.tsx)
  - [TopBar.tsx](file:///home/qhukz/Documents/Projects/Asterim/apps/web/src/components/TopBar.tsx)
  - [WorkspaceTabView.tsx](file:///home/qhukz/Documents/Projects/Asterim/apps/web/src/components/workspace/WorkspaceTabView.tsx)
  - [CommandPalette.tsx](file:///home/qhukz/Documents/Projects/Asterim/apps/web/src/components/CommandPalette.tsx)
- **Priority**: **P0 (Critical Architecture & UX)**

---

### Discrepancy 2: Disconnected View Naming & Missing Environment Settings Tabs
- **Expected Behavior**: The main view tab is named `EnvironmentSettingsView` and provides comprehensive sub-tabs: `General & Presets`, `Members & Governance`, `Projects & Assignment`, `Secrets & Credentials`, `MCP Tools`, `Skills & Prompts`, `Audit Stream`, `Danger Zone`.
- **Current Behavior**: Component is named `WorkspaceTabView` with incomplete sub-tabs (`Members & Roles`, `Shared Projects`, `Audit Log Stream`, `General Settings`).
- **Why It Is Wrong**: Fails to provide single-pane environment management for secrets, MCP tools, and skills, violating environment isolation principles.
- **Affected Files**:
  - [WorkspaceTabView.tsx](file:///home/qhukz/Documents/Projects/Asterim/apps/web/src/components/workspace/WorkspaceTabView.tsx)
  - [App.tsx](file:///home/qhukz/Documents/Projects/Asterim/apps/web/src/App.tsx)
  - [useViewStore.ts](file:///home/qhukz/Documents/Projects/Asterim/apps/web/src/stores/useViewStore.ts)
- **Priority**: **P0 (Critical UX)**

---

### Discrepancy 3: Missing Right-Click & Inline Project Environment Transfer
- **Expected Behavior**: Projects can be assigned or moved between Environments via an Environment dropdown on project cards and a right-click context menu item (`Move to Environment...`) in the left navigation sidebar.
- **Current Behavior**: Projects card in `WorkspaceTabView` displays a static "Open Project" button without any environment reassignment control.
- **Why It Is Wrong**: Developers cannot easily reorganize local projects into dedicated Client or Personal Environments.
- **Affected Files**:
  - [WorkspaceTabView.tsx](file:///home/qhukz/Documents/Projects/Asterim/apps/web/src/components/workspace/WorkspaceTabView.tsx)
  - [NavigationSidebar.tsx](file:///home/qhukz/Documents/Projects/Asterim/apps/web/src/components/NavigationSidebar.tsx)
  - [ProjectManager.ts](file:///home/qhukz/Documents/Projects/Asterim/apps/server/src/services/ProjectManager.ts)
- **Priority**: **P1 (High)**

---

### Discrepancy 4: Hotkey `⌘E` Behavior Mismatch
- **Expected Behavior**: Pressing `⌘E` or `Ctrl+E` anywhere in the IDE opens the Environment Switcher dropdown directly at the cursor / topbar location.
- **Current Behavior**: Pressing `⌘E` switches the main view tab to `workspace` instead of toggling the dropdown menu.
- **Why It Is Wrong**: Breaks quick keyboard-first switching between Environments.
- **Affected Files**:
  - [CommandPalette.tsx](file:///home/qhukz/Documents/Projects/Asterim/apps/web/src/components/CommandPalette.tsx)
  - [WorkspaceSwitcher.tsx](file:///home/qhukz/Documents/Projects/Asterim/apps/web/src/components/WorkspaceSwitcher.tsx)
- **Priority**: **P1 (High)**

---

### Discrepancy 5: Missing Environment Preset Types & Color Badges
- **Expected Behavior**: Supports environment preset types: `Personal` (Emerald `#10b981`), `Company` (Royal Blue `#3b82f6`), `Client Sandbox` (Amber `#f59e0b`), `Experimental` (Purple `#8b5cf6`).
- **Current Behavior**: Binary `isPersonal` check rendering green or blue icons only.
- **Why It Is Wrong**: Reduces visual distinction when developers manage multiple client sandboxes or experimental environments.
- **Affected Files**:
  - [workspace.ts](file:///home/qhukz/Documents/Projects/Asterim/packages/shared/src/types/workspace.ts)
  - [WorkspaceSwitcher.tsx](file:///home/qhukz/Documents/Projects/Asterim/apps/web/src/components/WorkspaceSwitcher.tsx)
  - [WorkspaceTabView.tsx](file:///home/qhukz/Documents/Projects/Asterim/apps/web/src/components/workspace/WorkspaceTabView.tsx)
- **Priority**: **P1 (High)**

---

## Action Plan Summary

To achieve 100% compliance with `docs/environment-product-spec.md`, the implementation roadmap in `docs/phase3-5-roadmap.md` must be updated to execute the following PR sequence:

1. **PR39 — Environment Domain Model & Store Refactor**
2. **PR40 — Environment Settings Native Tab View (`EnvironmentSettingsView`)**
3. **PR41 — TopBar Breadcrumb, Keyboard Shortcuts (`⌘E`) & Command Palette (`⌘K`)**
4. **PR42 — Project Migration & Environment Transfer Controls**
5. **PR43 — Environment Preset Types & Visual Badge Identity**
6. **PR44 — Environment Audit & Full Verification**
