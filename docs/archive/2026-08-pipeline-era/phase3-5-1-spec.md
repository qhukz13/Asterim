# Asterim Phase 3.5.1 — Environment Isolation & Attachment Refinement Specification

**Document Version**: 1.0.0 — CANONICAL PRODUCT & UX REFINEMENT SPEC  
**Author**: CTO, Product Architect & Lead UX Engineer  
**Date**: August 7, 2026  
**Status**: Authoritative Refinement Blueprint  
**Target Platform**: Asterim Local-First AI Engineering Operating System  

---

## 1. Overview & Problem Statement

While Phase 3.5 established the theoretical Environment Architecture Blueprint, an audit of the runtime experience revealed 4 critical UX and state isolation defects:

1. **Create Environment Modal Text Overflow**: The "Create Environment Universe" modal dialog box ran off the card bounds because of fixed CSS widths (`maxWidth: '380px'`) without word wrapping or flex bounds.
2. **Environment Settings Access Friction**: Clicking `⚙ Environment Settings` in the switcher dropdown or TopBar failed to reliably set `activeView = 'environment'` when no project was selected.
3. **Decorative Environment Switching**: Environment switching was purely decorative because `ProjectManager.ts` returned all projects on disk regardless of active environment filters, and `useProjects.ts` did not pass `environmentId` query parameters.
4. **Missing Empty Environment Onboarding**: Creating or switching to a fresh Environment failed to present a clean, clear workspace state asking the user to attach an existing local repository, create a new project, or open a folder.

Phase 3.5.1 resolves all 4 defects, delivering true environment isolation, repository attachment, and modal UI polish.

---

## 2. Product Behavior & Requirements

### A. Create Environment Modal Layout Fix
- The modal dialog card MUST use dynamic responsive width (`maxWidth: '460px'`, `width: '90%'`, `boxSizing: 'border-box'`).
- Subtitle text MUST wrap cleanly inside card boundaries without extending past modal borders.

### B. True Environment Project Isolation
- When Environment $X$ is active, Asterim MUST display ONLY projects attached to Environment $X$.
- Querying `GET /api/v1/projects?environmentId=X` MUST query `environment_project_attachments` and `workspace_id`.
- Legacy unassigned projects automatically belong to the **Personal Environment**.
- Switching to Environment $Y$ MUST immediately filter the left navigation sidebar and project list to Environment $Y$'s attached repositories.

### C. Clean Environment Onboarding State
- When switching to a newly created Environment (or an Environment with 0 attached projects), `activeProjectId` MUST clear to `null`.
- The main workspace area MUST present a clean, clear **Empty Environment View**:
  - `[ ✚ Create New Project ]` — Opens Add Project Modal with `environmentId` pre-bound.
  - `[ 📁 Add Existing Repository ]` — Opens local folder selector to attach an existing git repo to the active Environment.
  - `[ ⚙ Environment Settings ]` — Opens `EnvironmentSettingsView` native tab.

### D. Single-Pane Settings View Access
- Clicking `⚙ Environment Settings` in the switcher dropdown or TopBar MUST set `activeView = 'environment'` and switch `App.tsx` shell view immediately, whether or not a project is selected.

---

## 3. Technical & Database Architecture

### A. Project Attachment DDL & Query Logic
`ProjectManager.ts` `getProjects(environmentId)` query logic:

```sql
-- Query attached projects for specific Environment
SELECT p.id, p.workspace_id, p.name, p.path, p.visibility, p.created_at 
FROM projects p
LEFT JOIN environment_project_attachments epa ON p.id = epa.project_id
WHERE epa.environment_id = ? OR p.workspace_id = ?
ORDER BY p.created_at DESC;
```

For **Personal Environment** (`isPersonal = 1`):
```sql
SELECT p.id, p.workspace_id, p.name, p.path, p.visibility, p.created_at 
FROM projects p
LEFT JOIN environment_project_attachments epa ON p.id = epa.project_id
WHERE epa.environment_id = ? OR p.workspace_id = ? OR p.workspace_id IS NULL OR p.workspace_id = ''
ORDER BY p.created_at DESC;
```

### B. Project Attachment API (`POST /api/v1/projects`)
- `POST /api/v1/projects` accepts `{ name, path, environmentId, workspaceId }`.
- Automatically inserts entry into `environment_project_attachments(id, environment_id, project_id, attached_at)`.

---

## 4. Verification Checklist

- [ ] Create Environment modal displays without text overflow on any screen resolution.
- [ ] Clicking `⚙ Environment Settings` opens `EnvironmentSettingsView` natively when no project is selected.
- [ ] Switching between Environments immediately updates project lists and clears active project if target Environment has 0 projects attached.
- [ ] Creating a new Environment lands on a clean, empty state with Add Existing Repo / Create Project options pre-bound to the new Environment.
- [ ] All 7 monorepo packages build with 0 errors (`pnpm run build`).
