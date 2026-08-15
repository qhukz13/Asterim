# TEST REPORT

Task:
TEST-P6-02 — MCP Full Lifecycle, Capability Discovery & Regression Gate

Status:
VERIFIED

## Environment

Repository state:
`94e87c9` on `main`. Working tree clean at gate start (22:20:06). The tree became dirty with
P6-03 work during execution (see §"Snapshot Isolation"), so the certified results below were
produced against an **isolated pristine export of `94e87c9`**, immune to concurrent editing.

Relevant packages:
`asterim` (apps/server), `@asterim/web`, `@asterim/marketing`, `@asterim/relay`,
`@asterim/shared`, `@asterim/adapters`, `@asterim/mcp-memory-server`

Node version:
v24.13.1

Package manager:
pnpm 9.0.0 (turbo monorepo)

Other relevant environment information:
- Every turbo task was run with `--force`; no result below comes from a cache hit.
- No test runner exists in the repository; every suite is a standalone `tsx` script that exits
  non-zero on failure. CI (`.github/workflows/ci.yml`) runs only `lint` and `build`, so none of
  these suites run in CI.
- No product code, test code, or test expectation was modified by this QA pass. The repository
  working tree was never written to; the isolated export was produced with `git archive`, which
  performs no `.git` mutation.
- A pre-existing dev server (pid 373376) was listening on :3000 throughout. All probes used
  dedicated ports (39117–39141) and dedicated `ASTERIM_DATA_DIR` paths, so it did not interfere.

---

## Snapshot Isolation

The previous gate (TEST-P6-01) was blocked because the implementation was rewritten mid-run. The
same pattern recurred here: after a clean start at `94e87c9`, P6-03 work began landing in the
working tree while the steps executed.

| Time | Event |
|---|---|
| 22:20:06 | Gate start — `git status` **clean** at `94e87c9` |
| 22:21:55 | `McpStdioClient.ts` modified (during Step 1 lint) |
| 22:23:23 | `routes/mcp.ts`, `McpCapabilityDiscovery.test.ts` modified (during Step 2) |
| 22:25:38 | `McpProcessSupervisor.ts`, new `McpToolInvocation.test.ts` (during Step 3/4) |
| 22:26:50 | `apps/web/src/stores/useMcpStore.ts`, `apps/web/src/components/mcp/` |

Rather than certify a result that straddled five tree states, the whole gate was re-executed
against a pristine export:

```bash
git archive 94e87c9 | tar -x -C <scratch>/gate-94e87c9
pnpm install --frozen-lockfile
```

Export integrity was confirmed by comparing `McpProcessSupervisor.ts` against
`git show 94e87c9:…` (md5 `2742a194b097`, identical). **Every result in this report is from that
isolated snapshot** and is reproducible from the SHA alone. The in-repo run produced identical
pass/fail outcomes and identical assertion counts, which corroborates the isolated result.

The uncommitted P6-03 work in the live tree (MCP tool invocation engine, web management UI,
`McpToolInvocation.test.ts`) is **out of scope for this gate** and was not assessed.

---

## Tests Executed

### Step 1 — Full monorepo typecheck & lint

`npx turbo run typecheck --force` — **PASS**. 11 / 11 Turbo tasks successful, **0 TypeScript
errors**. 1 m 27 s cold.

`npx turbo run lint --force` — **PASS**. 7 / 7 workspace packages, **0 ESLint errors**, 558
warnings.

| Package | Errors | Warnings |
|---|---|---|
| `@asterim/web` | 0 | 256 |
| `asterim` | 0 | 241 |
| `@asterim/adapters` | 0 | 28 |
| `@asterim/marketing` | 0 | 18 |
| `@asterim/mcp-memory-server` | 0 | 12 |
| `@asterim/shared` | 0 | 3 |

All warnings are pre-existing and overwhelmingly `@typescript-eslint/no-explicit-any`; one is an
unused `eslint-disable` directive in `@asterim/web`. None are attributable to P6-01/P6-02 and none
are gate-blocking, since the criterion is 0 errors.

### Step 2 — MCP Capability Discovery & Process Supervisor suites

| Suite | Expected | Actual | Result |
|---|---|---|---|
| `McpProcessSupervisor.test.ts` | 115 / 115 | **115 / 115** | PASS (exit 0) |
| `McpCapabilityDiscovery.test.ts` | 89 / 89 | **89 / 89** | PASS (exit 0) |

The 23 failures reported against TEST-P6-01 are **resolved**. Root cause then was that the
supervisor had begun gating `RUNNING` on a successful `initialize` handshake while the P6-01
fixtures were bare `setInterval(() => {}, 1000)` processes that could never answer. The fixtures
have since been migrated: `McpProcessSupervisor.test.ts:80` now defines an `MCP_STUB` that answers
`initialize` and `tools/list`, and `STAY_ALIVE` composes it (`:107`).

Critically, the fix was made on the *test* side, not by weakening the product: the
`STARTING → INITIALIZING → RUNNING` gate is intact in `McpProcessSupervisor.ts` (`:493` sets
`INITIALIZING`, `:495` awaits `handshake()`, `:496` sets `RUNNING` only on success). The handshake
path is genuinely exercised rather than bypassed.

### Step 3 — Full monorepo test battery

`npx turbo run test --force` — **PASS**. 26 / 26 suites, **2,006 / 2,006 assertions**, 0 failures.

| Package | Suites | Expected | Actual | Result |
|---|---|---|---|---|
| `asterim` (Server) | 13 | 1,129 | 1,129 / 1,129 | PASS |
| `@asterim/mcp-memory-server` | 7 | 348 | 348 / 348 | PASS |
| `@asterim/web` | 4 | 435 | 435 / 435 | PASS |
| `@asterim/relay` | 1 | 71 | 71 / 71 | PASS |
| `@asterim/adapters` | 1 | 23 | 23 / 23 | PASS |
| **Total** | **26** | **2,006** | **2,006 / 2,006** | **PASS** |

Server suite breakdown (13): 63, 60, 140, 52, 51, 64, 89, 21, 231, 52, 102, **115** (supervisor),
**89** (capability discovery) = 1,129. `McpCapabilityDiscovery.test.ts` is now wired into the
`asterim` `"test"` script — the open Definition-of-Done item flagged in the previous report is
closed. No regression was observed in any package.

One caveat applies to this step; see Finding 1.

### Step 4 — Full production build

`npx turbo run build --force` — **PASS**. **7 / 7** Turbo packages built successfully.

Enumerated: `@asterim/shared`, `@asterim/adapters`, `@asterim/relay`, `@asterim/web`,
`@asterim/marketing`, `asterim`, `@asterim/mcp-memory-server`. (`@asterim/eslint-config` has no
`build` script and is correctly absent.)

Timing: **57.8 s cold** in the isolated export, 26.9 s cold in the warm-cached repo, **104 ms warm**
(`FULL TURBO`). The gate's "under 10 seconds" expectation is achievable only warm; see Finding 3.

Note: an intermediate invocation may report "4 successful, 4 total" when turbo schedules a partial
task graph. Enumerating the emitted task prefixes confirms all seven build tasks execute.

---

## Mandate Verification (§2)

### Capability Discovery — **VERIFIED**

Confirmed by suite (89/89) and by live execution. In the shutdown probe the Core autostarted a
real stdio child that negotiated the handshake, logging:

```
[MCP] Autostarting 1 enabled server(s)
[MCP] Spawned probe-stub (pid 375425)
[MCP] probe-stub ready: 0 tool(s), 0 resource(s), 0 prompt(s)
[MCP] Autostart complete: 1/1 ready
```

`RUNNING` is reached only after `initialize` succeeds and tools/resources/prompts are enumerated.

### Unified Graceful Shutdown — **VERIFIED BY REAL EXECUTION**

`GracefulShutdown.ts` has **no automated test coverage** (it is referenced only by `index.ts`, and
its `resetShutdownStateForTests()` seam is unused). Because the gate mandates confirming this
behaviour, it was verified empirically.

Method: pristine build from the isolated export; dedicated `ASTERIM_DATA_DIR`; port 39141; an
enabled `mcp_servers` row seeded so boot-time autostart spawns a marker-identified MCP stub;
`SIGTERM` to the Core; before/after observation of processes, port, and files. Parentage was
confirmed (`ppid` of the child == Core pid), so the observed child was genuinely supervisor-spawned
rather than a stale process.

| Observable | Before SIGTERM | After SIGTERM | Verdict |
|---|---|---|---|
| MCP child process | pid 385053 (ppid = Core) | gone, count 0 | PASS |
| Listening port 39141 | 1 | 0 | PASS |
| `server.json` | present | absent | PASS |
| SQLite `-wal` | present | absent (checkpointed) | PASS |
| Core process | alive | exited | PASS |

Log confirmation: `[Shutdown] SIGTERM: closing Asterim` → `[MCP] Stopping 1 MCP server(s)` →
`[Shutdown] Complete`. All four mandated effects — child termination, `server.json` removal, WAL
checkpoint, port closure — are confirmed. Reproduced twice (repo build and pristine build).

### Full Monorepo Regression — **VERIFIED**

26 / 26 suites, 2,006 / 2,006 assertions, no regression in any package.

### QA Role Only — **RESPECTED**

No product code, test code, or expectation was modified. The repository working tree was not
written to at any point; all probes ran in the session scratchpad against isolated data
directories. The only file this pass writes is this report.

---

## Findings

### Finding 1 — `pnpm run test` fails on a clean checkout (missing self-build dependency)

Severity: **MEDIUM** — reproducibility / onboarding; does not affect the gate verdict.
Confidence: **CONFIRMED** (observed on the pristine export, then resolved by building first).

On a freshly exported `94e87c9` with dependencies installed but nothing built, the first
`pnpm run test` fails:

```
@asterim/mcp-memory-server:test:  FAIL  dist/index.js exists
                                        (run `pnpm --filter @asterim/mcp-memory-server build` first)
@asterim/mcp-memory-server:test:  0/1 assertions passed
Failed:    @asterim/mcp-memory-server#test
```

`turbo.json` declares `"test": {"dependsOn": ["^build"]}` — upstream dependencies only, not the
package's *own* build. `stdio_scaffold.test.ts` spawns the package's built `dist/index.js`, so it
requires `@asterim/mcp-memory-server#build` to have run. Running `pnpm run build` first makes the
identical command pass 348/348.

This did not surface in the live repo because `dist/` was already populated from earlier builds —
it is invisible to anyone with a warm tree and hits only clean clones. CI does not currently run
`test`, so CI is unaffected today, but adding `test` to CI would fail immediately.

Suggested remediation (implementer's call): `"test": {"dependsOn": ["^build", "build"]}`.

### Finding 2 — `GracefulShutdown.ts` has no automated test coverage

Severity: **MEDIUM** — verified behaviour, unguarded against regression.
Confidence: **CONFIRMED**.

The shutdown sequence is correct (verified above), but nothing in the 26-suite battery exercises
it. The module even exports `resetShutdownStateForTests()`, a seam that no test consumes —
suggesting a suite was planned and not written. P6-02 Acceptance Criterion 6 ("unified graceful
shutdown terminates all MCP child processes cleanly on SIGINT/SIGTERM") therefore passes on
inspection and live probe, but has no standing guard: a future change to shutdown ordering,
`serverRegistry.clear()`, or `dbService.close()` would not be caught by `pnpm run test`.

### Finding 3 — Step 4 timing expectation is unachievable cold

Severity: **LOW** — gate documentation accuracy.
Confidence: **CONFIRMED**.

`tests/current.md` §3 Step 4 expects "7 / 7 Turbo packages build successfully in under 10 seconds."
Measured: 57.8 s cold (isolated), 26.9 s cold (repo), 104 ms warm. A cold build of seven packages
including two Vite apps and three `tsc` builds cannot finish in 10 s on this hardware. The
substantive criterion (7/7 succeed) passes; the timing figure describes a cached build and should
be restated as such.

### Finding 4 — Server log escapes `ASTERIM_DATA_DIR` and is truncated per process start

Severity: **LOW** — pre-existing, outside P6-02 scope; affects shutdown diagnosability.
Confidence: **CONFIRMED**.

`apps/server/src/utils/logger.ts` monkey-patches `process.stdout.write` and `process.stderr.write`
to redirect all console output into `path.join(os.homedir(), '.asterim', 'server.log')`. Two
consequences observed during probing:

1. The path is hardcoded to the home directory and **ignores `ASTERIM_DATA_DIR`**, so an instance
   pointed at an isolated data directory still writes its log into the shared `~/.asterim` one.
2. `initLogger()` truncates the file on every startup (`fs.writeFileSync(logFile, '')`), so
   concurrent instances clobber each other's logs. During probing, starting a probe Core truncated
   the log of the dev server running on :3000, and both processes then interleaved into one file.

Only the startup banner reaches the terminal (via `printToConsole()`, which retains the original
writer); `[MCP]` and `[Shutdown]` lines are invisible on stdout. This is why the shutdown sequence
appears absent from a redirected console and must be read from `~/.asterim/server.log`. Worth
noting for operators reading container or systemd logs.

---

## Acceptance Criteria Review

Criteria are those of `tests/current.md` §3, verified against the isolated `94e87c9` snapshot.

- [x] **Step 1 — `pnpm run typecheck`: 0 errors across 11 Turbo tasks**
      VERIFIED. 11/11 tasks successful, 0 TypeScript errors, uncached.
- [x] **Step 1 — `pnpm run lint`: 0 errors across 7 workspace packages**
      VERIFIED. 7/7 packages, 0 errors, 558 pre-existing warnings (criterion is 0 errors).
- [x] **Step 2 — `McpProcessSupervisor.test.ts`: 115 / 115 assertions**
      VERIFIED. 115/115, exit 0. Previous 23 failures resolved via fixture migration, with the
      `RUNNING`-after-handshake gate left intact.
- [x] **Step 2 — `McpCapabilityDiscovery.test.ts`: 89 / 89 assertions**
      VERIFIED. 89/89, exit 0.
- [x] **Step 3 — All 26 suites pass, 0 failures across 2,006+ assertions**
      VERIFIED. 26/26 suites, 2,006/2,006 assertions. Sub-criteria:
  - [x] `asterim` (Server) 13 suites / 1,129 assertions — 1,129/1,129
  - [x] `@asterim/mcp-memory-server` 7 suites / 348 assertions — 348/348
  - [x] `@asterim/web` 4 suites / 435 assertions — 435/435
  - [x] `@asterim/relay` 1 suite / 71 assertions — 71/71
  - [x] `@asterim/adapters` 1 suite / 23 assertions — 23/23
  - Caveat: requires a prior `pnpm run build` on a clean checkout (Finding 1).
- [x] **Step 4 — 7 / 7 Turbo packages build successfully**
      VERIFIED. 7/7 built, all enumerated. Timing sub-expectation ("under 10 seconds") NOT met
      cold (57.8 s); met warm (104 ms). Recorded as Finding 3, not as a build defect.

Mandates from `tests/current.md` §2:

- [x] **QA Role Only** — no product code, test code, or expectation modified; repository working
      tree never written to.
- [x] **Full Monorepo Regression** — 26/26 suites clean, no regressions.
- [x] **Capability Discovery Verification** — JSON-RPC 2.0 `initialize` negotiated against a real
      stdio child; tools/resources/prompts enumerated; `RUNNING` reached only upon readiness.
      Confirmed by suite and by live autostart.
- [x] **Unified Graceful Shutdown** — SIGTERM terminates MCP children, removes `server.json`,
      checkpoints the SQLite WAL, and closes the port. Verified by real execution, twice.
      Unguarded by automated tests (Finding 2).

---

## Verification Summary

| Step | Criterion | Result |
|---|---|---|
| 1 | typecheck, 0 errors, 11 tasks | **PASS** |
| 1 | lint, 0 errors, 7 packages | **PASS** |
| 2 | supervisor 115/115 | **PASS** |
| 2 | capability discovery 89/89 | **PASS** |
| 3 | 26 suites, 2,006 assertions | **PASS** |
| 4 | 7/7 packages build | **PASS** |
| §2 | capability discovery verification | **PASS** |
| §2 | unified graceful shutdown | **PASS** (live probe) |

Gate verdict: **VERIFIED**.

Every acceptance criterion of TEST-P6-02 is met at `94e87c9`. The four findings above are
non-blocking: one reproducibility defect in the turbo task graph, one coverage gap over verified
behaviour, one inaccurate timing expectation in the gate document, and one pre-existing logging
inconsistency.

---

## Recommendation

1. **Pass the gate.** P6-01 and P6-02 are verified at `94e87c9`.
2. **Fix Finding 1** — add `"build"` to the `test` task's `dependsOn` in `turbo.json` so the battery
   is runnable from a clean clone. Cheap, and a prerequisite for ever adding `test` to CI.
3. **Close Finding 2** — add a suite covering `runShutdownSequence()`; the `resetShutdownStateForTests()`
   seam already exists for it. Shutdown correctness is currently verified but unguarded.
4. **Correct Finding 3** in the gate template — state the build budget as warm (~100 ms) vs cold
   (~30–60 s).
5. **Consider Finding 4** — honour `ASTERIM_DATA_DIR` in `initLogger()` and append rather than
   truncate, so concurrent instances do not destroy each other's logs.
6. **Process**: this is the second consecutive gate executed against a tree being edited
   concurrently. Gates should be issued against a committed SHA with the implementer paused, or QA
   should continue isolating via `git archive` as done here. The isolation worked, but it cost a
   full dependency install and a duplicated run.

## Recommended Next Step

Report TEST-P6-02 **VERIFIED** to the orchestrator and proceed to the P6-03 work already present in
the working tree (MCP tool invocation engine, dynamic notifications, web management UI). That work
is uncommitted and unassessed; `McpToolInvocation.test.ts` exists and has already been wired into
the `asterim` `"test"` script (now 14 server suites), but was not evaluated by this gate and should
be covered by the next one.
