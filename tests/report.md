# TEST REPORT

Task:
GATE-P5 — Phase 5 Comprehensive Production & Integration Gate

Status:
PARTIAL

## Environment

Repository state:
`d10c422` on `main`, working tree clean at start and at end of verification.

Relevant packages:
`asterim` (apps/server), `@asterim/web`, `@asterim/marketing`, `@asterim/relay`,
`@asterim/shared`, `@asterim/adapters`, `@asterim/mcp-memory-server`

Node version:
v24.13.1

Package manager:
pnpm 9.0.0 (turbo monorepo)

Other relevant environment information:
- No test runner exists in the repository; every suite is a standalone `tsx` script that
  exits non-zero on failure. CI runs only `lint` and `build`, so none of these suites run in CI.
- `agy` (Antigravity) CLI present on PATH; `aider` CLI absent (warned by one suite, not fatal).
- A local process was listening on :4000 during the socket probe, which allowed the
  non-sovereign baseline to establish a real relay connection.
- Real-execution probe scripts were written to the session scratchpad, never to the repository.

## Tests Executed

### Test 1 — Prerequisite builds
Command:
`pnpm --filter @asterim/shared build` ; `pnpm --filter @asterim/mcp-memory-server build`
Result:
PASS

Evidence:
`tsc` clean for shared. `tsup` for MCP: `CJS dist/index.js 80.18 KB`, `Build success in 41ms`.

### Test 2 — The 12 suites named in tests/current.md §5
Command:
`pnpm --filter asterim exec tsx src/services/memory/__tests__/MemoryRelevanceEngine.test.ts`
`pnpm --filter asterim exec tsx src/routes/__tests__/memory.test.ts`
`pnpm --filter asterim exec tsx src/routes/__tests__/memory-candidates.test.ts`
`pnpm --filter asterim exec tsx src/services/memory/__tests__/DecisionExtractor.test.ts`
`pnpm --filter asterim exec tsx src/services/git/__tests__/GitDriftDetector.test.ts`
`pnpm --filter asterim exec tsx src/services/__tests__/SovereignMode.test.ts`
`pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/retrieval_tools.test.ts`
`pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/record_decision.test.ts`
`pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/dogfood_scenario.test.ts`
`pnpm --filter @asterim/web exec tsx src/components/memory/__tests__/DecisionExplorer.test.ts`
`pnpm --filter @asterim/web exec tsx src/components/memory/__tests__/CandidateReview.test.ts`
`pnpm --filter @asterim/adapters exec tsx src/sdk/__tests__/ProcessManager.test.ts`
Result:
PASS (12/12, every command exit 0)

Evidence:

| Suite | Assertions | Exit |
| :--- | ---: | :--- |
| MemoryRelevanceEngine | 63/63 | 0 |
| memory routes | 140/140 | 0 |
| memory-candidates | 52/52 | 0 |
| DecisionExtractor | 60/60 | 0 |
| GitDriftDetector | 64/64 | 0 |
| SovereignMode | 21/21 | 0 |
| MCP retrieval_tools | 87/87 | 0 |
| MCP record_decision | 82/82 | 0 |
| MCP dogfood_scenario | 62/62 | 0 |
| web DecisionExplorer | 151/151 | 0 |
| web CandidateReview | 37/37 | 0 |
| adapters ProcessManager | 23/23 | 0 |
| **Total** | **842/842** | |

### Test 3 — Eight further Phase 5 suites present in the repository
Command:
`... tsx packages/mcp-memory-server/src/__tests__/relay_e2e.test.ts` (and `relay-client`,
`resolver`, `stdio_scaffold`), `... tsx apps/web/src/components/memory/__tests__/MemoryTimeline.test.ts`,
`... tsx apps/web/src/stores/__tests__/useMemoryStore.test.ts`,
`... tsx apps/server/src/routes/__tests__/internal.test.ts`,
`... tsx apps/server/src/services/__tests__/ProjectMemoryService.test.ts`
Result:
PASS (8/8, every command exit 0)

Evidence:
relay_e2e 24/24 · relay-client 23/23 · resolver 42/42 · stdio_scaffold 28/28 ·
MemoryTimeline 134/134 · useMemoryStore 113/113 · internal 51/51 · ProjectMemoryService 231/231
= **646/646**. These were run because §3.1.4, §3.5.3 and §3.7.3 of the plan's scope are covered
by these suites and not by the twelve named commands. Grand total across all 20 suites:
**1,488/1,488 assertions, 0 failures.**

### Test 4 — Full monorepo build
Command:
`pnpm run build`
Result:
PASS

Evidence:
`Tasks: 7 successful, 7 total` · `Cached: 4 cached, 7 total` · `Time: 22.447s` · exit 0.

### Test 5 — Typecheck (`tsc --noEmit`) across packages
Command:
`pnpm --filter <pkg> exec tsc --noEmit` for `asterim`, `@asterim/web`, `@asterim/shared`,
`@asterim/adapters`, `@asterim/mcp-memory-server`
Result:
FAIL (1 of 5 packages)

Evidence:
`asterim` exits 1 with 4 errors; the other four packages exit 0 with 0 errors.
```
src/controllers/AuthController.ts(354,34): error TS2304: Cannot find name 'OAuthCodeExchangeRequest'.
src/services/AgentService.ts(164,17): error TS2339: Property 'socketManager' does not exist on type 'typeof import(".../sockets/socketManager")'.
src/services/ContextService.ts(109,59): error TS2339: Property 'type' does not exist on type 'ContextEntry'.
src/services/ai/providers/GeminiProvider.ts(2,29): error TS2307: Cannot find module './IAIProvider' or its corresponding type declarations.
```
`git diff --name-only f036b89~1 HEAD` shows none of these four files was touched by the Phase 5
commits; they were last modified 2026-07-23, 2026-08-07 and 2026-08-08.

### Test 6 — Real-execution socket differential, sovereign vs normal (plan §3.6.1)
Command:
Built binary `node apps/server/dist/index.js` started twice with a temp `ASTERIM_DATA_DIR`,
sockets enumerated from `/proc/<pid>/fd` matched against `/proc/net/{tcp,tcp6,udp,udp6}`.
Result:
PASS (with one finding)

Evidence:
```
MODE=sovereign  (ASTERIM_SOVEREIGN_MODE=true)
  TCP6  LISTEN   local=:::3995
  UDP   ---      local=0.0.0.0:5353
  [RelayClient] Sovereign Mode active: Cloud Relay connection disabled.

MODE=normal (baseline)
  TCP   ESTABLISHED  local=127.0.0.1:37510  remote=127.0.0.1:4000
  TCP6  LISTEN       local=:::3998
  UDP   ---          local=0.0.0.0:5353
```
The outbound relay socket present in the baseline is absent under sovereign mode.
Finding: UDP 5353 (mDNS) stays bound in both modes — see Failure F2.

### Test 7 — Cross-process concurrent SQLite writes (plan §3.7.1)
Command:
Real-execution probe: 4 MCP memory-server processes × 15 `record_decision` calls against one
database, with the real Core Fastify process live on the same file.
Result:
PASS

Evidence:
```
journal_mode at seed: {"journal_mode":"wal"}
  writer 0..3: 15 ok, 0 tool-errors, SQLITE_BUSY seen: false   (each)
  expected decisions:        60
  successful tool responses: 60
  rows in project_decisions: 60
  memory.* rows in events (Core-side writes): 60
  any SQLITE_BUSY / database-is-locked observed: false
  core process alive at end: true
```
`PRAGMA journal_mode = WAL` and `PRAGMA busy_timeout = 5000` confirmed at
`apps/server/src/services/DatabaseService.ts:45` and `:59`.

### Test 8 — MCP stdio resilience to malformed JSON-RPC (plan §3.7.2)
Command:
Real-execution probe: 7 hostile frames written to the built MCP binary's stdin, followed by a
valid `tools/list` survival check.
Result:
PASS (with one finding)

Evidence:
Process survived all 7 frames. Unknown method → `-32601`; unknown tool, missing args and
wrong-typed args → `isError: true` with actionable messages. Post-abuse `tools/list` answered
with 3 tools. stdout across the whole session: **6 lines, 0 non-JSON**.
Finding: garbage, truncated JSON and missing-`method` frames drew **no response at all** —
see Failure F3.

## Acceptance Criteria

### §3.1 End-to-End Multi-Agent Memory & Relay Flow
Status:
VERIFIED (items 2–4 through real execution; items 1 and 5 through automated tests)
Evidence:
`resolver.test.ts` asserts nested and deeply-nested subfolders resolve to the innermost project.
`dogfood_scenario.test.ts` drives the built binary against the live `~/.asterim/asterim.db` and
proves it is not mutated (size + sha256 unchanged). `relay_e2e.test.ts` spawns the Core in its
own process, a real Socket.IO client and the built MCP binary, and asserts delivery is prompt,
not poll-based. `ProjectMemoryService.test.ts` covers `supersedeDecision` lineage
(`supersededBy` null on new, old decision transitions to `SUPERSEDED`) and intent archival.
Test 7 independently shows 60/60 relay notifications under concurrency.

### §3.2 Decision Extraction & Human Confirmation Lifecycle
Status:
VERIFIED through automated tests
Evidence:
`DecisionExtractor.test.ts` (60/60): candidates staged `PENDING` with extraction timestamp and
no review timestamp, and "project_decisions is untouched (DEC-027)".
`memory-candidates.test.ts` (52/52): approval/rejection lifecycle, and "rejecting every
candidate deletes no existing decision".

### §3.3 Real Git Drift & Staleness Engine
Status:
VERIFIED (items 1–3 through real execution; 4–5 through automated tests)
Evidence:
`GitDriftDetector.test.ts` (64/64) creates real temporary Git repositories and shells to the
real `git` CLI, including degraded paths (non-repo, non-existent path). Non-destructiveness is
confirmed from the route side: `memory.test.ts` asserts "the drifted decision is still returned,
not filtered out (DEC-027)" carrying its drift annotation. `DecisionExplorer.test.ts` covers the
drift filter and badge rendering.

### §3.4 Relevance Ranking, Scoped Briefings & Governance Invariants
Status:
VERIFIED through automated tests
Evidence:
`MemoryRelevanceEngine.test.ts` (63/63) asserts the cap keeps the highest-ranked rather than the
first seen, and — at `limit: 0` — "even a zero limit keeps every rule", "and the intent", "while
returning no decisions". `retrieval_tools.test.ts` confirms the same across the MCP boundary and
that repeated identical scoped requests return byte-identical briefings.

### §3.5 Cross-Project Security & Isolation
Status:
VERIFIED (item 2 through real execution; 1 and 3 through automated tests)
Evidence:
`memory.test.ts`: over HTTP, "Project B sees none of Project A decisions/rules/intent".
`memory-candidates.test.ts`: acting on another project's candidate returns 400 and mutates
nothing. `record_decision.test.ts` seeds a second genuinely-registered project so the
cross-project rejection cannot pass vacuously. `resolver.test.ts` has a `segment-safe
containment` block and asserts a path outside every project does not match by prefix.

### §3.6 Sovereign Mode Air-Gap Gate
Status:
PARTIAL — items 2 and 3 VERIFIED; item 1 VERIFIED for relay/push/AI/telemetry, NOT SATISFIED
for mDNS
Evidence:
Item 1: Test 6 shows the outbound relay socket is absent in sovereign mode while present in the
baseline; `SovereignMode.test.ts` proves `socket.io-client` and `web-push` are never invoked
under the switch (and *are* invoked with it off, so the assertion is not vacuous); a dependency
scan finds zero telemetry/analytics SDKs. **But UDP 5353 (mDNS) remains bound in sovereign
mode**, so the literal "ZERO outbound network requests" criterion is not met (Failure F2).
Item 2: `ProcessManager.test.ts` (23/23) with real `spawn` — the child cannot see the relay URL
or the sovereign flag but keeps `ASTERIM_DATA_DIR`.
Item 3: documented in `docs/phase5-production-gate.md` §8.5. Note this boundary is *not*
currently stated in DEC-028 itself.

### §3.7 Failure, Concurrency & Recovery Testing
Status:
VERIFIED through real execution
Evidence:
Item 1 — Test 7: 60/60 rows, zero `SQLITE_BUSY`, WAL and `busy_timeout = 5000` confirmed.
Item 2 — Test 8: survives all 7 malformed frames, stdout purity preserved, recovers fully
(minor spec deviation recorded as F3).
Item 3 — `relay_e2e.test.ts` covers the Core being absent (descriptor removed, recording still
succeeds, decisions durable); `relay-client.test.ts` covers the Core being unresponsive
(abandoned at timeout, failures never surface to the caller).

### §4 Required Deliverables
Status:
VERIFIED
Evidence:
`docs/phase5-production-gate.md` created with all 16 required sections.
`reports/current.md` overwritten with the execution summary.

### §6 Self-Review Checklist
Status:
VERIFIED
Evidence:
All 10 dimensions audited with real evidence; no product feature code altered (`git status`
clean apart from the two intended deliverables); 16-section gate document created; verdict
issued with blockers classified; `reports/current.md` updated.

## Failures

- Classification: PRODUCT_FAILURE (pre-existing, outside Phase 5 scope)
- Command: `pnpm --filter asterim exec tsc --noEmit`
- Expected: exit 0, no type errors
- Actual: exit 1, 4 errors in `AuthController.ts`, `AgentService.ts`, `ContextService.ts`,
  `GeminiProvider.ts`
- Evidence: full error text in Test 5. `git diff --name-only f036b89~1 HEAD` shows the Phase 5
  commits touched none of these files; they were last modified 2026-07-23 / 08-07 / 08-08.
  `pnpm run build` passes because `tsup` transpiles without typechecking, so the green build
  hides this.
- Affected criterion: none of §3 directly; it fails the `CLAUDE.md` self-review cycle, which
  mandates `tsc --noEmit`.

- Classification: DOCUMENTATION_FAILURE (specification gap; implementation matches the approved ADR)
- Command: `/proc`-based socket enumeration of `node apps/server/dist/index.js` with
  `ASTERIM_SOVEREIGN_MODE=true`
- Expected: per plan §3.6.1, zero outbound network activity
- Actual: no outbound TCP (correct), but `UDP 0.0.0.0:5353` (mDNS) stays bound and advertising
- Evidence: Test 6 socket table; both modes hold the 5353 socket. DEC-028 §3 enumerates only
  RelayClient, Web Push and remote AI providers as suppressed — mDNS is not listed, so the code
  matches the ADR while falling short of the gate's literal wording.
- Affected criterion: §3.6.1

- Classification: PRODUCT_FAILURE (minor, non-blocking)
- Command: malformed-frame probe against `packages/mcp-memory-server/dist/index.js`
- Expected: per JSON-RPC 2.0, `-32700` for a parse error and `-32600` for an invalid request
- Actual: garbage, truncated JSON and missing-`method` frames receive no response at all
- Evidence: Test 8 table — the three unparseable/invalid frames show `(no stdout response)`
  while the four well-formed-but-wrong frames answer correctly. The server never crashes and
  stdout purity is preserved, but a client sending a malformed frame with an `id` waits for its
  own timeout.
- Affected criterion: §3.7.2 (resilience is satisfied; protocol conformance is not)

Security findings — reported under plan §4.1 item 12 rather than as test failures, and detailed
in `docs/phase5-production-gate.md` §12:

- **PIN brute-force unmitigated (High).** `PairingService.validatePin` is plain string equality;
  no attempt counter, lockout, delay, or rate limiting exists anywhere in the server (repo-wide
  search for `rate-limit`/`rateLimit`/`@fastify/rate` returns nothing). `/api/v1/auth/pair` is
  exempt from auth middleware and the server binds `::`. 6-digit PIN = 10⁶ keyspace.
- **`pairing_pin.txt` tracked in Git (High).** `git ls-files` lists both `pairing_pin.txt` and
  `apps/server/pairing_pin.txt`; neither is matched by `.gitignore`.
- **`~/.asterim/asterim.db` is mode 0644 and unencrypted (Medium)** while `server.json` is
  correctly 0600.
- **VAPID private key stored as plaintext JSON** in the `settings` table (Low–Medium).

Positive security findings: API keys are stored hashed (`key_hash` UNIQUE + `key_prefix`); the
`/api/v1/internal/*` relay endpoint is defended by loopback-address check + `server.json` token +
`memory.*` event-shape allowlist; zero telemetry or analytics dependencies exist in the monorepo.

## Verification Summary

Tests:
20 passed (test suites, 1,488/1,488 assertions)
0 failed
0 blocked
Plus 3 real-execution probes: 3 passed (2 with findings recorded above)

Build:
PASS — `pnpm run build`, 7/7 turbo tasks, 22.4s

Typecheck:
FAIL — `apps/server` 4 errors (pre-existing, non-Phase-5 files); `@asterim/web`,
`@asterim/shared`, `@asterim/adapters`, `@asterim/mcp-memory-server` all clean

Acceptance criteria:
6 / 7 scope dimensions fully verified; §3.6 partial (mDNS, F2). Both §4 deliverables produced.
All 23 numbered sub-items across §3.1–§3.7 verified except §3.6.1 in its literal "zero outbound"
form.

## Recommendation

PARTIAL — some criteria verified, others remain unresolved.

Every functional claim of the Phase 5 subsystem holds, most of them under real process execution
rather than mocks. What is unresolved is not Phase 5 feature behaviour: the server does not
typecheck (pre-existing), the sovereign-mode criterion is worded more strongly than DEC-028
actually specifies, and the security posture has real gaps the plan itself asked to be surfaced.

The corresponding verdict recorded in the gate document is **CONDITIONAL PASS**.

## Recommended Next Step

For the Antigravity orchestrator:

1. **Rule on F2 (mDNS under sovereign mode).** This is a specification decision, not an
   implementation bug — either amend DEC-028 §3 to state that LAN discovery is deliberately
   retained, or assign a task to suppress the advertisement when the switch is on. The audit
   cannot resolve this without an architectural ruling.
2. **Dispatch a Phase 5.5 hardening task** covering H1–H4 in the gate document: restore
   `tsc --noEmit` to green and add a `typecheck` task to `turbo.json` and CI; add attempt-limiting
   to the pairing PIN; untrack both `pairing_pin.txt` files and treat the committed PINs as
   disclosed; tighten `~/.asterim` file modes to 0700/0600.
3. **Consider wiring the existing 20 suites into CI.** They are high quality and currently run
   only by hand — CI executes `lint` and `build` only, so none of these 1,488 assertions guard
   the repository today.
4. Phase 6 feature work should not begin until H1 lands; further modules written against
   `AgentService` or `ContextService` compound the existing type debt.

No implementation was performed. Product code is unmodified.
