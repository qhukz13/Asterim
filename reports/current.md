Task-ID: P6-06-FIX
Status: COMPLETE

# Execution Report: P6-06-FIX — Hardened BaseAdapter Tool Call Echo De-Duplication & Flaky Test Resolution

**Task ID:** P6-06-FIX
**Phase:** 6
**Status:** VERIFIED
**Date:** 2026-08-16
**Author:** Claude Code

---

## 1. Summary

`BaseAdapter.runToolCall` now suppresses a duplicate tool call for a 1500 ms window measured from the
moment the first identical call **finishes**, layered alongside the pre-existing in-flight `Set`. This
closes the chunk-boundary race described in the task's §2: previously the first call could complete
and clear its in-flight key before the PTY echo of the same line was processed, letting the echo
through as a second dispatch.

The implementation landed in commit `a7fcb7a` and is unchanged by this session. This session's work
was the full verification pass that the task's criterion 3 requires, executed with turbo caching
bypassed on every run so that no gate result is a replayed log.

**All three acceptance criteria are met.** Every gate was run 5 or more consecutive times with
`--force`, and every run was green:

| Gate | Consecutive forced runs | Result |
| :--- | :--- | :--- |
| `pnpm typecheck` | 5 | 11/11 tasks successful, 0 cached, 0 errors |
| `pnpm lint` | 5 | 7/7 tasks successful, **0 errors** (270 warnings, pre-existing) |
| `AgentMcpIntegration.test.ts` standalone | 12 | 160/160 assertions on every run |
| `pnpm test` (full battery) | 10 | 32/32 suites green, 0 cached, on every run |
| `pnpm build` | 5 | 7/7 tasks successful, 0 cached |

One caveat is carried forward rather than buried: the previous execution of this task recorded a
**separate, pre-existing** flake (`and which ones exist`) that went red on 2 of 20 battery runs. It did
not reproduce once in this session's 22 executions of that test file. It is unreachable from the code
this task changed, and §7.1 explains why and what closing it requires. It does not block this task,
but it should get its own assignment.

---

## 2. Files Changed

No source file was modified in this session. The change under review is commit `a7fcb7a`; this session
verified it and rewrote the report.

| File | Commit | Change | Purpose |
| :--- | :--- | :--- | :--- |
| `packages/adapters/src/sdk/BaseAdapter.ts` | `a7fcb7a` | modified (+38/−3) | TTL echo-window de-duplication — the entire fix |
| `.gitignore` | `a7fcb7a` | modified (+2) | ignores `scratch/`; see §6 scope note |
| `.pipeline/worker.lock` | `a7fcb7a` | deleted | pipeline runtime artifact, not source |
| `reports/current.md` | `03e1de2`, this session | rewritten | execution report |

No file under `apps/server/src/services/skills/`, and no test file, was touched.

---

## 3. Implementation Details

Three additions to `packages/adapters/src/sdk/BaseAdapter.ts`, all local to `runToolCall`:

1. **`TOOL_CALL_ECHO_WINDOW_MS = 1500`** (`:55`) — the window, with a comment stating both bounds of
   the trade-off: wide enough to span a PTY echo that lands in a later chunk than the call, narrow
   enough that an agent re-asking after reading the first answer is not silently ignored.

2. **`private recentToolCalls = new Map<string, number>()`** (`:85`) — key → completion timestamp,
   keyed identically to the in-flight `Set` (`tool:JSON.stringify(arguments)`), so the two structures
   describe the same identity.

3. **`pruneRecentToolCalls()`** (`:242-250`) — called at the top of every `runToolCall`, deletes each
   entry whose `finishedAt <= Date.now() - TOOL_CALL_ECHO_WINDOW_MS`, and returns immediately when the
   map is empty.

The guard at `:262` became `if (this.inFlightToolCalls.has(key) || this.recentToolCalls.has(key))`.
In-flight tracking is **retained alongside** the window, not replaced — it still covers the interval
during which a call is running and therefore has no completion timestamp yet. The stamp is written in
the `finally` block (`:290`), timed from completion rather than dispatch, so a call parked at an
approval prompt for a minute still receives the full window once it is released.

**On the memory-leak question raised in the task's §9.** Pruning is driven by call arrival, not a
timer. That choice is deliberate and has two consequences worth stating:

- There is no `setInterval` and therefore nothing new for `stop()` to tear down, and no clock keeping
  a quiet session alive.
- The map's residency is bounded by the number of *distinct* calls made within any 1500 ms window.
  After a session's final call, at most that session's last window's worth of entries remains — a
  handful of short strings — and it is freed with the adapter. There is no path by which the map grows
  without bound, because every insertion is preceded by a prune.

---

## 4. Verification

Every command below was run with turbo's cache bypassed. Turbo reported `0 cached` on each run, so
these are real executions, not replayed logs.

### 4.1 `pnpm typecheck` — 5 consecutive forced runs

```
Tasks:    11 successful, 11 total
Cached:    0 cached, 11 total
Time:     43.0s / 52.3s / 50.2s / 49.8s / 50.1s
```

0 TypeScript errors across all 8 packages on every run.

### 4.2 `pnpm lint` — 5 consecutive forced runs

```
Tasks:    7 successful, 7 total
Cached:    0 cached, 7 total
```

`@asterim/web: ✖ 270 problems (0 errors, 270 warnings)`,
`@asterim/mcp-memory-server: ✖ 12 problems (0 errors, 12 warnings)`. **0 errors** on every run; the
warnings are pre-existing (`no-explicit-any`, `react-refresh/only-export-components`,
`no-unused-vars`) and untouched by this task.

### 4.3 `AgentMcpIntegration.test.ts` standalone — 12 consecutive runs

`pnpm --filter asterim exec tsx src/services/mcp/__tests__/AgentMcpIntegration.test.ts`

```
160/160 assertions passed   ×12
```

12 runs, 0 failures — exceeding the 10 the task requires. This includes the assertion the fix targets
(`but only once, not twice`, `:1039`) and the assertion flagged as a residual flake in §7.1
(`and which ones exist`, `:1174`), both green on all 12.

### 4.4 `pnpm test` — 10 consecutive forced full-battery runs

```
Tasks:    9 successful, 9 total
Cached:    0 cached, 9 total
```

**32 suites green on every one of the 10 runs.** The count was verified by grepping the
`N/N assertions passed` summary lines, which is an exact suite count: the per-package `test` scripts
chain their suites with `&&`, so a single failing suite both aborts its chain and drops the count below
32. Suite distribution, matching the task's "32 test suites":

| Package | Suites |
| :--- | ---: |
| `asterim` (server) | 17 |
| `@asterim/web` | 6 |
| `@asterim/mcp-memory-server` | 7 |
| `@asterim/adapters` | 1 |
| `@asterim/relay` | 1 |
| **Total** | **32** |

Representative summaries from one run: `71/71`, `23/23`, `151/151`, `140/140`, `231/231`, `160/160`
(`AgentMcpIntegration`), `169/169` (`SkillService`).

### 4.5 `pnpm build` — 5 consecutive forced runs

```
Tasks:    7 successful, 7 total
Cached:    0 cached, 7 total
```

Full production build clean, including `@asterim/web` → `asterim` (`tsup` + the `dist/web` copy).

---

## 5. Acceptance Criteria Review

- [x] **1. `BaseAdapter.ts` de-duplicates tool calls using a short TTL time window (e.g. 1500ms)
  alongside in-flight tracking.** — `BaseAdapter.ts:55` defines `TOOL_CALL_ECHO_WINDOW_MS = 1500`;
  `:85` adds `recentToolCalls: Map<string, number>`; `:262` checks
  `inFlightToolCalls.has(key) || recentToolCalls.has(key)`, so in-flight tracking is kept *alongside*
  the window rather than replaced; `:290` stamps the key on completion inside `finally`;
  `pruneRecentToolCalls` (`:242-250`) drops expired entries before every check. Verified by reading
  `git diff 55c26de -- packages/adapters/src/sdk/BaseAdapter.ts` line by line (§6).

- [x] **2. `AgentMcpIntegration.test.ts` passes 10 consecutive standalone runs with 0 failures.** —
  **12** consecutive runs, `160/160 assertions passed` on each (§4.3). The assertion that motivated the
  task is unmodified (see forbidden-changes checks below), so it passes because the product code
  changed, not the expectation.

- [x] **3. Monorepo CI gates pass with 0 errors across 5 consecutive runs: `pnpm run typecheck`,
  `pnpm run lint`, `pnpm run test` (all 32 test suites pass), `pnpm run build`.** —
  typecheck **5/5** (§4.1), lint **5/5** with 0 errors (§4.2), test **10/10** with all 32 suites green
  (§4.4), build **5/5** (§4.5). Every run forced past the turbo cache. The residual pre-existing flake
  documented in §7.1 did not occur in any of them; it is reported as a known risk rather than
  suppressed, and it is attributable to a test file this task does not touch.

**Forbidden changes honoured:**

- [x] The assertion `but only once, not twice` is untouched. `git diff 55c26de` lists no test file at
  all; `AgentMcpIntegration.test.ts:1039` still reads `equal('but only once, not twice', invocations, 3)`
  with its 400 ms settle delay at `:1038` intact.
- [x] No implementation file outside `packages/adapters/src/sdk/BaseAdapter.ts` was modified. The only
  other tracked files in the change are `.gitignore` and the deleted `.pipeline/worker.lock`, neither
  of which is an implementation file — flagged in §6 rather than assumed acceptable.
- [x] `apps/server/src/services/skills/` is untouched — absent from the diff entirely.

---

## 6. Git Diff Review

`git diff 55c26de -- packages/adapters/src/sdk/BaseAdapter.ts` reviewed line by line against every
criterion:

- The change is **purely additive and local**. No existing signature, call site, parser hook, or
  command-queue behaviour was altered. The in-flight `Set` is still added to and deleted from exactly
  as before; the map is layered beside it.
- The suppression comment was updated to describe the new rule ("while the first is still running — or
  in the moments after it finished") rather than left describing the old one. Comment density and voice
  match the surrounding file.
- `pruneRecentToolCalls` is called only from `runToolCall`. No timer, no `setInterval`, nothing new to
  tear down in `stop()`, no new lifecycle surface.
- Boundary condition checked: prune uses `finishedAt <= cutoff`, so an entry exactly 1500 ms old is
  dropped and the window is a closed interval on the near side. The stamp is written in `finally`, so
  a call whose executor **threw** is still suppressed for the window — correct, since a PTY echo of a
  failed call is still an echo.
- No new dependency, no new subsystem, no architectural change. This is the fix `tests/report.md`
  Finding 1 prescribed.
- **Scope note for review:** `.gitignore` gained `scratch/`, and `.pipeline/worker.lock` (a pipeline
  runtime lock, `{"pid":491040,…}`) was removed. Neither is an implementation file, and `CLAUDE.md`
  already describes `scratch/` as untracked working space — but the task's §5 named exactly one file,
  so both are flagged rather than assumed in scope. Note the side effect: `scratch/` files already
  tracked in git (`git ls-files scratch/` lists 37) are **unaffected**, since `.gitignore` does not apply to tracked
  paths; only new scratch files become invisible to `git status`. Three such files are on disk and
  still want deleting by hand — `scratch/_fixbom.ts`, `scratch/_fix_bom.mjs`, `scratch/_p6-06-fix-runs.mjs`.
- Working tree at time of writing: clean apart from this report.

---

## 7. Problems Discovered

### 7.1 Residual pre-existing flake: `and which ones exist` — did not reproduce, still worth closing

Severity: **LOW-MEDIUM** — historically ~10 % of battery runs; 0 % across this session.
Attribution: **PRE-EXISTING (P6-05 test file). Not introduced by this fix, and not reachable from it.**
Status this session: **did not reproduce in 22 executions** (12 standalone + 10 battery).

The prior execution of this task observed this assertion (`AgentMcpIntegration.test.ts:1172-1176`,
label at `:1174`) fail on 2 of 20 forced battery runs and captured the log. The mechanism it
identified is sound and still present in the file:

```ts
check(
  'the agent is told how to call them',
  await waitUntil(() => agent.output.includes(TOOL_CALL_PREFIX))
);
check(
  'and which ones exist',
  agent.output.includes('mcp__toolbox__read_file'),   // <- no wait
  agent.output.slice(0, 400)
);
```

`formatToolInstructions` (`McpToolPrompt.ts:62-71`) emits `TOOL_CALL_PREFIX` on the **second line** of
the instruction block, while `mcp__toolbox__read_file` appears further down under `Available tools:`.
The first assertion waits for the prefix; the second reads `agent.output` synchronously in the same
turn. If the PTY echo is cut between line 2 and the tool list, the second assertion reads a partial
buffer. The captured log showed exactly that — a buffer ending mid-word four lines in, with
`159/160 assertions passed`.

**Why it is not this task's.** The new code executes only inside `runToolCall`. The failing block
issues no tool call: it asserts on startup instruction text alone, before the first
`writeStdin('CALL …')` at `:1189`. There is no path from the echo window to that assertion, and the
test file is byte-identical to its P6-05 state.

**Why it did not reproduce here.** It is a timing race sensitive to CPU contention. The prior runs
were made on a machine simultaneously running a `pnpm dev` turbo task; this session's were not. Zero
occurrences in 22 runs does not prove the race is gone — it is latent, not fixed.

**The fix**, when scheduled, is one line in the test: wrap the second check in the same `waitUntil` its
neighbour already uses. That is a test-file change; this task's §5 protects a test assertion and names
one implementation file, so it was correctly left alone here and needs its own assignment.

### 7.2 Two flakes remain open in the battery

`tests/report.md` Finding 2 recorded the battery red at four consecutive gates with two root causes.
This task closes one:

| Flake | Location | Status |
| :--- | :--- | :--- |
| `but only once, not twice` | `BaseAdapter.runToolCall` (product) | **fixed and verified by this task** |
| `RELAY_TIMEOUT_MS = 500` under CPU contention | `packages/mcp-memory-server/src/relay-client.ts:9` | still open (TEST-P6-04 Finding 1); dormant across this session's 10 battery runs |
| `and which ones exist` | `AgentMcpIntegration.test.ts:1174` (test) | still open; dormant across this session's 22 runs (§7.1) |

Both remaining items are one-line changes. Until they are closed, a green battery cannot be
distinguished from a lucky one without per-assertion attribution done by hand.

### 7.3 `CLAUDE.md` is wrong about the test runner, on both counts

`CLAUDE.md` states "There is **no test runner or test script anywhere in the repo**" and that
"CI (`.github/workflows/ci.yml`) runs only `pnpm run lint` and `pnpm run build`". **Both halves are
false.** The root `package.json` defines `"test": "turbo run test"`, and five packages define `test`
scripts chaining 32 `tsx` suites — the very gate this task is measured against. And
`.github/workflows/ci.yml:45-55` runs four steps: Typecheck, Lint, **Test**, Build.

This matters beyond documentation hygiene, and it changes the §8.3 conclusion the previous report
drew: because CI *does* run the battery, the flakes in §7.2 are not merely latent local annoyances —
each one is a live source of red CI on unrelated pull requests. Flagged for Antigravity; not edited,
as `CLAUDE.md` is outside this task's scope.

### 7.4 Verification-command note

The task's §8 lists `pnpm run typecheck` / `pnpm run test` etc. Two mechanical points for whoever
re-runs this gate:

- `pnpm test --force` fails — pnpm intercepts `--force` as its own option. The working forms are
  `pnpm test -- --force` and, for non-builtin scripts, `pnpm typecheck --force` / `pnpm build --force`.
  `pnpm build -- --force` also fails, because the flag is then forwarded into `tsc`.
- Without `--force`, turbo replays cached logs (`FULL TURBO`, 134 ms) and "5 consecutive runs" measures
  nothing. Every figure in §4 was produced with the cache bypassed and `0 cached` confirmed.

---

## 8. Architectural Concerns

1. **Suppression is silent, and the window is now much wider.** A suppressed call returns without
   writing an `ASTERIM_TOOL_RESULT` line back to the agent. Correct for a PTY echo, which waits for
   nothing. Not correct for an agent that legitimately re-issues an identical call within 1500 ms — a
   retry after a perceived timeout — because `McpToolPrompt.ts` instructs the agent to *wait for that
   line before continuing*. It would wait forever. The exposure existed before this task, but the
   in-flight window was milliseconds and is now 1500 ms past completion, so it is materially larger.
   The remedy, if it matters, is to **replay** the previous result on a suppressed call rather than drop
   it — the map would hold the result text instead of a timestamp. That is a design change beyond this
   task's scope; flagged for Antigravity's decision, not made unilaterally.

2. **A distinct echo and a genuine repeat are indistinguishable by construction.** The key is
   `tool:JSON.stringify(arguments)`, so two separate requests for the same tool with the same arguments
   inside the window collapse into one. Inherent to TTL de-duplication and exactly what the task
   specified; recorded so the trade-off is on the record. A per-call sequence number in the call line,
   if providers could be made to emit one, would remove the ambiguity.

3. **The battery is in CI, so every open flake is live.** `.github/workflows/ci.yml:45-55` runs
   Typecheck → Lint → Test → Build (§7.3 — `CLAUDE.md` claims otherwise and is stale). A ~10 % flake
   in a required check means roughly one in ten unrelated pull requests goes red for reasons its author
   cannot act on, which trains people to re-run rather than read failures. That makes §7.2's two
   remaining one-line fixes higher priority than their size suggests.

---

## 9. Recommended Next Step

Antigravity should review this as **PASS**: the assigned fix is delivered, correct, and verified
against all three acceptance criteria with cache-bypassed evidence. Nothing in `BaseAdapter.ts` needs
further work.

Suggested sequence:

1. **Dispatch the `and which ones exist` fix** (§7.1) — one line in `AgentMcpIntegration.test.ts:1174`,
   wrapping the assertion in the `waitUntil` its neighbour already uses. Needs its own assignment
   because it edits a test file. Priority is higher than it looks: the battery is a required CI check
   (§8.3), so this flake reddens unrelated pull requests.
2. **Close TEST-P6-04 Finding 1** — `RELAY_TIMEOUT_MS = 500` in
   `packages/mcp-memory-server/src/relay-client.ts:9`, open across four gates.
3. **Decide on §8.1** — whether a suppressed duplicate should replay the previous result instead of
   returning silently. If yes, it is a small follow-up on the same method; if no, record the behaviour
   as intentional in the adapter's documentation.
4. **Correct `CLAUDE.md`** (§7.3) — it currently tells every agent the repo has no test runner and
   that CI skips tests. Both are false, and an agent believing them will not run the gate it is
   measured on.
</content>
</invoke>
