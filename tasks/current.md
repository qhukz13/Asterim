Task-ID: P6-07
Phase: 6

# P6-07 — Agent Profiles, Built-in Engineering Roles & Persona Management

**Task ID:** P6-07
**Phase:** 6
**Assigned Agent:** Claude Code
**Orchestrator:** Antigravity
**Status:** ASSIGNED
**Date:** 2026-08-16

---

## 1. Objective
Implement Asterim's Agent Profiles & Engineering Roles subsystem: define the schema and persistence for configurable agent profiles, seed out-of-the-box system roles (Senior Backend Engineer, Frontend Reviewer, DevOps Engineer, Security Auditor, QA Engineer, Tech Lead), expose authenticated REST APIs (`/api/v1/profiles`), integrate profile selection and system prompts into `AgentService` session startup, and build the Profile Selector & Management UI in `apps/web`.

## 2. Why This Task Exists
Phase 6 ("AI Ecosystem") establishes Asterim as the control center for AI-native software engineering through three core primitives: MCP Server Supervision (P6-01 to P6-05), Reusable Skills Discovery (P6-06), and Agent Profiles (P6-07).
Currently, all agent sessions run with uniform default prompts and global tool capabilities. Agent Profiles enable users and teams to tailor agent persona, system instructions, model parameters, enabled MCP servers, active skills, and automated approval rules per task or workflow.

## 3. Context & Architecture
- Blueprint Reference: `blueprint/ROADMAP.md` Phase 6 ("Agent Profiles: Pre-configured Roles & Profile Configuration Schema").
- Profile Data Model (`packages/shared/src/types/profiles.ts`):
  - `AgentProfile`: `id`, `name`, `role`, `description`, `systemPrompt`, `model?`, `temperature?`, `enabledMcpServers?: string[]`, `enabledSkills?: string[]`, `autoApprovalRules?: string[]`, `isBuiltin: boolean`, `workspaceId?: string`, `createdAt: number`, `updatedAt: number`.
- Persistence: `agent_profiles` table in SQLite (`DatabaseService.ts`) with idempotent creation and default built-in profile seeding.
- Profile Service (`apps/server/src/services/ai/ProfileService.ts`):
  - CRUD operations for profiles with workspace scoping (`listProfiles(workspaceId?)`, `getProfile(id)`, `createProfile(data)`, `updateProfile(id, data)`, `deleteProfile(id)`).
  - Built-in profiles cannot be deleted or mutated into invalid states; users can clone or override them.
- Runtime Session Integration (`AgentService.ts`):
  - `startAgent(projectId, threadId, workspace, agentType, profileId?)`:
  - When `profileId` is provided (or configured on thread/project), load the profile definition.
  - Combine the profile's `systemPrompt` with `McpToolPrompt` instructions (`formatSessionInstructions`).
  - Filter `mcpTools` and `skills` to only include those allowed by `enabledMcpServers` / `enabledSkills` (or all if omitted/wildcard).
- REST API Surface (`apps/server/src/routes/profiles.ts`):
  - `GET /api/v1/profiles` (lists built-in + workspace-scoped profiles).
  - `GET /api/v1/profiles/:id` (retrieves full profile details).
  - `POST /api/v1/profiles` (creates a custom profile).
  - `PUT /api/v1/profiles/:id` (updates a custom profile; rejects mutating built-in profiles).
  - `DELETE /api/v1/profiles/:id` (deletes a custom profile; rejects deleting built-in profiles).
- Web UI (`apps/web`):
  - `useProfileStore.ts`: Zustand store for active profile selection and CRUD operations.
  - `ProfileSelector.tsx`: Dropdown / pill in the chat header or session sidebar showing the active profile with role badge, icon, and quick switcher.
  - `ProfileManagerModal.tsx`: Modal for browsing all profiles, inspecting details/prompts/tools, cloning built-in roles, and creating/editing custom profiles.

## 4. Repository Evidence
- `apps/server/src/services/DatabaseService.ts`: SQLite schema initialization.
- `apps/server/src/services/AgentService.ts`: Session start and tool/skill instruction formatting.
- `apps/server/src/services/mcp/McpToolPrompt.ts`: System prompt instruction generation.
- `packages/shared/src/index.ts`: Shared type exports across server and web.
- `apps/web/src/components/SessionSidebar.tsx` & `apps/web/src/components/TopBar.tsx`: Integration points for profile selector.

## 5. Implementation Scope
1. **Shared Types (`packages/shared/src/types/profiles.ts` & `packages/shared/src/index.ts`)**:
   - Define `AgentProfile`, `CreateProfileInput`, `UpdateProfileInput`, and built-in role constants (`BUILTIN_PROFILES`).
2. **Database Schema (`apps/server/src/services/DatabaseService.ts`)**:
   - Add `agent_profiles` table:
     ```sql
     CREATE TABLE IF NOT EXISTS agent_profiles (
       id TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       role TEXT NOT NULL,
       description TEXT NOT NULL,
       system_prompt TEXT NOT NULL,
       model TEXT,
       temperature REAL,
       enabled_mcp_servers TEXT,
       enabled_skills TEXT,
       auto_approval_rules TEXT,
       is_builtin INTEGER NOT NULL DEFAULT 0,
       workspace_id TEXT,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     );
     ```
3. **Profile Service (`apps/server/src/services/ai/ProfileService.ts`)**:
   - Implement `ProfileService` singleton with built-in role seeding (`initBuiltinProfiles()`).
   - Built-in roles:
     1. `Senior Backend Engineer` (Architecture, API design, Node/TypeScript/SQL optimization, clean code).
     2. `Frontend Reviewer` (UI/UX fidelity, accessibility, design token compliance, state hygiene).
     3. `DevOps Engineer` (CI/CD, Docker containerization, infrastructure, build optimizations).
     4. `Security Auditor` (AST hazard analysis, path traversal checks, secret leakage detection, permission boundaries).
     5. `QA Engineer` (Test coverage, edge case analysis, regression prevention, integration verification).
     6. `Tech Lead` (Cross-domain coordination, architectural decisions, task breakdown, trade-off review).
   - Implement CRUD methods with guard against deleting/modifying built-in profiles.
4. **REST API Routes (`apps/server/src/routes/profiles.ts`)**:
   - Authenticated Fastify routes mounted under `/api/v1/profiles`.
   - Register route plugin in `apps/server/src/index.ts`.
5. **Agent Session Integration (`apps/server/src/services/AgentService.ts`)**:
   - Read profile when starting agent sessions; inject profile instructions and apply MCP/Skill filter rules.
6. **Web UI (`apps/web`)**:
   - `apps/web/src/stores/useProfileStore.ts`: Zustand store managing active profile state and fetching profiles from `/api/v1/profiles`.
   - `apps/web/src/components/profiles/ProfileSelector.tsx`: Compact role badge/selector component for selecting the active agent profile in the session/chat header.
   - `apps/web/src/components/profiles/ProfileManagerModal.tsx`: Management dialog displaying role catalog, instructions, attached tools/skills, and custom profile creation/cloning.
7. **Automated Unit & Integration Tests**:
   - `apps/server/src/services/ai/__tests__/ProfileService.test.ts`: Test profile CRUD, built-in seeding, validation guards, and REST routes.
   - `apps/web/src/components/profiles/__tests__/ProfileSelector.test.ts`: Test store actions and component rendering.
   - Register new test suites in package test scripts.

## 6. Explicitly Forbidden Changes
- Do NOT delete, weaken, or alter any existing test assertions across the 32 passing test suites.
- Do NOT introduce external LLM SDK dependencies (OpenAI, Anthropic) into the server; prompt formatting and profile configuration must remain local-first.
- Do NOT alter the database migration safety model: schema changes must follow the idempotent `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN` pattern.

## 7. Acceptance Criteria
1. `agent_profiles` table is initialized idempotently in SQLite with built-in profiles seeded automatically on startup.
2. `ProfileService` provides full CRUD operations, protecting built-in roles from unauthorized deletion or mutation.
3. Authenticated REST API endpoints (`GET /api/v1/profiles`, `GET /api/v1/profiles/:id`, `POST /api/v1/profiles`, `PUT /api/v1/profiles/:id`, `DELETE /api/v1/profiles/:id`) operate with full input validation.
4. `AgentService` seamlessly applies the selected profile's system prompt and tool/skill restrictions during agent session startup.
5. `ProfileSelector.tsx` and `ProfileManagerModal.tsx` render cleanly in `apps/web` with role badges, prompt inspection, and custom profile creation.
6. Unit tests in `ProfileService.test.ts` and `ProfileSelector.test.ts` pass deterministically.
7. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test` (all test suites green), `pnpm run build`.

## 8. Definition of Done
- TypeScript typecheck passes with 0 errors (`pnpm run typecheck`).
- ESLint passes with 0 errors (`pnpm run lint`).
- All monorepo test suites (34+ suites) pass deterministically (`pnpm run test`).
- Monorepo production build succeeds (`pnpm run build`).
- Execution report written to `reports/current.md`.

## 9. Verification Commands
```bash
pnpm run typecheck
pnpm run lint
pnpm --filter asterim exec tsx src/services/ai/__tests__/ProfileService.test.ts
pnpm --filter @asterim/web exec tsx src/components/profiles/__tests__/ProfileSelector.test.ts
pnpm run test
pnpm run build
```

## 10. Self-Review Requirements
- Review `git diff` to ensure clean additions without unexpected file changes.
- Verify built-in profile prompts are rich, domain-specific, and non-generic.
- Ensure all acceptance criteria are checked with explicit evidence in `reports/current.md`.

## 11. Required Report
Write execution report to `reports/current.md` adhering to schema in `AGENTS.md`.
