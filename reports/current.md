# Execution Report: P5.1-04 — MCP Memory Retrieval Tools

**Task ID:** P5.1-04
**Status:** VERIFIED
**Date:** 2026-08-13
**Author:** Claude Code
**Branch:** `main` @ `48c4f7c` (working tree)

---

## 1. Summary

`get_project_briefing` and `query_decisions` are registered and served over stdio. `src/index.ts` now resolves its project at startup via `parseResolveOptionsFromArgv` + `resolveProjectContext`, reports failure on stderr and exits 1 without writing a byte to stdout, and dispatches both tools through a handler that converts every failure into an in-band `isError` result rather than letting it reach the transport.

`retrieval_tools.test.ts` covers this at **71/71 assertions** against the built binary as a real child process. All six acceptance criteria are met.

Three mutation runs establish that the suite can go red for the right reasons (§ 5). One of them initially **survived**, showing that the resolve-before-connect ordering was asserted only by accident; the test was strengthened until it caught the mutation, and that assertion now pins the ordering for real.

One P5.1-02 artefact required modification: `stdio_scaffold.test.ts` could not survive startup resolution unchanged (§ 6.1).

---

## 2. Files Changed

**Modified**

| File | Change |
| :-- | :-- |
| `packages/mcp-memory-server/src/index.ts` | Startup project resolution, two tool definitions, `CallToolRequestSchema` dispatch, argument validation, in-band error results |
| `packages/mcp-memory-server/src/__tests__/stdio_scaffold.test.ts` | Seeds a project and passes `--project`; the "no tools yet" assertion now expects the two registered tools (§ 6.1) |

**Created**

| File | Lines | Purpose |
| :-- | --: | :-- |
| `packages/mcp-memory-server/src/__tests__/retrieval_tools.test.ts` | 397 | End-to-end stdio JSON-RPC tool tests |

`src/index.ts` was mutated three times for negative controls and restored byte-identically each time (`md5 7b110efc69374836f0853bdac69c2735`, confirmed against a pre-mutation copy).

**Not modified:** no file in `apps/server`, `packages/shared`, or `packages/adapters` was touched; no DDL was altered; `record_decision` was not implemented. The § 5 prohibitions hold.

---

## 3. Implementation Details

### 3.1 Startup resolution

```ts
try {
  resolvedProject = resolveProjectContext(parseResolveOptionsFromArgv(process.argv.slice(2)));
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const transport = new StdioServerTransport();
await server.connect(transport);
```

Resolution runs **before** `server.connect`. Once a transport is attached, anything on stdout is read as a protocol frame, so a client would see a corrupt stream instead of a clean non-zero exit. § 5.1 shows this ordering is currently defensive rather than load-bearing — and exactly when it stops being defensive.

The resolved project is announced on stderr alongside the database path, so an agent reporting unfamiliar memory can be diagnosed from the server's own log lines.

### 3.2 Dispatch and argument validation

The low-level `Server` API does **not** validate `tools/call` arguments against the advertised `inputSchema` — that is a client-side contract. Arguments are therefore validated in the handler:

- `readString` rejects non-strings and treats empty/whitespace-only as absent, so `{ projectId: '   ' }` falls back to the resolved project rather than querying a project whose id is blank. This matches the task's `args?.projectId || resolvedProject.id` semantics.
- `readStatus` validates against the runtime `DECISION_STATUSES` list exported by `ProjectMemoryService`, so the advertised `enum` and the accepted values cannot drift apart.

Both tools delegate straight to `projectMemoryService` — no SQL, no filtering, no business logic is duplicated in this package.

### 3.3 Errors are in-band

Every handler path is wrapped so a failure returns `{ isError: true, content: [{ type: 'text', text }] }`. Throwing would surface as a JSON-RPC protocol error and hand the model nothing it can act on. The suite asserts the server is still alive and serving correct results after four consecutive failed calls.

### 3.4 Deviation from the written task — an invalid `status` is rejected, not ignored

The task does not say what to do with an unrecognised `status`. Passing it through to `listDecisions` would return `[]`, which a model reads as *"this project has no such decisions"* rather than *"you spelled the filter wrong"*. For a memory system, a false negative is the expensive direction: it looks exactly like an absence of prior decisions, which is the signal that licenses an agent to decide freshly.

`query_decisions { status: 'active' }` therefore returns `isError` naming the four valid values. Flagged as a deviation because it is one.

---

## 4. Tests / Verification

All commands run from the repository root.

```
$ pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/retrieval_tools.test.ts
  build artifact ..................................  2 PASS
  startup project resolution ......................  4 PASS
  tools/list ......................................  9 PASS
  tools/call — get_project_briefing ............... 20 PASS
  tools/call — query_decisions .................... 18 PASS
  error handling ..................................  9 PASS
  the transport survives every failure above ......  3 PASS
  stdout purity ...................................  4 PASS
  71/71 assertions passed                             EXIT=0

$ tsc -p packages/mcp-memory-server/tsconfig.json --noEmit
  0 errors                                            EXIT=0

$ eslint src/   (in packages/mcp-memory-server)
  0 problems                                          EXIT=0

$ pnpm --filter @asterim/mcp-memory-server build
  CJS dist/index.js 48.27 KB                          EXIT=0

$ pnpm run build
  Tasks: 7 successful, 7 total                        EXIT=0
```

**Regression suites** — all four pre-existing suites re-run against the changed tree:

```
stdio_scaffold.test.ts        (P5.1-02, updated per § 6.1)   28/28
resolver.test.ts              (P5.1-03)                      42/42
ProjectMemoryService.test.ts  (P5.0)                        217/217
memory.test.ts                (P5.0)                         77/77
```

### 4.1 Acceptance criteria

| # | Criterion | Result |
| :-- | :-- | :-- |
| 1 | `tools/list` returns both tools with complete schemas | **Met** — names, descriptions, property sets and the `status` enum all asserted |
| 2 | `get_project_briefing` delegates and returns deterministic JSON | **Met** — two calls against an unchanged database are byte-identical |
| 3 | `query_decisions` routes to `findRelevantDecisions` / `listDecisions` | **Met** — proven by fixture construction, see § 4.2 |
| 4 | Errors return safely without crashing stdio | **Met** — 4 failure modes, then a normal call still succeeds |
| 5 | `retrieval_tools.test.ts` passes 100% | **Met** — 71/71 |
| 6 | `pnpm run build` 0 errors | **Met** — 7/7 tasks |

### 4.2 The fixture is built so assertions cannot pass for the wrong reason

- **Both** the ACTIVE (Argon2id) and the ARCHIVED (bcrypt) decision are anchored to `src/auth.ts`. A `filePath` query that reached `listDecisions` instead of `findRelevantDecisions` returns two rows, so criterion 3 cannot be satisfied by accident.
- The ARCHIVED decision is seeded **first**, so the ACTIVE one is also the newest — ordering assertions cannot pass by coincidence of insertion order.
- **Two** intents are created; the second archives the first, so `currentIntent` is asserted against a project whose `project_intents` table holds more than one row.
- The database is seeded **and closed** before the server spawns, so every returned value crossed a process boundary rather than being read from the test's own connection.

### 4.3 Bundle

19.57 KB → **48.27 KB**, from `ProjectMemoryService` and its `EventBus`/`@asterim/shared` closure. The require set remains clean:

```
node:sqlite, crypto, events, fs, os, path,
@modelcontextprotocol/sdk/{server/index.js, server/stdio.js, types.js}
```

No Fastify, no Socket.IO, no HTTP stack. `crypto` is new (uuid generation in `ProjectMemoryService`). Shebang and executable bit intact.

---

## 5. Negative Controls

| # | Mutation | Suite result | Verdict |
| :-- | :-- | --: | :-- |
| A | Resolution moved *after* `server.connect` | **71/71** | **survived** — see below |
| A2 | Same, plus an `await` yield before resolving | 54/61 | **caught** after the test was strengthened |
| B | `filePath` routed to `listDecisions` | 67/71 | caught — 4 failures |
| C | Handler `try/catch` removed | 67/71 | caught — 4 failures |

### 5.1 Control A — the ordering assertion was initially vacuous

The first version of the suite asserted `stdout === ''` on the resolution-failure path. Moving resolution after `server.connect` did not break it: the failing process was never sent a request, so the SDK had nothing to answer and stdout stayed empty either way. The assertion was passing for a reason unrelated to the property it claimed.

`runToExit` was changed to write an `initialize` frame at spawn time, so the server has a request queued at the moment it decides whether it has a project. That alone still did not catch mutation A — because `resolveProjectContext` is **synchronous** and `process.exit(1)` runs in the same tick that `connect` resolves, before Node can deliver the stdin `data` event.

Control A2 confirms that this is the entire reason the ordering currently appears not to matter. Inserting a 50 ms yield before resolution — standing in for any future async work, such as awaiting a database open — produces exactly the corruption the ordering exists to prevent:

```
FAIL  nothing is written to stdout when resolution fails, even with a request already queued
      — got {"result":{"protocolVersion":"2024-11-05", … ,"id":1}
FAIL  the call is not an error  — Cannot read properties of undefined (reading 'id')
```

Two distinct defects appear at once: the client receives a successful `initialize` response from a server that is about to exit 1, and `resolvedProject` is read while still `undefined` by any tool call that lands in the gap.

**The shipped ordering is correct and neither defect occurs.** The value of A2 is that the strengthened assertion now fails the moment resolution stops being synchronous — which is a realistic future change, and one whose breakage would otherwise be silent.

### 5.2 Controls B and C

B removes the `filePath` → `findRelevantDecisions` routing and is caught four times, including by the assertion that the ARCHIVED decision anchored to the same file stays excluded — the check § 4.2's fixture exists to make possible.

C replaces the handler's `catch` with a bare `finally`, and precisely the four error-handling assertions fail (`isError` becomes `undefined` as the errors escape as protocol errors). Criterion 4 is therefore pinned by tests that demonstrably fail without the implementation.

---

## 6. Problems Discovered & Concerns

### 6.1 P5.1-02's scaffold test could not survive this task unchanged — MODIFIED

`stdio_scaffold.test.ts` spawned the binary with no `--project` against an empty temp database. Once startup resolution landed, that process exits 1 before answering anything:

```
UNCAUGHT ERROR: Error: timed out after 10000ms waiting for the initialize response
6/7 assertions passed
```

Two changes were required, both minimal and both preserving the test's purpose (stdout purity and the stdio guard):

1. Seed one project row into the temp database and pass `--project`. The database is opened only for that insert, then closed before spawning.
2. `equal('the scaffold exposes no tools yet', …, [])` → assert the two registered tool names. That assertion was correct for P5.1-02 and is now false by design.

Flagged prominently because it is a change to a previously-VERIFIED artefact, not a new file. **Any future task that alters startup or the tool list must expect to touch this file** — it is the only suite that exercises the binary's default invocation.

### 6.2 `projectId` lets a client read outside the resolved project

Both tools accept `projectId` and fall back to the resolved project only when it is absent — as the task specifies (§ 4.1). The consequence is that resolution scopes the *default*, not the *boundary*: a client may pass any project id and read that project's decisions, rules, and intent. The suite asserts this works (`{ projectId: 'proj-does-not-exist' }`), because it is the specified behaviour.

For read-only tools against a local single-user database this is defensible. It stops being obviously defensible at **P5.1-05**, where `record_decision` arrives: the same parameter shape would let an agent working in project A write a decision into project B's memory. Phase 5.0 enforced project scoping at every persistence path; this parameter is the seam where that guarantee becomes advisory.

**Recommend deciding this before P5.1-05**, not during it. Options: drop `projectId` from the write tool, or require it to equal `resolvedProject.id`.

### 6.3 An unknown project returns an empty briefing, not an error

`getProjectBriefing` performs no existence check — every query is scoped by `project_id`, so an unregistered id yields a well-formed briefing with empty arrays and `currentIntent: null`. The task permitted "empty array or handled error", and this is the service's existing behaviour, so nothing was changed.

The failure mode is worth recording: an agent that typos a `projectId` receives a plausible, well-formed briefing stating the project has no decisions, rules, or intent. That is precisely the signal that tells an agent nothing has been decided yet. It reads as absence of memory rather than absence of project — the same false-negative hazard as § 3.4, one layer up, and it is currently unmitigated.

### 6.4 Advertised `additionalProperties: false` is not enforced server-side

Both schemas declare it, but the low-level `Server` does not validate arguments, and the handler ignores unrecognised keys. A client that sends `{ statuss: 'ACTIVE' }` gets every decision back rather than a complaint. Same failure shape as § 3.4 — a malformed question answered as though it were well-formed. Cheap to close by rejecting unknown keys; not done here because it is unspecified and outside the task's scope.

### 6.5 Carried forward, still open

- **The `asterim/src/...` deep import** (P5.1-02 § 6.4) now covers `ProjectMemoryService` as well as `DatabaseService` — three modules in this package reach past `apps/server`'s public surface into its source tree. Still unrecorded in `blueprint/audit/IMPLEMENTATION_DRIFT.md`. The recommendation stands and the surface has grown.
- **Repo-wide lint is red on `main`** from pre-existing `@asterim/adapters` violations (24 errors / 25 warnings, `no-useless-escape`), which halts the turbo lint pipeline before `asterim`'s known errors. Untouched by Phase 5.0/5.1. This package lints clean. **CI is not green on `main`, and P5.1-04 does not change that** — every result above is local verification.
- **The § 6.4 Windows assertion noted in the P5.1-03 report has been fixed** in `resolver.test.ts` (now 42/42, up from 41), along with the § 5.1 coverage gap. Both were closed before this task ran.

---

## 7. Recommended Next Step

Proceed to **P5.1-05 — `record_decision`**, with three items from this task folded in:

1. **Settle § 6.2 first.** `record_decision` is the point where the `projectId` parameter turns from a convenience into a way for an agent to write into a project it is not working on. This is a product decision about the scoping guarantee, not an implementation detail — it belongs in `decisions.md`.
2. **Reuse `readString`/`readStatus`.** The write tool needs the same treatment for `provenance` and `confidence`; `DECISION_PROVENANCES` is already exported alongside `DECISION_STATUSES` for exactly this. `createDecision` throws on unrecognised enums, so unvalidated input becomes an `isError` with a service-internal message rather than a usable one.
3. **Extend `stdio_scaffold.test.ts` in the same commit** (§ 6.1) — its tool-list assertion will need a third name, and discovering that from a red suite later costs more than doing it deliberately now.

For the write path specifically: `createDecision` runs in a transaction and publishes an EventBus event on commit. This process has its own EventBus instance with no subscribers, so memory events published here reach nothing — the running Core server will not see them, and the dashboard will not live-update from an agent's write. That is not a defect in P5.1-04, but it is a design question P5.1-05 has to answer explicitly rather than discover.
