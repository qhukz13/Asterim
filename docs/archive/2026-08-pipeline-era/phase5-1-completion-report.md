# Phase 5.1 Completion Report — Project Memory over MCP

**Phase:** 5.1 — MCP Memory Server
**Status:** COMPLETE
**Date:** 2026-08-13
**Verification:** local (`pnpm run build`, seven assertion suites) — see § 6 for what that does and does not cover

---

## 1. What was built

Phase 5.0 gave Asterim a Project Memory store: durable decisions, their code anchors, architectural rules, and a project's current intent, persisted in `~/.asterim/asterim.db` and reachable over REST.

Phase 5.1 makes that memory reachable **by the agents themselves**, through the Model Context Protocol.

```
Session 1 (Claude Code)                 Session 2 (Cursor, next week)
   get_project_briefing                     get_project_briefing
   query_decisions("src/auth.ts")           query_decisions("src/auth.ts")
   record_decision ─────────┐                        ▲
                            ▼                        │
                     ~/.asterim/asterim.db ──────────┘
```

`@asterim/mcp-memory-server` is a stdio MCP server that scopes itself to one project and exposes three tools. It is a thin surface over `ProjectMemoryService`: no state of its own, no duplicated queries.

| Tool | Purpose |
| :-- | :-- |
| `get_project_briefing` | The project's memory snapshot — active decisions, rules, current intent, recent sessions, recent approvals |
| `query_decisions` | Decisions by anchored file path or lifecycle status; the check to run before editing a file |
| `record_decision` | Record a durable choice, anchored to the files it governs |

The product claim this substantiates is narrow and real: **an agent session no longer starts from nothing, and what it decides survives it** — across process boundaries and across tools.

---

## 2. Task-by-task

| Task | Delivered | Assertions |
| :-- | :-- | --: |
| **P5.1-01** | Architecture audit — dependency closure, database reuse, transport plan (`docs/p5.1-01-audit-report.md`) | — |
| **P5.1-02** | Package scaffold, MCP SDK wiring, stdio guard, protocol handshake | 28 |
| **P5.1-03** | Project context resolver — 4-tier precedence, segment-safe containment, longest-match | 42 |
| **P5.1-04** | `get_project_briefing`, `query_decisions`, startup resolution, in-band errors | 71 |
| **P5.1-05** | `record_decision`, project write boundary, agent defaults, input validation | 82 |
| **P5.1-06** | Multi-session dogfood scenario, live-database compatibility probe | 62 |
| **P5.1-07** | `busy_timeout`, documentation, decision records, blueprint sync, this report | — |

---

## 3. Verification

### 3.1 Assertion tally

```
packages/mcp-memory-server
  resolver.test.ts .............................  42/42
  stdio_scaffold.test.ts .......................  28/28
  retrieval_tools.test.ts ......................  71/71
  record_decision.test.ts ......................  82/82
  dogfood_scenario.test.ts .....................  62/62
                                          subtotal  285

apps/server (Phase 5.0, re-run as regression)
  ProjectMemoryService.test.ts ................. 217/217
  memory.test.ts ...............................  77/77
                                          subtotal  294

                                             TOTAL  579
```

`pnpm run build` — **7 successful, 7 total**, 0 errors.
`tsc --noEmit` on `packages/mcp-memory-server` — 0 errors. `eslint` on the package — 0 problems.

> The Phase 5.1 task plan projected 272 + 294 = 566. The measured figure is **579**; the MCP package subtotal is 285, not 272. The difference is assertions added during P5.1-05 and P5.1-06 after the plan was written. The measured numbers are authoritative.

### 3.2 The suites are mutation-tested

Every suite in this phase was checked by breaking the implementation and confirming the suite goes red. Fourteen mutations were run across five tasks. Three findings came out of that practice rather than out of the tests passing:

- **P5.1-03** — an assertion named for substring-collision safety passed even with segment-safe containment removed; the longest-match sort masked it. The genuinely dangerous shape (an unregistered sibling directory sharing a name prefix) was uncovered until an assertion was added.
- **P5.1-04** — the assertion pinning "resolution happens before the transport connects" was vacuous: the failing process was never sent a request. It now delivers an `initialize` frame at spawn time, and a further control proved the ordering only becomes load-bearing if resolution ever becomes asynchronous.
- **P5.1-05** — `retrieval_tools.test.ts` probed unknown-tool dispatch by calling `record_decision`, which did not yet exist. Registering the tool did **not** turn the assertion red — the call still returned `isError`, now for a missing title — so it kept reporting green while testing nothing.

All three were fixed. They are recorded because each is the same failure mode: a test that stops testing without going red.

### 3.3 What the dogfood scenario proves

Three independent server processes, distinct pids, each exiting cleanly. None receives a `--project` flag — each resolves from its working directory, as a real `claude mcp add` invocation does, and Session A starts in a *nested subdirectory* so longest-match resolution is on the scenario's critical path.

- **Session A** finds an empty project, records a decision, exits.
- **Session B** — a new process, told nothing about A — finds that decision by id, title, rationale, provenance and confidence, through both the briefing and a file-anchored query, and records a follow-up.
- **Session C**, in a neighbouring registered project, sees none of it and is refused when it tries to write into Primary.

Final state is then read straight from SQLite, after every session has terminated: two decisions, both belonging to Primary, both anchored to the shared file, zero rows for the neighbour.

Two mutations confirm this is not theatre. Making the resolver ignore the working directory collapses the isolation phase — Session C becomes a third session in Primary and its "cross-project" write is accepted. Making `record_decision` return a plausible decision without persisting it fails eleven assertions in Session B and the final database check.

### 3.4 Live database compatibility

The scenario also probes the real `~/.asterim/asterim.db` when one exists. On the verification machine: 3 registered projects, all 3 paths present on disk. A session spawned in the deepest resolved correctly by working directory and served a briefing against the real schema, returning **5 recent sessions and 5 recent approvals** — the first observation of those two projections against non-empty data.

The probe is provably non-destructive:

- The server child runs against a snapshot taken with `VACUUM INTO` over a read-only connection — one read transaction, one consistent file. (An earlier `copyFileSync` approach was replaced: the live database is in **WAL mode**, so copying `asterim.db` alone omits committed transactions still in the `-wal`, and copying the files in sequence can tear.)
- The only handle on the real file is read-only, and the suite **proves** it by attempting an `INSERT` through it and requiring the write to be rejected.
- Size and sha256 are asserted unchanged before and after.

---

## 4. Decisions recorded

Three entries were added to the decision record in this phase:

- **[DEC-023] Project scoping model.** Writes are bounded to the resolved project; reads default to it but are not bounded. Asymmetric on purpose: a misdirected write is unrecoverable and reads as the receiving project's own history, while a misdirected read is disclosure on a local single-user database. Measured during P5.1-05: with the guard removed, a write into a *registered* neighbouring project succeeds **silently** — no error, no foreign-key violation. The application check is the only enforcement.
- **[DEC-024] Agent memory defaults.** `provenance: 'AGENT_STATEMENT'`, `confidence: 0.75`. The service's own defaults (`HUMAN_CONFIRMED`, `1.0`) are right for REST and wrong here; inheriting them would record an agent's unprompted assertion as human-confirmed at maximum confidence and erase the distinction `provenance` exists to carry.
- **[DEC-025] In-band error handling for stdio.** stdout carries protocol frames only; tool failures are returned, not thrown; startup failures precede the transport. The local expression of the standing rule that tool failures must never take down the Core.

---

## 5. Concurrency: one measured fix

The Core server is no longer the only process writing `asterim.db`. Each MCP session opens it too.

WAL keeps readers clear, so briefings and queries are unaffected by a concurrent Core write. **Writers still serialize, and SQLite's default busy timeout is zero.** Measured before the fix: `record_decision` failed within ~1 ms with `database is locked` whenever the Core held the write lock — the agent's decision simply lost, with an error it could not act on.

`PRAGMA busy_timeout = 5000` was added to `DatabaseService.init()`. Measured across processes afterwards:

| Lock held by the other process | `record_decision` | Elapsed |
| --: | :-- | --: |
| 800 ms | SUCCEEDED | 846 ms |
| 2500 ms | SUCCEEDED | 2544 ms |
| 6000 ms | FAILED (`database is locked`) | 5023 ms |

It waits only as long as needed and remains bounded. Startup was never affected: `CREATE TABLE IF NOT EXISTS` takes no write lock when the tables already exist.

This is recorded in `blueprint/audit/IMPLEMENTATION_DRIFT.md` § 10, along with the fact that `ARCHITECTURE.md`'s description of the Core as "the only privileged process" owning SQLite is no longer literally true.

---

## 6. Open items carried out of Phase 5.1

Stated plainly, because none of them is closed:

1. **The dashboard does not live-update on an agent's write.** Each MCP process has its own `EventBus` with no subscribers, so `memory.decision_created` reaches nothing. The decision is durable but invisible until the next fetch. This is a hole in the Golden Loop's premise, not merely a missing feature. Specified for decision in `blueprint/audit/MISSING_SPECIFICATION.md` § 4, with three candidate shapes and no choice made.
2. **The binary is not relocatable.** The MCP SDK is left external, so `dist/index.js` needs the repository's `node_modules`. Clients must point at an absolute path inside the checkout. Documented in `docs/mcp-setup-guide.md` § 2 rather than hidden.
3. **Reads are unscoped by design** (DEC-023). Revisit before the Phase 5 cloud relay, where the threat model changes.
4. **`packages/mcp-memory-server` deep-imports `apps/server` source.** Four symbols across two modules, reaching past a package that declares no `exports` map. Adding one would break this package. Recorded as drift § 9; the fix is a `packages/memory-core` extraction.
5. **CI is red on `main`, independently of this phase.** `pnpm run lint` fails on `@asterim/adapters` (24 errors, mostly `no-useless-escape`), halting the turbo pipeline. `apps/server` also has 4 pre-existing `tsc --noEmit` errors — unaffected by Phase 5.1 and identical before and after the `DatabaseService` change. Builds pass because `tsup` does not typecheck. **Every verification figure in this report is local; the CI gate has not been green during this phase.**
6. **No test covers concurrent load.** Every suite has the database to itself. The `busy_timeout` measurements in § 5 come from targeted probes, not from a standing suite. The configuration users will actually run — agents alongside a live Core — has no regression coverage.

---

## 7. Assessment

Phase 5.1 delivers what it set out to: three working memory tools, reachable by any MCP-capable agent, verified across process boundaries and against the real database, with the project boundary enforced on writes and the failure modes handled in band.

The honest qualification is item 6 above. Cross-session memory is proven; **concurrent** memory is measured but not continuously verified. The most likely way this fails in real use is a write colliding with the Core under sustained load, and that path is now bounded rather than instant, but untested by any suite that runs on every change.
