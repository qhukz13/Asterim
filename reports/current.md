# Execution Report: P5.1-06 — End-to-End Dogfood Scenario & Multi-Session Persistence

**Task ID:** P5.1-06
**Status:** VERIFIED
**Date:** 2026-08-13
**Author:** Claude Code
**Branch:** `main` @ `48c4f7c` (working tree)

---

## 1. Summary

The full cross-agent scenario runs end to end across three independent MCP server processes. Session A records a decision in Project Primary and exits; Session B — a new process, spawned later, told nothing about Session A — finds that decision through both `get_project_briefing` and `query_decisions` and records a follow-up; Session C, in the neighbouring project, sees none of it and is refused when it tries to write into Primary.

Nothing is passed between the sessions. None is given a `--project` flag: each resolves its project from its working directory, and Session A starts in a *nested subdirectory* so the resolver's longest-match rule is on the scenario's critical path rather than tested in isolation. The project directories are real directories on disk.

`dogfood_scenario.test.ts` covers this at **62/62 assertions**, including a Phase 4 probe against the user's live `~/.asterim/asterim.db` that is provably non-destructive. All six acceptance criteria are met.

The optional § 4.2 item was implemented: unrecognised argument keys are now rejected across all three tools, closing the hazard raised in the P5.1-05 report § 6.3.

Two findings came out of this task that the per-tool suites could not have surfaced: the live database is in **WAL mode** (§ 6.1), and `DatabaseService` sets **no `busy_timeout`**, so an agent's write fails immediately when the Core server is mid-write (§ 6.3).

---

## 2. Files Changed

**Created**

| File | Lines | Purpose |
| :-- | --: | :-- |
| `packages/mcp-memory-server/src/__tests__/dogfood_scenario.test.ts` | 431 | Three-session scenario, cross-session state check, live-database probe |

**Modified**

| File | Change |
| :-- | :-- |
| `packages/mcp-memory-server/src/index.ts` | `rejectUnknownArguments`; unknown-tool check moved ahead of the switch |
| `packages/mcp-memory-server/src/__tests__/record_decision.test.ts` | +3 assertions covering unknown argument keys |

`index.ts` and `resolver.ts` were each mutated for negative controls and restored byte-identically (`md5 c7b18204db8374af4b2fdeabba7df877` and `ef37a63d1ed6a990e349aec56c42a643`).

**Not modified:** nothing in `apps/server`, `packages/shared`, or `packages/adapters`; no DDL; **no write of any kind to the real `~/.asterim/asterim.db`** — its size, sha256 and mtime are unchanged (§ 4.3). The § 5 prohibitions hold.

---

## 3. Implementation Details

### 3.1 The sessions are genuinely independent

Each session is a fresh `node dist/index.js` with its own database handle, its own request-id sequence and its own captured streams, wrapped in a `Session` class so nothing can leak between them inside the test either. The assertions record their process ids and confirm they differ.

Resolution is by working directory only:

| Session | cwd | Resolves to |
| :-- | :-- | :-- |
| A | `<primary>/src/auth` (nested) | Project Primary |
| B | `<primary>` (root) | Project Primary |
| C | `<neighbour>` | Project Neighbor |

This is what a real `claude mcp add` invocation looks like — no project argument, the workspace is the context — and it means the scenario exercises `resolveProjectContext` for real rather than trusting P5.1-03's isolated coverage.

### 3.2 State is checked at three levels

The scenario asserts at the tool level (what Session B is told), at the process level (each session exits 0 with pure stdout), and finally by reopening the SQLite file directly once every session has terminated: two decisions, both belonging to Primary, both anchored to the shared file, zero rows for Neighbor.

### 3.3 Unknown argument keys are rejected

```ts
const allowed = Object.keys(tool.inputSchema.properties ?? {});
const unknown = Object.keys(args ?? {}).filter(key => !allowed.includes(key));
```

All three schemas already declared `additionalProperties: false`; the low-level SDK `Server` does not enforce it. The expensive case is a near-miss on an optional key — `relatedFile` for `relatedFiles` records a decision with **no anchors** and reports success, and the anchors are what make a decision findable later. The agent is told its work was remembered, and it was, minus the part that mattered.

The unknown-tool check moved ahead of the `switch` so the tool can be looked up once for both purposes. The message and behaviour are unchanged.

---

## 4. Tests / Verification

```
$ pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/dogfood_scenario.test.ts
  fixture .......................................  2 PASS
  Session A — first agent session ............... 11 PASS
  Session B — later independent session ......... 15 PASS
  Session C — neighbouring project .............. 12 PASS
  final state, read straight from SQLite .........  4 PASS
  Phase 4 — live database probe ................. 13 PASS
  62/62 assertions passed                           EXIT=0
```

**All suites:**

```
dogfood_scenario.test.ts       62/62    (new)
record_decision.test.ts        82/82    (was 79; +3 unknown-key)
retrieval_tools.test.ts        71/71
stdio_scaffold.test.ts         28/28
resolver.test.ts               42/42
ProjectMemoryService.test.ts  217/217   (P5.0 regression)
memory.test.ts                 77/77    (P5.0 regression)

tsc --noEmit  0 errors  ·  eslint  0 problems  ·  pnpm run build  7/7 tasks
bundle 53.97 → 54.51 KB, require set unchanged
```

### 4.1 Acceptance criteria

| # | Criterion | Result |
| :-- | :-- | :-- |
| 1 | A → B → C multi-process lifecycle over stdio | **Met** — three processes, distinct pids, each exits 0 |
| 2 | Session A's decision visible in Session B | **Met** — by id, title, rationale, provenance and confidence |
| 3 | Session C proves isolation and rejects cross-project writes | **Met** — briefing, both query forms, and the write all scoped to Neighbor |
| 4 | `dogfood_scenario.test.ts` 100% | **Met** — 62/62 |
| 5 | All regression suites pass | **Met** — 82 / 71 / 28 / 42, plus both P5.0 suites |
| 6 | `pnpm run build` 0 errors | **Met** — 7/7 |

### 4.2 What the live probe found

Phase 4 ran against the real database — 3 registered projects, all 3 paths still present on disk. A session spawned in the deepest of them resolved to the correct project by working directory and served a briefing against the real schema:

```
INFO  live briefing: 0 active decisions, 5 recent sessions, 5 recent approvals
```

This is the first time `recentAgentWork` and `recentApprovals` have been observed **non-empty** — every fixture so far left both projections untested against real rows. Both came back well-formed. That closes the open item from the P5.1-05 report § 7.

### 4.3 The live database was not touched

- The server child process was pointed at a snapshot, never at `~/.asterim`.
- The only handle on the real file is `new DatabaseSync(livePath, { readOnly: true })`, and the suite **proves** it is read-only by attempting an `INSERT` through it and asserting the write is rejected. Without that positive control, the "unmodified" assertions could pass merely because nothing tried.
- Size and sha256 are asserted identical before and after. Confirmed again outside the suite: `mtime` is still `Aug 13 22:10`, predating every run in this task.
- No rollback journal was left beside it.

---

## 5. Negative Controls

| # | Mutation | Suite result | Verdict |
| :-- | :-- | --: | :-- |
| A | Resolver ignores cwd; first project always wins | 53/62 | caught — 9 failures |
| B | `record_decision` reports success but never persists | 51/62 | caught — 11 failures |

### 5.1 Control A — the scenario depends on per-workspace resolution

If every session resolved identically, the three phases would be theatre: Session C would simply be a third session in Primary. Making the resolver ignore `cwd` collapses exactly the isolation phase:

```
FAIL  Session C resolved Project Neighbor, not Primary
FAIL  Session C: the briefing is scoped to Neighbor        — got "proj-primary"
FAIL  Session C: no decisions bled across from Primary     — got [ …Primary's decision… ]
FAIL  Session C: a write aimed at Primary is rejected      — expected true, got undefined
FAIL  Primary holds exactly the two decisions …            — expected 2, got 3
```

The last two are the informative pair. With every session in Primary, the cross-project write is no longer cross-project — it is accepted, and the row count proves it landed. Isolation and the boundary guard are load-bearing together, not separately.

### 5.2 Control B — cross-session visibility is real persistence

Returning the constructed decision object without calling `createDecision` produces a server that answers `record_decision` with a complete, plausible decision — and forgets it. Eleven assertions fail, all in Session B and the final SQLite check:

```
FAIL  Session B sees exactly the decision Session A left behind  — expected 1, got 0
FAIL  Session B: the title survived the process boundary
FAIL  only one project has decisions                             — expected 1, got 0
FAIL  both decisions are anchored to the shared file             — expected 2, got 0
```

One assertion — "it is the same decision, by id" — passed vacuously, comparing `undefined` to `undefined`. It is redundant beside the eleven that failed, but worth noting as the weakest link in this suite.

---

## 6. Problems Discovered & Concerns

### 6.1 The live database is in WAL mode, and my first probe handled it wrongly

The first version of Phase 4 copied `asterim.db` with `copyFileSync` and asserted that no `-wal` file existed beside the original. It failed — and it was the assertion that was wrong, not the code:

```
$ ls ~/.asterim/
asterim.db  asterim.db-shm  asterim.db-wal  crash.log  server.log
journal_mode = wal
```

`DatabaseService.init()` sets `PRAGMA journal_mode = WAL`, which persists in the database header. Those files belong to the user's own running Asterim server, so their presence says nothing about this probe. Two real problems followed from the same misunderstanding:

1. **The copy was incomplete.** In WAL mode, committed transactions live in the `-wal` file until checkpoint. Copying `asterim.db` alone silently omits recent history.
2. **The copy could tear.** Copying the three files in sequence while another process writes can produce an inconsistent snapshot.

Phase 4 now takes the snapshot with `VACUUM INTO` over the read-only connection — one read transaction, one consistent file, no WAL handling — and the non-destructiveness claim rests on the read-only positive control in § 4.3 rather than on the absence of files this probe never created.

Recorded at length because the failing assertion was the *only* signal that the copy was unsound. Had the live database not been in WAL mode on this machine, the suite would have passed while snapshotting incorrectly.

### 6.2 The live probe resolved to a project named `test`

Of the three registered projects, the deepest path — the one longest-match selects — belongs to a project called `test`. Everything behaved correctly, but it is worth knowing that the live registry contains a scratch entry nested inside another project, which is precisely the ancestor/descendant shape the P5.1-01 audit flagged. It is a good thing the resolver handles it; it may still be worth cleaning up before P5.1-08 documents installation, since `claude mcp add` from that directory would attach an agent to a project called `test`.

### 6.3 No `busy_timeout` — an agent's write fails instantly when the Core is mid-write

The scenario runs three sessions **sequentially**. The real deployment runs them **concurrently with the Core server**, which writes continuously. `DatabaseService` enables WAL but sets no busy timeout, so SQLite's default of 0 applies: a writer that finds the database locked fails immediately rather than waiting.

Probed directly, holding a write transaction open on one connection while an MCP session ran against the same file:

```
second writer failed after 1ms: database is locked

record_decision  -> isError: database is locked
query_decisions  -> ok, 0 decisions
exit code: 0
```

The good news is in the last two lines. Reads are unaffected — that is what WAL buys — and the failure is handled exactly as designed: an in-band `isError`, transport intact, process alive. Startup is also safe; `init()`'s `CREATE TABLE IF NOT EXISTS` statements take no write lock when the tables already exist, so a session spawned during a Core write still reaches `ready on stdio`.

The bad news is that the agent loses the decision, and the message it gets back — `database is locked` — is one it cannot act on. A single `PRAGMA busy_timeout` in `DatabaseService` would turn an instant failure into a short wait; the probe confirms the pragma takes effect and waits its full interval. **That is a one-line change in `apps/server`, which § 5 forbids here**, so it is reported rather than made.

This is the most likely way Phase 5.1 fails in real use, and no test in the phase covers it, because every suite so far has had the database to itself. **Recommend a concurrency test against a live Core before P5.1-08 documents installation.**

### 6.4 Carried forward, still open

- **Reads remain unscoped** (P5.1-05 § 6.2). Session C proves isolation *by workspace* — it does not attempt `get_project_briefing({ projectId: PRIMARY_ID })`, which would succeed. The isolation demonstrated here is the isolation an honest client gets, not a boundary. Still worth a `decisions.md` entry alongside the write-scoping guarantee.
- **Agent writes reach no EventBus subscriber** (P5.1-05 § 6.5). The dogfood scenario makes this concrete: two decisions were recorded across two sessions and the running Core learned of neither. Belongs in `blueprint/audit/MISSING_SPECIFICATION.md`.
- **The `asterim/src/...` deep import** — unchanged in shape, still unrecorded in `blueprint/audit/IMPLEMENTATION_DRIFT.md` after five tasks.
- **Repo-wide `pnpm run lint` is red on `main`** from pre-existing `@asterim/adapters` violations. This package lints clean. CI is not green on `main`; every result above is local verification.

---

## 7. Recommended Next Step

The three tools work, persist across process boundaries, and hold their project boundary. What remains before this is usable is packaging and honesty about limits.

**P5.1-07 / P5.1-08 — documentation, MCP config, blueprint sync.** Four things should land with them:

1. **The `decisions.md` entries.** Write-scoping rests on one line with no database-level backstop (P5.1-05 § 5.1); read-scoping is open by omission (§ 6.4). Both are product decisions and neither is recorded.
2. **`busy_timeout` (§ 6.3).** The documentation will tell users to run this alongside the Core, which is the configuration no test covers and the one where writes fail. Either fix the pragma or document the failure mode — but do not ship installation instructions that quietly assume exclusive database access.
3. **The binary is not standalone** (P5.1-02 § 6.5). `dist/index.js` keeps the SDK external and needs the repo's `node_modules`, so `claude mcp add` must point at an absolute path inside the checkout. That constraint has to be stated plainly, or resolved, before it is written into docs.
4. **`blueprint/audit/IMPLEMENTATION_DRIFT.md`** — the deep import into `apps/server`'s source tree has been outstanding since P5.1-02 and now spans four modules. A blueprint-sync task is the right place to close it.

For the docs themselves: the `--project`, `--project-path` and `ASTERIM_PROJECT_ID` escape hatches exist and are tested, but the working-directory default is what the dogfood scenario shows actually working, and it is what a user's `claude mcp add` will use. Lead with it.
