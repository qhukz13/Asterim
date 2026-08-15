# TEST REPORT

Task:
TEST-P6-01 — MCP Server Supervisor & Monorepo Regression Gate

Status:
BLOCKED

## Environment

Repository state:
`dde3586` on `main`, working tree **dirty and changing throughout the entire verification window**.
6 modified files, 3 untracked files at the last observation. See §"Blocking Condition".

Relevant packages:
`asterim` (apps/server), `@asterim/web`, `@asterim/marketing`, `@asterim/relay`,
`@asterim/shared`, `@asterim/adapters`, `@asterim/mcp-memory-server`

Node version:
v24.13.1

Package manager:
pnpm 9.0.0 (turbo monorepo)

Other relevant environment information:
- Every turbo task was run with `--force`. The first `pnpm run typecheck` of the session returned
  `11/11 cached, FULL TURBO` in 115 ms; a cached pass is not evidence for a QA gate, so every
  result below comes from an uncached execution.
- No test runner exists in the repository; every suite is a standalone `tsx` script that exits
  non-zero on failure. CI runs only `lint` and `build`, so none of these suites run in CI.
- Probe scripts were written to the session scratchpad, never to the repository.
- No product code, test code, or test expectation was modified by this QA pass.

---

## Blocking Condition — the implementation was being written during the gate

`tests/current.md` assigns verification of **P6-01**. `tasks/current.md` on disk is **P6-02**
(*MCP Capability Discovery, Stdio Handshake & Boot Autostart*), and P6-02 was being actively
implemented in the working tree while this gate ran. The tree never held still long enough to
produce a single coherent verification snapshot.

Observed write timeline (mtimes, all 2026-08-15):

| Time | Event |
|---|---|
| ~21:20 | Session start — `git status` **clean** at `dde3586` |
| 21:22:27 | `McpProcessSupervisor.test.ts` written |
| 21:36–21:39 | `McpProcessSupervisor.ts`, `routes/mcp.ts`, `shared/types/mcp.ts` rewritten (338 lines) |
| 21:42:23 | Watcher reports tree quiet for 91 s — **false stabilization** |
| 21:44:21 | `McpCapabilityDiscovery.test.ts` created (new, untracked) |
| 21:46:17 | `McpProcessSupervisor.ts` rewritten again — *during the test battery* |
| 21:51:31 | `McpProcessSupervisor.test.ts` rewritten |
| 21:53:54 | `McpCapabilityDiscovery.test.ts` rewritten |

Consequence: results that depend on the tree flipped between runs and cannot be certified.

- Step 2 first execution aborted at **36/37** with an uncaught
  `TypeError: this.terminate is not a function` and `Handshake failed: McpStdioClient is not defined`.
  A module probe minutes later showed `terminate` present on the prototype and `McpStdioClient`
  exported cleanly. **That failure was an artifact of a half-written file and is not reported as a
  defect.**
- `asterim#typecheck` and `asterim#lint` each failed, then passed, then failed again — every error
  located in `McpCapabilityDiscovery.test.ts`, the file being authored at that moment.

The verdict is therefore **BLOCKED**, not PASS and not FAIL. One finding (§Finding 1) reproduced
identically across three runs at three different tree states and is reported with confidence; the
volatile results are recorded but explicitly not certified.

---

## Tests Executed

### Step 1 — Full monorepo typecheck & lint

`npx turbo run typecheck --force` — **VOLATILE, NOT CERTIFIED**

| Run | Time | Result |
|---|---|---|
| 1 | 21:35 | 11/11 tasks successful, 0 errors |
| 2 | 21:43 | `asterim#typecheck` FAILED — 5 × `TS18048`/`TS2532` in `McpCapabilityDiscovery.test.ts` |
| 3 | 21:51 | `asterim` passes (`tsc --noEmit` exit 0) |
| 4 | 21:54 | `asterim#typecheck` FAILED — `TS18046: 'init.params' is of type 'unknown'` (line 388) |

`npx turbo run lint --force` — **VOLATILE, NOT CERTIFIED**

| Run | Time | Result |
|---|---|---|
| 1 | 21:37 | 7/7 packages, **0 errors**, 558 warnings |
| 2 | 21:43 | `asterim#lint` FAILED — 1 error, `no-useless-assignment` on `fullId`, `McpCapabilityDiscovery.test.ts:389` |
| 3 | 21:53 | 7/7 packages, **0 errors**, 565 warnings |

Warning distribution at run 3 (all pre-existing, overwhelmingly `@typescript-eslint/no-explicit-any`):
`@asterim/web` 256, `asterim` 248, `@asterim/adapters` 28, `@asterim/marketing` 18,
`@asterim/mcp-memory-server` 12, `@asterim/shared` 3.

Gate expectation of "11 Turbo tasks" for typecheck is correct only when the task graph completes;
a failing `asterim#typecheck` truncates it to 9 because dependents are skipped.

### Step 2 — MCP Process Supervisor unit & route tests

`pnpm --filter asterim exec tsx src/services/mcp/__tests__/McpProcessSupervisor.test.ts`

**FAIL — 92 / 115 assertions passed, 23 failed.** Reproduced identically three times
(standalone at 21:45, inside the battery at 21:47, standalone again at 21:52), across three
different states of `McpProcessSupervisor.ts`. Exit code 1.

The gate's expectation of 115 assertions is confirmed accurate — the suite has 107 static
assertion call sites, several inside loops, totalling 115 at runtime.

Sections that passed fully: `mcp_servers` table creation, `sanitizeMcpEnv` (all 16 assertions),
configuration CRUD, stderr ring buffer, crash detection, unknown-command handling, disabled
servers, non-stdio transports, child-environment observation, deletion, and the majority of the
REST route surface.

### Step 3 — Full monorepo test battery

`npx turbo run test --force`

**FAIL — 24 / 25 suites pass. 1894 / 1917 assertions passed, 23 failed.**

| Package | Suites | Assertions | Result |
|---|---|---|---|
| `asterim` (Server) | 12 | 1017 / 1040 | **FAIL** (1 suite) |
| `@asterim/mcp-memory-server` | 7 | 348 / 348 | PASS |
| `@asterim/web` | 4 | 435 / 435 | PASS |
| `@asterim/relay` | 1 | 71 / 71 | PASS |
| `@asterim/adapters` | 1 | 23 / 23 | PASS |
| **Total** | **25** | **1894 / 1917** | **FAIL** |

The 23 failures are entirely within `McpProcessSupervisor.test.ts`. The other 11 server suites
contributed 925/925. **No regression was detected anywhere outside the MCP subsystem** — memory,
git, relay, adapters, web, and marketing suites are unaffected.

### Step 4 — Full production build

`npx turbo run build --force`

**PASS — 7 / 7 Turbo packages built successfully.**

Cold (`--force`, no cache): 40.3 s. Warm/cached: 115 ms (`FULL TURBO`). The gate's "under 10
seconds" expectation is only meetable warm; a cold build of seven packages including two Vite
apps and two `tsc` project builds does not complete in 10 s on this machine. Recording as PASS on
the substantive criterion (7/7 succeed) and flagging the timing expectation as unrealistic for a
cold run.

An earlier invocation reported "4 successful, 4 total" because a partial task graph was scheduled;
the authoritative forced run enumerates all seven build tasks (`@asterim/shared`, `@asterim/adapters`,
`@asterim/relay`, `@asterim/web`, `@asterim/marketing`, `asterim`, `@asterim/mcp-memory-server`).
`@asterim/eslint-config` has no `build` script and is correctly absent.

---

## Findings

### Finding 1 — P6-02 handshake gate breaks all 23 process-lifecycle assertions in the P6-01 suite

Severity: **HIGH** — violates an explicit P6-02 prohibition.
Confidence: **CONFIRMED** (reproduced 3×, 3 distinct tree states).

Every one of the 23 failures shares a single root cause:

```
[MCP] Spawned stay-alive (pid …)
[MCP] stay-alive: Handshake failed: MCP request 'initialize' timed out after 5000ms
  FAIL  the status becomes RUNNING  — expected "RUNNING", got "ERROR"
```

`McpProcessSupervisor.startServer()` now gates the `RUNNING` transition on a successful JSON-RPC
`initialize` handshake; on timeout it sets `status = 'ERROR'`, records `lastError`, terminates the
child, and emits `SERVER_CRASHED`.

The P6-01 suite's fixtures are ordinary Node processes that never speak JSON-RPC:

```js
const STAY_ALIVE = 'setInterval(() => {}, 1000)';   // McpProcessSupervisor.test.ts:73
```

Such a child can never answer `initialize`, so every start now times out after 5000 ms and lands
in `ERROR`. This cascades into every downstream assertion about pid tracking, start counts, stop,
restart, SIGTERM/SIGKILL escalation, `shutdownAll`, and the REST status surface — including
`SIGKILL followed the grace period (took 0ms)`, which now measures a process that was already dead.

**The supervisor behaviour is correct per spec.** `tasks/current.md` §7 AC #2 requires transition
to `RUNNING` "only after successful handshake", and AC #3 requires timeouts to mark `ERROR`. The
defect is that the P6-01 fixtures were not migrated alongside it, while `tasks/current.md` §6
states: *"Do NOT break any existing tests or typechecks."*

Remediation is the implementer's call, not QA's, but the spec already points at it —
`tasks/current.md` §5 calls for *"a small Node script responding to `initialize`, `tools/list`,
`resources/list`"*. The P6-01 fixtures need the same treatment: replace `STAY_ALIVE` / `NOISY`
with minimal MCP-speaking stubs, keeping a genuinely-silent child only for the tests that
legitimately assert handshake-timeout behaviour.

### Finding 2 — `McpCapabilityDiscovery.test.ts` is not wired into the test script

Severity: **MEDIUM** — open P6-02 Definition-of-Done item; suite invisible to `pnpm run test`.
Confidence: **CONFIRMED**.

The new suite exists and, run directly, **passes 89/89 assertions**. It is absent from the `"test"`
script in `apps/server/package.json`, so the full battery never executes it — the monorepo reports
25 suites when 26 exist. `tasks/current.md` §5 explicitly requires *"Wire into
`apps/server/package.json` `"test"` script."*

Because it is unwired, its failures surface only through `typecheck`/`lint`, which is how the
volatile Step 1 errors in §Step 1 arose.

### Finding 3 — `dde3586` commit message describes work that is not in the commit

Severity: **LOW** — hygiene / traceability.
Confidence: **CONFIRMED**.

HEAD `dde3586` reads *"feat: implement MCP stdio handshake, capability discovery, autostart, and
unified graceful shutdown"*, but `McpStdioClient.ts`, `GracefulShutdown.ts`, and
`McpCapabilityDiscovery.test.ts` are all **untracked** on disk, and `McpProcessSupervisor.ts`,
`routes/mcp.ts`, `index.ts`, `DatabaseService.ts`, `ServerRegistry.ts`, and
`packages/shared/src/types/mcp.ts` all carry uncommitted modifications. The commit does not
contain the feature it names, so no revision in history corresponds to a testable state of P6-02.

---

## Acceptance Criteria Review

Criteria are those of `tests/current.md` §3.

- [ ] **Step 1 — `pnpm run typecheck`: 0 errors across 11 Turbo tasks**
      NOT CERTIFIED. Passed at 21:35 and 21:51; failed at 21:43 and 21:54. All errors confined to
      `McpCapabilityDiscovery.test.ts` while it was being authored. Last observation: FAILING.
- [ ] **Step 1 — `pnpm run lint`: 0 errors across 7 workspace packages**
      NOT CERTIFIED. 0 errors at 21:37 and 21:53; 1 error at 21:43
      (`no-useless-assignment`, `McpCapabilityDiscovery.test.ts:389`). Last observation: 0 errors,
      565 warnings. Warnings are pre-existing and outside this gate's scope.
- [ ] **Step 2 — MCP supervisor suite: 115/115 assertions passing**
      **FAILED.** 92/115, 23 failures, reproduced 3×. See Finding 1.
- [ ] **Step 3 — All 25 suites pass, 0 failures across 1,917+ assertions**
      **FAILED.** 24/25 suites, 1894/1917 assertions. Sub-criteria:
  - [ ] `asterim` (Server) 12 suites / 1,040 assertions — 1017/1040, 1 suite failing
  - [x] `@asterim/mcp-memory-server` 7 suites / 348 assertions — 348/348
  - [x] `@asterim/web` 4 suites / 435 assertions — 435/435
  - [x] `@asterim/relay` 1 suite / 71 assertions — 71/71
  - [x] `@asterim/adapters` 1 suite / 23 assertions — 23/23
- [x] **Step 4 — 7/7 Turbo packages build successfully**
      PASSED. 7/7 built. Timing criterion ("under 10 seconds") not met cold (40.3 s); met warm
      (115 ms). Flagged as an unrealistic expectation for an uncached build, not as a defect.

Mandates from `tests/current.md` §2:

- [x] **QA role only** — no product code, test code, or expectation was modified.
- [ ] **Full monorepo regression** — executed; 24/25 clean. Not certifiable against a moving tree.
- [ ] **Process lifecycle verification** — **could not be verified.** PID tracking, SIGTERM/SIGKILL
      termination, and HTTP status reporting are all gated behind a handshake the fixtures cannot
      complete, so these paths are never exercised. Stderr ring-buffer logging **is** verified and
      passing.
- [x] **Environment sanitization verification** — **VERIFIED AND PASSING.** All 16 `sanitizeMcpEnv`
      assertions pass. Confirmed blocked from children: `ASTERIM_RELAY_URL`, `ASTERIM_RELAY_SECRET`,
      `RELAY_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GITHUB_TOKEN`,
      `AWS_SECRET_ACCESS_KEY`, `DB_PASSWORD`, `MY_API_KEY`. Confirmed passed through: `PATH`,
      `HOME`, locale, `ASTERIM_DATA_DIR`, and operator-set explicit vars.

---

## Verification Summary

| Step | Criterion | Result |
|---|---|---|
| 1 | typecheck, 0 errors | NOT CERTIFIED (flip-flopped 4×) |
| 1 | lint, 0 errors | NOT CERTIFIED (flip-flopped 3×) |
| 2 | supervisor 115/115 | **FAIL — 92/115** |
| 3 | 25 suites, 1917 assertions | **FAIL — 24/25, 1894/1917** |
| 4 | 7/7 packages build | **PASS** |

Gate verdict: **BLOCKED**.

The one substantive defect (Finding 1) is a direct and predictable consequence of unfinished
P6-02 work landing on top of P6-01's test fixtures. It is real and reproducible, but it is not
evidence that P6-01 is broken — it is evidence that the gate was run against a tree mid-migration.

---

## Recommendation

TEST-P6-01 should not be re-run until the tree is committed and quiescent. Specifically:

1. **Finish and commit P6-02.** No revision in history currently contains the feature under test
   (Finding 3), so there is nothing stable to certify.
2. **Migrate the P6-01 fixtures** to minimal MCP-speaking stubs (Finding 1), preserving a silent
   child only where handshake-timeout behaviour is the assertion under test.
3. **Wire `McpCapabilityDiscovery.test.ts` into the `asterim` test script** (Finding 2) so the
   battery covers 26 suites.
4. **Re-issue the gate against a committed SHA.** Consider retargeting it as TEST-P6-02, since
   `tasks/current.md` has already advanced to P6-02 while `tests/current.md` still names P6-01.
5. **Revise the Step 4 timing expectation** to distinguish cold (~40 s) from warm (~115 ms) builds.

## Recommended Next Step

Return this gate to the orchestrator as BLOCKED. Once P6-02 is committed, re-run all four steps
against that SHA; the expected delta is 23 assertions restored in `McpProcessSupervisor.test.ts`
plus 89 added from `McpCapabilityDiscovery.test.ts`, giving 26 suites / 2,006 assertions.

---

## Reporting Note

`tests/current.md` §4 directs the report to `reports/current.md`; the operator instruction for this
run directed it to `tests/report.md`. This report was written to `tests/report.md` per the operator
instruction. `reports/current.md` was left untouched (it still holds the prior Stripe billing task
report). The two locations should be reconciled in the protocol.
