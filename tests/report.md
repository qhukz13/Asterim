Task-ID: P6-06
Result: FAIL

# TEST REPORT

Task:
P6-06 — Reusable Agent Skills Engine, Schema Parser & Workspace Discovery

Gate verdict:
**FAIL** — Verification step 4 (`pnpm run test`, "all test suites pass with 0 failures") did not
hold. The battery was red on **2 of 5** executions. Steps 1, 2, 3 and 5 all passed.

Attribution:
The failure is **not caused by P6-06**. It is a single flaky assertion in
`apps/server/src/services/mcp/__tests__/AgentMcpIntegration.test.ts` (P6-05), whose root cause lives
in `packages/adapters/src/sdk/BaseAdapter.ts` — a file the P6-06 commit does not touch. Every piece
of P6-06's own verification passed, repeatedly and cleanly. See §Findings and §Attribution below.

---

## Environment

| | |
|---|---|
| Repository state | `29f87e7` on `main` — the P6-06 implementation commit |
| Working tree | clean at gate start and gate end (`git status --short` shows only the two untracked `scratch/` files the implementer disclosed) |
| Node | v24.13.1 |
| CPUs | **4 cores** (material — see Findings) |
| Package manager | pnpm 9.0.0 (turbo monorepo) |
| Cache | every turbo task below was run with `--force`. **No result in this report comes from a cache hit.** |

QA role respected: no production code, test code, or test expectation was modified. The only file
this pass writes is this report. (One incidental note: `pnpm run build` and `pnpm run test` write
build artefacts under `dist/` and `.turbo/`, as they do for anyone who runs them; no tracked source
file changed.)

---

## Tests Executed

Exactly the five commands in `tests/current.md`, and nothing else.

### Step 1 — Typecheck — **PASS**

```
pnpm typecheck --force
→ Tasks: 11 successful, 11 total   Cached: 0 cached, 11 total   Time: 44.499s
→ 0 TypeScript errors
```

Meets the stated criterion (0 errors across 11 Turbo tasks) on a fully cold run.

### Step 2 — Lint — **PASS**

```
pnpm lint --force
→ Tasks: 7 successful, 7 total   Cached: 0 cached, 7 total
```

Per-package ESLint summaries, **0 errors everywhere**:

| Package | Problems |
|---|---|
| `@asterim/shared` | 3 problems (0 errors, 3 warnings) |
| `@asterim/adapters` | 28 problems (0 errors, 28 warnings) |
| `@asterim/marketing` | 18 problems (0 errors, 18 warnings) |
| `asterim` | 256 problems (0 errors, 256 warnings) |
| `@asterim/mcp-memory-server` | 12 problems (0 errors, 12 warnings) |
| `@asterim/web` | 270 problems (0 errors, 270 warnings) |
| `@asterim/relay` | clean |

Meets the stated criterion (0 errors across 7 workspace packages). Warnings are pre-existing and
not gated by the task.

### Step 3 — Skill service unit & route tests — **PASS**

```
pnpm --filter asterim exec tsx src/services/skills/__tests__/SkillService.test.ts
→ 169/169 assertions passed          exit 0
```

Run twice during this gate (once standalone, once inside the full battery), green both times, and
green in every one of the 5 battery runs below. The 12 sections cover the frontmatter parser
(`stripComment`/`parseScalar`/`parseYaml`/`parseFrontmatter`), `normalizeParametersSchema`,
`parseSkillMarkdown`, dual-scope discovery, discovery resilience, the TTL cache, `getSkill`,
`executeSkill`, the `skill__<name>` agent bridge, the session startup instructions, and both REST
routes driven through `fastify.inject()`.

Spot-checks I read directly in the passing output, because they are the assertions that actually
discriminate:

- `a name in both scopes resolves to the workspace copy` — plus the two follow-ups that prove it by
  instructions *and* by path, rather than by count.
- `a very long keyless line does not hang the parser` — the quadratic-backtracking regression the
  implementer's report §3 describes is genuinely guarded, not merely asserted to exist.
- `an unregistered path is refused rather than scanned` / `and so is a traversal out of one` — the
  arbitrary-directory-read guard on `?workspacePath=` is real and tested.
- `an oversized file is refused` / `a SKILL.md that is a directory is skipped` — discovery
  resilience is exercised against the filesystem, not mocked.
- `an unauthenticated request is refused` on both routes.

### Step 4 — Full monorepo test battery — **FAIL (non-deterministic)**

```
pnpm test -- --force --output-logs=errors-only
```

| Run | Result | Detail |
|---|---|---|
| 1 | **FAIL** | `asterim:test` — 159/160, `FAIL  but only once, not twice  — expected 3, got 4` |
| 2 | PASS | 9 successful, 9 total — 55.187s |
| 3 | PASS | 9 successful, 9 total — 56.537s |
| 4 | **FAIL** | `asterim:test` — same single assertion, `expected 3, got 4` |
| 5 | PASS | 9 successful, 9 total — 54.311s |

**2 failures in 5 runs.** The stated criterion for this step — "All 31 test suites pass with 0
failures" — is therefore not met at `29f87e7`.

Failing assertion, from `apps/server/.turbo/turbo-test.log` (line 2027) of run 4:

```
the round trip — reading calls out of a noisy stream
  PASS  a repeated call still runs
  FAIL  but only once, not twice  — expected 3, got 4
...
159/160 assertions passed
```

Isolated re-runs of that one suite, outside the battery:

```
pnpm --filter asterim exec tsx src/services/mcp/__tests__/AgentMcpIntegration.test.ts
run A → 159/160   FAIL  but only once, not twice
run B → 159/160   FAIL  but only once, not twice
run C → 160/160   pass
```

So it is flaky standalone as well as under battery load — **2 of 3** standalone, **2 of 5** in the
battery. It is not merely a contention artefact of running nine turbo tasks on four cores.

**Suite count deviation.** The step specifies 31 suites; the repository wires **32**:

| Package | Suites |
|---|---|
| `asterim` (apps/server) | 17 |
| `@asterim/web` | 6 |
| `@asterim/mcp-memory-server` | 7 |
| `@asterim/relay` | 1 |
| `@asterim/adapters` | 1 |
| **Total** | **32** |

This matches `reports/current.md` §4 exactly: the baseline was 30, the task asked for +1
(`SkillService.test.ts`), and the implementer added +2 by also writing
`apps/web/src/components/skills/__tests__/SkillsExplorer.test.ts`. The extra suite is the only
automated evidence for acceptance criterion 5 in a repository with no browser test runner, so the
deviation is an improvement, disclosed in advance, and **not** a reason for this FAIL. Recording it
so the gate text can be corrected to 32.

The gate text's "2,300+ assertions" is also approximately right rather than exact; assertion totals
are printed per suite, not aggregated by any runner, so no single number is emitted anywhere.

### Step 5 — Production build — **PASS**

```
pnpm build --force --output-logs=errors-only
→ Tasks: 7 successful, 7 total   Cached: 0 cached, 7 total   Time: 27.633s
```

All 7 Turbo packages build. The step's timing sub-expectation ("in under 10 seconds") is a **warm**
figure, not a cold one — a cold forced build is 27.6 s here, and a fully cached replay is ~90 ms
(observed on the step-1 cache-hit run: `Time: 91ms >>> FULL TURBO`). This repeats Finding 5 of the
TEST-P6-04 report, which made the same observation about a 41 s cold build. The build **succeeds**;
only the stated budget is miscalibrated, and that is not the cause of this FAIL.

---

## Findings

### Finding 1 — `BaseAdapter` echo de-duplication is racy; `AgentMcpIntegration.test.ts` is flaky (BLOCKING for this gate)

Severity: **HIGH** — makes `pnpm run test` non-deterministic, which defeats step 4's own criterion.
Confidence: **CONFIRMED** — reproduced 4 times (2 in-battery, 2 standalone).
Attribution: **PRE-EXISTING (P6-05). Not introduced by P6-06.**

**The assertion.** `AgentMcpIntegration.test.ts:1035-1039`:

```js
agent.writeStdin('TWICE {"tool":"mcp__toolbox__ponder","arguments":{"topic":"echo"}}\r\n');
check('a repeated call still runs', await waitUntil(() => invocations >= 3));
// Long enough that a second invocation would have landed by now.
await delay(400);
equal('but only once, not twice', invocations, 3);
```

The mock agent (`:263-268`) answers `TWICE` by writing the *same* tool-call line twice, back to
back. The adapter is expected to run it once.

**The mechanism.** `BaseAdapter.runToolCall` (`packages/adapters/src/sdk/BaseAdapter.ts:229-256`)
de-duplicates on **in-flight state alone**:

```js
const key = `${call.tool}:${JSON.stringify(call.arguments)}`;
if (this.inFlightToolCalls.has(key)) return;   // "…that is the echo, not a second request"
this.inFlightToolCalls.add(key);
...
} finally { this.inFlightToolCalls.delete(key); }
```

Whether the duplicate is suppressed depends entirely on **where the PTY happens to cut the chunk**:

- Both lines in one chunk → `scanForToolCalls`'s `while` loop dispatches them in the same
  synchronous turn, the first call is still in flight at the `await`, the second is suppressed.
  Assertion passes.
- Lines split across two chunks → an event-loop turn intervenes, the first call's `finally` has
  already cleared the key (the executor here resolves immediately), nothing suppresses the second.
  `invocations` reaches 4. Assertion fails.

The fix is the one `reports/current.md` §7.1 already proposes: de-duplicate on a short **time
window** (a recently-seen set with a TTL), not on in-flight state alone.

**Why this is not P6-06's.** Three independent lines of evidence:

1. `git log --oneline -1 --stat 29f87e7` shows the commit touches neither
   `packages/adapters/**` nor `AgentMcpIntegration.test.ts`. Both are exactly as P6-05 left them.
2. The failing block does not execute a single line of P6-06 code. Unlike its neighbouring blocks,
   it does not use `gateway.createExecutor(...)`; it uses a test-local counter
   (`AgentMcpIntegration.test.ts:1000-1003`) passed to `launchHarness`, driving `HarnessAdapter` —
   a `BaseAdapter` subclass defined inside the test file. `McpAgentBridge`, `McpToolGateway`,
   `McpToolPrompt`, `AgentService` and `SkillService` are all absent from that path.
3. Directionally, P6-06's change would *help* rather than hurt: adding skill discovery lengthens the
   real executor, which widens the in-flight window and makes suppression **more** likely — the
   opposite of the observed failure. And the observed failure occurs with an executor that P6-06
   cannot lengthen at all.

**Why the gate still fails.** Attribution changes who should fix it, not whether the criterion was
met. Step 4 states its own pass condition — all suites, 0 failures — and I watched it go red twice.
The TEST-P6-04 report set the standard I am applying here: *"a single green run does not establish
that this battery is green."* Certifying green after observing red would contradict that standard.

### Finding 2 — this is the second distinct flake in the same battery, and the first is still unfixed

Severity: **MEDIUM** (process). Attribution: **PRE-EXISTING**.

TEST-P6-04's Finding 1 (`packages/mcp-memory-server/src/__tests__/relay-client.test.ts` failing
under CPU contention, root-caused to `RELAY_TIMEOUT_MS = 500` at
`packages/mcp-memory-server/src/relay-client.ts:9`) was reported HIGH, with "fix before P6-05" as
recommendation 2. It is **unfixed** — the constant is still `500`. It did not fire in any of this
gate's 5 runs, so it is dormant rather than resolved, and it will return on a busier machine.

The battery has now been red on some fraction of runs at four consecutive gates
(TEST-P6-02: 1/3, TEST-P6-03: 2/5, TEST-P6-04: 2/6, TEST-P6-06: 2/5) with two different root
causes. Both are known, both are cheap, and neither has been scheduled. Until they are, no gate can
distinguish "this task broke the battery" from "the battery is red again" without the kind of
per-assertion attribution this report had to do by hand.

### Finding 3 — `pnpm run test` is still not in CI and still has no `dependsOn: ["build"]`

Severity: **LOW** (repeat of TEST-P6-04 Finding 3). `.github/workflows/ci.yml` runs `lint` and
`build` only, so the flakes above are invisible to CI and cannot regress it — which is also why they
have survived four gates.

### Finding 4 — two untracked scratch files remain in the working tree

Severity: **INFORMATIONAL**. `scratch/_fixbom.ts` and `scratch/_fix_bom.mjs` are present and
untracked, exactly as `reports/current.md` §7.4 discloses (the implementer's environment refused
every deletion attempt). They are excluded from `29f87e7`, are not referenced by any build, and do
not affect any result above. They should be removed manually.

---

## Attribution Summary

| Verification step | Result | P6-06's responsibility? |
|---|---|---|
| 1 — typecheck, 11 tasks, 0 errors | **PASS** | — |
| 2 — lint, 7 packages, 0 errors | **PASS** | — |
| 3 — `SkillService.test.ts`, exit 0 | **PASS** (169/169) | — |
| 4 — full battery, 0 failures | **FAIL** (2/5 runs red) | **No** — `BaseAdapter` / P6-05, see Finding 1 |
| 5 — build, 7 packages | **PASS** | — |

Everything P6-06 delivers is green, cold, and repeatably so. The subsystem's own suite
(`SkillService.test.ts`, 169 assertions) passed on all 7 executions it saw during this gate — 5
inside the battery and 2 standalone — including on both runs where the battery as a whole was red.
The `@asterim/web` suite carrying `SkillsExplorer.test.ts` was green on all 5 battery runs.

---

## Cross-Check of `reports/current.md`

Quantitative claims checked against my own measurements:

| Claim | Verified |
|---|---|
| typecheck 11/11, 0 errors | ✅ |
| lint 7/7, **0 errors** (warnings pre-existing) | ✅ |
| build 7/7 | ✅ |
| `SkillService.test.ts` 169/169 | ✅ exactly |
| 32 suites now, 30 before, task said 31 | ✅ counted: 17 + 6 + 7 + 1 + 1 = 32 |
| §7.1 "`AgentMcpIntegration.test.ts` is load-sensitive and flaked twice during verification", root cause in `BaseAdapter.runToolCall` in-flight de-dup, `packages/adapters/` untouched | ✅ confirmed independently, including the code path — see Finding 1 |
| §7.4 two scratch files remain undeleted | ✅ present and untracked |
| `git diff --stat packages/adapters` empty | ✅ commit touches no adapter file |

The implementer's report is accurate on every quantitative claim I checked, and §7.1 discloses
precisely the defect that failed this gate — including its correct root cause and the correct
observation that the change direction *widens* rather than narrows the de-dup window. The
disclosure is honest and complete; it is the underlying defect, not the reporting of it, that
blocks the gate.

One qualification: `reports/current.md` §4 presents `pnpm test` as "9 successful, 9 total — 32
suites, all assertions passed". A green run does exist — I reproduced it three times — but the
battery is red about 40 % of the time at this SHA, and §7.1 says as much a few pages later. The two
statements are in tension; §7.1 is the accurate one.

---

## Verification Summary

| Step | Criterion | Result |
|---|---|---|
| 1 | typecheck — 0 errors, 11 tasks | **PASS** |
| 2 | lint — 0 errors, 7 packages | **PASS** |
| 3 | `SkillService.test.ts` — exit 0 | **PASS** (169/169) |
| 4 | full battery — all suites, 0 failures | **FAIL** (2 of 5 runs red; 32 suites, not 31) |
| 5 | build — 7/7 packages | **PASS** (27.6 s cold, not <10 s; budget is a warm figure) |

**Gate verdict: FAIL.**

The P6-06 implementation itself is sound and I found nothing wrong with it. The gate fails on its
own step-4 criterion, for a defect that predates the task.

---

## Recommendation

1. **Do not send P6-06 back for rework.** Nothing in the skills subsystem needs changing on this
   evidence. If the orchestrator's intent is to certify P6-06's *own* correctness, that is
   verified; it is the shared battery that is red.
2. **Fix Finding 1 first** — give `BaseAdapter`'s echo de-duplication a short TTL window instead of
   in-flight-only state (`packages/adapters/src/sdk/BaseAdapter.ts:229-256`). It is a real
   correctness bug on the agent tool path, not just a test artefact: a real agent whose duplicate
   call straddles a PTY chunk boundary will have that tool run twice. Re-run this gate afterwards;
   step 4 is the only thing standing between P6-06 and a clean pass.
3. **Fix TEST-P6-04's Finding 1** (`RELAY_TIMEOUT_MS = 500`), still open after three gates.
4. **Correct the gate template**: 32 suites, not 31; and state the build budget as warm (~90 ms)
   versus cold (~28 s).
5. **Then add `pnpm run test` to CI** with `dependsOn: ["build"]`. With Findings 1–3 closed the
   battery would finally be deterministic enough to gate on, which is the only durable fix for a
   problem that has now consumed four consecutive QA gates.

## Recommended Next Step

Report P6-06 to the orchestrator as **implementation-verified, gate-failed on a pre-existing
defect**, and dispatch the `BaseAdapter` de-duplication fix as the next task. Re-running this gate
after that fix should require only steps 4 and 5.
