# Phase 3.5.2 Tasks

- [x] **PR 1: Personal Environment Experience**
  - [x] Implement conditional rendering in `EnvironmentSettingsView.tsx` based on `environment.preset === "personal"` or `isPersonal`.
  - [x] Hide `Members & Governance`, `Invitations`, and `Audit Stream` in Personal Environment.
  - [x] Ensure non-personal presets (`company`, `client`, `experimental`) render enterprise tabs.
  - [x] Verify manually and run monorepo build.

- [x] **PR 2: Environment Switcher UX**
  - [x] Implement auto-focused search field in `WorkspaceSwitcher.tsx`.
  - [x] Implement keyboard navigation (`ArrowUp`, `ArrowDown`, `Enter`, `Escape`).
  - [x] Display rich metadata (badge, preset name, attached projects count).
  - [x] Implement environment ordering (Pinned, Recent, All).
  - [x] Verify manually and run monorepo build.

- [x] **PR 3: Project Scalability**
  - [x] Implement real-time sidebar search filter in `NavigationSidebar.tsx`.
  - [x] Implement compact list mode toggle for dense project display.
  - [x] Implement environment-specific project pinning architecture.
  - [x] Verify manually and run monorepo build.

- [x] **PR 4: Project Management UX**
  - [x] Implement search and sorting in Environment Settings Projects tab.
  - [x] Implement search filter in `AddProjectModal.tsx`.
  - [x] Verify manually and run monorepo build.

---

## 🐛 Pending Bug Fixes (Documented State)

- [ ] **BUG-004: Environment Deletion Failure in Danger Zone**
  - [ ] Implement/Fix environment deletion action in `EnvironmentSettingsView.tsx` (Danger Zone tab).
  - [ ] Trigger `DELETE /api/v1/workspaces/:id`, refresh store, and fallback active environment to Personal.

- [ ] **BUG-005: "Open Project" Button in Projects Tab Navigation**
  - [ ] Update `onClick` handler in `EnvironmentSettingsView.tsx` to set `activeProjectId` and navigate to `/workspace/project/:id`.

- [ ] **BUG-006: Environment Switcher Project Counts Displaying 0**
  - [ ] Update `getProjectCount` in `WorkspaceSwitcher.tsx` to compute project counts per environment across all environments instead of filtering active environment projects only.

