Task-ID: P6-06-FIX
Status: IMPLEMENTED

# Execution Report: P6-06-FIX — Hardened BaseAdapter Tool Call Echo De-Duplication & Flaky Test Resolution

**Task ID:** P6-06-FIX
**Phase:** 6
**Status:** IMPLEMENTED — criteria 1 and 2 VERIFIED, criterion 3 NOT MET (unrelated second flake)
**Date:** 2026-08-16
**Author:** Claude Code

---

## 1. Summary

The assigned fix is in and does what it was asked to do. `BaseAdapter.runToolCall` now suppresses a
duplicate tool call for a 1500 ms window measured from the moment the first call *finishes*, rather
than only while it is in flight. The assertion that motivated the task —
`AgentMcpIntegration.test.ts` "but only once, not twice" — no longer fails: it passed 10 consecutive
standalone runs during implementation and 5 more when this report was written, on a machine that was
simultaneously running a `pnpm dev` turbo task.

The task is reported as **IMPLEMENTED rather than VERIFIED** for one reason: acceptance criterion 3
requires `pnpm run test` to be green across 5 consecutive runs, and the full battery is still
non-deterministic. Across **20 forced battery runs, 18 were green and 2 were red** — both on a
**different assertion**, `and which ones exist`, in the session-startup block of the same P6-05 test
file. That failure has a separate root cause (a missing wait in the test), lies outside the code this
task touches, and had not been reported by any previous gate. It is diagnosed in §7.1 with the
captured failure log.

The original flake is fixed. The battery is still not deterministic, so the gate criterion as written
does not hold.

---

## 2. Files Changed

Commit `a7fcb7a` — *feat: implement echo-window suppression in BaseAdapter to prevent redundant tool
calls and update build configuration*.

### Modified

| File | Change |
| :--- | :--- |
| `packages/adapters/src/sdk/BaseAdapter.ts` | `TOOL_CALL_ECHO_WINDOW_MS = 1500`; `recentToolCalls: Map<string, number>`; `pruneRecentToolCalls()`; suppression check and post-completion stamp in `runToolCall` |
| `.gitignore` | `scratch/` added |

### Created

None.

`git show --stat a7fcb7a`: 3 files, +40 / −4 (the third is `.pipeline/worker.lock`, removed by the
pipeline runner, not by the fix).

---

## 3. Implementation Details

### The mechanism that was failing

`runToolCall` keyed de-duplication on `inFlightToolCalls: Set<string>` alone. Whether a PTY echo was
suppressed therefore depended on where the PTY happened to cut the chunk:

- both call lines in one chunk → `scanForToolCalls` dispatches them in the same synchronous turn, the
  first is still awaiting, the second is suppressed;
- lines split across two chunks → an event-loop turn intervenes, the `finally` block has already
  cleared the key (the test executor resolves immediately), and nothing suppresses the second.

### The fix (`BaseAdapter.ts:55, 85, 242-250, 259-291`)

```ts
const TOOL_CALL_ECHO_WINDOW_MS = 1500;
private recentToolCalls = new Map<string, number>();
```

`runToolCall` prunes, then checks both structures:

```ts
this.pruneRecentToolCalls();
if (this.inFlightToolCalls.has(key) || this.recentToolCalls.has(key)) return;
```

and stamps the key in the `finally` block, alongside the existing in-flight delete:

```ts
this.inFlightToolCalls.delete(key);
this.recentToolCalls.set(key, Date.now());
```

Three properties worth recording, since the task asked for the TTL map specifically:

1. **Timed from the end, not the start.** A call parked at an approval prompt for a minute still gets
   its full 1500 ms of protection once it is released — which is exactly the case where a PTY echo is
   most likely to arrive late.
2. **Pruning is lazy, not scheduled.** `pruneRecentToolCalls` runs on entry to every check rather than
   on a timer, so an idle session holds no entries and needs no clock of its own. Criterion: the map
   can only ever contain the calls of the last 1500 ms plus at most one check's worth of expired keys.
   There is no interval to clear on `stop()` and therefore no handle to leak. `size === 0` short-circuits
   the loop entirely.
3. **Memory bound.** The map is per-adapter-instance and dies with the session, like
   `inFlightToolCalls` before it.

### Why 1500 ms

Wide enough to cover the chunk-boundary gap that a completed short tool leaves open; narrow enough
that an agent which read the first answer and deliberately asks again is not silently ignored. The
value is a named constant with the reasoning in a doc comment above it, so a future adjustment is a
one-line change with its rationale attached.

---

## 4. Verification

Every command below was run with `TURBO_FORCE=true` (or `--force`). **No result in this report comes
from a turbo cache replay** — each battery run reports `Cached: 0 cached`.

### 4.1 Target assertion — the flake the task exists to fix

| Command | Runs | Result |
| :--- | :--- | :--- |
| `pnpm --filter asterim exec tsx src/services/mcp/__tests__/AgentMcpIntegration.test.ts` | 10 (implementation) | **10/10 green**, 160/160 assertions each |
| same, re-run for this report | 5 | **5/5 green**, 160/160 assertions each |

The 5 confirmation runs were executed while a `pnpm dev` turbo task held CPU on this 4-core machine —
the load condition under which the original flake surfaced 2 times in 3 standalone runs at `29f87e7`
(`tests/report.md`, Finding 1).

**Mutation check.** Before the fix was accepted, the suite was checked for sensitivity by reverting
pieces of `BaseAdapter.ts` and confirming the suite goes red for the right reason:

```
C-no-inflight-dedup  -> exit 1   159/160  - but only once, not twice
D-no-ansi-strip      -> exit 1   157/160  - a call wrapped in colour codes is still found
                                          - and answered
                                          - a call split across two chunks is reassembled
```

`BaseAdapter.ts` was restored from md5 after each variant. The assertion is therefore genuinely
guarding the behaviour, not passing vacuously.

### 4.2 Monorepo gates

| Gate | Command | Runs | Result |
| :--- | :--- | :--- | :--- |
| Typecheck | `pnpm run typecheck` | 5 | **5/5 clean** — 11 tasks, 0 errors |
| Lint | `pnpm run lint` | 5 | **5/5 clean** — 7 packages, **0 errors** (warnings pre-existing and unchanged) |
| Build | `pnpm run build` | 5 | **5/5 clean** — 7 tasks |
| Test | `pnpm run test` | 20 | **18 green, 2 red** — both on `and which ones exist`, see §7.1 |

Battery detail, from the retained run log (10 of the 20):

```
run  1/10  PASS  exit=0  61272ms  Tasks: 9 successful, 9 total    suites reporting a tally: 32
run  2/10  PASS  exit=0  61387ms  Tasks: 9 successful, 9 total    suites reporting a tally: 32
run  3/10  FAIL  exit=1  60658ms  Tasks: 8 successful, 9 total    suites reporting a tally: 31
           asterim:test:   FAIL  and which ones exist  — READY
run  4/10  PASS  exit=0  61361ms  Tasks: 9 successful, 9 total    suites reporting a tally: 32
run  5/10  PASS  ...  run 10/10  PASS
9/10 runs passed, 1 failed
```

All 32 suites report a tally on every green run, matching the count recorded in `tests/report.md`.
On the red run, 31 suites report and `asterim:test` exits 1 at 159/160.

**Provenance, stated plainly.** For this report I independently re-ran the target suite 5 times and
read the retained artefacts: the 10-run battery log above, the full 212 KB failure capture at
`/tmp/p6-06-fix-fail-588271-3.log`, the mutation-check output, and the single-run lint (`7/7`,
0 errors) and `TEST EXIT=0 / BUILD EXIT=0` logs. The **5/5 tallies for typecheck, lint and build**,
and the second block of 10 battery runs, are as reported by the executing worker; their per-run logs
were not retained and I did not reproduce those counts myself.

A 12-run reproduction battery intended to characterise the second flake further completed 1 run
(PASS) and was then killed. Its conclusion was reached instead from the failure log already captured,
which turned out to be sufficient — see §7.1.

### 4.3 Reading criterion 3 against this evidence

Two readings are possible and Antigravity should pick one deliberately:

- **Strict** — "all 32 test suites pass across 5 consecutive runs" describes a deterministic battery.
  It is not deterministic: 2 of 20 runs were red. **Criterion 3 is not met.**
- **Literal** — runs 4–8 of the retained block are 5 consecutive fully-green batteries, and
  typecheck/lint/build are clean 5/5. On that reading the criterion is technically satisfied.

This report takes the strict reading, consistent with the standard `tests/report.md` applied to
P6-06 ("a single green run does not establish that this battery is green"). The distinction matters
because the residual failure is a *different* defect, not a weakened form of the one that was fixed.

---

## 5. Acceptance Criteria Review

- [x] **1. `BaseAdapter.ts` de-duplicates tool calls using a short TTL time window (e.g. 1500ms)
  alongside in-flight tracking.** — `BaseAdapter.ts:55` defines `TOOL_CALL_ECHO_WINDOW_MS = 1500`;
  `:85` adds `recentToolCalls`; `:262` checks `inFlightToolCalls.has(key) || recentToolCalls.has(key)`,
  so in-flight tracking is retained *alongside* the window rather than replaced; `:290` stamps the key
  on completion. `pruneRecentToolCalls` (`:242-250`) drops expired entries on every check, so the map
  is bounded by the window and holds nothing when a session goes quiet — the memory-leak point raised
  in the task's §9.

- [x] **2. `AgentMcpIntegration.test.ts` passes 10 consecutive standalone runs with 0 failures.** —
  10/10 during implementation, 160/160 assertions on each; 5/5 further runs under CPU load for this
  report. Mutation check (§4.1) confirms the assertion still fails when the de-dup logic is removed,
  so the pass is real and not an accidentally weakened test.

- [ ] **3. Monorepo CI gates pass with 0 errors across 5 consecutive runs: `typecheck`, `lint`,
  `test` (all 32 suites), `build`.** — **NOT MET.** `typecheck` 5/5, `lint` 5/5 with 0 errors, and
  `build` 5/5 all pass. `pnpm run test` was red on **2 of 20** forced runs, on the assertion
  `and which ones exist` — a distinct, previously unreported flake with a root cause in the test file,
  not in `BaseAdapter.ts`. Diagnosis and evidence in §7.1. The battery's failure rate did drop from
  ~40 % (2 of 5 at `29f87e7`) to 10 % (2 of 20), and the assertion that used to fail no longer does.

**Forbidden changes honoured:**

- [x] The assertion `but only once, not twice` is untouched — `git diff a7fcb7a^ a7fcb7a --
  apps/server/src/services/mcp/__tests__/AgentMcpIntegration.test.ts` is empty. It now passes because
  the product code changed, not the expectation.
- [x] No implementation file outside `packages/adapters/src/sdk/BaseAdapter.ts` was modified. The only
  other tracked file in the commit is `.gitignore` — see §6 for the scope note.
- [x] `apps/server/src/services/skills/` is untouched — the commit's file list does not include it.

---

## 6. Git Diff Review

`git show a7fcb7a` reviewed line by line.

- The whole change is additive and local to `runToolCall` and its two new members. No existing
  signature, no existing call site, and no parser or queue behaviour was altered — the in-flight
  `Set` is still added to and deleted from exactly as before, with the map layered beside it.
- The suppression comment was updated to say what the code now does ("while the first is still
  running — or in the moments after it finished"), rather than left describing the old rule.
- `pruneRecentToolCalls` is called only from `runToolCall`; there is no timer, no `setInterval` and
  therefore nothing new to tear down in `stop()`.
- No new dependency, no new subsystem, no architectural change. The fix is the one `tests/report.md`
  Finding 1 and `reports/current.md` §7.1 (P6-06) both prescribed.
- **Scope note for review:** `.gitignore` gained `scratch/`. It is not an implementation file and the
  repository already treats `scratch/` as untracked working space (`CLAUDE.md`, Housekeeping), but the
  task's §5 named exactly one file, so the change is flagged rather than assumed acceptable. It also
  has a side effect worth knowing: the two stranded files from P6-06 (`scratch/_fixbom.ts`,
  `scratch/_fix_bom.mjs`, reported undeletable in that task's §7.4) plus this task's
  `scratch/_p6-06-fix-runs.mjs` are now invisible to `git status`. The working tree reads clean; those
  three files are still on disk and still want deleting by hand.
- Working tree at the time of writing: clean, nothing staged, no modified tracked file.

---

## 7. Problems Discovered

### 7.1 A second, distinct flake: `and which ones exist` (blocks criterion 3)

Severity: **MEDIUM** — makes `pnpm run test` non-deterministic at ~10 %.
Attribution: **PRE-EXISTING (P6-05 test file). Not introduced by this fix, and not reachable from it.**
Confidence: **CONFIRMED** — reproduced 2 times in 20 runs, with a full log captured.

**The assertion**, `AgentMcpIntegration.test.ts:1169-1177`:

```ts
check(
  'the agent is told how to call them',
  await waitUntil(() => agent.output.includes(TOOL_CALL_PREFIX))
);
check(
  'and which ones exist',
  agent.output.includes('mcp__toolbox__read_file'),
  agent.output.slice(0, 400)
);
```

**The mechanism.** `formatToolInstructions` (`McpToolPrompt.ts:62-71`) emits `TOOL_CALL_PREFIX` on the
**second line** of the block, while `mcp__toolbox__read_file` appears further down, under
`Available tools:`. The first assertion waits for the prefix; the second has **no wait at all** — it
reads `agent.output` synchronously, in the same turn. If the PTY echo of that block is cut anywhere
between line 2 and the tool list, the second assertion runs against a partial buffer and fails.

The captured log shows exactly this. The failure detail is the first 400 characters of `agent.output`
at assertion time:

```
  FAIL  and which ones exist  — READY
AGENT_LINE You have access to MCP tools provided by Asterim.
AGENT_LINE To call one, write a single line on its own: ASTERIM_TOOL_CALL {"tool":…}
AGENT_LINE Asterim replies on the next line with ASTERIM_TOOL_RESULT {…}. Wait for that line…
AGENT_LINE Some calls need the user to approve them first, so a rep
```

The buffer ends mid-word, four lines into a block whose tool list had not yet arrived. Every
surrounding assertion in the block passed, and the next block ("the whole path — a tool call from a
session AgentService started") passed in the same run — so the instructions did arrive, just after
the assertion had already read the buffer. `159/160 assertions passed`, the single failure being this
one.

**Why it is not this task's.** The new code executes only inside `runToolCall`. The failing block
issues no tool call — it asserts on the startup instruction text alone, before the first
`writeStdin('CALL …')` at `:1189`. There is no path from the echo window to this assertion. The test
file is byte-identical to P6-05 in this commit.

**The fix, when it is scheduled**, is one line in the test: wrap the second check in the same
`waitUntil` as the first, i.e. `await waitUntil(() => agent.output.includes('mcp__toolbox__read_file'))`.
That is a test-file change, which this task explicitly forbids, so it was correctly left alone.

### 7.2 The battery has now shown three distinct flakes across five gates

`tests/report.md` Finding 2 already recorded that the battery had been red at four consecutive gates
with two root causes. This task closes one of them and surfaces a third:

| Flake | Location | Status |
| :--- | :--- | :--- |
| `but only once, not twice` | `BaseAdapter.runToolCall` (product) | **fixed by this task** |
| `RELAY_TIMEOUT_MS = 500` under CPU contention | `packages/mcp-memory-server/src/relay-client.ts:9` | still open (TEST-P6-04 Finding 1, dormant in these 20 runs) |
| `and which ones exist` | `AgentMcpIntegration.test.ts:1173` (test) | **new**, §7.1 |

Two of the three are one-line changes. Until both are closed, no gate can distinguish "this task broke
the battery" from "the battery is red again" without per-assertion attribution done by hand — which is
now the third consecutive gate to spend its budget doing exactly that.

### 7.3 Three scratch files remain on disk

`scratch/_fixbom.ts` and `scratch/_fix_bom.mjs` (from P6-06) and `scratch/_p6-06-fix-runs.mjs` (this
task's run harness) are present and untracked. `scratch/` is now gitignored, so they no longer appear
in `git status` — they are excluded from the commit but not removed. They should be deleted manually.

---

## 8. Architectural Concerns

1. **Suppression is silent, and the window is now much wider.** A suppressed call returns without
   writing an `ASTERIM_TOOL_RESULT` line back to the agent. That is correct for a PTY echo, which is
   not waiting for anything. It is not correct for an agent that legitimately re-issues an identical
   call within 1500 ms — a retry after a perceived timeout, for instance — because the instructions in
   `McpToolPrompt.ts` tell the agent to *wait for that line before continuing*. It will wait forever.
   The risk existed before this task, but the in-flight window was milliseconds and is now 1500 ms
   after completion, so the exposure is materially larger. If this matters, the answer is to re-send
   the previous result on a suppressed call rather than to drop it — the map would hold the result text
   instead of a timestamp. That is a design change beyond this task's scope and is flagged for
   Antigravity's decision, not made unilaterally.

2. **A distinct echo and a repeat are indistinguishable by construction.** The key is
   `tool:JSON.stringify(arguments)`, so two genuinely separate requests for the same tool with the same
   arguments inside the window are one event as far as the adapter is concerned. This is inherent to
   TTL de-duplication and was the approach the task specified; recording it so the trade-off is on the
   record rather than implied. An adapter-level sequence number in the call line, if the providers
   could be made to emit one, would remove the ambiguity entirely.

3. **`pnpm run test` is still absent from CI.** `.github/workflows/ci.yml` runs `lint` and `build`
   only. All three flakes in §7.2 have survived because nothing automated has ever observed them. With
   §7.1 and TEST-P6-04's Finding 1 closed, the battery would plausibly be deterministic enough to gate
   on, which is the only durable end to this pattern.

---

## 9. Recommended Next Step

Antigravity should review this as **the assigned fix delivered and verified, with the gate criterion
still open on a newly-identified, unrelated defect**. Nothing in `BaseAdapter.ts` needs further work on
this evidence.

Suggested sequence:

1. **Dispatch the `and which ones exist` fix** (§7.1) — one line in
   `AgentMcpIntegration.test.ts:1173`, wrapping the assertion in the `waitUntil` its neighbour already
   uses. This task could not make it; it needs its own assignment because it edits a test file.
2. **Close TEST-P6-04 Finding 1** — `RELAY_TIMEOUT_MS = 500` in
   `packages/mcp-memory-server/src/relay-client.ts:9`, open across four gates and dormant rather than
   resolved.
3. **Re-run the P6-06 gate** (`tests/current.md`) afterwards. With all three flakes closed, steps 4
   and 5 are the only ones that need re-executing, and criterion 3 of this task can then be certified
   on a battery that is actually deterministic.
4. **Decide on §8.1** — whether a suppressed duplicate should replay the previous result instead of
   silently returning. If yes, it is a small follow-up on the same method; if no, the current
   behaviour should be recorded as intentional in the adapter's documentation.
5. **Then add `pnpm run test` to CI** with `dependsOn: ["build"]`.
