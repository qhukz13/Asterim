# Asterim Phase 3.5.2 — UX Refinement & Personal Environment Experience

**Document Version**: 1.0.0 — SOURCE OF TRUTH FOR PHASE 3.5.2  
**Author**: Lead UX Engineer & Product Architect  
**Date**: August 7, 2026  
**Status**: Approved Architecture & Implementation Plan  
**Target Platform**: Asterim Local-First AI Engineering Operating System  

---

## 1. Goals

Phase 3.5.2 focuses strictly on **UX Refinement** and **Project Scalability** for the Asterim Environment System.

The Environment architecture is already fully functional (creation, switching, project attachment, state persistence, MCP, Skills, Agent Profiles, Knowledge Items, and Secrets). This phase does **NOT** alter the underlying architecture defined in `docs/environment-blueprint.md`.

### Core Goals:
1. **Personal Environment Cleanliness**: Ensure Personal Environment feels like a sleek, local developer workstation ("This is my local workstation") rather than a SaaS admin dashboard. Hide enterprise-only concepts (`Members`, `Governance`, `Invitations`, `Audit Stream`) when in Personal Environment.
2. **Environment Switching UX**: Elevate environment switching (`⌘E`) to feel like an OS-level workspace context swap (<100ms, searchable, arrow-navigable, showing attached project counts, pinned active environment, recently used sorting).
3. **Project Scalability**: Enable Asterim to gracefully handle 20, 80, or 250+ attached repositories without UI clutter or performance degradation. Introduce sidebar search, project pinning/favorites, compact list display, sorting, and settings search/filtering.

---

## 2. UX Audit Findings & Problems

### Area 1: Personal Environment Overhead
* **Issue**: `EnvironmentSettingsView.tsx` currently renders `Members & Governance` and `Audit Stream` tabs unconditionally for every environment, including Personal Environment.
* **Impact**: Solo developers working in Personal Environment are confronted with team invitation inputs, member role selectors, and enterprise audit logs, breaking the local developer workstation aesthetic.
* **Root Cause**: Hardcoded tab array in `EnvironmentSettingsView.tsx` lacks capability-based or preset-aware filtering.

### Area 2: Environment Switcher Dropdown (`WorkspaceSwitcher.tsx`)
* **Issue 1**: Dropdown lists all environments in a static vertical stack without search input or keyboard arrow navigation.
* **Issue 2**: Active environment is not pinned or visually distinct enough in long lists.
* **Issue 3**: Switcher does not show attached project count per environment or last used metadata.
* **Issue 4**: As environments scale (5+ environments), finding a specific environment requires manual mouse scrolling.

### Area 3: Navigation Sidebar Project List (`NavigationSidebar.tsx`)
* **Issue 1**: Renders projects in a plain flat list without search/filter capability.
* **Issue 2**: When a user attaches 20, 80, or 250 projects, the sidebar becomes an unmanageable scrolling list.
* **Issue 3**: No support for favorites, pinned projects, or recent project sorting.
* **Issue 4**: Project cards in sidebar take up unnecessary vertical space when managing large numbers of repositories.

### Area 4: Environment Settings Project Management (`EnvironmentSettingsView.tsx` -> Projects Tab)
* **Issue 1**: Project cards in the settings view lack search filtering.
* **Issue 2**: No quick view toggle (Card view vs Compact Table view) for managing dozens of attached repositories.
* **Issue 3**: `AddProjectModal.tsx` batch attachment list has no search filter for selecting existing projects.

---

## 3. Proposed Solutions & UX Designs

### Solution A: Capability-Based View Scope for Personal Environment
- Implement helper function `getEnvironmentCapabilities(preset, isPersonal)`:
  - `hasGovernance`: false for `personal`, true for `company`, `client`, `experimental`.
  - `hasAuditStream`: false for `personal`, true for `company`, `client`, `experimental`.
- In `EnvironmentSettingsView.tsx`:
  - Dynamically filter tabs based on capabilities.
  - When in Personal Environment, only show relevant tabs: `General & Presets`, `Projects & Assignment`, `Agent Profiles`, `Secrets & Credentials`, `MCP Tools & Servers`, `Skills & Prompts`, `Knowledge Items`, `Danger Zone`.
  - Automatically reveal `Members & Governance` and `Audit Stream` when switching to a Company, Client, or Shared environment.

### Solution B: Enhanced Environment Switcher (`WorkspaceSwitcher.tsx`)
- **Search Bar**: Inline search input at top of `⌘E` dropdown with auto-focus when opened.
- **Keyboard Navigation**: Full `ArrowUp`, `ArrowDown`, `Enter`, `Escape` support in dropdown.
- **Pinned Active Item**: Pin active environment to top of list with active glow & check icon.
- **Rich Metadata**: Show preset color badge, environment type, and attached project count (e.g. `Personal • 4 Projects`).
- **Recently Used Sorting**: Track environment usage timestamp in store and display recent environments first.

### Solution C: Scalable Project List & Navigation (`NavigationSidebar.tsx` & `EnvironmentSettingsView.tsx`)
- **Sidebar Project Search & Filter**:
  - Add search input field at top of `NavigationSidebar.tsx` with clear button.
  - Instant client-side filtering by project name or path.
- **Project Pinning / Favorites**:
  - Toggle pin star icon on projects. Pinned projects stay anchored at the top of the sidebar under a "Pinned" section.
- **Compact View Toggle & Layout**:
  - Provide compact single-line mode vs standard 2-line mode in sidebar.
- **Settings & Modal Project Scalability**:
  - Add search input to `EnvironmentSettingsView` Projects tab and `AddProjectModal`.
  - Add compact table view option with column sorting (Name, Path, Attached Date) for managing 50+ projects.

---

## 4. Implementation Order

1. **Phase 3.5.2-A**: Personal Environment View Filtering & Capability System.
2. **Phase 3.5.2-B**: Environment Switcher UX Enhancements (Search, Arrow Key Nav, Pinned Active Env, Project Count Badges).
3. **Phase 3.5.2-C**: Navigation Sidebar Project Scalability (Search, Pinning, Compact Mode).
4. **Phase 3.5.2-D**: Environment Settings & Modal Scalability (Project Filtering, Table Mode, Batch Attachment Search).

---

## 5. PR Breakdown Roadmap

### PR 1: Personal Environment UX & Capability Scope
* **Scope**: Hide enterprise tabs (`Members & Governance`, `Audit Stream`) when active environment is Personal.
* **Files**:
  - `apps/web/src/components/environment/EnvironmentSettingsView.tsx`
  - `@asterim/shared` (Capability interfaces)
* **Goal**: Personal Environment feels 100% like a local workstation.

### PR 2: Environment Switcher OS Experience (`⌘E`)
* **Scope**: Add instant search, arrow key navigation, pinned active item, and attached project counts to environment switcher dropdown.
* **Files**:
  - `apps/web/src/components/WorkspaceSwitcher.tsx`
* **Goal**: Instant, accessible, OS-grade environment context switcher.

### PR 3: Navigation Sidebar Scalability & Search
* **Scope**: Add search filter, pinned projects section, and compact layout options to sidebar.
* **Files**:
  - `apps/web/src/components/NavigationSidebar.tsx`
  - `apps/web/src/stores/useProjectStore.ts` (Pinned projects state)
* **Goal**: Scale sidebar to seamlessly handle 20 to 250+ projects.

### PR 4: Environment Settings & Attachment Modal Scalability
* **Scope**: Add search, sorting, and compact table mode to Environment Settings Projects tab and `AddProjectModal`.
* **Files**:
  - `apps/web/src/components/environment/EnvironmentSettingsView.tsx`
  - `apps/web/src/components/overlays/AddProjectModal.tsx`
* **Goal**: Effortless project attachment management for large workspaces.

---

## 6. Verification Checklist

- [ ] **Personal Environment Cleanliness**: In Personal Environment, `Members & Governance` and `Audit Stream` tabs are completely hidden from Settings View.
- [ ] **Enterprise Environment Feature Reveal**: Switching to Company or Client Environment automatically displays `Members & Governance` and `Audit Stream` tabs.
- [ ] **Switcher Search & Arrow Navigation**: Pressing `⌘E` opens switcher dropdown, typing filters environments instantly, arrow keys move focus, and `Enter` switches active environment.
- [ ] **Active Env Pinning & Metadata**: Switcher displays active environment pinned with preset badge and attached project count.
- [ ] **Sidebar Search Filtering**: Typing in sidebar project search filters 50+ projects in real-time (<16ms).
- [ ] **Sidebar Pinning**: Star/pinning projects moves them to "Pinned" section at top of sidebar.
- [ ] **Modal & Settings Search**: `AddProjectModal` and Settings Projects tab support search filtering across hundreds of projects.
- [ ] **Monorepo Build**: All 7 packages compile cleanly with zero TypeScript errors (`npm run build`).
