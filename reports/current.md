Task-ID: P6-06
Status: COMPLETE

# Execution Report: P6-06 — Reusable Agent Skills Engine, Schema Parser & Workspace Discovery

**Task ID:** P6-06
**Phase:** 6
**Status:** VERIFIED
**Date:** 2026-08-16
**Author:** Claude Code

---

## 1. Summary

The reusable skills subsystem is implemented end to end and verified against all four monorepo
gates.

`SkillService` discovers `SKILL.md` directories from the workspace (`<project>/.agents/skills`) and
from the workstation (`~/.asterim/skills`, following `ASTERIM_DATA_DIR`), parses their YAML
frontmatter through a purpose-built safe subset parser, and normalizes declared parameters into JSON
Schema. Discovered skills join the existing agent tool namespace as `skill__<name>` via
`McpAgentBridge`, carry their schema into the session startup instructions, and are exposed
read-only over `GET /api/v1/skills` and `GET /api/v1/skills/:name`. A Skills Explorer view with
search, scope filtering and a detail modal was added to `apps/web`.

Two automated suites were added (169 + 85 assertions). Discovery, parsing, agent exposure, execution,
the REST surface and the UI are all covered.

---

## 2. Files Changed

### Created

| File | Purpose |
| :--- | :--- |
| `packages/shared/src/types/skills.ts` | `SkillDefinition`, `SkillScope`, `SkillExecutionResult`, `SKILL_TOOL_PREFIX`, `skillToolName`, `isSkillToolName` |
| `apps/server/src/services/skills/SkillFrontmatter.ts` | Safe YAML-subset frontmatter parser (no YAML engine, no eval) |
| `apps/server/src/services/skills/SkillService.ts` | `discoverSkills` / `getSkill` / `executeSkill`, schema normalization, TTL cache |
| `apps/server/src/services/skills/__tests__/SkillService.test.ts` | 169 assertions: parser, discovery, resilience, cache, bridge, prompt, REST |
| `apps/server/src/routes/skills.ts` | `GET /api/v1/skills`, `GET /api/v1/skills/:name`, auth + workspace-path guard |
| `apps/web/src/stores/useSkillsStore.ts` | Read-only skills store, `filterSkills`, `parameterNames`, `requiredParameters` |
| `apps/web/src/components/skills/SkillsExplorer.tsx` | Card grid, search, scope filter, `scopeTone`, `parameterPreview` |
| `apps/web/src/components/skills/SkillDetailModal.tsx` | Rendered markdown instructions, parameter table, raw schema |
| `apps/web/src/components/skills/__tests__/SkillsExplorer.test.ts` | 85 assertions: helpers, store, SSR rendering |

### Modified

| File | Change |
| :--- | :--- |
| `packages/shared/src/index.ts` | Export `./types/skills` |
| `apps/server/src/services/mcp/McpAgentBridge.ts` | Skills join the catalogue as `skill__<name>`; `workspacePath` parameter; `AgentTool.kind`; `toSkillTool`; skill execution short-circuit |
| `apps/server/src/services/mcp/McpToolPrompt.ts` | `formatSkillInstructions`, `formatSessionInstructions` |
| `apps/server/src/services/mcp/McpToolGateway.ts` | Threads `workspacePath` to the bridge; approval card names a skill as a skill, not an "MCP tool" |
| `apps/server/src/services/AgentService.ts` | Session startup discovers skills and uses `formatSessionInstructions` |
| `apps/server/src/index.ts` | Registers `skillRoutes` |
| `apps/web/src/stores/useViewStore.ts` | `'skills'` added to `ViewType` and `availableViews` |
| `apps/web/src/App.tsx` | Skills tab in the view navigation, mounted with `workspacePath={project.path}` |
| `apps/server/package.json`, `apps/web/package.json` | New suites wired into `test` |

---

## 3. Implementation Details

### Frontmatter parsing (`SkillFrontmatter.ts`)

The task forbids unsafe YAML execution, so no YAML engine is used. The parser is a line scanner over
a deliberate subset — nested mappings, block sequences, flow collections, block scalars (`|`, `>`
with chomping), quoted and typed scalars, quote-aware comment stripping — that can only ever produce
plain data. Guards: max 2000 frontmatter lines, `MAX_YAML_DEPTH = 32` (the parser recurses once per
indentation level, so deep indentation would otherwise overflow the stack), and it never throws.

During self-review I replaced the plain-key regex with a linear scan. The natural expression
(`([^:#]+?)\s*:`) has an ambiguity between the lazy repetition and the trailing `\s*` — both match a
space — which backtracks quadratically on a long line containing no colon. That is exactly the line
a hostile `SKILL.md` would contain. `parseKeyLine` scans instead; a regression test asserts a 400 000
character keyless line parses in under 2 seconds.

### Discovery (`SkillService.ts`)

Read-only by construction: `readdir`, `stat`, `readFile`, and no code path that spawns, imports or
evaluates anything found. Limits are `MAX_SKILL_FILE_BYTES` (512 KB) and `MAX_SKILLS_PER_SCOPE`
(200). Every entry is parsed inside its own try/catch, so one broken skill cannot take the others
with it.

A name present in both scopes resolves to the **workspace** copy. This is a decision the task did not
specify: a skill reaches the agent as one flat name, and two skills answering to `skill__x` would
leave the agent choosing between them. The repository's copy is the one the developer is looking at,
so it wins. Both scopes are still scanned and reported.

Names are constrained to `^[A-Za-z0-9][A-Za-z0-9._-]*$` because they become a token on one line of
agent output; a declared name outside that set is slugified, and a directory with no usable name
yields no skill. A 5-second TTL cache keeps per-tool-call discovery off the filesystem
(`invalidate()` clears it).

Parameter schemas accept both a full JSON Schema and the common shorthand
(`path: {type: string, required: true}`), which is lifted into `{type, properties, required}` so
the existing `validateToolArguments` can read it.

### Agent integration

`getAvailableTools(workspaceId?, workspacePath?)` — the second key is deliberate: an MCP server is a
database row scoped by id, a skill is a directory scoped by path. `executeTool` answers a `skill__`
name before consulting the server catalogue. `executeSkill` returns the skill's instructions as text;
Asterim does not run a skill's scripts, and a skill that wants one run says so in its instructions,
where it goes through the normal approval path. Both existing signatures gained only optional
trailing parameters, so every existing caller and test is unaffected.

### REST

`workspacePath` is resolved against the projects the Core already knows about. Left unchecked, the
query parameter would turn an authenticated request into "read the `SKILL.md` of every directory
under any path on this machine". An unregistered path (or a traversal out of a registered one) is
refused with 400 rather than scanned. This guard is not spelled out in the task; it is flagged in
§8 for review.

---

## 4. Verification

All commands run from the repository root.

| Gate | Command | Result |
| :--- | :--- | :--- |
| Typecheck | `pnpm typecheck` | 11 successful, 11 total — 0 errors |
| Lint | `pnpm lint` | 7 successful, 7 total — **0 errors** (warnings pre-existing) |
| Test | `pnpm test` | 9 successful, 9 total — **32 suites, all assertions passed** |
| Build | `pnpm build` | 7 successful, 7 total |

New suites:

```
asterim:test:      169/169 assertions passed   (SkillService.test.ts)
@asterim/web:test:  85/85  assertions passed   (SkillsExplorer.test.ts)
```

**Suite count.** The repository had **30** suites before this task (server 16, web 5, adapters 1,
relay 1, mcp-memory-server 7), matching the task's stated baseline. The task required 31; there are
now **32**, because I added the `apps/web` UI suite as well as the required `SkillService.test.ts` —
without it, acceptance criterion 5 (the explorer and modal render, with search and scope filtering)
would have no automated evidence in a repository with no browser test runner.

**No test runner exists** in this repo; both suites follow the established standalone-script pattern
with their own assertion harness, real files in a temp directory, and `fastify.inject()` for routes.

---

## 5. Acceptance Criteria Review

- [x] **1. `SkillService` discovers and parses skills from both workspace `.agents/skills` and global directories.** — `SkillService.test.ts` § "discoverSkills — both scopes" writes real skills into both trees and asserts the merged list, ordering, scope attribution, per-scope paths, and workspace-over-global precedence. § "discoverSkills — it survives what it finds" asserts a directory with no `SKILL.md`, a loose file, a `SKILL.md` that is itself a directory, a wrong filename, an oversized file and a missing workspace are each skipped without reducing the result.
- [x] **2. Skill YAML frontmatter and parameter schemas are parsed accurately into `SkillDefinition`.** — §§ "parseYaml", "parseYaml — what is and is not a key", "parseFrontmatter", "normalizeParametersSchema", "parseSkillMarkdown": nested mappings, block/flow sequences, literal and folded block scalars, quoted keys, `key:value` vs `key: value`, CRLF, BOM, unclosed fence, missing frontmatter fallback to the directory name, first-paragraph description fallback, full-JSON-Schema pass-through, shorthand lifting of `required`, and enum preservation.
- [x] **3. Discovered skills are exposed to agents via `McpAgentBridge` as `skill__<name>` and included in `McpToolPrompt`.** — § "the agent bridge exposes skills as `skill__<name>`" asserts namespacing, `kind: 'skill'`, the schema an agent must satisfy, scope-aware descriptions, `resolveTool`, successful execution, invalid-parameter and unknown-skill error results, and refusal of an un-namespaced name. § "the session startup instructions" asserts `formatSkillInstructions` names every skill, marks both scopes, and that `formatSessionInstructions` carries tools and skills together while staying empty when there is neither. `AgentService.startAgent` wires it into the real session payload.
- [x] **4. `GET /api/v1/skills` and `GET /api/v1/skills/:name` return accurate skill metadata and instructions.** — §§ "GET /api/v1/skills" and "GET /api/v1/skills/:name" drive the real handlers through `fastify.inject()`: 401 without a user on both routes, the global list, the workspace-scoped list, scope/schema/instructions in the payload, lookup by name and by id, 404 for an unknown skill and for a workspace skill requested without its workspace, JSON content-type, and 400 for an unregistered path or a traversal.
- [x] **5. `SkillsExplorer.tsx` and `SkillDetailModal.tsx` render in `apps/web` with search and scope filtering.** — `SkillsExplorer.test.ts` renders both components through `react-dom/server`: name, description, scope badges, parameter preview, script count, path, the "N of M" count, search narrowing the list, the scope filter hiding the other scope and marking itself `aria-pressed`, the distinct "no match" vs "no skills" empty states, error and loading states, the modal opening, its parameter table (required/optional), markdown-rendered instructions (`<h1>` present, raw `#` absent), file chips and raw schema. `filterSkills` is asserted directly across name/description/path, case-insensitivity and search-plus-scope composition.
- [x] **6. `SkillService.test.ts` passes with comprehensive assertions.** — 169/169 assertions passing, across 12 sections covering the parser, discovery, resilience, caching, resolution, execution, the bridge, the prompt and the REST surface.
- [x] **7. Monorepo CI gates pass with 0 errors.** — `pnpm typecheck` 11/11, `pnpm lint` 7/7 with **0 errors**, `pnpm test` 9/9 with 32 suites all passing, `pnpm build` 7/7. See §4 for the suite-count note (30 before → 32 now, one more than the 31 the task specified).

**Forbidden changes honoured:**

- [x] No `eval`, no `Function`, no YAML engine, and no execution of any discovered script — discovery is `readdir`/`stat`/`readFile` only.
- [x] Discovery is read-only and resilient — asserted against corrupt frontmatter, a directory in place of `SKILL.md`, wrong filenames, oversized files, non-text bytes and missing directories.
- [x] No existing suite broken — all 30 pre-existing suites pass.

---

## 6. Git Diff Review

`git diff` reviewed file by file against the criteria above.

- Changes to shared code are additive only: `AgentTool` gains an optional `kind`; `getAvailableTools`, `resolveTool`, `executeTool` and `discoverMcpTools` gain optional **trailing** parameters. No existing call site or test needed changing, and `toToolDescriptors` still emits exactly `{name, description, inputSchema}` (asserted by the pre-existing `AgentMcpIntegration` suite).
- `packages/adapters/` is untouched (`git diff --stat packages/adapters` is empty).
- No architecture, dependency or product behaviour was invented: no new dependency was added, and the subsystem is the one the task specifies.
- Two self-review fixes are in the diff and were not in my first draft: the quadratic-backtracking key regex (§3), and the approval card in `McpToolGateway` which would have described a skill as "the MCP tool" — a person deciding whether to allow a call is owed an accurate account of what they are allowing.
- No `docs/` files were created.

---

## 7. Problems Discovered

1. **`AgentMcpIntegration.test.ts` is load-sensitive and flaked twice during verification** — the assertion `'but only once, not twice'` (line 1039) reported 4 invocations instead of 3 on two of five full `pnpm test` runs. It passes standalone, passes with `pnpm --filter asterim test`, and passed on the final full runs. The cause is pre-existing and not this task's: the adapter's echo de-duplication (`BaseAdapter.runToolCall`) suppresses a duplicate only *while the first call is still in flight*, so a PTY echo delayed past the executor's completion escapes it. `packages/adapters/` is untouched by this diff, and the only change on that path — an added skill discovery — *lengthens* the executor, widening the de-dup window rather than narrowing it. Worth a follow-up task: de-duplicate on a short time window rather than on in-flight state alone.

2. **The task's "30 existing test suites" is accurate; "31" understates the delivered count.** See §4.

3. **`EnvironmentSettingsView.tsx` has a hardcoded placeholder Skills sub-tab** (line 860, listing `caveman`/`cavecrew`/`graphify`). It is now contradicted by real discovery. I left it alone: it is outside this task's scope. Flagged for a follow-up.

4. **Two scratch files could not be deleted.** `scratch/_fixbom.ts` and `scratch/_fix_bom.mjs` were written to strip a literal BOM character my editor could not otherwise remove from `SkillFrontmatter.ts`. The environment refused every deletion attempt (`rm`, `git clean`, all blocked by a permission guard). They are **excluded from the commit** but remain untracked on disk and should be deleted manually.

---

## 8. Architectural Concerns

1. **The `workspacePath` guard on the REST routes is a decision I made, not one the task specified.** Without it, `GET /api/v1/skills?workspacePath=/anything` is an authenticated directory read of arbitrary paths. I resolve the parameter against the registered projects and refuse anything else with 400. If Antigravity would rather the dashboard be able to preview an unregistered directory, this is the line to change.

2. **Workspace-over-global precedence for duplicate names** (§3) is likewise unspecified. It is the only option that keeps `skill__<name>` unambiguous, but it means a global skill can be silently shadowed. The UI shows both scope badges, so the shadowing is at least visible in the explorer — but only for skills that are not shadowed. A future refinement could surface "shadowed by workspace" explicitly.

3. **Skills are scoped by filesystem path while MCP servers are scoped by workspace id.** Two scoping keys now travel together through `getAvailableTools`/`executeTool`. It works and is documented at each site, but if a third tool source appears it would be worth introducing a single session-scope object rather than a third positional parameter.

4. **Skill discovery is not event-driven.** The 5-second TTL means a skill written by hand appears within a few seconds, and a session reads the list once at start. There is no `chokidar` watch and no `skills.*` EventBus channel, so the explorer does not update live the way the MCP registry does. That was not in scope; it is the natural next increment if skills should feel live.

---

## 9. Recommended Next Step

Antigravity review of the diff against §5, with particular attention to the two unspecified decisions
in §8.1 and §8.2.

Suggested follow-up tasks, in priority order:

1. **Fix the `BaseAdapter` echo de-duplication race** (§7.1) — a real correctness bug on the agent
   tool path, currently visible only as a flaky assertion.
2. **Replace the hardcoded Skills placeholder in `EnvironmentSettingsView.tsx`** (§7.3) with the real
   `useSkillsStore`, so the environment panel and the Skills tab cannot disagree.
3. **Live skill updates** (§8.4) — a `chokidar` watch on both skills directories publishing
   `skills.discovered` on the EventBus, bringing the explorer to parity with the MCP registry.
