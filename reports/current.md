# Execution Report: P5.1-07 — Documentation, MCP Config, Blueprint Synchronization & Phase 5.1 Completion

**Task ID:** P5.1-07
**Status:** VERIFIED
**Date:** 2026-08-13
**Author:** Claude Code
**Branch:** `main` @ `48c4f7c` (working tree)

---

## 1. Summary

Phase 5.1 is closed out. `PRAGMA busy_timeout = 5000` is in `DatabaseService.init()` and **measured working across processes** — a write that previously failed within ~1 ms now waits exactly as long as the competing writer holds the lock, and remains bounded at 5 s. Client setup documentation, three decision records, two blueprint audit updates, and the phase completion report are all written.

All seven suites pass: **579 assertions** (285 in the MCP package, 294 in the core memory service). `pnpm run build` is 7/7.

Two things the task specified are worth naming up front: the **assertion tally in the task is out of date** (566 vs. the measured 579 — § 6.1), and **`docs/decisions.md` does not exist** — the repository's decision ledger is `decisions.md` at the root, and that is where DEC-023 through DEC-025 were appended rather than starting a second ledger (§ 6.2).

---

## 2. Files Changed

**Modified**

| File | Change |
| :-- | :-- |
| `apps/server/src/services/DatabaseService.ts` | `PRAGMA busy_timeout = 5000` after the WAL pragma, in its own try/catch |
| `decisions.md` | +DEC-023 (scoping model), DEC-024 (agent defaults), DEC-025 (in-band stdio errors) |
| `blueprint/audit/IMPLEMENTATION_DRIFT.md` | +§ 9 (deep imports), +§ 10 (two processes writing SQLite); § 3 corrected — it was factually stale (§ 6.3) |
| `blueprint/audit/MISSING_SPECIFICATION.md` | +§ 4 (cross-process event broadcasting) |

**Created**

| File | Purpose |
| :-- | :-- |
| `packages/mcp-memory-server/README.md` | Package reference: tools, resolution, architecture, development |
| `docs/mcp-setup-guide.md` | Client setup for Claude Code / Cursor / Antigravity, verification, troubleshooting, limits |
| `docs/phase5-1-completion-report.md` | Phase 5.1 completion report |

No source file other than `DatabaseService.ts` was touched; no test file was modified.

---

## 3. Implementation Details

### 3.1 The concurrency fix, and proof that it works

```ts
try {
  this.db.exec('PRAGMA busy_timeout = 5000;');
} catch {
  console.warn('[Database] Could not set busy_timeout; concurrent writes may fail immediately.');
}
```

Placed after the WAL pragma, wrapped separately so a failure to set it does not take the WAL pragma down with it. Unlike `journal_mode`, `busy_timeout` is **per-connection**, not persisted in the database header — so it is re-applied by every process that constructs a `DatabaseService`, which is exactly what is needed here: the setting has to hold in the MCP session processes, not just in the Core.

The P5.1-06 report measured the failure this fixes (`record_decision → isError: database is locked` after ~1 ms). Applying the pragma is not by itself evidence that it helps, so it was measured again across two real processes — this process holding a write transaction, the MCP binary spawned separately and blocking on it:

| Lock held | `record_decision` | Elapsed |
| --: | :-- | --: |
| 800 ms | SUCCEEDED | 846 ms |
| 2500 ms | SUCCEEDED | 2544 ms |
| 6000 ms | FAILED (`database is locked`) | 5023 ms |

It waits only as long as needed, and the 6000 ms row confirms the wait is bounded rather than indefinite — a hung writer degrades to the same in-band `isError` as before, not to a stalled agent.

**A correction to my own earlier probe.** The P5.1-06 report noted a same-process probe where `busy_timeout` "waited its full interval and still failed". That probe was invalid: `node:sqlite` blocks synchronously, so the timer meant to release the lock could never fire while the waiter blocked the event loop. It measured nothing about SQLite. The cross-process measurements above are the real behaviour.

### 3.2 Documentation

`packages/mcp-memory-server/README.md` covers the three tools with full parameter tables, the four-tier resolution order, the write boundary, and how the package is built and tested. `docs/mcp-setup-guide.md` is the user-facing path: prerequisites, config JSON for Claude Code (both `claude mcp add` and file form), Cursor, and Antigravity, a shell verification command, a troubleshooting table keyed by the actual error strings the server emits, and a closing section of known limits.

Two things are stated plainly rather than omitted, per DEC-016's truth contract:

- **The binary is not relocatable.** The MCP SDK is external, so `dist/index.js` needs the repository's `node_modules` and clients must use an absolute path inside the checkout. This is the first documentation to say so; it has been true since P5.1-02.
- **The dashboard does not live-update on an agent's write**, and why.

The guide leads with working-directory resolution rather than the `--project` flags, because that is what `claude mcp add` will actually use and what the dogfood scenario demonstrates working.

### 3.3 Decision records

DEC-023, DEC-024 and DEC-025 each record the *measured* basis for the decision, not just the position — e.g. DEC-023 notes that with the write guard removed, a write into a registered neighbouring project succeeds silently with no foreign-key violation, which is why the application-level check has no backstop beneath it.

### 3.4 Blueprint audit

- **Drift § 9** — the deep import into `apps/server/src/services/`, with the growth path across P5.1-02 → P5.1-05 and the `packages/memory-core` extraction as the recommended fix.
- **Drift § 10** — two processes writing the same SQLite file, including the measurements above and the observation that `ARCHITECTURE.md`'s "the Core is the only privileged process" is no longer literally true.
- **Missing specification § 4** — cross-process event broadcasting, framed as a decision the Blueprint has not made, with three candidate shapes (route agent writes through the Core; have the Core observe the database; add a cross-process transport) and none chosen. Deliberately not implemented: picking one here would be inventing architecture.

---

## 4. Tests / Verification

```
packages/mcp-memory-server
  resolver.test.ts .............................  42/42
  stdio_scaffold.test.ts .......................  28/28
  retrieval_tools.test.ts ......................  71/71
  record_decision.test.ts ......................  82/82
  dogfood_scenario.test.ts .....................  62/62
                                        subtotal    285

apps/server (Phase 5.0 regression, re-run after the DatabaseService change)
  ProjectMemoryService.test.ts ................. 217/217
  memory.test.ts ...............................  77/77
                                        subtotal    294

                                           TOTAL    579

tsc --noEmit  packages/mcp-memory-server ......  0 errors
eslint        packages/mcp-memory-server ......  0 problems
pnpm --filter @asterim/mcp-memory-server build   dist/index.js 54.51 KB
pnpm run build ................................  7 successful, 7 total
```

All five MCP suites re-run after the `DatabaseService` change, since every one of them constructs it.

### 4.1 Acceptance criteria

| # | Criterion | Result |
| :-- | :-- | :-- |
| 1 | `busy_timeout = 5000` enabled | **Met** — and measured across processes (§ 3.1) |
| 2 | README + setup guide provide complete client setup | **Met** — Claude Code, Cursor, Antigravity, plus verification and troubleshooting |
| 3 | Decision + drift + missing-spec records accurate | **Met** — with one deviation on file location (§ 6.2) and one correction (§ 6.3) |
| 4 | Completion report authored | **Met** — `docs/phase5-1-completion-report.md` |
| 5 | All suites pass, full build 0 errors | **Met** — 579 assertions, 7/7 tasks |

---

## 5. Verification of the Documentation Itself

Documentation can be wrong in ways a build cannot catch, so the load-bearing claims were checked rather than written from memory:

| Claim in the docs | How it was checked |
| :-- | :-- |
| Resolution order and CWD default | P5.1-03 suite (42 assertions) + dogfood sessions resolving with no `--project` flag |
| Error strings in the troubleshooting table | Taken from `resolver.ts` / `index.ts` source, not paraphrased |
| stderr shows `database:` and `project:` lines | Asserted in `dogfood_scenario.test.ts` and `retrieval_tools.test.ts` |
| Binary needs the repo's `node_modules` | `tsup.config.ts` keeps `@modelcontextprotocol/sdk` external; confirmed in the emitted bundle's require set |
| `busy_timeout` behaviour described in § 8 | Measured (§ 3.1) |
| Tool parameter tables | Read off the `TOOLS` definitions; the advertised schemas are themselves asserted in `record_decision.test.ts` |

---

## 6. Problems Discovered & Concerns

### 6.1 The task's assertion tally was out of date — corrected to the measured figure

The task states "272 MCP package assertions across 5 suites, + 294 core memory service assertions = 566 total". The core figure is right; the MCP figure is not. Measured:

```
42 + 28 + 71 + 82 + 62 = 285   (not 272)
285 + 294 = 579                 (not 566)
```

The gap is assertions added during P5.1-05 and P5.1-06 after the task plan was written — three unknown-argument assertions in `record_decision.test.ts`, and the strengthened ordering and live-probe assertions in the dogfood suite. The completion report uses **579** and includes a footnote explaining the discrepancy, so the two documents do not silently disagree.

### 6.2 `docs/decisions.md` does not exist — appended to the root ledger instead

The task specifies `docs/decisions.md`. There is no such file. The repository's decision record is **`decisions.md` at the root**, running DEC-001 → DEC-022, and it is the file `CLAUDE.md` and the prior phases treat as the ledger.

DEC-023 through DEC-025 were appended there, continuing the numbering. Creating `docs/decisions.md` would have produced a second ledger with overlapping numbering and no cross-reference — precisely the fragmentation a single decision record exists to prevent. Flagging rather than burying it, since it is a deviation from the written task. If a `docs/`-scoped ledger is genuinely wanted, the right move is to move the whole file, not to fork it.

### 6.3 `IMPLEMENTATION_DRIFT.md` § 3 was factually wrong — corrected

The existing entry read: *"`apps/marketing` uses ESLint Flat Config, while the rest of the repo does not. No Prettier configuration exists."*

Both halves are false as of today. Verified:

```
.prettierrc, .prettierignore                     present at root
eslint.config.js in: apps/marketing, apps/relay, apps/server, apps/web,
                     packages/adapters, packages/mcp-memory-server, packages/shared
```

The entry was rewritten to describe the actual arrangement, and its recommended action retargeted to the real problem — `@asterim/adapters` failing lint and halting the turbo pipeline. The correction is marked inline so the change is visible to anyone who remembers the old text.

This is scope beyond the task, which asked only for the deep-import entry. It was made because a normative audit document asserting something demonstrably false is worse than the drift it describes, and the file was already open. **No other pre-existing entry was altered.**

### 6.4 The concurrency fix has no standing test

§ 3.1 is a measurement, not a regression test. Every suite in Phase 5.1 has the database to itself; nothing that runs on each change would notice if `busy_timeout` were removed, reordered above the WAL pragma, or silently swallowed by its own catch.

Writing one is not free — it needs a second process holding a lock on a schedule — but the configuration users will actually run is *agents alongside a live Core*, and that path currently has zero coverage. This is recorded as open item 6 in the completion report and is my main reservation about declaring the phase closed.

### 6.5 `apps/server` does not typecheck; unchanged by this task

`tsc --noEmit` on `apps/server` reports **4 errors** (`AuthController.ts`, `AgentService.ts`, `ContextService.ts`). Confirmed pre-existing by stashing the `DatabaseService` change and re-running: 4 before, 4 after, none in `DatabaseService.ts`. `tsup` does not typecheck, so the build passes regardless.

### 6.6 CI remains red on `main`

`pnpm run lint` still fails on `@asterim/adapters` (24 errors), halting the pipeline at 2 of 5 tasks. Every figure in this report and the completion report is **local verification**. Phase 5.1 has never been validated by a green CI gate, and closing the phase does not change that. Stated in the completion report § 6 item 5 rather than left implicit.

---

## 7. Recommended Next Step

Phase 5.1 is complete and its open items are recorded rather than closed. Before milestone sign-off, two are worth resolving because they are cheap now and expensive later:

1. **Fix `@asterim/adapters` lint (§ 6.6).** 24 errors, most of them `no-useless-escape` in regex literals — largely `eslint --fix`-able. Until it is green, "all tests pass" is a claim no automated gate is checking, and every phase report in this repository carries the same asterisk.
2. **Add the concurrency regression test (§ 6.4).** The one failure mode most likely to be hit in real use is the one nothing watches.

**For Phase 5.2**, the highest-value item carried out of 5.1 is cross-process event broadcasting (`MISSING_SPECIFICATION.md` § 4). It is not a missing feature but an unmade architectural decision, and it blocks two things at once: a memory UI that reacts to agent writes, and the Phase 5 cloud relay, which needs the same answer for remote agents. It should be settled as a Change Proposal against `ARCHITECTURE.md` before either is built.

Also worth folding into 5.2 planning: the `packages/memory-core` extraction (drift § 9). It has been recommended since P5.1-02 and grown at every task since. The relay will be a third consumer of the same persistence layer, which is the point at which the deep import stops being untidy and starts being load-bearing.
