# Current Task: P5.1-03 — Project Context Resolver Engine

**Task ID:** P5.1-03  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-13  

---

## 1. Objective

Implement the project context resolution engine in `packages/mcp-memory-server/src/resolver.ts` to reliably determine the active Asterim project for the MCP process via CLI flags, environment variables, or normalized longest-prefix CWD auto-detection against SQLite.

---

## 2. Context & Findings from P5.1-01 & P5.1-02

* `ProjectManager` does not have a `getProjectByPath` method.
* The live `~/.asterim/asterim.db` contains nested paths (e.g. an ancestor directory registered alongside specific repositories) and trailing slashes.
* The resolution engine must:
  1. **Normalize all paths** via `path.resolve()` (stripping trailing slashes and resolving relative segments).
  2. **Use segment-safe containment** (`path.relative(projectPath, cwd)`) rather than raw `startsWith` to prevent substring collisions (e.g. `/AsterimOld` matching `/Asterim`).
  3. **Select the longest matching path** when multiple candidates match (most specific project root wins over broad ancestor directories).
  4. **Fail loudly and descriptively** if no project matches, listing known registered projects. Never silently pick an arbitrary project.

---

## 3. Repository Evidence & Relevant Files

Inspect:
* [`packages/mcp-memory-server/src/index.ts`](file:///c:/Projects/Asterim/packages/mcp-memory-server/src/index.ts)
* [`apps/server/src/services/DatabaseService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/DatabaseService.ts)
* [`apps/server/src/services/ProjectManager.ts`](file:///c:/Projects/Asterim/apps/server/src/services/ProjectManager.ts)
* [`docs/p5.1-01-audit-report.md`](file:///c:/Projects/Asterim/docs/p5.1-01-audit-report.md) § 5
* [`reports/current.md`](file:///c:/Projects/Asterim/reports/current.md)

---

## 4. Implementation Scope

1. **Resolver Implementation (`packages/mcp-memory-server/src/resolver.ts`)**:
   - Define and export interface:
     ```typescript
     export interface ResolvedProject {
       id: string;
       name: string;
       path: string;
     }

     export interface ResolveOptions {
       explicitProjectId?: string;
       explicitProjectPath?: string;
       cwd?: string;
     }
     ```
   - Implement `resolveProjectContext(options?: ResolveOptions): ResolvedProject`:
     - **Priority 1**: `explicitProjectId` (from CLI `--project <id>` or option). Query `SELECT id, name, path FROM projects WHERE id = ?`. Throw if not found.
     - **Priority 2**: `explicitProjectPath` (from CLI `--project-path <path>` or option). Resolve path and match against `projects` table.
     - **Priority 3**: `process.env.ASTERIM_PROJECT_ID`. Query `projects` table by id. Throw if invalid.
     - **Priority 4**: **CWD Auto-Detection**:
       - `targetCwd = path.resolve(options?.cwd || process.cwd())`
       - Query all projects: `SELECT id, name, path FROM projects`.
       - For each project, compute `normalizedProjectPath = path.resolve(p.path)`.
       - Calculate `rel = path.relative(normalizedProjectPath, targetCwd)`.
       - Match if `rel === ''` (exact match) OR (`!rel.startsWith('..') && !path.isAbsolute(rel)` - subfolder of project).
       - Sort matches by `normalizedProjectPath.length DESC` and pick the first (longest / most specific path).
     - **Fallback**: If no match found, throw a formatted error listing all registered project names and paths.
2. **Unit Test Suite (`packages/mcp-memory-server/src/__tests__/resolver.test.ts`)**:
   - Create isolated temp SQLite database using `DatabaseService`.
   - Seed test projects:
     - Project 1 (Ancestor): `/workspace/projects/` (with trailing slash)
     - Project 2 (Specific): `/workspace/projects/asterim-core`
     - Project 3 (Sibling): `/workspace/projects/asterim-core-legacy`
   - Test Cases:
     - Exact match on Project 2.
     - Nested subfolder CWD (`/workspace/projects/asterim-core/apps/server/src`) resolves to Project 2 (not Project 1).
     - Trailing slash input normalizes correctly.
     - Sibling directory (`/workspace/projects/asterim-core-legacy`) resolves to Project 3.
     - Explicit `--project <id>` resolution.
     - Explicit `ASTERIM_PROJECT_ID` env resolution.
     - Unknown path / unknown project throws descriptive error.

---

## 5. Explicitly Forbidden Changes

* Do **NOT** implement the MCP tools (`get_project_briefing`, `query_decisions`, `record_decision`) yet — reserved for P5.1-04 and P5.1-05.
* Do **NOT** modify existing services in `apps/server` or `packages/shared`.
* Do **NOT** alter existing database DDL schemas.

---

## 6. Acceptance Criteria

1. `resolveProjectContext` correctly implements the 4-tier resolution hierarchy.
2. Normalization, segment-safe containment, and longest-path matching rules are fully covered.
3. Unit test suite `resolver.test.ts` passes 100% of assertions.
4. `pnpm run build` completes with 0 errors across all monorepo packages.

---

## 7. Verification Commands

```bash
pnpm --filter asterim exec tsx ../../packages/mcp-memory-server/src/__tests__/resolver.test.ts
pnpm --filter @asterim/mcp-memory-server build
pnpm run build
```

---

## 8. Required Report Format

Upon completion, write the execution result directly to `reports/current.md` using the standard format:
* **Task ID**: P5.1-03
* **Status**: `IMPLEMENTED` / `VERIFIED` / `BLOCKED`
* **Summary**: Summary of resolver implementation and test coverage
* **Files Changed**: List of files created/modified
* **Implementation Details**: Details on path resolution and specificity ranking
* **Tests / Verification**: Output of test execution and build commands
* **Problems Discovered & Concerns**: Any issues encountered
* **Recommended Next Step**: Recommendation for P5.1-04
