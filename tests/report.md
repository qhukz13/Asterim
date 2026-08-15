# TEST REPORT

Task:
TEST-P6-04 — Agent Tool Bridge, Schema Validation & Per-Server Queueing Gate

Status:
VERIFIED (with one non-blocking reliability defect — see Finding 1)

## Environment

Repository state:
`a258536` on `main` (implementation committed in `f44b58d`). Working tree clean at gate start
(00:16:26); P6-05 work began landing at 00:59 (see §"Snapshot Isolation"). Certified results below
come from an **isolated pristine export of `a258536`**.

Relevant packages:
`asterim` (apps/server), `@asterim/web`, `@asterim/marketing`, `@asterim/relay`,
`@asterim/shared`, `@asterim/adapters`, `@asterim/mcp-memory-server`

Node version:
v24.13.1 · **4 CPU cores** (material to Finding 1)

Package manager:
pnpm 9.0.0 (turbo monorepo)

Other relevant environment information:
- Every turbo task was run with `--force`; no result below comes from a cache hit.
- No product code, test code, or test expectation was modified. The repository working tree was
  never written to; the export was produced with `git archive` (no `.git` mutation). The only file
  this pass writes is this report.
- The full battery was executed **6 times** at this SHA to characterise Finding 1.
- One QA harness was written to the session scratchpad (never to the repository) to verify the
  unified-auth mandate, which has no automated coverage — see §"Mandate Verification".

---

## Snapshot Isolation

For the fourth consecutive gate, implementation work landed in the working tree during execution.

| Time | Event |
|---|---|
| 00:16:26 | Gate start — `git status` **clean** at `a258536` |
| 00:59–01:00 | P6-05 work: `McpToolGateway.ts`, `McpToolPrompt.ts`, `AgentMcpIntegration.test.ts`, plus `AgentService.ts`, `ApprovalManager.ts`, `BaseAdapter.ts`, `SessionManager.ts` |

The gate was executed against a pristine export, as in the two prior gates:

```bash
git archive a258536 | tar -x -C <scratch>/gate-a258536
pnpm install --frozen-lockfile
```

Integrity confirmed by comparing `McpAgentBridge.test.ts` against `git show a258536:…`
(md5 `d2647f75f0ae`, identical). The export wires 15 server suites and 5 web suites; with
mcp-memory-server (7), relay (1) and adapters (1) that is 29, matching the gate. The uncommitted
P6-05 work is **out of scope** and was not assessed.

---

## Tests Executed

### Step 1 — Full monorepo typecheck & lint

`npx turbo run typecheck --force` — **PASS**. 11 / 11 Turbo tasks, **0 TypeScript errors**. 1 m 13 s.

`npx turbo run lint --force` — **PASS**. 7 / 7 workspace packages, **0 ESLint errors**, 567 warnings.

| Package | Errors | Warnings |
|---|---|---|
| `@asterim/web` | 0 | **265** |
| `asterim` | 0 | 241 |
| `@asterim/adapters` | 0 | 28 |
| `@asterim/marketing` | 0 | 18 |
| `@asterim/mcp-memory-server` | 0 | 12 |
| `@asterim/shared` | 0 | 3 |

The implementer's claim that `apps/web` dropped to 265 — one *fewer* than after P6-03 — is
confirmed: I measured 266 at `93c2a76` and 265 here, consistent with typing the MCP socket handler
in `useSocket.ts`.

### Step 2 — MCP Agent Bridge & Schema Validation suite

| Suite | Expected | Actual | Result |
|---|---|---|---|
| `McpAgentBridge.test.ts` | 67 / 67 | **67 / 67** | PASS (exit 0) |

Matches the gate exactly. Wired into the `asterim` `"test"` script.

### Step 3 — Full monorepo test battery

`npx turbo run test --force` — **PASS on a clean run**: 29 / 29 suites, **2,220 / 2,220
assertions**, 9 / 9 Turbo tasks.

| Package | Suites | Expected | Actual | Result |
|---|---|---|---|---|
| `asterim` (Server) | 15 | 1,239 | 1,239 / 1,239 | PASS |
| `@asterim/mcp-memory-server` | 7 | 348 | 348 / 348 | PASS |
| `@asterim/web` | 5 | 539 | 539 / 539 | PASS |
| `@asterim/relay` | 1 | 71 | 71 / 71 | PASS |
| `@asterim/adapters` | 1 | 23 | 23 / 23 | PASS |
| **Total** | **29** | **2,220** | **2,220 / 2,220** | **PASS** |

Server breakdown (15): 63, 60, 140, 52, 51, 64, 89, 21, 231, 52, 102, 115, 89, 43, **67** = 1,239.
Web breakdown (5): 151, 37, 134, 113, 104 = 539.

**This step is not reliably green: 2 of 6 battery runs failed**, always in
`@asterim/mcp-memory-server`. See Finding 1, which this gate escalates from "observed flakiness" to
a causally demonstrated defect.

### Step 4 — Full production build

`npx turbo run build --force` — **PASS**. **7 / 7** Turbo packages built. 41.0 s cold, ~100 ms warm.

---

## Mandate Verification (§2)

### Schema Validation — **VERIFIED**

`validateToolArguments` is covered by 22 assertions across three blocks (happy paths, what it
catches, it never throws). The mandate's "detailed field paths" requirement is asserted literally:

- missing required field → `['read_file.path: required']` — the field is *named*, not merely counted
- wrong type → error includes `expected string, received integer`
- enum violation → error lists the permitted values (`"utf8"`)
- **every problem reported, not just the first** → two errors returned for one bad call
- `integer` vs `number` distinguished in both directions (`limit: 1.5` rejected; `n: 3` accepted)
- nested objects and array items carry a path (e.g. `filter.minSize`)

The "never throws" block covers a self-referential schema, a non-object schema, and unknown
keywords — all returning permissive rather than crashing, which matches the task's §6 prohibition.

### Queue Safety — **VERIFIED**

The serialisation claim is proven the only way that counts: the test's child process itself tracks
`inFlight` and reports whether it ever saw two calls open at once. Across five concurrent calls,
`answers.every(answer => answer.overlapped === false)` holds, calls are served 1–5 in order, and
each receives its own arguments. This is a genuine anti-collision proof, not an inference from
timing.

Slot-leak safety is covered separately and correctly:

- after a **timed-out** call, `queueDepth()` is 0 **and** "the next call is served normally" — the
  latter being the assertion that actually distinguishes a `finally` release from a `catch` release
- at depth 2, a fourth call is refused `QUEUE_FULL`, the queue then empties, and "the server is
  still usable"

### Unified Auth — **VERIFIED BY INDEPENDENT PROBE** (no repository coverage)

`getAuthHeaders` has **zero automated test coverage**: no file under any `__tests__` directory
references it. The implementer verified it manually in a browser (their §4.4), which is real
evidence but leaves the behaviour unguarded and unverifiable by `pnpm run test`.

Because the mandate requires confirming it, I verified it directly with a scratchpad harness that
imports `apps/web/src/utils/auth.ts` unmodified and supplies only the browser globals it expects.
**15 / 15 probe assertions passed:**

| Scenario | Result |
|---|---|
| Backend resolves to the serving host; key is per-backend | PASS |
| Legacy plain `asterim_token` only → found and sent as bearer | PASS |
| Per-backend `asterim_token_<url>` only, legacy deleted → found and sent | PASS |
| Both present → **per-backend wins** | PASS |
| Preferred remote workstation from `asterim_workstation_config` → remote token used, not legacy | PASS |
| Explicit backend url overrides resolution and selects that token | PASS |
| `getAuthHeaders(true)` adds `Content-Type: application/json` | PASS |
| No token → no `Authorization` header | PASS |
| Malformed config JSON → falls back to serving host, still returns a usable header | PASS |

Both conventions named in the mandate resolve correctly, in the stated precedence.

### Full Monorepo Regression — **VERIFIED (with Finding 1)**

29 / 29 suites and 2,220 / 2,220 assertions on a clean run. No regression attributable to P6-04.

### QA Role Only — **RESPECTED**

Nothing in the repository was modified; the working tree was never written to.

---

## Cross-Check of `reports/current.md`

The implementer's report was checked against measurement. Every quantitative claim holds:

| Claim (reports/current.md) | Verified |
|---|---|
| `McpAgentBridge.test.ts` 67/67 | ✅ 67/67 |
| 29 suites / 2,220 assertions | ✅ exactly |
| typecheck 11/11, 0 errors | ✅ |
| lint 7/7, 0 errors | ✅ |
| build 7/7 | ✅ |
| `apps/server` 241 warnings, `apps/web` **265** (one fewer than P6-03) | ✅ both |
| §7.1 "`McpAgentBridge` has no caller" | ✅ confirmed — no reference outside the module and its own suite |

The §7.1 self-disclosure is accurate and worth restating: P6-04 ships a seam, not a working agent
capability. Nothing in `AgentService` or any adapter invokes the bridge, and no route exposes it.
That is consistent with the task's scope and is the declared subject of P6-05.

**One claim is incomplete rather than wrong.** §4.1 presents `pnpm run test → 9 successful, 9 total
… exit 0` as a settled result. A passing run does exist — I reproduced it — but the battery is red
on roughly a third of runs for reasons unrelated to P6-04 (Finding 1). The implementer's gate
evidence appears to rest on a single run; a single green run does not establish that this battery
is green.

---

## Findings

### Finding 1 — `relay-client.test.ts` flakiness is now causally demonstrated (ESCALATED)

Severity: **HIGH** — makes `pnpm run test` non-deterministic; defeats the gate's own Step 3
criterion. Flagged in TEST-P6-03, unaddressed since.
Confidence: **CONFIRMED — deterministic reproduction available.**
Attribution: **PRE-EXISTING**, not introduced by P6-04.

Observed across three gates:

| SHA | Battery runs | Failures |
|---|---|---|
| `94e87c9` (TEST-P6-02) | 3 | 1 |
| `93c2a76` (TEST-P6-03) | 5 | 2 |
| `a258536` (this gate) | 6 | **2** |

Previously this could only be reported as intermittent. It can now be **triggered on demand**.
Idle, the suite passes deterministically; under CPU contention it fails on exactly the same six
assertions:

```bash
# idle
pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/relay-client.test.ts
→ 23/23 assertions passed

# with 8 spinner processes on 4 cores
→ FAIL  it reports success / exactly one request was made / to the internal endpoint
        / carrying the descriptor token / and the event type / and the payload
```

Root cause: `packages/mcp-memory-server/src/relay-client.ts:9` sets `RELAY_TIMEOUT_MS = 500`, and
`:71` hard-aborts via `AbortController` at that deadline. The test posts to a locally spawned fake
Core over loopback. When `turbo run test` saturates a 4-core machine, the round-trip exceeds 500 ms,
the abort fires, no request is recorded, and the entire "Core is running" happy-path block fails
together.

The 500 ms budget is correct *product* behaviour — a memory server must not block on an absent
Core. The defect is that the test races a real wall-clock deadline it does not control. The usual
remedy is to inject the timeout for the happy-path cases, reserving the real 500 ms only for the
tests that specifically assert fail-fast behaviour.

This is now the highest-value test-infrastructure fix in the repository. Three consecutive gates
have had to distinguish this noise from real regressions by hand; the next one that coincides with
a genuine failure will be materially harder to adjudicate.

### Finding 2 — `getAuthHeaders` has no automated coverage (NEW)

Severity: **MEDIUM** — a mandated behaviour with no standing guard.
Confidence: **CONFIRMED**.

No test under any `__tests__` directory references `getAuthHeaders`, `getAuthToken`,
`tokenStorageKey`, or `resolveBackendUrl`, despite `apps/web/src/utils/auth.ts` being new in P6-04
and named directly in the gate's mandates. Twelve call sites across the dashboard now depend on it,
including both zustand stores.

The behaviour is correct — my probe confirms all 15 cases including the dual-key precedence the
mandate names — but a regression in token resolution would log every user out and no suite would
catch it. The module is pure and dependency-free apart from `localStorage` and `window.location`,
so it is unusually cheap to test; the probe I wrote is ~90 lines and could be adapted directly.

### Finding 3 — `pnpm run test` still fails on a clean checkout (carry-over, 3rd gate)

Severity: **MEDIUM** — reproducibility.
Confidence: **CONFIRMED** at `a258536`.

`turbo.json` still declares `"test": {"dependsOn": ["^build"]}` — upstream dependencies only, not
the package's own build. `@asterim/mcp-memory-server`'s `stdio_scaffold.test.ts` spawns its own
built `dist/index.js`, so on a fresh clone the first `pnpm run test` fails before any real
assertion runs. This gate avoided it by running `build` first; that ordering is encoded nowhere.

Suggested remediation: `"test": {"dependsOn": ["^build", "build"]}`.

### Finding 4 — `GracefulShutdown.ts` still has no automated coverage (carry-over, 3rd gate)

Severity: **MEDIUM** — verified behaviour, unguarded.
Confidence: **CONFIRMED** at `a258536`.

Still no suite exercises `runShutdownSequence()`; the `resetShutdownStateForTests()` seam remains
unused. `index.ts:197–198` still installs it correctly, and the behaviour was verified by live probe
during TEST-P6-02 (child termination, `server.json` removal, WAL checkpoint, port closure). Not
re-probed here, as P6-04 does not touch the shutdown path.

### Finding 5 — Step 4 timing expectation remains unachievable cold (carry-over)

Severity: **LOW** — gate documentation accuracy.

"7 / 7 Turbo packages build successfully in under 10 seconds" — measured 41.0 s cold, ~100 ms warm.

### Finding 6 — Server log escapes `ASTERIM_DATA_DIR` (carry-over)

Severity: **LOW** — pre-existing, outside P6-04 scope.

`apps/server/src/utils/logger.ts` still hardcodes `os.homedir()/.asterim` and truncates
`server.log` on every startup, so concurrent instances clobber each other's logs.

---

## Acceptance Criteria Review

Criteria are those of `tests/current.md` §3, verified against the isolated `a258536` snapshot.

- [x] **Step 1 — `pnpm run typecheck`: 0 errors across 11 Turbo tasks**
      VERIFIED. 11/11 tasks, 0 errors, uncached.
- [x] **Step 1 — `pnpm run lint`: 0 errors across 7 workspace packages**
      VERIFIED. 7/7 packages, 0 errors, 567 pre-existing warnings (criterion is 0 errors).
- [x] **Step 2 — `McpAgentBridge.test.ts`: 67 / 67 assertions**
      VERIFIED. 67/67, exit 0, covering schema validation, queue serialisation, namespacing and
      error formatting as the gate specifies.
- [x] **Step 3 — All 29 suites pass, 0 failures across 2,220+ assertions**
      VERIFIED on a clean run: 29/29 suites, 2,220/2,220 assertions. Sub-criteria:
  - [x] `asterim` (Server) 15 suites / 1,239 assertions — 1,239/1,239
  - [x] `@asterim/mcp-memory-server` 7 suites / 348 assertions — 348/348
  - [x] `@asterim/web` 5 suites / 539 assertions — 539/539
  - [x] `@asterim/relay` 1 suite / 71 assertions — 71/71
  - [x] `@asterim/adapters` 1 suite / 23 assertions — 23/23
  - Caveats: red on 2 of 6 runs (Finding 1); requires a prior `pnpm run build` on a clean
    checkout (Finding 3).
- [x] **Step 4 — 7 / 7 Turbo packages build successfully**
      VERIFIED. 7/7 built. Timing sub-expectation not met cold (41.0 s); met warm (Finding 5).

Mandates from `tests/current.md` §2:

- [x] **QA Role Only** — nothing modified; working tree never written to.
- [x] **Full Monorepo Regression** — 29/29 suites, no P6-04 regression (Finding 1 caveat).
- [x] **Schema Validation & Queue Safety** — `SchemaValidator` rejects malformed arguments naming
      each field with a path and reports all problems at once; `SerialQueue` serialises concurrent
      calls with the child process itself confirming zero overlap, and releases its slot on
      timeout, failure and queue-full alike.
- [x] **Unified Auth Verification** — `getAuthHeaders` resolves both `asterim_token` and
      `asterim_token_<url>`, with the per-backend key taking precedence. Verified by independent
      probe (15/15); **no repository coverage exists** (Finding 2).

---

## Verification Summary

| Step | Criterion | Result |
|---|---|---|
| 1 | typecheck, 0 errors, 11 tasks | **PASS** |
| 1 | lint, 0 errors, 7 packages | **PASS** |
| 2 | agent bridge 67/67 | **PASS** |
| 3 | 29 suites, 2,220 assertions | **PASS** (flaky — Finding 1) |
| 4 | 7/7 packages build | **PASS** |
| §2 | schema validation & queue safety | **PASS** |
| §2 | unified auth | **PASS** (by probe; unguarded) |

Gate verdict: **VERIFIED**.

Every acceptance criterion of TEST-P6-04 is met at `a258536`. The P6-04 work is of high quality:
the queue's anti-collision property is proven by the child process rather than inferred, the
slot-release assertion is the one that actually discriminates `finally` from `catch`, and the
validator's error paths are asserted literally rather than by count. The implementer's report is
accurate on every quantitative claim I checked, and its §7.1 disclosure that the bridge has no
caller is both true and appropriately surfaced.

The blocking risk is not in P6-04. It is that the battery this gate depends on is red about a
third of the time for reasons no one has fixed across three gates.

---

## Recommendation

1. **Pass the gate.** P6-04 is verified at `a258536`.
2. **Fix Finding 1 before P6-05.** It is now reproducible on demand, so it is cheap to fix and
   cheap to confirm fixed. Every further gate is degraded until it is done.
3. **Close Finding 2** — add a suite for `apps/web/src/utils/auth.ts`. It is pure, has twelve
   dependents, and governs whether users stay logged in; the probe written for this gate covers the
   cases and can be adapted.
4. **Fix Finding 3** — add `"build"` to the `test` task's `dependsOn`. With Findings 1 and 3 fixed,
   `test` could finally join `lint` and `build` in CI, which would prevent this class of drift
   entirely.
5. **Close Finding 4** — add a suite over `runShutdownSequence()`; the seam already exists. Four
   gates have now passed with shutdown correctness resting on one manual probe.
6. **Correct Finding 5** in the gate template — state the build budget as warm (~100 ms) vs cold
   (~40 s).

## Recommended Next Step

Report TEST-P6-04 **VERIFIED** to the orchestrator, then fix Findings 1 and 3 so the next gate can
trust a single battery run. The P6-05 work already in the working tree (`McpToolGateway.ts`,
`McpToolPrompt.ts`, `AgentMcpIntegration.test.ts`, plus changes to `AgentService`,
`ApprovalManager`, `BaseAdapter` and `SessionManager`) is uncommitted and unassessed — it appears to
be the bridge-to-agent wiring plus approval gating that `reports/current.md` §9 recommends, and
should be the subject of TEST-P6-05.
