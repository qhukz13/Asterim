# Execution Report: P5.1-05 — `record_decision` MCP Tool & Input Validation

**Task ID:** P5.1-05
**Status:** VERIFIED
**Date:** 2026-08-13
**Author:** Claude Code
**Branch:** `main` @ `48c4f7c` (working tree)

---

## 1. Summary

`record_decision` is registered and enforces the project boundary: a write naming any project other than the resolved one is rejected in band, before validation and before a transaction opens. Agent writes default to `provenance: 'AGENT_STATEMENT'`, `confidence: 0.75`, `status: 'ACTIVE'`. Every argument — required text, both enums, the confidence range, array shapes, and code-ref entries — is validated in this package before `ProjectMemoryService` is reached.

`record_decision.test.ts` covers this at **79/79 assertions**, driving the built binary as a child process and then **reopening the SQLite file with an independent connection** to confirm what was persisted. All six acceptance criteria are met.

Three mutation runs confirm the suite fails for the right reasons (§ 5). Mutation A also produced direct evidence for the concern raised in the P5.1-04 report § 6.2: with the boundary check removed, a write into the neighbouring project **succeeds silently** — no error, no foreign-key violation, a decision simply lands in another project's memory.

Two existing suites needed updating; one of them had a genuinely broken assertion (§ 6.1).

---

## 2. Files Changed

**Modified**

| File | Change |
| :-- | :-- |
| `packages/mcp-memory-server/src/index.ts` | `record_decision` tool definition, boundary guard, agent defaults, six argument readers; `readStatus` generalised to `readEnum` |
| `packages/mcp-memory-server/src/__tests__/stdio_scaffold.test.ts` | Tool-list assertion now expects all three tools |
| `packages/mcp-memory-server/src/__tests__/retrieval_tools.test.ts` | Tool count 2 → 3; unknown-tool probe changed off `record_decision` (§ 6.1) |

**Created**

| File | Lines | Purpose |
| :-- | --: | :-- |
| `packages/mcp-memory-server/src/__tests__/record_decision.test.ts` | 415 | Write-path tests over stdio + direct SQLite verification |

`src/index.ts` was mutated three times for negative controls and restored byte-identically each time (`md5 96fd7c61f01e11ee1cd2129ab30ad501`).

**Not modified:** nothing in `apps/server`, `packages/shared`, or `packages/adapters`; no DDL; no tools beyond the three in the plan. The § 5 prohibitions hold.

---

## 3. Implementation Details

### 3.1 The boundary check runs first

```ts
const requestedProjectId = readString(args, 'projectId');
if (requestedProjectId !== undefined && requestedProjectId !== resolvedProject.id) {
  return toolError(
    `Cannot record decision for project '${requestedProjectId}' from workspace of project '${resolvedProject.id}'.`
  );
}
```

It precedes every other validation deliberately. A write is the one operation where being wrong about the project is unrecoverable from inside this process: the decision lands in another project's memory and reads as that project's own history from then on. The guard never consults the database, so an unregistered id is refused by the same rule and with the same message as a registered one — the boundary is *this process's scope*, not *what exists*.

`projectId` is then discarded: `createDecision` is always called with `resolvedProject.id`.

### 3.2 Agent defaults

`AGENT_DEFAULTS = { status: 'ACTIVE', provenance: 'AGENT_STATEMENT', confidence: 0.75 }`.

`provenance` is the field a reviewer uses to weigh a remembered decision. `ProjectMemoryService.insertDecision` defaults it to `HUMAN_CONFIRMED` — correct for the REST path, where a human is on the other end, and wrong here. § 5.2 shows what happens without the override: an agent's unattributed assertion is stored as human-confirmed at confidence 1.0, indistinguishable from something the user actually approved.

### 3.3 Validation happens here, not downstream

Six readers cover the surface: `requireString`, `readEnum` (generic over `DECISION_STATUSES` / `DECISION_PROVENANCES`), `readStringArray`, `readCodeRefs`, `readConfidence`, plus the existing `readString`. `readStatus` was folded into `readEnum` rather than duplicated for provenance.

All of them run while building the `createDecision` argument object, so a malformed request never opens a transaction. Three readers are deliberately **stricter than the service**:

| Input | `ProjectMemoryService` | This package |
| :-- | :-- | :-- |
| `confidence: 75` | clamped to `1.0` | rejected |
| `codeRefs: [{}]` | silently dropped | rejected |
| unknown enum | throws with a service-internal message | rejected, listing valid values |

Each of these is a case where the permissive behaviour produces a *plausible wrong record* rather than a failure. An agent meaning "75%" that sends `75` would have its guess stored as maximum confidence — the exact inverse of what it expressed, with nothing in the row to show it happened. An agent that mistypes a code-ref key would be told its decision was anchored, then find `query_decisions({ filePath })` returns nothing.

Being stricter than the service is a deviation worth naming, but it is not a divergence in what gets stored: every value that passes these readers is accepted unchanged downstream.

---

## 4. Tests / Verification

```
$ pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/record_decision.test.ts
  build artifact ...................................  1 PASS
  tools/list .......................................  9 PASS
  record_decision — minimal required fields ........ 11 PASS
  record_decision — full field set ................. 10 PASS
  recorded decisions are immediately retrievable ...  7 PASS
  project boundary enforcement .....................  4 PASS
  input validation ................................. 17 PASS
  the transport survives every rejection above .....  2 PASS
  persistence, read from SQLite directly ........... 12 PASS
  stdout purity ....................................  3 PASS
  79/79 assertions passed                              EXIT=0

$ tsc -p packages/mcp-memory-server/tsconfig.json --noEmit      0 errors
$ eslint src/  (in packages/mcp-memory-server)                  0 problems
$ pnpm --filter @asterim/mcp-memory-server build                CJS dist/index.js 53.97 KB
$ pnpm run build                                                Tasks: 7 successful, 7 total
```

**All suites, after the changes:**

```
record_decision.test.ts        79/79
retrieval_tools.test.ts        71/71
stdio_scaffold.test.ts         28/28
resolver.test.ts               42/42
ProjectMemoryService.test.ts  217/217   (P5.0 regression)
memory.test.ts                 77/77    (P5.0 regression)
```

Bundle 48.27 → 53.97 KB. Require set unchanged: node builtins plus the three SDK subpaths. No Fastify, no Socket.IO.

### 4.1 Acceptance criteria

| # | Criterion | Result |
| :-- | :-- | :-- |
| 1 | All three tools advertised | **Met** — asserted in two suites |
| 2 | Creates and persists with agent provenance and 0.75 default | **Met** — verified in the response *and* in the SQLite row |
| 3 | Cross-project writes strictly rejected in band | **Met** — against a registered and an unregistered project, plus a row count of 0 for the neighbour |
| 4 | New decisions immediately retrievable | **Met** — via `query_decisions({ filePath })` and `get_project_briefing` |
| 5 | All four suites pass 100% | **Met** — 79 / 71 / 28 / 42 |
| 6 | `pnpm run build` 0 errors | **Met** — 7/7 |

### 4.2 The fixture is built so assertions cannot pass for the wrong reason

- **A second project is genuinely registered.** Rejecting a write to `proj-the-neighbour` proves a boundary check; rejecting a write to a non-existent id would only have proven a lookup failure. Mutation A confirms the distinction is real — see § 5.1.
- **The decision count is captured before and after the 17 validation rejections** and asserted unchanged. A rejection that still wrote a row is caught, not assumed away. This assertion is what caught mutation C's silent clamping.
- **Two decisions are anchored to the same file with different statuses**, so retrieval integration cannot be satisfied by anchor matching alone.
- **Persistence is read through a fresh `DatabaseSync`** opened after the server is terminated — bypassing `ProjectMemoryService`, the tool response, and the server process alike.

---

## 5. Negative Controls

| # | Mutation | Suite result | Verdict |
| :-- | :-- | --: | :-- |
| A | Boundary check removed; `projectId` passed through | 74/79 | caught — 5 failures |
| B | `AGENT_DEFAULTS` dropped, service defaults apply | 75/79 | caught — 4 failures |
| C | Confidence range check removed (service clamps) | 75/79 | caught — 4 failures |

### 5.1 Control A — the concern from P5.1-04 § 6.2, demonstrated

Removing the guard and forwarding `args.projectId` produced two different outcomes, and the difference is the finding:

```
FAIL  a write aimed at another registered project is rejected
      — expected isError, got { …a successfully created decision… }
FAIL  a write aimed at an unregistered project is rejected the same way
      — got: FOREIGN KEY constraint failed
FAIL  nothing was written to the neighbouring project — expected 0, got 1
```

Writing to a **non-existent** project fails on its own — the foreign key catches it. Writing to a **registered** project succeeds completely silently: no error, no constraint, a decision simply appears in another project's memory and is indistinguishable from one recorded there legitimately.

So the database provides no protection whatsoever for the case that actually matters — a machine with several registered projects, which the P5.1-01 audit found is the normal shape of the live `~/.asterim/asterim.db`. The guard in § 3.1 is the only thing standing between an agent and another project's memory. This is worth recording in `decisions.md`: the scoping guarantee is enforced at exactly one line of application code, with no defence in depth beneath it.

### 5.2 Control B — the service default is wrong for this caller

Dropping the explicit defaults and letting `insertDecision` supply its own:

```
FAIL  provenance defaults to AGENT_STATEMENT  — got "HUMAN_CONFIRMED"
FAIL  confidence defaults to 0.75             — got 1
```

Both the response assertions and the direct SQLite assertions fail, so this is caught at the persistence layer too. An agent's unprompted assertion would enter project memory as human-confirmed at full confidence — the strongest provenance the model has, awarded to the weakest evidence.

### 5.3 Control C — clamping is silent, and the count assertion catches it

Removing the range check let `confidence: 75` and `confidence: -0.1` through to `clampConfidence`, which stored `1.0` and `0`:

```
FAIL  a confidence above 1 is rejected rather than clamped
FAIL  a negative confidence is rejected
FAIL  not one rejected call wrote a decision  — expected 4, got 6
FAIL  five decisions reached the table        — expected 5, got 7
```

The last two are the informative ones: the write went through and was only visible as a change in row count. Without the before/after count assertion, a clamped-and-stored decision would have looked identical to a rejected one from the test's perspective.

---

## 6. Problems Discovered & Concerns

### 6.1 `retrieval_tools.test.ts` had a self-disabling assertion — FIXED

That suite probed unknown-tool dispatch by calling `record_decision`, which did not exist at the time:

```ts
const unknownTool = await callTool('record_decision', {});
equal('an unknown tool returns isError', unknownTool.result?.isError, true);
check('the unknown-tool message names the tool', textOf(unknownTool).includes('record_decision'), …);
```

Registering the tool did not make that first assertion fail. `record_decision` with no arguments still returns `isError` — for a missing title — so the check kept passing while testing nothing about dispatch. Only the message assertion failed, and only because the text changed.

This is the failure mode where a test keeps reporting green after the thing it tested stopped existing. The probe is now `forget_everything`, a name no tool will claim, with a comment recording why. **Worth a general note for this package: any assertion whose subject is "a name that does not exist" needs a name that cannot later come into existence** — the tool list is still growing.

The tool-count assertions in the same suite (2 → 3) and in `stdio_scaffold.test.ts` were straightforward updates, expected by the task.

### 6.2 Reads are still unscoped; only writes are bounded

`record_decision` now enforces `projectId === resolvedProject.id`. `get_project_briefing` and `query_decisions` retain the P5.1-04 behaviour: `projectId` selects any project, and `retrieval_tools.test.ts` asserts that it does.

The asymmetry is deliberate — the task scoped the guarantee to writes, and § 5 forbids unrequested changes — but it should be a recorded decision rather than an artefact of task sequencing. An agent working in project A can still read project B's decisions, rules, intent, recent sessions and approvals. For a local single-user database that is a small thing; for the Phase 5 multi-tenant relay it is the same boundary question one layer out, and the answer should be the same in both places.

**Recommend a `decisions.md` entry covering both directions**, so the read side is either deliberately open or closed on purpose.

### 6.3 `additionalProperties: false` is still not enforced

Unchanged from P5.1-04 § 6.4, and it now matters more. The write tool advertises the constraint but the server does not check it, so `record_decision` with a mistyped optional key — `relatedFile` for `relatedFiles`, `constraint` for `constraints` — silently records a decision **missing the anchors or constraints the agent supplied**, and reports success. The required fields are caught; the optional ones vanish.

This is the same class as the two cases § 3.3 already closes, and closing it is a few lines: reject argument keys not in the tool's schema. Not done here because it is unspecified and would touch all three tools.

### 6.4 The finiteness guard in `readConfidence` is unreachable over stdio

`JSON.stringify(NaN)` emits `null`, which `readConfidence` treats as absent, so `typeof value !== 'number' || !Number.isFinite(value)` can only fire on a non-number. The branch is kept because the reader is not transport-specific, but no test covers it and none can over JSON-RPC. Recorded so it is not mistaken for tested behaviour.

### 6.5 EventBus writes reach nothing

Flagged as a question in the P5.1-04 report; now live. `createDecision` publishes `memory.decision_created` on commit, and this process has its own `EventBus` instance with no subscribers. Agent writes therefore do not reach the running Core server, and the dashboard does not live-update when an agent records a decision — the user learns about it on next fetch.

Nothing in Phase 5.1 asked for cross-process events, and inventing a channel here would be inventing architecture. But the Golden Loop's premise is that the user sees what the agent is doing, and a decision written into project memory without a visible trace is a small hole in that. **This belongs in `blueprint/audit/MISSING_SPECIFICATION.md`** rather than being decided inside a task.

### 6.6 Carried forward, still open

- **The `asterim/src/...` deep import** now also pulls `CreateCodeRefInput`, `DECISION_PROVENANCES` and `DECISION_STATUSES` from `ProjectMemoryService`. Four modules in this package reach past `apps/server`'s public surface. Still unrecorded in `blueprint/audit/IMPLEMENTATION_DRIFT.md`; the P5.1-02 § 6.4 recommendation has now been outstanding for four tasks and the surface has grown at each one.
- **Repo-wide `pnpm run lint` is red on `main`** from pre-existing `@asterim/adapters` violations. This package lints clean. **CI is not green on `main` and P5.1-05 does not change that** — every result above is local verification.

---

## 7. Recommended Next Step

Proceed to **P5.1-06 — End-to-End Dogfood Scenario**. The three tools are complete and mutually consistent; what has not been tested is the loop an actual agent runs: brief → work → record → next session briefs on what the last one recorded.

Three things to settle before or during it:

1. **Register the two `decisions.md` entries** from § 5.1 and § 6.2 — the write-scoping guarantee rests on one line with no database-level backstop, and the read side is open by omission rather than by decision. A dogfood scenario is the natural moment to state both, since it is the first task where the tools are used the way a user would.
2. **Point the MCP server at the real `~/.asterim/asterim.db`** for at least one pass. Every suite so far has run against a temp fixture. The P5.1-01 audit found the live database has nested project paths and a trailing-slash row; the resolver handles both, but no test has run against the actual file.
3. **Decide § 6.3.** A dogfood run is where a mistyped optional key would actually happen, and where "the decision was recorded but its anchors silently vanished" is most expensive to discover — the anchors are what make a decision findable later.

For the scenario itself: `get_project_briefing` returns `recentAgentWork` and `recentApprovals` from the `sessions` and `approvals` tables, which no test has ever populated — every assertion so far has seen them empty. A dogfood run with a real session is the first chance to verify those two projections against non-empty data.
