# Execution Report: P5.4-04 — Relevance Ranking, Scoped Briefings & Noise Reduction

**Task ID:** P5.4-04
**Phase:** Phase 5.4 — Intelligent Memory & Continuous Governance
**Status:** VERIFIED
**Date:** 2026-08-14
**Author:** Claude Code

---

## 1. Summary

Project Memory can now answer *"what do I need to know for **this** change?"* instead of only *"what has been decided?"*. `MemoryRelevanceEngine` scores decisions from four local signals — provenance weight, touched-file overlap, lexical overlap with the task, and a drift deduction — and `getProjectBriefing` uses it to return a bounded, ranked context window. Architectural rules and the current intent are routed around the engine entirely: they are governance invariants, and a limit must never be able to silence them.

Ranking is **opt-in**. A briefing requested without scope returns exactly what it returned before this task, in the same order, byte for byte — the guarantee `retrieval_tools.test.ts` already depended on.

**+127 assertions** across four suites (one new, three extended). Every existing suite in the repository re-run unchanged. `tsc --noEmit` clean on `@asterim/web`, `@asterim/shared`, `@asterim/adapters` and `@asterim/mcp-memory-server`; `apps/server` holds its 4 pre-existing errors, none in a touched file. `pnpm run build` 7/7.

**13 mutation runs**, one per load-bearing guard. Two of them exposed weak assertions of my own — the more serious being a set of `?files` route tests that passed against a route ignoring `?files` entirely (§ 7.1). Both were strengthened and re-confirmed.

---

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `packages/shared/src/types/memory.ts` | Modified | `BriefingOptions`, `RelevanceBreakdown`, `ProjectDecision.relevanceScore` |
| `apps/server/src/services/memory/MemoryRelevanceEngine.ts` | Created | Deterministic local scoring, ranking, and briefing windowing |
| `apps/server/src/services/ProjectMemoryService.ts` | Modified | `getProjectBriefing(projectId, options?)`; new `queryDecisions` |
| `apps/server/src/routes/memory.ts` | Modified | `?task` / `?files` / `?limit` on the briefing endpoint |
| `packages/mcp-memory-server/src/index.ts` | Modified | `taskDescription`/`touchPaths`/`limit` on `get_project_briefing`; `touchPaths`/`limit` on `query_decisions` |
| `apps/web/src/components/memory/DecisionExplorer.tsx` | Modified | Drift filter toggle; search extended to anchor paths; shared pill style |
| `apps/server/src/services/memory/__tests__/MemoryRelevanceEngine.test.ts` | Created | 63 assertions |
| `apps/server/src/routes/__tests__/memory.test.ts` | Modified | +27 assertions (113 → 140) |
| `packages/mcp-memory-server/src/__tests__/retrieval_tools.test.ts` | Modified | +16 assertions (71 → 87) |
| `apps/web/src/components/memory/__tests__/DecisionExplorer.test.ts` | Modified | +21 assertions (130 → 151) |
| `docs/screenshots/p5.4-04/drift-filter-1400.png` | Created | Visual evidence of both filter states |
| `scratch/gen-relevance.tsx`, `scratch/shoot-relevance.js` | Created | Capture harness (scratch only, not part of any build) |

---

## 3. Implementation Details

### 3.1 The score, and why each term is the size it is

```
score = provenance + pathOverlap + lexical − driftPenalty
```

| Term | Range | Source |
| :--- | :--- | :--- |
| `provenance` | 1.0 / 0.85 / 0.7 / 0.5 | DEC-024 — human > repository evidence > agent > inferred |
| `pathOverlap` | +0.5 | anchor intersects `touchPaths` |
| `lexical` | +0.1 … +0.4 | share of task terms found in title/summary/rationale/constraints |
| `driftPenalty` | −0.15 | anchor `FILE_DELETED` or `SYMBOL_NOT_FOUND` (DEC-027) |

Two relationships in that table are load-bearing and are asserted directly rather than left to arithmetic coincidence:

- `PATH_OVERLAP_BOOST (0.5)` **exceeds** the `HUMAN_CONFIRMED − AGENT_STATEMENT` gap of `0.3`, which is what makes the boost meaningful: *an agent's note about the file you are editing outranks a human decision about a file you are not.* Asserted directly as `PATH_OVERLAP_BOOST > PROVENANCE_WEIGHT.HUMAN_CONFIRMED - PROVENANCE_WEIGHT.AGENT_STATEMENT`, so retuning either constant past that relationship fails the suite rather than silently changing the ordering.
- `DRIFT_PENALTY (0.15)` is **smaller** than that same gap, so drift can never push a human-confirmed decision below an agent statement. DEC-027 says drift annotates and does not demote; a penalty that reordered provenance would violate it quietly. Asserted, and mutation-tested at 0.5 (§ 4.3, M3).

`lexical` is measured against the **query's** term count, not the decision's, so a long decision is not punished for containing more words than were asked about.

### 3.2 Determinism is a hard requirement, not a nice property

`rankDecisions` breaks ties by `createdAt DESC` then `id DESC` — the same total order the SQL queries use. Without that, two equally-scored decisions would come back in whatever order `Array.sort` felt like, and the briefing's byte-identical guarantee (asserted in `retrieval_tools.test.ts` and again in the route suite) would fail intermittently rather than reliably. The limit is applied **after** sorting, so a cap keeps the highest-ranked entries rather than the first-seen ones; both are asserted, and both fail under M4.

No embeddings, no vector store, no network, no new dependency (DEC-028). The engine imports nothing but types.

### 3.3 Segment-safe path comparison

`pathsOverlap` matches on path *segments*: `src/auth` matches `src/auth/hash.ts` but not `src/authentication/x.ts`. This is the third time this trap has come up in this phase (the project resolver in P5.4-02, the anchor extractor in P5.4-03), and the substring version passes every other assertion in the suite — so the sibling-prefix case is asserted explicitly at both the unit level and over HTTP (`?files=src/sec` must **not** promote a decision anchored under `src/security`).

### 3.4 Ranking is opt-in, at both layers

`getProjectBriefing` ranks only when the caller supplied at least one of `taskDescription` / `touchPaths` / `limit`. `?drift=true` alone does **not** trigger ranking — asking for annotations is not asking to reorder. Unscoped callers get the same object they got before, with no `relevanceScore` key; asserted so the response shape cannot drift silently.

`queryDecisions` is a separate method rather than a change to `listDecisions`. The Explorer reads `listDecisions` and relies on its stable `created_at DESC` order — a list that reordered itself as you typed would be worse than one that does not rank at all.

### 3.5 Rules and intent are structurally excluded from the window

`applyToBriefing` spreads the briefing and replaces **only** `activeDecisions`. `architecturalRules`, `currentIntent`, `recentAgentWork` and `recentApprovals` never enter the engine, so there is no code path — including a future token-saving change — that can cap them without deleting that spread. Asserted at `limit: 0`, the case where a naive implementation returns an empty briefing: rules and intent still come back in full.

### 3.6 UI: drift is its own axis

The Explorer already had text search and status pills (P5.2-02). Added:

- A **drift toggle** (`All` / `Drifted only (n)`) as a separate `role="group"`, divided from the status pills by a hairline so the two `All` buttons do not read as one row. Drift is orthogonal to status — a decision can be `ACTIVE` and still have lost the file it was about — so it is not a sixth status pill.
- The filter keys on `drift[id].drifted`, not on the *presence* of a drift entry. The API returns entries for decisions it checked and found clean, so presence-keying would show clean decisions under "Drifted only" (mutation M5).
- **Free-text search now also covers anchor paths**, which § 5.5 of the task asks for. The dedicated path field remains as the narrower version.

Screenshot: `docs/screenshots/p5.4-04/drift-filter-1400.png` — both states, 3 decisions, 2 drifted.

---

## 4. Verification

### 4.1 Test suites (every suite in the repository)

| Suite | Result |
| :--- | :--- |
| `apps/server` MemoryRelevanceEngine (**new**) | **63/63** |
| `apps/server` memory routes | **140/140** (was 113) |
| `apps/server` ProjectMemoryService | 231/231 |
| `apps/server` memory-candidates routes | 52/52 |
| `apps/server` DecisionExtractor | 60/60 |
| `apps/server` GitDriftDetector | 64/64 |
| `apps/server` internal routes | 51/51 |
| `apps/server` SovereignMode | 21/21 |
| `mcp-memory-server` retrieval_tools | **87/87** (was 71) |
| `mcp-memory-server` record_decision | 82/82 |
| `mcp-memory-server` dogfood_scenario | 62/62 |
| `mcp-memory-server` resolver | 42/42 |
| `mcp-memory-server` stdio_scaffold | 28/28 |
| `mcp-memory-server` relay-client / relay_e2e | 23/23, 24/24 |
| `@asterim/web` DecisionExplorer | **151/151** (was 130) |
| `@asterim/web` MemoryTimeline | 134/134 |
| `@asterim/web` useMemoryStore | 113/113 |
| `@asterim/web` CandidateReview | 37/37 |
| `@asterim/adapters` ProcessManager | 23/23 |

### 4.2 Typecheck, build, lint

```
@asterim/web                 tsc --noEmit   0 errors
@asterim/shared              tsc --noEmit   0 errors
@asterim/adapters            tsc --noEmit   0 errors
@asterim/mcp-memory-server   tsc --noEmit   0 errors
asterim (server)             tsc --noEmit   4 errors  — all pre-existing, none in a touched file
pnpm run build                              7/7 successful
```

The 4 server errors are unchanged from the start of this task: `AuthController.ts:354`, `AgentService.ts:164`, `ContextService.ts:109`, `GeminiProvider.ts:2`.

`pnpm run lint` fails repo-wide and did so before this task (~40 errors in `apps/server`, 2 in `apps/web/src/components/git/ChangesView.tsx`, 1 in `mcp-memory-server/src/__tests__/relay_e2e.test.ts`, and the ANSI-regex set in `@asterim/adapters`). **Every file this task touched or created reports 0 lint errors** — checked per-file. The new test file carries 3 `no-explicit-any` warnings, matching the convention of every existing test file in the repo.

### 4.3 Negative controls

Each guard was broken, the suite re-run, then restored and md5-verified byte-identical.

| # | Mutation | Result |
| :-- | :--- | :--- |
| M1 | `applyToBriefing` also caps `architecturalRules` | **caught** — 2 fail |
| M2 | `pathsOverlap` uses substring instead of segment matching | **caught** — 1 fail |
| M3 | `DRIFT_PENALTY` raised to 0.5 (large enough to demote) | **caught** — 2 fail |
| M4 | tie-break removed from `rankDecisions` | **caught** — 3 fail |
| M5 | drift filter keys on entry presence, not `.drifted` | **caught** — 4 fail |
| M6 | drift filter made a no-op | **caught** — 7 fail |
| M7 | search no longer covers anchor paths | **caught** — 2 fail |
| M8 | route ignores `?limit` | **caught** — 2 fail |
| M9 | route ignores `?files` | **survived → fixed → caught, 4 fail** (§ 7.1) |
| M10 | route ignores `?task` | **caught** — 1 fail |
| M11 | `?files` split no longer trims | **caught** — 2 fail |
| M12 | negative-`limit` guard removed | **caught** — 1 fail |
| M13 | MCP briefing handler drops `taskDescription`/`touchPaths` | **caught** — 4 fail |

### 4.4 Visual

`docs/screenshots/p5.4-04/drift-filter-1400.png`, captured from `renderToStaticMarkup` against `tokens.css` (no dev server involved, so no stale-`:3000` logged-in-state risk). Both filter states in one frame.

---

## 5. Acceptance Criteria Review

- [x] **1. `MemoryRelevanceEngine` scores decisions deterministically using file path overlap, lexical matching, provenance weight, and drift status.**
  All four components implemented and separately asserted (`scoreDecision(...).breakdown`). Determinism asserted three ways: identical input ranks identically twice; reversed input order produces the identical result; ties resolve on `createdAt` then `id`. Verified by mutation M4 (removing the tie-break fails 3 assertions). No network, no embeddings, no vector dependency — `git diff` on `package.json`/`pnpm-lock.yaml` is empty.

- [x] **2. Decisions referencing files in `touchPaths` rank higher than unrelated decisions.**
  Unit: an `AGENT_STATEMENT` anchored to a touched file outranks a `HUMAN_CONFIRMED` decision that is not (`touchedRanking[0].id === 'agent-touched'`). Over HTTP: the target decision is recorded *before* a newer decoy, so recency favours the decoy — `?files=src/security/keys.ts&limit=1` still returns the target. Folder-level touches match; partial folder names (`src/sec` vs `src/security`) do not. Verified by mutation M9.

- [x] **3. `getProjectBriefing` caps returned decisions at the specified `limit` while preserving all active architectural rules and intent.**
  `?limit=1` returns 1 decision with the rule count and intent id unchanged from the unscoped briefing; `?limit=0` returns 0 decisions and still every rule and the intent. Same asserted at the unit level, including the default of 15. Verified by mutations M1 and M8.

- [x] **4. MCP tool `get_project_briefing` accepts `taskDescription` and `touchPaths` and returns the relevance-scoped briefing.**
  Tool schema asserted to expose exactly `['limit','projectId','taskDescription','touchPaths']`; `query_decisions` exposes `['filePath','limit','projectId','status','touchPaths']`. Behaviour asserted end-to-end through the tool handler: the touched decision ranks first, every returned decision carries a `relevanceScore`, the touched one scores higher, and `limit` caps. `readLimit` rejects a non-numeric limit by name. Verified by mutation M13.

- [x] **5. Decision Explorer UI provides interactive text search, status filtering, and drift filtering.**
  Search (title/summary/rationale/constraints/**anchor paths**), 5 status pills, and the new `All`/`Drifted only (n)` toggle, each in a labelled `role="group"`. Filtering logic asserted as a pure function (11 new assertions) and the rendered output asserted in both states. Screenshot in § 4.4.
  *Caveat, unchanged from every prior UI task in this phase:* the repo has no DOM test environment, so **click handlers are not executed by any test**. Filter state is reached through `initialDriftFilter`/`initialStatusFilter` props; that the `onClick` is wired to `setDriftFilter` is verified by reading the diff and by the screenshot, not by a test.

- [x] **6. All test suites pass cleanly, `tsc --noEmit` reports 0 errors, and `pnpm run build` succeeds across monorepo.**
  All 19 suites pass (§ 4.1). `pnpm run build` 7/7. `tsc --noEmit` is 0 errors on four of five packages; **`apps/server` reports 4 errors, all pre-existing and none in a file this task touched** — this criterion is therefore met for the work in scope but not literally repo-wide, and I am flagging rather than claiming it (§ 8.1).

---

## 6. Git Diff Review

`git diff` reviewed file by file against § 6 of the task.

| Forbidden change | Finding |
| :--- | :--- |
| External vector DB / remote embedding API | **None.** `package.json` and `pnpm-lock.yaml` are untouched. The engine imports only types; no `fetch`, no HTTP client, no `embedding`/`vector`/vendor identifier anywhere in the diff. |
| Excluding `architecturalRules` or `currentIntent` from briefings | **None.** `applyToBriefing` replaces only `activeDecisions`. Asserted at `limit: 0` in two suites; mutation M1 confirms the assertions bite. |
| Altering SQLite schemas for decisions or rules | **None.** `DatabaseService.ts` is untouched; no `CREATE TABLE` / `ALTER TABLE` / `ADD COLUMN` appears anywhere in the diff. `relevanceScore` is computed per request and never persisted — the same pattern as `drift` from P5.4-02. |

Working tree contains only the files in § 2. Build artifacts touched incidentally by running the suites (`apps/server/pairing_pin.txt`, two `tsconfig.tsbuildinfo`) were reverted. `scratch/` additions are capture-harness only and are excluded from every build, per the housekeeping rule in `CLAUDE.md`.

---

## 7. Problems Discovered

### 7.1 My `?files` route tests passed against a route that ignored `?files`

Mutation M9 — replacing `touchPaths` with `undefined` in the briefing route — **survived all 137 assertions on the first run.**

The cause was fixture ordering. My scoped decision was the last one recorded, so it was the newest; with scoring disabled, ties fall through to `createdAt DESC`, and the newest decision won every "ranks first" assertion anyway. The tests asserted the right outcome for the wrong reason, which is the failure mode that makes a green suite actively misleading.

Fixed by recording the target **first** and a decoy **after** it, so recency actively works against the expected result, plus an explicit control (`unscoped, the most recent decision leads`) that pins the baseline the ranking has to overturn. On re-run, M9 fails 4 assertions and M10 (`?task` ignored) fails 1. The comment in the test records why the order matters, so a future edit does not innocently reorder the fixture back.

### 7.2 Test-ordering pollution in the MCP suite

The new scoping block records 2 decisions into a fixture the earlier assertions count exactly. Placed near the retrieval tests it broke 7 assertions; moved further down, still 2. It now runs at the very end of `main()` with a comment saying why. The underlying issue — a single shared, mutable fixture with order-dependent assertions — is noted in § 8.2.

### 7.3 Lexical matching is exact-term, not stemmed

`hashing` does not match `hash`; `password` does not match `passwords`. This surfaced when my first lexical ranking assertion failed for a reason unrelated to ranking. It is a real and defensible limit of a deterministic local scorer — stemming is a dependency and a source of surprise — but it is now recorded as an explicit assertion (`terms are matched literally, without stemming`) so that adding a stemmer later is a decision someone makes, rather than a behaviour change nobody notices.

### 7.4 The two adjacent `All` buttons

The task specifies `All` / `Drifted Only` for the drift toggle, which puts a second button labelled `All` immediately beside the status group's `All`. The first screenshot confirmed this reads as one nine-button row. Resolved with a hairline divider and margin (`--color-border-default`, not `--color-border-subtle`, which was invisible at 6% alpha) — the labels stay as the task specifies.

---

## 8. Architectural Concerns

### 8.1 The server's 4 `tsc` errors are now a standing tax

Every report in this phase has said "4 pre-existing errors, none in a touched file". They are small (a missing type import, a stale property reference, a deleted module path, a renamed export) and they make every acceptance criterion of the form "`tsc --noEmit` reports 0 errors" impossible to satisfy literally. The same is now true of `pnpm run lint`, which CI runs and which fails repo-wide. Both are cheap to clear once and expensive to keep explaining. Worth a dedicated cleanup task.

### 8.2 The MCP retrieval suite needs per-block fixtures

Three consecutive tasks have now had to place new assertions at a specific point in `retrieval_tools.test.ts` to avoid disturbing counts elsewhere. That constraint grows with the file. A per-block fixture (or a fresh temp DB per `describe`) would remove it. Not in scope here; flagging before the next task inherits it.

### 8.3 Ranking weights are constants, not configuration

`PROVENANCE_WEIGHT`, `PATH_OVERLAP_BOOST` and `DRIFT_PENALTY` are exported constants with the relationships between them asserted in tests. That is deliberate — they encode DEC-024 and DEC-027, and making them user-tunable would let a setting silently contradict a decision record. If tuning is ever wanted, it should arrive as a Change Proposal against those decisions rather than as a config key.

### 8.4 Nothing calls the scoped briefing yet

The engine, the route parameters and the MCP tool parameters all exist, but no *caller* currently passes `touchPaths` — the agent session does not yet tell Project Memory which files it is about to open. Until something does, the feature is available rather than active. That wiring is the natural next task.

---

## 9. Recommended Next Step

**Wire scoped retrieval into the agent session lifecycle.** Have the session pass the files it is opening (and its current objective) into `get_project_briefing`, so the briefing an agent actually receives is the scoped one rather than the whole store. That converts P5.4-04 from a capability into behaviour, and it is the first point at which the token-saving argument in § 2 of the task is realised.

Secondary: a `chore` task clearing the 4 server `tsc` errors and the repo-wide lint failures (§ 8.1), so that "0 errors" becomes a criterion that can be met rather than annotated.
