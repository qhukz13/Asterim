# Asterim Phase 3.5.2 — UX Refinement & Environment Polish Roadmap

**Document Version**: 1.0.0 — SOURCE OF TRUTH FOR PHASE 3.5.2 ROADMAP  
**Date**: August 7, 2026  
**Status**: Active Execution  

---

## PR 1: Personal Environment Experience
- **Objective**: Hide enterprise-only features (`Members`, `Governance`, `Invitations`, `Audit Stream`) when `environment.preset === "personal"` or `isPersonal === true`.
- **Target Tabs in Personal Env**: General, Projects, Secrets, MCP Tools, Agent Profiles, Skills, Knowledge Items, Danger Zone.
- **Files**: `apps/web/src/components/environment/EnvironmentSettingsView.tsx`

---

## PR 2: Environment Switcher UX (`⌘E`)
- **Objective**: High-speed, keyboard-first desktop-style environment switcher.
- **Features**:
  - Auto-focused search field; typing filters environments instantly.
  - Full keyboard navigation (`ArrowUp`, `ArrowDown`, `Enter`, `Escape`).
  - Rich metadata cards: Preset badge, Environment preset, Number of attached projects.
  - Ordering: Pinned (future-ready architecture), Recent, All.
- **Files**: `apps/web/src/components/WorkspaceSwitcher.tsx`

---

## PR 3: Project Scalability (20 to 250+ Repositories)
- **Objective**: Seamless sidebar and navigation experience for hundreds of attached projects.
- **Features**:
  - Real-time sidebar search filtering.
  - Compact list mode (dense, high-efficiency list density).
  - Environment-specific project pinning model (prepared in database / state so pinning is per-environment).
- **Files**: `apps/web/src/components/NavigationSidebar.tsx`, `apps/web/src/stores/useProjectStore.ts`, shared/backend schemas.

---

## PR 4: Project Management UX
- **Objective**: Effortless project management in Settings and Add Project dialog.
- **Features**:
  - Search and sorting across large project collections.
  - Compact table / list view in Environment Settings Projects tab.
  - Batch search filter in `AddProjectModal`.
- **Files**: `apps/web/src/components/environment/EnvironmentSettingsView.tsx`, `apps/web/src/components/overlays/AddProjectModal.tsx`
