# Execution Report: P5.4-02 — Git Staleness & Drift Engine

**Task ID:** P5.4-02
**Phase:** Phase 5.4 — Intelligent Memory & Continuous Governance
**Status:** VERIFIED
**Date:** 2026-08-14
**Author:** Claude Code
**Branch:** `main` (working tree)

---

## 1. Summary

`GitDriftDetector` computes `FILE_DELETED`, `FILE_MODIFIED` and `SYMBOL_NOT_FOUND` against a project's working tree, exposed at `GET /api/v1/projects/:id/memory/drift` and opt-in on the briefing, and rendered as amber caution badges in both memory views. Nothing is written: a drifted decision stays `ACTIVE`, as DEC-027 requires.

**+81 assertions** — a new 64-assertion detector suite run against a **real git repository**, plus route and component coverage. All existing suites unchanged, `pnpm run build` 7/7.

Two things worth reading before the detail:

- **A negative control demonstrated real command injection.** Removing the commit-hash validation let `HEAD; touch /tmp/pwned` reach the shell and **the file was created**. With the guard, it is not (§ 5.2).
- **A latent trap in `GitProvider` cost me a working implementation.** `exec` trims its output, which shifts every column of `git status --porcelain` by one. The existing `StatusManager` survives it only by accident (§ 3.2).

---

## 2. Files Changed

**Created**

| File | Lines | Purpose |
| :-- | --: | :-- |
| `apps/server/src/services/git/GitDriftDetector.ts` | 279 | Snapshot, per-ref and per-decision drift, path/hash guards |
| `apps/server/src/services/git/__tests__/GitDriftDetector.test.ts` | 340 | Real repository: commits, edits, deletes, renames |
| `apps/web/src/components/memory/DriftBadge.tsx` | 47 | Amber caution badge with per-anchor detail |
| `docs/screenshots/p5.4-02/drift-badges-1440.png` | — | Visual evidence |

**Modified**

| File | Change |
| :-- | :-- |
| `packages/shared/src/types/memory.ts` | `DriftType`, `CodeRefDrift`, `DecisionDriftInfo`; optional `drift` on `ProjectDecision` |
| `apps/server/src/services/ProjectMemoryService.ts` | `getProjectDrift` (delegating); briefing accepts drift rather than computing it |
| `apps/server/src/routes/memory.ts` | `GET …/memory/drift`; `?drift=true` on the briefing |
| `apps/web/src/stores/useMemoryStore.ts` | `drift` state + `fetchDrift` |
| `apps/web/src/components/memory/{DecisionExplorer,MemoryTimelineView}.tsx` | Badge wiring, drift props |
| Route and component test suites | +17 assertions |

Two files were mutated for negative controls and restored byte-identically.

**Not modified:** no status column touched, no AST parser added. The § 5 prohibitions hold.

---

## 3. Implementation Details

### 3.1 One snapshot, no anchor near a shell

Drift needs the working tree, and the obvious implementation runs `git` per code ref. A project with fifty anchored decisions would spawn hundreds of subprocesses to answer one question.

`snapshot()` instead runs **two fixed commands** — `git status --porcelain` and `git rev-parse HEAD` — and every subsequent check is `fs`. Nothing from an anchor is interpolated into either. That is the security property as much as the performance one: `GitProvider.exec` passes a string to a shell, so a path reaching it is a command-injection vector, and CLAUDE.md warns about exactly this.

Outside a repository the snapshot reports "not a repository" and file-existence and symbol checks still run, so projects not under version control still get useful drift.

### 3.2 `GitProvider.exec` trims, and column-based porcelain parsing breaks

My first implementation used `line.slice(3)` — the documented porcelain layout, `XY <path>`. It returned `rc/auth.ts` for `src/auth.ts`.

`GitProvider.exec` ends with `stdout.trim()`. For plain `--porcelain`, the first line is ` M src/auth.ts`, whose leading space is the first character of the output — so the trim eats it and shifts every column by one.

`StatusManager` uses the same `substring(3)` and is **not** affected, because it passes `-b`: the first line is `## branch`, unindented, which absorbs the trim and leaves the file lines intact. It is correct by accident of an unrelated flag.

The detector now parses with `/^\s*(\S{1,2})\s+(.+)$/`, which does not care about column position, and an assertion pins the behaviour explicitly ("the porcelain path survives the provider trimming its output").

### 3.3 `FILE_MODIFIED` asks a narrower question than the task specified

The task defines it as uncommitted changes **or** `HEAD` differing from `ref.commitHash`. The second half taken literally flags every anchored decision the first time anyone commits anything, because any commit moves `HEAD` — drift that fires constantly is drift nobody reads.

Implemented instead as: uncommitted changes to that path, **or** that path appearing in `git diff --name-only <anchor> HEAD`. That is the question worth asking — did *this file* change since the decision was anchored to it — and the difference is asserted directly ("an unrelated commit does not drift an untouched anchor").

An unknown commit (shallow clone, rewritten history) is treated as absence of evidence, not evidence of drift.

### 3.4 Two guards on data agents wrote

Anchors come from `record_decision`, so both fields are attacker-influenced in the ordinary case of a confused or hostile agent:

- **`resolveInsideProject`** refuses paths escaping the project, using `path.relative` rather than a prefix test — the same reasoning as the MCP resolver, where a prefix match accepts a sibling directory whose name merely starts the same way.
- **`isSafeCommitHash`** requires 7–40 hex characters before a hash is interpolated. § 5.2 shows what happens without it.

### 3.5 Drift is computed, never stored — and the briefing stays synchronous

`getProjectDrift` is async and delegates to the detector; it contains no git logic, keeping `ProjectMemoryService` a persistence layer.

`getProjectBriefing` **remains synchronous** and gained an optional `drift` parameter rather than computing drift itself. Making it async would have rippled through the MCP briefing tool, the REST route, and 231 assertions that rely on it being sync and deterministic — including the byte-identical determinism assertion. The route does the async work and passes the result in. Drift is opt-in via `?drift=true`, because the common caller is an agent starting a session that wants its briefing immediately.

---

## 4. Tests / Verification

```
apps/server
  GitDriftDetector.test.ts .......  64/64    (new)
  memory.test.ts ................. 113/113   (was 98, +15)
  internal.test.ts ...............  51/51
  ProjectMemoryService.test.ts ... 231/231

apps/web
  DecisionExplorer.test.ts ....... 130/130   (was 116, +14)
  MemoryTimeline.test.ts ......... 134/134
  useMemoryStore.test.ts ......... 113/113

packages/mcp-memory-server
  resolver 42 · record_decision 82 · dogfood 62 · relay-client 23 · relay_e2e 24

tsc --noEmit (web)  0 errors  ·  eslint  0 errors, 64 warnings
apps/server tsc: 4 pre-existing errors, none in a touched file
pnpm run build:  7 successful, 7 total
```

### 4.1 Acceptance criteria

| # | Criterion | Result |
| :-- | :-- | :-- |
| 1 | Deleted/modified anchored files flag correctly | **Met** — against a real repo, including rename and post-commit cases |
| 2 | Missing symbol flags `SYMBOL_NOT_FOUND` | **Met** — incl. a renamed symbol preferring it over `FILE_MODIFIED` |
| 3 | Clean decisions return null drift | **Met** — clean file, clean file+symbol, symbol-only anchor, no anchors |
| 4 | UI shows amber badges while preserving status | **Met** — asserted and visible in the capture |
| 5 | Suites pass, build clean | **Met** |

### 4.2 The detector is tested against a real repository

`GitDriftDetector.test.ts` creates a temp repo, commits, edits the working tree, commits again, deletes files and renames a symbol — then asserts against actual `git status` output. A mocked `GitProvider` would have tested my parsing of a string I invented; it is precisely what would **not** have caught § 3.2, since I would have written the mock with the leading space intact.

### 4.3 Visual QA

`docs/screenshots/p5.4-02/drift-badges-1440.png` — `File missing · 2 anchors` on the first decision, `Symbol not found` on the second, nothing on the clean third, and all three still reading **ACTIVE**. That last part is DEC-027 made visible.

*(The first capture came out tiled and unreadable — a rasterization artifact, not a layout fault; re-taken with GPU disabled and an explicit wait for the rendered content.)*

---

## 5. Negative Controls

| # | Mutation | Result | Verdict |
| :-- | :-- | --: | :-- |
| A | `resolveInsideProject` containment removed | 58/64 | caught — 6 failures |
| B | `isSafeCommitHash` accepts any non-empty string | 60/64 | caught — **and executed an injected command** |
| C | Badge keys on `worst` instead of `drifted` | **survived** → 129/130 after fixing | exposed a fixture gap |
| D | Severity aggregation takes the first, not the worst | 63/64 | caught |

### 5.1 Control A

Without containment, `../../../etc/passwd` resolves to a real path outside the project and the detector would stat and read it. Six assertions fail, including the sibling-directory case a prefix check would wrongly accept.

### 5.2 Control B — the injection is real, not theoretical

The suite includes an anchor whose `commitHash` is `HEAD; touch /tmp/pwned`, and an assertion that `/tmp/pwned` does not exist. With the validation removed:

```
FAIL  and nothing was executed
$ ls -la /tmp/pwned
-rw-r--r--. 1 qhukz qhukz 0 Aug 14 02:56 /tmp/pwned
```

The file was created. `GitProvider.exec` passes its string to a shell, so an unvalidated hash is arbitrary command execution as the server user — triggered by a value an agent wrote into project memory. With the guard restored the file is not created and the suite is green.

### 5.3 Control C survived, and the fixture was why

Every drift fixture I wrote had `drifted` and `worst` agreeing, so a badge keyed on either passed identically. Since drift crosses HTTP, the two *can* disagree in a way the detector never produces.

A fixture now sends `drifted: false` with `worst: 'FILE_DELETED'` and asserts no badge renders — `drifted` is the authority. Under the mutation it fails.

---

## 6. Problems Discovered & Concerns

### 6.1 `StatusManager`'s porcelain parsing is fragile

It is correct today only because `-b` happens to put an unindented line first (§ 3.2). Drop the flag, or read plain `--porcelain` anywhere else, and every path loses its first character — silently, producing paths that simply never match.

Two options: make `GitProvider.exec` stop trimming (it would need every caller checked), or parse porcelain positionally nowhere. **Worth an entry in `IMPLEMENTATION_DRIFT.md`** — it is a trap laid for the next person who reads `substring(3)` and copies it.

### 6.2 Symbol matching is textual, and deliberately so

`symbolAppears` is a word-boundary regex, not a parse (§ 5 forbids an AST dependency). It cannot tell code from a comment or a string literal, so a symbol deleted from a function but surviving in a comment reads as present.

The bias is toward **missing** drift rather than inventing it, which for a caution badge is the right direction — a false alarm on every decision teaches people to ignore the badge. Recorded so the limitation is a known property rather than a surprise.

### 6.3 Drift is recomputed on every request, with no cache

`GET /memory/drift` spawns two git subprocesses and reads every anchored file. Fine for tens of decisions on a local disk; it scales with anchors × request frequency, and the explorer calls it on every project switch.

Nothing caches it because drift is only meaningful as of *now*. If it becomes a cost, the natural fix is a short TTL keyed on the working-tree state rather than the clock.

### 6.4 Nothing recomputes drift when the code changes

The UI fetches drift on project change. Editing a file does not refresh the badges, and the Core already watches the filesystem for other purposes. A decision can therefore show a stale *drift* state — which is a slightly absurd thing for a drift feature to do.

The same shape as the `recentAgentWork` staleness raised in P5.2-03 § 6.3, still open. Both would be answered by the same mechanism.

### 6.5 The briefing's drift is opt-in, so agents do not see it

`?drift=true` exists, but the MCP `get_project_briefing` tool does not pass it — so an agent, the party most likely to act on a stale anchor, is the one not told. That is a deliberate stopping point rather than an oversight: it is an MCP change, and P5.4-01 § 6.3 already flagged that the MCP server needs a considered story for its second write-adjacent feature. Worth doing next.

### 6.6 Carried forward

- **Rules cannot be edited or removed; intent cannot be cleared** (P5.3-03 § 6.2, § 6.3).
- **`MemoryStore` absent from `STORE_ARCHITECTURE.md`** (P5.2-01 § 6.3).
- **`MISSING_SPECIFICATION.md` § 4 still says cross-process broadcasting is undecided**, though P5.4-01 decided and shipped it.
- **No DOM test environment** (P5.2-02 § 6.3). Badge behaviour is render-asserted; nothing clicks.
- `pnpm run lint` red on `@asterim/adapters`; `apps/server` has 4 pre-existing `tsc` errors. All figures local.

---

## 7. Recommended Next Step

Proceed to **P5.4-03 — Decision Extraction Queue & Candidate Review UI** (DEC-027 § 2). Four things to carry in:

1. **Give agents the drift they are meant to act on** (§ 6.5). One parameter on the MCP briefing tool, and the feature reaches the audience DEC-027 describes.
2. **`candidate_decisions` needs the same anchor guards.** Extraction will write `filePath` values derived from LLM output straight into anchors — `resolveInsideProject` and `isSafeCommitHash` exist now and should be applied at the point candidates are created, not only when they are read.
3. **Approval is a status transition on a staging table**, so it will want the P5.3-01 lifecycle shape (`PATCH …/status`) rather than a new vocabulary. Reusing it keeps one lifecycle model across both tables.
4. **Record the § 6.1 trap** before someone copies `substring(3)`.

One design note: DEC-027 requires candidates to become `HUMAN_CONFIRMED` at confidence 1.0 on approval. That is the correct provenance — a human did confirm it — but it erases which agent proposed it, and `recentAgentWork` already exists to join against. Worth deciding whether approval should keep a pointer to the session that suggested it, because "who first noticed this" is exactly the question a reviewer asks three months later.
