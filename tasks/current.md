Task-ID: P6-06
Phase: 6

Reusable Agent Skills Engine, Schema Parser & Workspace Discovery

## Objective
Implement Asterim's Reusable Skills Subsystem: discover `.agents/skills/*/SKILL.md` from the current workspace and global `~/.asterim/skills/`, parse YAML frontmatter and parameter schemas, expose skills to agents as callable tools via `McpAgentBridge` (`skill__<skillName>`) and system prompt instructions, provide authenticated REST endpoints (`GET /api/v1/skills`), and build the Skills Explorer UI in `apps/web`.

## Context & Architecture
- Skills in Asterim follow the open Agent Skill specification: a directory containing a required `SKILL.md` with YAML frontmatter (`name`, `description`, optional JSON parameter schema, entry scripts, reference files).
- `SkillService.ts` discovers skills across two scopes:
  1. Workspace: `<projectPath>/.agents/skills/*/SKILL.md`
  2. Global: `~/.asterim/skills/*/SKILL.md`
- Discovered skills are formatted into `McpToolPrompt` and registered into `McpAgentBridge` so agents can invoke skills (`skill__<name>`) or read their full execution instructions.
- A dedicated Skills view (`SkillsExplorer.tsx`, `SkillDetailModal.tsx`) is added to `apps/web` allowing developers to browse, search, and inspect available skills and their parameters.

## Implementation Scope
1. **Shared Types (`packages/shared/src/types/skills.ts`)**:
   - `SkillDefinition`: `id`, `name`, `description`, `scope` (`workspace` | `global`), `path`, `parametersSchema?: Record<string, unknown>`, `instructions: string`, `scripts?: string[]`, `references?: string[]`.
   - Export from `packages/shared/src/index.ts`.
2. **`SkillService.ts` (`apps/server/src/services/skills/SkillService.ts`)**:
   - `discoverSkills(workspacePath?: string)`: Scans workspace `.agents/skills` and global `~/.asterim/skills`, parses YAML frontmatter and markdown body safely without external unsafe YAML execution.
   - `getSkill(nameOrId: string, workspacePath?: string)`: Retrieves full skill instructions and metadata.
   - `executeSkill(name: string, params: Record<string, unknown>, workspacePath?: string)`: Resolves skill, validates params, returns formatted prompt/instruction payload for agent execution.
3. **Agent Integration (`McpAgentBridge.ts` & `McpToolPrompt.ts`)**:
   - Expose discovered skills alongside MCP tools as `skill__<name>` tools with `parametersSchema`.
   - Include available skills summary in session startup instructions.
4. **REST API Routes (`apps/server/src/routes/skills.ts`)**:
   - `GET /api/v1/skills` — List discovered skills (filtered by optional `?workspacePath=`).
   - `GET /api/v1/skills/:name` — Get full skill markdown, metadata, and parameter schema.
   - Register in `apps/server/src/index.ts`.
5. **Web UI (`apps/web`)**:
   - `useSkillsStore.ts`: Store for listing and fetching skills.
   - `SkillsExplorer.tsx`: Card grid / list of available skills with search filter, scope badge (`Workspace` / `Global`), and parameter preview.
   - `SkillDetailModal.tsx`: Render rendered markdown instructions and input parameter schemas.
   - Add Skills tab to navigation sidebar.
6. **Automated Unit Tests (`apps/server/src/services/skills/__tests__/SkillService.test.ts`)**:
   - Test discovery from temporary directories with real `SKILL.md` files.
   - Test frontmatter parsing, parameter schema validation, and missing frontmatter fallback.
   - Test REST route handlers.
   - Wire into `apps/server/package.json` `"test"` script.

## Constraints & Forbidden Changes
- Do NOT use unsafe `eval` or execute untrusted shell scripts during skill discovery.
- Keep skill discovery read-only and resilient against corrupted or non-markdown files.
- Do NOT break any of the 30 existing test suites.

## Acceptance Criteria
1. `SkillService` discovers and parses skills from both workspace `.agents/skills` and global directories.
2. Skill YAML frontmatter and parameter schemas are parsed accurately into `SkillDefinition`.
3. Discovered skills are exposed to agents via `McpAgentBridge` as `skill__<name>` and included in `McpToolPrompt`.
4. `GET /api/v1/skills` and `GET /api/v1/skills/:name` return accurate skill metadata and instructions.
5. `SkillsExplorer.tsx` and `SkillDetailModal.tsx` render in `apps/web` with search and scope filtering.
6. `SkillService.test.ts` passes with comprehensive assertions.
7. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test` (31 test suites), `pnpm run build`.
