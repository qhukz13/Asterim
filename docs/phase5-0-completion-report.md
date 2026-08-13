# Phase 5.0 — Project Memory Core: Completion Report

**Status:** Complete
**Date:** 2026-08-13
**Branch:** `main` (base `e69d4b5`)
**Tasks:** P5.0-01 through P5.0-09

---

## 1. What was built

Project Memory Core gives a Project continuity across Threads, agents, and processes. Where Context answers *"what is the agent looking at right now"*, Memory answers *"what has this project already decided, and why"* — and the **ProjectBriefing** is the mechanism that delivers it: a deterministic snapshot handed to an agent starting work, so that continuity does not depend on a human re-explaining the project.

The subsystem is complete end to end: shared types → SQLite schema → persistence service → decision lifecycle → briefing generator → event contract → REST surface → specification.

### Delivered surface

| Layer | Artifact |
| :-- | :-- |
| Types | `packages/shared/src/types/memory.ts` — 13 exports; `events.ts` — 4 payloads + 4 event aliases |
| Schema | 4 tables + 7 indexes in `DatabaseService.ts`, WAL enabled |
| Service | `ProjectMemoryService.ts` — 16 public methods |
| Events | 4 `memory.*` types published with `source: 'system:memory'` |
| REST | 8 endpoints at `/api/v1/projects/:id/memory/*` |
| Spec | `DOMAIN_MODEL.md` § Project Memory, `ARCHITECTURE.md` § 8 |

### Files created

```
packages/shared/src/types/memory.ts
apps/server/src/services/ProjectMemoryService.ts
apps/server/src/routes/memory.ts
apps/server/src/services/__tests__/ProjectMemoryService.test.ts
apps/server/src/services/__tests__/temp_db_schema_verify.js
apps/server/src/routes/__tests__/memory.test.ts
apps/server/src/routes/__tests__/temp_phase5_e2e_verify.ts
docs/p5.0-01-verification-report.md … docs/p5.0-08-report.md
docs/phase5-0-completion-report.md
```

### Files modified

```
packages/shared/src/events.ts          additive only; no existing interface altered
packages/shared/src/index.ts           one export line
apps/server/src/services/DatabaseService.ts   WAL pragma + new DDL block; no existing table touched
apps/server/src/index.ts               route registration + initEventBusListeners()
blueprint/DOMAIN_MODEL.md              Project Memory entities and domain rules
blueprint/ARCHITECTURE.md              § 8 Project Memory, REST surface, event contract
blueprint/audit/IMPLEMENTATION_DRIFT.md  5 new drift entries
```

---

## 2. Verification

### Test suites

| Suite | Assertions | Result |
| :-- | --: | :-- |
| `ProjectMemoryService.test.ts` | 217 | ✅ pass |
| `memory.test.ts` (Fastify `inject()`) | 77 | ✅ pass |
| `temp_phase5_e2e_verify.ts` (end-to-end) | 71 | ✅ pass |
| **Total** | **365** | **0 failures** |

```
$ pnpm --filter asterim exec tsx src/services/__tests__/ProjectMemoryService.test.ts
217/217 assertions passed     EXIT=0

$ pnpm --filter asterim exec tsx src/routes/__tests__/memory.test.ts
77/77 assertions passed       EXIT=0

$ pnpm --filter asterim exec tsx src/routes/__tests__/temp_phase5_e2e_verify.ts
71/71 end-to-end checks passed  EXIT=0

$ pnpm run build
Tasks:  6 successful, 6 total    EXIT=0
dist/index.js 568.26 KB
```

`tsc -p apps/server/tsconfig.json --noEmit` reports exactly the four errors that pre-date this phase (`AuthController.ts:354`, `AgentService.ts:164`, `ContextService.ts:109`, `GeminiProvider.ts:2`) and no others. Lint contributes 0 errors from Phase 5.0 files.

Note that the repository has no test runner (established in P5.0-01), so all three suites are standalone scripts with their own assertion harnesses. Each points `ASTERIM_DATA_DIR` at a `mkdtempSync` directory **before** loading `DatabaseService` — whose singleton is constructed at import time — and removes it in a `finally` block. No suite touches `~/.asterim/asterim.db`.

### End-to-end scenario

`temp_phase5_e2e_verify.ts` walks the complete loop in one narrative, over HTTP, with both the projects and memory route plugins registered:

| # | Scenario | Result |
| :-- | :-- | :-- |
| 1 | Create two projects over REST | ✅ |
| 2 | Record a decision anchored to file + symbol + commit; confirm it is discoverable by file path | ✅ |
| 3 | Supersede it; confirm both status transitions and the link in both directions; walk `ACTIVE → STALE → ARCHIVED → ACTIVE` | ✅ |
| 4 | Set intent twice; confirm the predecessor archives and exactly one `ACTIVE` intent remains | ✅ |
| 5 | Add rules with explicit and defaulted severity; confirm listing order | ✅ |
| 6 | Seed agent sessions and approval gates exactly as `AgentService` and `ApprovalManager` write them | ✅ |
| 7 | Generate the briefing; confirm all five sections populate and two calls are byte-identical | ✅ |
| 8 | Confirm strict project isolation; confirm cross-project supersede is refused | ✅ |
| 9 | Delete a project; confirm memory cascades, including grandchild code refs | ✅ |

Every acceptance item in the P5.0-09 brief is covered by step 2 (code refs), step 3 (supersede + transitions), step 4 (intent), step 5 (rules), step 7 (briefing), and step 8 (isolation).

### Live-server verification

Beyond the harnesses, the REST surface was confirmed against the running dev server, which hot-reloaded the change and served the real `~/.asterim/asterim.db` (6.9 MB, 3 projects, 4052 events):

```
$ curl localhost:3000/api/v1/projects/43f4a2da-…/memory/briefing
200  {"briefing":{"projectId":"43f4a2da-…","activeDecisions":[],…,
      "recentAgentWork":[{"sessionId":"df4a55de-…","agentType":"antigravity",
      "status":"crashed","startedAt":1786439059086,…
```

`recentAgentWork` is populated from genuine `sessions` rows written by `AgentService` — the strongest available evidence that the P5.0-01 finding was correct: **no `agent_work_records` table was needed**, because the runtime already records everything the briefing requires.

---

## 3. Design decisions worth carrying forward

**No new activity log.** P5.0-01 verified that `sessions` and `approvals` already carry sufficient data for the briefing, so the phase added no parallel record of agent work. This avoided duplicated data, a second thing to keep in sync, and a write on the agent hot path.

**Determinism over recall.** The briefing is assembled by query, never summarized by a model. Every ordered query carries a *total* order — `id` breaks timestamp ties — so two calls against unchanged data return byte-identical JSON even when every `created_at` in the project is the same value. This is tested directly under forced timestamp collision, which an ordinary determinism test would miss. Approximate retrieval can be layered on later as an index; it must not replace the deterministic core.

**Atomicity at every multi-statement write.** `createDecision`, `createIntent`, and `supersedeDecision` run in explicit transactions. Rollback is proven, not assumed: the suites force a mid-transaction primary-key collision and confirm no partial state survives.

**Validation at the boundary the schema cannot enforce.** SQLite cannot add a `CHECK` constraint to an existing table, so the service validates enum-like columns on write and rejects unrecognised literals rather than coercing them — a caller passing `'active'` gets an error instead of silently mis-partitioning `idx_decisions_project_status`.

**Publish after commit, and survive hostile subscribers.** The Event Bus dispatches synchronously, so a subscriber that throws could make a committed write look like a failure, and a subscriber that writes memory could recurse forever. Both are absorbed in one guarded helper: errors are logged and swallowed, and nesting is capped. Events are emitted only after the write commits, so no subscriber can observe a change that later rolls back.

**Thin routes.** Handlers contain no SQL and no lifecycle logic. `projectId` always comes from the path and overwrites any body value, removing the class of bug where URL and payload disagree.

---

## 4. Known gaps

All are recorded in `blueprint/audit/IMPLEMENTATION_DRIFT.md` §§ 4–8 with recommended actions. Summarised here by urgency:

**Decide before a client is written against the API:**

1. **`supersededBy` carries two opposite meanings** — it names the replacement on a `SUPERSEDED` decision and the replaced decision on the `ACTIVE` one. Already on the wire through both REST and the event payload. (Drift § 4)
2. **`relatedFiles` has no column** — derived from code refs, which makes the two fields non-independent. (Drift § 5)
3. **Cross-project supersede discloses the owning project's id** in its 400 message. (Drift § 8)

**Decide before the relevant feature is built:**

4. **`scope_pattern` default is `'*'` in the schema and `'**'` in the type's documentation** — matters once rule matching exists. (Drift § 6)
5. **Memory events are not forwarded over Socket.IO** — matters once a memory UI exists. (Drift § 7)
6. **`initEventBusListeners()` registers nothing.** The seam is wired and called at startup, but no existing system event has a defined memory consequence. Deciding that (say) a crashed agent should mark decisions `STALE` is a product decision, not a coding one.

**Scale and hardening:**

7. **`activeDecisions` and `architecturalRules` are unbounded in the briefing.** Agent work and approvals are capped at 5; decisions and rules are not. A project with hundreds of active decisions produces an arbitrarily large briefing, and it is now reachable over HTTP.
8. **The briefing's five queries are not one snapshot.** Determinism holds; atomicity does not — a concurrent write between queries yields a briefing that matched no single database state.
9. **No project-scoped authorization.** Shared with `projects.ts` and `context.ts`, so subsystem-wide rather than introduced here.

**Repository-level, pre-existing:**

10. **CI is red on `main`** — 38 lint errors in files this phase never touched. Every "build passes" claim in this phase is local verification; the pipeline provides no signal until this is fixed.
11. **`~/.asterim/asterim.db` was migrated to WAL** by the running dev server when P5.0-03 landed. Data is intact (`integrity_check: ok`), but WAL lives in the database header — reverting the commit does not revert the file, and backups must now include the `-wal` and `-shm` sidecars.

---

## 5. Specification synchronization

This phase closed the governance gap that P5.0-01 through P5.0-08 flagged repeatedly: the implementation had run eight tasks ahead of the normative specification.

- **`blueprint/DOMAIN_MODEL.md`** — Project Memory added to the domain hierarchy under Project; the Project entity updated to own it; five new entity specifications (Project Memory aggregate, ProjectDecision, DecisionCodeRef, ProjectIntent, ArchitecturalRule, ProjectBriefing) in the document's existing Purpose/Responsibilities/Lifecycle/Relationships/Current State form; three new entries under Domain Rules & Justifications explaining why Memory is scoped to Project rather than Thread, why a briefing is queried rather than summarized, and why it reads existing AgentExecution and Approval records.
- **`blueprint/ARCHITECTURE.md`** — new § 8 in the document's normative MUST form, covering requirements, current implementation, alternatives considered, trade-offs and reasoning; § 8.1 registers the eight REST routes and the thinness rule; § 8.2 registers the four-event contract and the synchronous-dispatch obligations. The system overview diagram now shows Project Memory.
- **`blueprint/audit/IMPLEMENTATION_DRIFT.md`** — five entries recording where the implementation knowingly diverges from the specification, so the Blueprint stays normative and the gaps stay visible.

---

## 6. Verdict

**Phase 5.0 Project Memory Core is complete and proven.** 365 assertions across three suites pass with zero failures; the monorepo builds clean; the REST surface is verified against both a throwaway database and the live server with real data; and the specification now describes the subsystem.

The nine gaps in § 4 are documented rather than silently carried. Items 1–3 are the ones worth settling before Phase 5.1 builds a client against this API — each is a small change now and a breaking change later.
