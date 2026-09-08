# Asterim Phase 3.5.1 — Refinement Implementation Roadmap

**Document Status**: AUTHORITATIVE IMPLEMENTATION SCHEDULE  
**Author**: CTO, Product Architect & Lead UX Engineer  
**Date**: August 7, 2026  
**Reference Specification**: [docs/phase3-5-1-spec.md](file:///home/qhukz/Documents/Projects/Asterim/docs/phase3-5-1-spec.md)  

---

## PR Schedule Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                   PHASE 3.5.1 PR SCHEDULE                              │
├─────────────┬──────────────────────────────────────────────────────────┤
│ PR3.5.1-A   │ Create Environment Modal UI Layout & Text Wrapping Fix   │
├─────────────┼──────────────────────────────────────────────────────────┤
│ PR3.5.1-B   │ Reliable Environment Settings View Navigation            │
├─────────────┼──────────────────────────────────────────────────────────┤
│ PR3.5.1-C   │ Strict Environment Project Filtering & Attachment Engine │
├─────────────┼──────────────────────────────────────────────────────────┤
│ PR3.5.1-D   │ Clean Empty Environment Workspace Onboarding State      │
├─────────────┼──────────────────────────────────────────────────────────┤
│ PR3.5.1-E   │ Full Monorepo Build & Zero-Leakage Verification Pass     │
└─────────────┴──────────────────────────────────────────────────────────┘
```

---

## Detailed PR Specifications

### PR3.5.1-A — Create Environment Modal UI Layout & Text Wrapping Fix
- **Purpose**: Fix text overflow in "Create Environment Universe" modal dialog box by increasing modal card max-width (`maxWidth: '460px'`), adding responsive padding (`width: '90%'`), and ensuring clean text wrapping.
- **Files**: `apps/web/src/components/WorkspaceSwitcher.tsx`
- **Dependencies**: None.
- **Verification**: Visual inspection of Create Environment modal.

### PR3.5.1-B — Reliable Environment Settings View Navigation
- **Purpose**: Fix environment settings access so clicking `⚙ Environment Settings` in `WorkspaceSwitcher.tsx` or TopBar immediately sets `activeView = 'environment'` and displays `EnvironmentSettingsView` natively in `App.tsx` whether or not a project is selected.
- **Files**:
  - `apps/web/src/components/WorkspaceSwitcher.tsx`
  - `apps/web/src/App.tsx`
  - `apps/web/src/stores/useViewStore.ts`
- **Dependencies**: PR3.5.1-A.
- **Verification**: Click `⚙ Environment Settings` with and without an active project.

### PR3.5.1-C — Strict Environment Project Filtering & Attachment Engine
- **Purpose**: Pass active `environmentId` in `useProjects.ts` fetch queries and update `ProjectManager.ts` to query `environment_project_attachments` table so switching environments strictly filters project lists to only attached repositories.
- **Files**:
  - `apps/web/src/hooks/useProjects.ts`
  - `apps/server/src/services/ProjectManager.ts`
  - `apps/server/src/routes/projects.ts`
  - `apps/web/src/stores/useWorkspaceStore.ts`
- **Dependencies**: PR3.5.1-B.
- **Verification**: Switch between Personal and Company environments and verify projects list updates dynamically.

### PR3.5.1-D — Clean Empty Environment Workspace Onboarding State
- **Purpose**: Clear `activeProjectId` when switching to an Environment with 0 projects attached, and update `EmptyWorkspace.tsx` to provide `Add Existing Local Repository`, `Create New Project`, and `Open Folder` options pre-bound to the active Environment.
- **Files**:
  - `apps/web/src/components/EmptyWorkspace.tsx`
  - `apps/web/src/App.tsx`
  - `apps/web/src/stores/useWorkspaceStore.ts`
- **Dependencies**: PR3.5.1-C.
- **Verification**: Create a fresh Environment and verify clean empty workspace screen with repo creation options.

### PR3.5.1-E — Full Monorepo Build & Zero-Leakage Verification Pass
- **Purpose**: Quality assurance, end-to-end verification, and monorepo production build pass.
- **Files**: Monorepo packages.
- **Dependencies**: PR3.5.1-A through PR3.5.1-D.
- **Verification**: Run `pnpm run build` across all 7 monorepo packages.
