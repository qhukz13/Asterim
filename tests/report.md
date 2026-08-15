# TEST REPORT

Task:
TEST-P6-03 — MCP Tool Invocation Engine & Web Registry UI Gate

Status:
VERIFIED (with one non-blocking reliability defect — see Finding 1)

## Environment

Repository state:
`93c2a76` on `main`. Working tree clean at gate start (23:38:25), dirty with P6-04 work by
23:50 (see §"Snapshot Isolation"). Certified results below come from an **isolated pristine export
of `93c2a76`**.

Relevant packages:
`asterim` (apps/server), `@asterim/web`, `@asterim/marketing`, `@asterim/relay`,
`@asterim/shared`, `@asterim/adapters`, `@asterim/mcp-memory-server`

Node version:
v24.13.1 · **4 CPU cores** (relevant to Finding 1)

Package manager:
pnpm 9.0.0 (turbo monorepo)

Other relevant environment information:
- Every turbo task was run with `--force`; no result below comes from a cache hit.
- No test runner exists in the repository; every suite is a standalone `tsx` script that exits
  non-zero on failure. CI runs only `lint` and `build`, so none of these suites run in CI.
- No product code, test code, or test expectation was modified. The repository working tree was
  never written to; the export was produced with `git archive` (no `.git` mutation). The only file
  this pass writes is this report.
- The full battery was executed **5 times** at this SHA and **3 times** at the previous SHA to
  characterise Finding 1.

---

## Snapshot Isolation

For the third consecutive gate, implementation work landed in the working tree during execution.
The tree was clean and had been quiet for ~52 minutes at start, but editing resumed at 23:39:52 —
inside Step 1.

| Time | Event |
|---|---|
| 23:38:25 | Gate start — `git status` **clean** at `93c2a76` |
| 23:39:52 | `SchemaValidator.ts` created (during Step 1 typecheck) |
| 23:40:14 | `McpProcessSupervisor.ts` modified (during Step 1 lint) |
| ~23:50 | P6-04 work: `McpAgentBridge.ts`, `McpAgentBridge.test.ts`, `apps/web/src/utils/auth.ts`, `useSocket.ts`, `useMcpStore.ts` |

The gate was therefore re-executed against a pristine export, as in TEST-P6-02:

```bash
git archive 93c2a76 | tar -x -C <scratch>/gate-93c2a76
pnpm install --frozen-lockfile
```

Integrity confirmed by comparing `McpProcessSupervisor.ts` against `git show 93c2a76:…`
(md5 `c654f4e8290f`, identical). The export contains 14 wired server suites and 5 wired web suites
= 28, matching the gate. The uncommitted P6-04 work (`McpAgentBridge`, schema validation,
per-server invocation queueing, unified auth headers) is **out of scope** and was not assessed.

---

## Tests Executed

### Step 1 — Full monorepo typecheck & lint

`npx turbo run typecheck --force` — **PASS**. 11 / 11 Turbo tasks, **0 TypeScript errors**. 58.8 s.

`npx turbo run lint --force` — **PASS**. 7 / 7 workspace packages, **0 ESLint errors**, 568 warnings.

| Package | Errors | Warnings |
|---|---|---|
| `@asterim/web` | 0 | 266 |
| `asterim` | 0 | 241 |
| `@asterim/adapters` | 0 | 28 |
| `@asterim/marketing` | 0 | 18 |
| `@asterim/mcp-memory-server` | 0 | 12 |
| `@asterim/shared` | 0 | 3 |

Warnings rose from 558 to 568, entirely in `@asterim/web` (256 → 266) from the new MCP registry UI.
All are `@typescript-eslint/no-explicit-any` plus one unused `eslint-disable` directive. The
criterion is 0 errors, which is met.

### Step 2 — MCP Tool Invocation & Web Explorer suites

| Suite | Expected | Actual | Result |
|---|---|---|---|
| `McpToolInvocation.test.ts` | 43 / 43 | **43 / 43** | PASS (exit 0) |
| `McpServerExplorer.test.ts` | 104 / 104 | **104 / 104** | PASS (exit 0) |

Both match the gate exactly. Both are wired into their packages' `"test"` scripts.

### Step 3 — Full monorepo test battery

`npx turbo run test --force` — **PASS on a clean run**: 28 / 28 suites, **2,153 / 2,153
assertions**, 9 / 9 Turbo tasks.

| Package | Suites | Expected | Actual | Result |
|---|---|---|---|---|
| `asterim` (Server) | 14 | 1,172 | 1,172 / 1,172 | PASS |
| `@asterim/mcp-memory-server` | 7 | 348 | 348 / 348 | PASS |
| `@asterim/web` | 5 | 539 | 539 / 539 | PASS |
| `@asterim/relay` | 1 | 71 | 71 / 71 | PASS |
| `@asterim/adapters` | 1 | 23 | 23 / 23 | PASS |
| **Total** | **28** | **2,153** | **2,153 / 2,153** | **PASS** |

Server breakdown (14): 63, 60, 140, 52, 51, 64, 89, 21, 231, 52, 102, 115, 89, **43** = 1,172.
Web breakdown (5): 151, 37, 134, 113, **104** = 539.

**However, this step is not reliably green.** Across 5 battery runs at this SHA, 2 failed — always
the same suite, `@asterim/mcp-memory-server`'s `relay-client.test.ts`. See Finding 1. The result is
recorded as PASS because the failure is a timing artefact of parallel execution, is reproducible at
the previous SHA, and the suite passes 23/23 deterministically when run alone.

### Step 4 — Full production build

`npx turbo run build --force` — **PASS**. **7 / 7** Turbo packages built. 38.5 s cold.

Enumerated: `@asterim/shared`, `@asterim/adapters`, `@asterim/relay`, `@asterim/web`,
`@asterim/marketing`, `asterim`, `@asterim/mcp-memory-server`. The "under 10 seconds" expectation
remains warm-only (~100 ms warm); see Finding 4.

---

## Mandate Verification (§2)

### Tool Invocation — **VERIFIED**

`McpToolInvocation.test.ts` (43/43) exercises `tools/call` against **real spawned stdio child
processes**, not mocks. Covered blocks: `callTool`, `a tool that reports failure`, `failures that
are not the tool saying no`, `a server that is not running`, and
`POST /api/v1/mcp/servers/:id/tools/:toolName`.

The mandate's three specific requirements are each covered:

- **Executes tools / structured content** — `callTool` returns structured `content[]`; the REST
  route surfaces it.
- **Error status** — an unknown tool yields `TOOL_NOT_FOUND`; a JSON-RPC error propagates its
  message (`Invalid params`); a tool reporting failure is distinguished from a transport failure.
- **Survives timeouts without pipe corruption** — directly asserted. A hanging tool yields
  `TOOL_TIMEOUT` bounded by the configured budget, and the suite then issues a fresh `echo` call on
  the *same session* and asserts the round-trip succeeds ("and the session still works
  afterwards"). An abandoned request therefore does not desynchronise the stdio framing.

### Dynamic Invalidation — **VERIFIED**

`McpToolInvocation.test.ts:284` defines a `notifications/tools/list_changed` block; the child stub
emits the notification unsolicited (`:167`), and the suite asserts
`mcp.capabilities_updated is emitted` (`:312`). Re-discovery is therefore triggered by the
notification rather than polled, and the EventBus emission is confirmed.
`McpCapabilityDiscovery.test.ts:596` independently asserts the same event on the discovery path.

### Web Component & Store — **VERIFIED**

`McpServerExplorer.test.ts` (104/104) covers `useMcpStore` across loading, lifecycle actions,
create/update/delete, tool calling, and error surfacing; `useMcpStore — socket events` (`:406`)
asserts MCP events are recognised and applied (e.g. `mcp.server_crashed`); and
`McpServerExplorerView renders` (`:466`) plus `McpServerDetailDrawer renders` (`:512`) cover render
output, alongside the modal's parsers and the drawer's formatters.

### Full Monorepo Regression — **VERIFIED (with Finding 1)**

28 / 28 suites and 2,153 / 2,153 assertions on a clean run. No regression attributable to P6-03 in
any package.

### QA Role Only — **RESPECTED**

No product code, test code, or expectation modified; repository working tree never written to.

---

## Findings

### Finding 1 — `relay-client.test.ts` is flaky under parallel battery load

Severity: **MEDIUM–HIGH** — makes `pnpm run test` non-deterministic; directly threatens the "0
failures" criterion.
Confidence: **CONFIRMED** (8 battery runs across two SHAs).
Attribution: **PRE-EXISTING**, not introduced by P6-03.

Observed results:

| SHA | Battery runs | Failures | Failure detail |
|---|---|---|---|
| `93c2a76` (this gate) | 5 | **2** | 17/23 — the whole "Core is running" happy-path block |
| `94e87c9` (previous gate) | 3 | **1** | 22/23 — a single timing-bound assertion |

Run standalone, the suite passes **23/23 deterministically**:

```
pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/relay-client.test.ts
→ 23/23 assertions passed
```

Root cause: `packages/mcp-memory-server/src/relay-client.ts:9` sets `RELAY_TIMEOUT_MS = 500`, and
`:71` hard-aborts the request with an `AbortController` at that deadline. The test posts to a
locally spawned fake Core over loopback. Under `turbo run test`, several packages' suites run
concurrently on a 4-core machine; when CPU contention pushes the loopback round-trip past 500 ms,
the abort fires, no request is recorded, and the six happy-path assertions fail together:

```
FAIL  it reports success                — expected true, got false
FAIL  exactly one request was made      — expected 1, got 0
FAIL  to the internal endpoint          — expected "/api/v1/internal/memory-events", got undefined
FAIL  carrying the descriptor token     — expected "good-token", got undefined
FAIL  and the event type                — expected "memory.decision_created", got undefined
FAIL  and the payload                   — expected "proj-a", got undefined
```

The 500 ms budget is a reasonable *product* setting (a memory server should not block on an absent
Core), so the defect is in the test's dependence on wall-clock behaviour under load, not in
`relay-client.ts`. P6-03 did not introduce it, but P6-03 raised the load — two extra suites and 147
extra assertions — which is consistent with the higher observed failure rate at this SHA.

Practical impact: on this hardware a given `pnpm run test` has roughly a 2-in-5 chance of reporting
red for reasons unrelated to the change under test. Remediation is the implementer's call; the
usual approach is to inject the timeout for the happy-path cases so the assertion does not race a
real deadline, keeping the real 500 ms budget only for the tests that specifically assert
fail-fast behaviour.

### Finding 2 — `pnpm run test` still fails on a clean checkout (carry-over, unaddressed)

Severity: **MEDIUM** — reproducibility.
Confidence: **CONFIRMED** at `93c2a76`.

Reported against TEST-P6-02 and still present: `turbo.json` declares
`"test": {"dependsOn": ["^build"]}` — upstream dependencies only, not the package's own build.
`@asterim/mcp-memory-server`'s `stdio_scaffold.test.ts` spawns its own built `dist/index.js`, so on
a fresh clone the first `pnpm run test` fails before any real assertion runs. This gate avoided it
by running `build` before `test`; that ordering is not encoded anywhere.

Suggested remediation: `"test": {"dependsOn": ["^build", "build"]}`.

### Finding 3 — `GracefulShutdown.ts` still has no automated coverage (carry-over, unaddressed)

Severity: **MEDIUM** — verified behaviour, unguarded against regression.
Confidence: **CONFIRMED** at `93c2a76`.

`GracefulShutdown.ts` is still referenced only by `index.ts` and itself; no suite in the 28-suite
battery exercises `runShutdownSequence()`, and the `resetShutdownStateForTests()` seam remains
unused. The behaviour was verified by live probe during TEST-P6-02 (child termination,
`server.json` removal, WAL checkpoint, port closure) and was not re-probed here, as P6-03 does not
touch the shutdown path.

### Finding 4 — Step 4 timing expectation remains unachievable cold (carry-over)

Severity: **LOW** — gate documentation accuracy.
Confidence: **CONFIRMED**.

"7 / 7 Turbo packages build successfully in under 10 seconds" — measured 38.5 s cold, ~100 ms warm.
The substantive criterion passes; the timing figure describes a cached build.

### Finding 5 — Server log escapes `ASTERIM_DATA_DIR` (carry-over, unaddressed)

Severity: **LOW** — pre-existing, outside P6-03 scope.
Confidence: **CONFIRMED** at `93c2a76`.

`apps/server/src/utils/logger.ts:8` still hardcodes `path.join(os.homedir(), '.asterim')`,
ignoring `ASTERIM_DATA_DIR`, and truncates `server.log` on every startup so concurrent instances
clobber each other's logs.

---

## Acceptance Criteria Review

Criteria are those of `tests/current.md` §3, verified against the isolated `93c2a76` snapshot.

- [x] **Step 1 — `pnpm run typecheck`: 0 errors across 11 Turbo tasks**
      VERIFIED. 11/11 tasks, 0 errors, uncached.
- [x] **Step 1 — `pnpm run lint`: 0 errors across 7 workspace packages**
      VERIFIED. 7/7 packages, 0 errors, 568 pre-existing warnings (criterion is 0 errors).
- [x] **Step 2 — `McpToolInvocation.test.ts`: 43 / 43 assertions**
      VERIFIED. 43/43, exit 0.
- [x] **Step 2 — `McpServerExplorer.test.ts`: 104 / 104 assertions**
      VERIFIED. 104/104, exit 0.
- [x] **Step 3 — All 28 suites pass, 0 failures across 2,153+ assertions**
      VERIFIED on a clean run: 28/28 suites, 2,153/2,153 assertions. Sub-criteria:
  - [x] `asterim` (Server) 14 suites / 1,172 assertions — 1,172/1,172
  - [x] `@asterim/mcp-memory-server` 7 suites / 348 assertions — 348/348
  - [x] `@asterim/web` 5 suites / 539 assertions — 539/539
  - [x] `@asterim/relay` 1 suite / 71 assertions — 71/71
  - [x] `@asterim/adapters` 1 suite / 23 assertions — 23/23
  - Caveats: not reliably reproducible (Finding 1, 2 of 5 runs red); requires a prior
    `pnpm run build` on a clean checkout (Finding 2).
- [x] **Step 4 — 7 / 7 Turbo packages build successfully**
      VERIFIED. 7/7 built. Timing sub-expectation not met cold (38.5 s); met warm (Finding 4).

Mandates from `tests/current.md` §2:

- [x] **QA Role Only** — nothing modified; working tree never written to.
- [x] **Full Monorepo Regression** — 28/28 suites, no P6-03 regression (Finding 1 caveat).
- [x] **Tool Invocation Verification** — `tools/call` executes against real stdio children, returns
      structured content, distinguishes tool-reported failure from transport failure, times out as
      `TOOL_TIMEOUT`, and the session remains usable afterwards (no pipe corruption).
- [x] **Dynamic Invalidation Verification** — an unsolicited `notifications/tools/list_changed`
      triggers re-discovery and emits `mcp.capabilities_updated` on the EventBus.
- [x] **Web Component & Store Verification** — `useMcpStore` and the explorer/drawer/modal
      components render correctly and react to MCP socket events.

---

## Verification Summary

| Step | Criterion | Result |
|---|---|---|
| 1 | typecheck, 0 errors, 11 tasks | **PASS** |
| 1 | lint, 0 errors, 7 packages | **PASS** |
| 2 | tool invocation 43/43 | **PASS** |
| 2 | web explorer 104/104 | **PASS** |
| 3 | 28 suites, 2,153 assertions | **PASS** (flaky — Finding 1) |
| 4 | 7/7 packages build | **PASS** |
| §2 | tool invocation verification | **PASS** |
| §2 | dynamic invalidation verification | **PASS** |
| §2 | web component & store verification | **PASS** |

Gate verdict: **VERIFIED**.

Every acceptance criterion of TEST-P6-03 is met at `93c2a76`. The P6-03 work itself is clean: both
new suites pass at their stated counts, all three feature mandates are covered by real-process
tests rather than mocks, and no regression appeared anywhere in the battery. The one reliability
defect (Finding 1) is pre-existing, reproducible at the prior SHA, and unrelated to the code under
test — but it is the most actionable item here, because it makes the gate's own Step 3 criterion
non-deterministic.

---

## Recommendation

1. **Pass the gate.** P6-03 is verified at `93c2a76`.
2. **Fix Finding 1 first.** A battery that is red 2 runs in 5 for timing reasons will erode trust in
   every future gate and will mask a real regression when one appears. This is now the highest-value
   test-infrastructure fix in the repo.
3. **Fix Finding 2** — add `"build"` to the `test` task's `dependsOn`. Both this and Finding 1 are
   prerequisites for ever running `test` in CI, which currently runs only `lint` and `build`.
4. **Close Finding 3** — add a suite over `runShutdownSequence()`; the seam already exists. Three
   gates have now passed with shutdown correctness resting on a manual probe.
5. **Correct Finding 4** in the gate template — state the build budget as warm (~100 ms) vs cold
   (~30–60 s).
6. **Process**: three consecutive gates have been issued against a tree under active edit. Isolation
   via `git archive` works and is now routine, but it costs a dependency install and a duplicated
   run each time. Issuing gates against a committed SHA with the implementer paused would remove
   that cost.

## Recommended Next Step

Report TEST-P6-03 **VERIFIED** to the orchestrator, then address Findings 1 and 2 before the next
gate so that gate can trust a single battery run. The P6-04 work already in the working tree
(`McpAgentBridge` with schema validation, per-server invocation queueing, and unified auth headers,
plus `McpAgentBridge.test.ts` and `apps/web/src/utils/auth.ts`) is uncommitted and unassessed; it
should be the subject of TEST-P6-04.
