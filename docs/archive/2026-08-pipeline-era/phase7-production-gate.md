# Phase 7 Production Gate — Multi-Agent Orchestration & Collaborative Workflows

**Gate ID:** P7-06
**Phase:** Phase 7 — Multi-Agent Orchestration & Collaborative Workflows
**Date:** 2026-08-17
**Auditor:** Claude Code (Execution Engineer)
**Orchestrator:** Antigravity
**Governance:** `AGENTS.md`, `blueprint/AI_CONTEXT.md`, `decisions.md` (DEC-028)
**Commit under audit:** `d257161` (`pipeline: dispatch task P7-06`) — working tree clean except `tests/report.md` (P7-05 gate record, left from the prior verification session)
**Toolchain:** Node v24.13.1, pnpm 9.0.0, turbo 2.9.18, TypeScript 5.4

---

## 1. Executive Verdict

**PASS — READY FOR NEXT PHASE.**

Phase 7 delivers a complete, bounded, observable multi-agent delegation subsystem across five
workstreams (P7-01 → P7-05). Every acceptance criterion of every workstream was re-checked
against the code at `d257161`, not against the prior reports. All four monorepo quality gates
were executed in this session with the Turbo cache defeated (`--force`), so each result below is
live execution rather than a replayed log:

| Gate | Command | Result |
| :--- | :--- | :--- |
| Typecheck | `pnpm typecheck --force` | **PASS** — 11/11 Turbo tasks, 0 TypeScript errors |
| Lint | `pnpm lint --force` | **PASS** — 7/7 Turbo tasks, **0 errors** (619 warnings) |
| Test | `pnpm test -- --force` | **PASS** — 9/9 Turbo tasks, **36 suites, 3,719 assertions, 0 failures** |
| Build | `pnpm build --force` | **PASS** — 7/7 Turbo tasks, 0 cached |

The subsystem holds its two safety invariants in code and under test: delegation depth is bounded
at 3, and concurrent children per parent are bounded at 4. Neither bound was weakened by this
audit; no product code was modified.

Three factual discrepancies between the P7-06 task text and the implementation are recorded in
§7. None of them is a defect — they are naming drift in the task brief. They are listed so the
Orchestrator's next brief can be written against reality.

---

## 2. Subsystem Audit Matrix

| # | Subsystem | Source of truth | Verdict | Evidence |
| :-: | :--- | :--- | :---: | :--- |
| 1 | **Delegation protocol & thread hierarchy** | `apps/server/src/services/ai/AgentDelegationService.ts`, `apps/server/src/services/DatabaseService.ts` | **PASS** | `threads.parent_thread_id` + `threads.delegation_context_json` + `idx_threads_parent` (`DatabaseService.ts:610–623`); 412 assertions |
| 2 | **Recursion safety (depth ≤ 3)** | `requireDepthFor` (`AgentDelegationService.ts:570–579`), `MAX_DELEGATION_DEPTH = 3` (`packages/shared/src/types/delegation.ts:31`) | **PASS** | Refuses with `DEPTH_EXCEEDED`; cycle in the parent chain reports `MAX_CHAIN_HOPS` so a corrupted row refuses rather than reading as shallow (`:306–317`) |
| 3 | **Concurrency bounding (≤ 4)** | `delegateParallel` (`AgentDelegationService.ts:744–765`), `MAX_CONCURRENT_DELEGATIONS = 4` | **PASS** | Both the batch size *and* `running + items.length` are checked, so a fan-out cannot be stacked on a running one; `CONCURRENCY_LIMIT_EXCEEDED` → HTTP 409 |
| 4 | **Parent park / clean resumption** | `runDelegation` (`AgentDelegationService.ts:640–708`) | **PASS** | Completion, crash, timeout, failed launch and cancellation all release the parent; release is idempotent in a `finally` block |
| 5 | **Teardown safety** | `safeStop` (`:1446`) → `client.command:stop` → `AgentService.stopAgent` (`:563–608`) | **PASS** | `processTreeManager.killProcessTree(threadId, 3000)` (SIGTERM, SIGKILL escalation after 3s) then `sessionManager.stopSession` → `BaseAdapter.stop()` → `ProcessManager.kill()` |
| 6 | **Parallel fan-out / fan-in** | `delegateParallel`, `aggregateDelegationStatus`, `aggregateReviewVerdict` | **PASS** | `Promise.allSettled` fan-in; `COMPLETED` / `PARTIAL_SUCCESS` / `FAILED` aggregation; one dissenting review carries the batch verdict to `NEEDS_FIX` |
| 7 | **Operator intervention & cancellation** | `cancelDelegation`, `cancelAllDelegations`, `apps/server/src/routes/delegation.ts` | **PASS** | Cancel by parent id or child id; idempotent under double-cancel; a cancellation that beats session start stops nothing and still releases the parent |
| 8 | **Startup orphan recovery** | `recoverDelegations` (`:440`), called from `apps/server/src/index.ts:229` | **PASS** | Dangling children settle `FAILED` with a reason; an interrupted `REVIEW` cannot read as `PASS` |
| 9 | **EventBus synchronization** | `packages/shared/src/types/delegation.ts:264–283`, `apps/web/src/hooks/useSocket.ts` | **PASS** | Five events (`started`, `child_state`, `parent_state`, `completed`, `batch_completed`); live subscription at `useSocket.ts:433`, replay of the three durable ones at `:82–88` |
| 10 | **Meta-tool surface** | `McpAgentBridge.getDelegationTools` (`:142`), `executeDelegationTool` (`AgentDelegationService.ts:1048`) | **PASS** | `delegate_task` / `request_review` / `delegate_parallel` offered only to delegation-capable roles; an unresolvable role returns a readable tool error, never an exception |
| 11 | **Thread hierarchy UI** | `apps/web/src/components/delegation/ThreadTree.tsx`, `SessionSidebar.tsx:255` | **PASS** | Indented tree, role badges, `L1`/`L2` depth pills, collapse, keyboard reachable, per-child stop control |
| 12 | **Supervision & outcome UI** | `apps/web/src/components/delegation/DelegationStatus.tsx`, mounted at `App.tsx:817` | **PASS** | Waiting banner (single + fan-out), single outcome card, batch outcome card, Cancel / Cancel All, precedence rules asserted |
| 13 | **Operator batch composition** | `apps/web/src/components/delegation/DelegateModal.tsx`, mounted at `App.tsx:954` | **PASS** | Third `PARALLEL` tab, 2–4 rows, add/remove bounded, per-row validation, 409 refusal surfaced |
| 14 | **REST surface & auth** | `apps/server/src/routes/delegation.ts` | **PASS** | Every route refuses anonymously (401); `STATUS_BY_CODE` maps refusals to 400/404/409; registered at `index.ts:158` |
| 15 | **Data sovereignty (DEC-028)** | §5 | **PASS** | Zero network primitives anywhere in the delegation subsystem |

---

## 3. Workstream Acceptance-Criteria Audit (P7-01 → P7-05)

Each criterion below is quoted from the task brief that was dispatched for it (recovered from
`git show <dispatch-commit>:tasks/current.md`) and re-verified against the code at `d257161`.

### 3.1 P7-01 — Multi-Agent Handoff & Role Delegation Protocol (`cff2f66`)

| # | Criterion | Verdict | Evidence |
| :-: | :--- | :---: | :--- |
| 1 | SQLite schema supports parent-child hierarchy (`parent_thread_id`) | **PASS** | `DatabaseService.ts:610` / `:615` / `:623` — additive `ALTER TABLE` + `CREATE INDEX IF NOT EXISTS`, so existing `~/.asterim/asterim.db` still opens. Suite: *"the threads table carries the hierarchy"*, incl. *"opening the same database again is idempotent"* |
| 2 | Spawns child sessions under the specified role profile and passes task context | **PASS** | `createChildThread` + `resolveTargetProfile`; suite asserts the child ran *"under the resolved profile"*, *"was handed the task"* and *"and the context"* |
| 3 | Parent pauses and cleanly resumes on completion **or timeout** | **PASS** | `setParentState` / `addWaiting` / `removeWaiting`; suites *"a child that crashes still releases the parent"*, *"a child that never answers times out"*, *"a session that cannot start at all"* |
| 4 | Depth bounded, rejects when depth > 3 | **PASS** | `requireDepthFor`; suite *"the depth bound is enforced"* — depth 4 refused, *"no child was created for it"*, *"nothing was started"* |
| 5 | `delegate_task` / `request_review` callable as meta-tools | **PASS** | `McpAgentBridge.getDelegationTools` (`:142`) wired from `AgentService.ts:278`; suites *"who is offered the meta-tools"*, *"executeDelegationTool"*, *"the bridge routes delegation calls"* |
| 6 | `AgentDelegationService.test.ts` passes with comprehensive assertions | **PASS** | 412/412, standalone run reproduced in this session |
| 7 | Monorepo CI gates pass with 0 errors | **PASS** | §4 |

### 3.2 P7-02 — Delegation UI, Thread Hierarchy & Real-Time Supervision (`cd94e84`)

| # | Criterion | Verdict | Evidence |
| :-: | :--- | :---: | :--- |
| 1 | Sidebar renders hierarchical trees with role badges, depth, live status | **PASS** | `SessionSidebar.tsx:44` (`buildThreadTree`) → `ThreadTreeView` (`:255`); suite `ThreadTreeView` — role badge, `L1`/`L2` pills, pulsing active child, amber parked parent |
| 2 | All four `delegation.*` socket events synchronized in real time | **PASS** | `useSocket.ts:323–325` via `isDelegationEvent`, and `:433` subscribing every `DELEGATION_EVENT_TYPES` entry (now five, incl. `batch_completed`); suite `useProjectStore — delegation events` |
| 3 | Waiting banner with navigation to the child | **PASS** | `DelegationWaitingBanner` (`DelegationStatus.tsx:137`), mounted via `DelegationStatus` at `App.tsx:817`; suite *"and offers a way into the child"* |
| 4 | Completed delegations render structured summary/review cards | **PASS** | `DelegationOutcomeCard` (`:340`) — status badge, verdict, summary, artifacts, transcript link |
| 5 | Operators can manually trigger delegation/review via `DelegateModal` | **PASS** | `DelegateModal` mounted at `App.tsx:954`, opened from the thread header (`:714`) |
| 6 | Startup recovers dangling child threads | **PASS** | `recoverDelegations` (`:440`) called at `index.ts:229`; suite *"recoverDelegations settles children the Core stopped on top of"* — incl. *"nothing is left to settle on a second pass"* and *"no parent is left parked after a restart"* |
| 7 | Web delegation unit tests pass | **PASS** | 401/401 in `DelegationUI.test.ts` |
| 8 | Monorepo CI gates pass with 0 errors | **PASS** | §4 |

### 3.3 P7-03 — Cancellation, Operator Intervention & Lifecycle Control (`da3f69e`)

| # | Criterion | Verdict | Evidence |
| :-: | :--- | :---: | :--- |
| 1 | `cancelDelegation()` aborts, stops the child process, settles `FAILED`, releases the parent | **PASS** | Suite *"cancelDelegation — stopping a child from the parent"*: answers immediately rather than at the timeout, `safeStop` called for the child, child row records the failure + `finishedAt`, parent unparked with nothing pending |
| 2 | `POST /api/v1/threads/:id/delegate/cancel` cancels cleanly with validation | **PASS** | `routes/delegation.ts:227` + `/delegation/cancel` alias (`:231`); suite *"the REST surface"* — 401 anonymous, 404 unknown thread, 409 not delegating, 200 happy path |
| 3 | Cancelling a `REVIEW` records `NEEDS_FIX` | **PASS** | Suite *"cancelDelegation — a cancelled review has not passed"* |
| 4 | Clients receive real-time events clearing the banner and showing the outcome | **PASS** | Terminal `child_state` + `parent_state` + `completed` published exactly once (*"the outcome is published exactly once"*, *"routed to the parent's room"*) |
| 5 | Accessible "Cancel Delegation" action in the waiting banner | **PASS** | Suite *"DelegationWaitingBanner — cancelling (P7-03)"* — labelled for a screen reader, in-flight state, refusal shown as an `alert`, button restored |
| 6 | Both delegation suites pass cleanly | **PASS** | 412/412 and 401/401 |
| 7 | Monorepo CI gates pass with 0 errors | **PASS** | §4 |

Idempotency and races are covered beyond the brief: *"two operators clicking at once"* (one stop,
one resume, one published outcome, first reason recorded), and *"a cancellation that beats the
watch"* (no session ever started, so no subprocess is left behind).

### 3.4 P7-04 — Parallel Delegation, Concurrent Fan-Out & Aggregation (`955c431`)

| # | Criterion | Verdict | Evidence |
| :-: | :--- | :---: | :--- |
| 1 | `delegateParallel()` spawns, monitors and aggregates up to 4 children | **PASS** | Suite *"delegateParallel — several children at once"*: *"all of them before the first answer came back"* proves concurrency, not sequencing |
| 2 | Exceeding 4 rejected with an explicit error code | **PASS** | `CONCURRENCY_LIMIT_EXCEEDED` on both batch size (`:744`) and running total (`:760`); suite *"the concurrency bound counts what is running"* |
| 3 | `delegate_parallel` available to orchestrator/architect profiles | **PASS** | Suite *"delegate_parallel as a meta-tool"* — offered alongside the other two, *"an auditor still gets none of them"* |
| 4 | `BatchDelegationResult` computes overall status and unified verdict | **PASS** | Suite *"aggregateDelegationStatus / aggregateReviewVerdict"* — all/partial/none, *"an empty batch is not a success"*, *"one dissent carries"* |
| 5 | `/delegate/parallel` and `/delegate/cancel-all` with auth and validation | **PASS** | `routes/delegation.ts:160–161`, `:192–193`; suite covers 401 / 400 non-list / 400 empty / 409 over-limit / 404 unknown thread / 200 happy path, plus both aliases |
| 6 | Banner shows every concurrent child with per-child Stop and Cancel All | **PASS** | Suite *"DelegationWaitingBanner — several children at once"*; `DelegationStatusView` offers `onCancelAll` only when `pending.length > 1` (`DelegationStatus.tsx:769`), so a single delegation is not given the same button twice |
| 7 | Aggregated multi-agent outcome card with per-child breakdown and artifacts | **PASS** | `DelegationBatchOutcomeCard` (`:520`); precedence over the single card asserted both ways |
| 8 | Both delegation suites pass cleanly | **PASS** | 412/412 and 401/401 |
| 9 | Monorepo CI gates pass with 0 errors | **PASS** | §4 |

Teardown under fan-out cancellation is explicitly covered: *"no watcher is left on the bus"*,
*"nor on the status channel"*, *"every child process was stopped"*, *"every child row is settled
in storage"* — i.e. no orphaned subprocesses and no dangling EventBus subscriptions.

### 3.5 P7-05 — Operator-Initiated Parallel Batch Delegation (`dba0ebc`)

| # | Criterion | Verdict | Evidence |
| :-: | :--- | :---: | :--- |
| 1 | "Parallel Batch" tab alongside "Delegate Task" and "Request Review" | **PASS** | `DelegateModal.tsx` mode `'PARALLEL'`; suite *"the tab is offered alongside the other two"* |
| 2 | 2–4 subagents with individual roles, tasks, contexts | **PASS** | Suite *"DelegateModalView — parallel batch"* — per-row role selector, task field, context field |
| 3 | Add enabled up to 4, remove enabled down to 2 | **PASS** | `canAddParallelItem` / `canRemoveParallelItem` (`:60`, `:65`); suite *"at four the add control is spent"*, *"which is refused at the minimum of two"* |
| 4 | Validation blocks empty tasks or a count outside [2,4] | **PASS** | `canSubmitParallelDelegation` (`:98–99`); suite *"whitespace is not a task"*, *"and neither is a fifth subagent"* |
| 5 | Dispatches to `POST .../delegate/parallel` and closes on child start | **PASS** | Suite *"parallel batch — dispatch and refusal"* drives the real `fetch` stub: endpoint, POST, auth token, both items as the Core reads them |
| 6 | 409 / 400 refusals rendered in the modal error banner | **PASS** | Suite *"a batch over the limit is refused"* / *"the refusal is what the modal shows"* |
| 7 | Unit coverage for render, add/remove, validation, payload, dispatch | **PASS** | Four dedicated `describe` blocks; suite grew 316 → 401 assertions |
| 8 | Monorepo CI gates pass with 0 errors | **PASS** | §4 |

---

## 4. Full Test Suite Inventory

`pnpm test -- --force` — **36 suites, 3,719 assertions, 0 failures**, 9/9 Turbo tasks, 0 cached,
1m17s. Counts are per-suite in each package's `test` script order.

### `asterim` (server) — 19 suites, 2,118 assertions

| Suite | Assertions |
| :--- | ---: |
| `services/memory/MemoryRelevanceEngine` | 63 |
| `services/memory/DecisionExtractor` | 60 |
| `routes/memory` | 140 |
| `routes/memory-candidates` | 52 |
| `routes/internal` | 51 |
| `services/git/GitDriftDetector` | 64 |
| `services/git/RemoteManager` | 89 |
| `services/SovereignMode` | 21 |
| `services/ProjectMemoryService` | 231 |
| `services/PairingService` | 52 |
| `services/BillingService` | 102 |
| `services/mcp/McpProcessSupervisor` | 115 |
| `services/mcp/McpCapabilityDiscovery` | 89 |
| `services/mcp/McpToolInvocation` | 43 |
| `services/mcp/McpAgentBridge` | 67 |
| `services/mcp/AgentMcpIntegration` | 160 |
| `services/skills/SkillService` | 169 |
| `services/ai/ProfileService` | 138 |
| **`services/ai/AgentDelegationService`** | **412** |

### `@asterim/web` — 8 suites, 1,159 assertions

| Suite | Assertions |
| :--- | ---: |
| `components/memory/DecisionExplorer` | 151 |
| `components/memory/CandidateReview` | 37 |
| `components/memory/MemoryTimeline` | 134 |
| `stores/useMemoryStore` | 113 |
| `components/mcp/McpServerExplorer` | 104 |
| `components/skills/SkillsExplorer` | 85 |
| `components/profiles/ProfileSelector` | 134 |
| **`components/delegation/DelegationUI`** | **401** |

### `@asterim/mcp-memory-server` — 7 suites, 348 assertions

| Suite | Assertions |
| :--- | ---: |
| `resolver` | 42 |
| `stdio_scaffold` | 82 |
| `record_decision` | 87 |
| `relay-client` | 62 |
| `relay_e2e` | 28 |
| `retrieval_tools` | 23 |
| `dogfood_scenario` | 24 |

### `@asterim/relay` — 1 suite, 71 assertions · `@asterim/adapters` — 1 suite, 23 assertions

**Phase 7 delegation coverage: 813 assertions (412 server + 401 web) — 21.9% of the whole battery.**

Both named delegation suites were additionally run standalone in this session, outside Turbo,
and reproduced identical counts:

```
pnpm --filter asterim exec tsx src/services/ai/__tests__/AgentDelegationService.test.ts   → 412/412
pnpm --filter @asterim/web exec tsx src/components/delegation/__tests__/DelegationUI.test.ts → 401/401
```

### Quality gate detail

- **Typecheck** — 11/11 Turbo tasks (8 packages; `@asterim/shared`, `@asterim/web` and
  `@asterim/adapters` builds run as `typecheck` dependencies). 0 errors.
- **Lint** — 7/7 Turbo tasks, **0 errors**. Warnings by package: `asterim` 266, `@asterim/web` 292,
  `@asterim/adapters` 28, `@asterim/marketing` 18, `@asterim/mcp-memory-server` 12,
  `@asterim/shared` 3, `@asterim/relay` 0 — **619 warnings, 0 errors**. This is unchanged in
  character from prior phases; no rule was disabled or downgraded for this gate.
- **Build** — 7/7 Turbo tasks, 0 cached. `asterim` `dist/index.js` 841.85 KB; `@asterim/web`
  1,608.06 KB JS (481.05 KB gzip) + PWA service worker (11 precache entries);
  `@asterim/marketing` 330.02 KB (89.28 KB gzip). The pre-existing Vite
  "chunks larger than 500 kB" advisory on `@asterim/web` persists — a warning, not an error, and
  outside this gate's scope.

---

## 5. Data Sovereignty & Sovereign Mode Attestation (DEC-028)

**Verdict: PASS — the delegation subsystem introduces no new external network boundary.**

| DEC-028 clause | Finding |
| :--- | :--- |
| §1 Zero External Leakage | A grep for `fetch(`, `http://`, `https://`, `axios`, `net.` and `dns.` across `AgentDelegationService.ts`, `routes/delegation.ts` and `packages/shared/src/types/delegation.ts` returns **nothing**. Task descriptions, briefs, child transcripts, summaries and artifacts move only between SQLite (`threads.delegation_context_json`), the in-process `EventBus`, and local PTY subprocesses. |
| §2 Zero Telemetry | No delegation counter, timing beacon or usage event is emitted anywhere outside the local `EventBus`. Batch timings (`startedAt` / `finishedAt`) are returned to the caller and stored locally. |
| §3 Sovereign Mode | `ASTERIM_SOVEREIGN_MODE` gates `RelayClient` and Web Push. Delegation touches neither: child sessions are started by publishing `client.command` on the bus, which routes through `AgentService` → `SessionManager` → local `node-pty`. **Sovereign Mode requires no delegation-specific carve-out, and delegation adds no bypass.** |
| §3 Local CLI execution | `EventBusSessionRunner` never spawns a process itself. It publishes the same three client events the dashboard publishes, so a child inherits the workspace check, profile resolution, tool catalogue and the sanitized subprocess environment `ProcessManager` already builds. No parent environment or credential is passed to a child. |
| §4 Staged Extraction Sovereignty | Unaffected — delegation stages nothing for remote processing. |

**Carried-forward boundary (unchanged by Phase 7):** what the *agent CLI* inside a child session
does with the brief it is handed is governed by that CLI's own vendor, not by Asterim. This is the
same boundary `docs/phase5-production-gate.md` §8.5 (recommendation H8) already raised for
single-session agents. Delegation multiplies the number of such sessions but does not change the
boundary's nature. It remains a recommendation against DEC-028's text, not a Phase 7 defect.

**Authentication posture.** Every delegation route refuses an unauthenticated caller with 401
(`requireUser`, `routes/delegation.ts:53`), backed by the globally registered `authMiddleware`
(`index.ts:76`). The routes do not additionally assert that the authenticated user owns the
project the thread belongs to — consistent with the rest of the Core's single-workstation model
and with the observation already recorded in `docs/phase5-production-gate.md:391`. Not a Phase 7
regression; see §8.

---

## 6. Invariant Verification Detail

### 6.1 Recursion safety — `depth <= 3`

`MAX_DELEGATION_DEPTH = 3` (`packages/shared/src/types/delegation.ts:31`). `requireDepthFor`
computes `getDelegationDepth(parent) + 1` and throws `DEPTH_EXCEEDED` when that exceeds 3, *before*
any child row is written or session started. Two hardening details beyond the brief:

- `getDelegationDepth` carries a `seen` set and a `MAX_CHAIN_HOPS = 64` ceiling. A `parent_thread_id`
  cycle — a corrupted row, not a reachable state — returns `MAX_CHAIN_HOPS`, so the guard refuses
  rather than reading the chain as shallow and letting an unbounded loop through.
- A parallel batch checks depth **once for the whole batch** and refuses it whole; the suite asserts
  no half-started children and no parked parent are left behind.
- The child's brief itself states *"This is delegation depth N of 3"* and instructs the child not to
  delegate onward by reflex (`formatChildBrief`, `:1483`) — a soft guard in front of the hard one.

Over HTTP: `DEPTH_EXCEEDED` → **409**, with the code in the body so a client can branch on it.

### 6.2 Concurrency bounding — `<= 4` per parent

`MAX_CONCURRENT_DELEGATIONS = 4` (`:46`). Two independent checks in `delegateParallel`:

1. `items.length > 4` → `CONCURRENCY_LIMIT_EXCEEDED`.
2. `getActiveDelegationCount(parent) + items.length > 4` → `CONCURRENCY_LIMIT_EXCEEDED`. This is the
   one that matters: the bound is on **agent processes running under one thread**, not on how many
   one call asks for, so two batches of three cannot be stacked.

A sequential `delegateTask` from a parent that already has a batch running is refused with
`ALREADY_DELEGATING`, and a slot frees as soon as a child settles (suite: *"and a fourth fits once
it is done"*). Over HTTP both → **409**.

The **lower** bound of 2 is a UI decision, not a protocol rule: `MIN_PARALLEL_DELEGATIONS = 2` lives
in `DelegateModal.tsx:34` because a one-item "batch" is just a delegation. The Core accepts
`1 <= n <= 4` and refuses an empty list with `INVALID_INPUT` → 400. This matches the P7-04 brief
(`1 <= items.length <= MAX_CONCURRENT_DELEGATIONS`) and diverges from the P7-06 brief's phrasing
(`2 <= children <= 4`); see §7.

### 6.3 Thread hierarchy without transcript collisions

A child is an ordinary thread row with `parent_thread_id` set and its own `delegation_context_json`
brief; it has its own session and therefore its own transcript. The parent never receives the
child's raw terminal — `formatDelegationReport` sends a bounded report
(`MAX_OUTPUT_CHARS = 20000`, `MAX_SUMMARY_CHARS = 2000`), and the suite asserts *"the raw transcript
is not dumped into the parent"*. Events for sibling threads are filtered by `threadId` in
`watchChild` (suite: *"events for other threads are ignored"*).

### 6.4 Clean resumption

Every exit path releases the parent exactly once:

| Child exit | Recorded status | Parent |
| :--- | :--- | :--- |
| Finished, wrote `SUMMARY:` | `COMPLETED` | Released, resumed with the formatted report |
| Crashed | `FAILED` | Released, told why and what to do |
| Never answered | `TIMEOUT` (not folded into `FAILED`) | Released, told it timed out |
| Session could not start | `FAILED` | Released — a failure, not a hang |
| Cancelled by operator | `FAILED` (+ `NEEDS_FIX` if `REVIEW`) | Released immediately, not at the timeout |
| Core restarted mid-flight | `FAILED` by `recoverDelegations` | Not parked after restart |

The release is also repeated idempotently in `runDelegation`'s `finally` block, so a throwing bus
subscriber on a terminal event cannot strand a parent. When the delegation came through a meta-tool,
the report is the tool's result line and is **not** sent a second time into the parent's session
(suite: *"the parent is not written to twice"*).

### 6.5 Teardown safety

`safeStop` publishes `client.command:stop`, which reaches `AgentService.stopAgent`:
`processTreeManager.killProcessTree(threadId, 3000)` sends **SIGTERM** to the whole process tree and
escalates to **SIGKILL** after 3s, then `sessionManager.stopSession` → `BaseAdapter.stop()` →
`ProcessManager.kill()` on the PTY. `safeStop` swallows its own errors by design — stopping a child
must never be what strands the parent. The child's process is stopped **before** the parent is
resumed, so the parent's next move cannot race the child over the same working tree.

`cancelAllDelegations` applies this per child and additionally asserts no bus watcher and no status
listener survives the fan-out.

---

## 7. Discrepancies Between the P7-06 Brief and the Implementation

None of these is a defect. They are recorded so the next brief is written against reality.

| # | Brief says | Repository has | Assessment |
| :-: | :--- | :--- | :--- |
| 1 | Error code `MAX_DELEGATION_DEPTH_EXCEEDED` | `DEPTH_EXCEEDED` (`DelegationErrorCode`, `AgentDelegationService.ts:73`) | Naming drift in the brief. The constant is `MAX_DELEGATION_DEPTH`; the *code* has always been `DEPTH_EXCEEDED`, is asserted as such by the suite (*"says which rule it broke"*), and is part of the client-visible contract. **Not changed** — renaming it would break dashboard branching for a cosmetic gain. |
| 2 | "Parallel delegation strictly bounded to `2 <= children <= 4`" | Core accepts `1..4`; the 2-minimum is `MIN_PARALLEL_DELEGATIONS` in `DelegateModal.tsx` | The Core bound matches the P7-04 brief that specified it. The 2-minimum is a P7-05 UI affordance. Both are enforced where they were specified. |
| 3 | `apps/web/src/components/delegation/DelegationTree.tsx` | `ThreadTree.tsx`, exporting `ThreadTreeView` | File never existed under that name; the P7-02 brief named `ThreadTree.tsx` and P7-03/P7-04 referenced it correctly. |

Additionally, the brief's §4.2 names `pnpm run typecheck` / `lint` / `test` / `build`. The repository
permission allowlist admits the `pnpm <script>` form, which invokes the identical root scripts
(`turbo run <task>`); `pnpm test` additionally needs `--` before `--force` because pnpm intercepts
`test` as a shorthand. Commands actually executed are given verbatim in §4.

---

## 8. Architectural Observations for Phase 8

1. **Thread-level authorization.** Delegation routes authenticate but do not authorize against
   project ownership. On a single-user workstation this is consistent with the rest of the Core; the
   moment multi-user relay-hosted access becomes real, `rbacGuard`-style scoping on
   `/threads/:id/*` becomes load-bearing. Carried forward from `docs/phase5-production-gate.md`.
2. **Synchronous `POST /delegate` holds a request open for up to the delegation timeout**
   (`DEFAULT_DELEGATION_TIMEOUT_MS = 600000`, ceiling `MAX_DELEGATION_TIMEOUT_MS = 3600000`). This is
   deliberate and documented in the route's own header, and the cancel route is what makes it
   bearable. It does mean any reverse proxy placed in front of the Core needs a matching read
   timeout — worth a line in `docs/operations-runbook.md` before any hosted deployment.
3. **Depth 3 × breadth 4 is 84 potential child processes** in the worst case
   (4 + 16 + 64, plus the root). The concurrency bound is **per parent**, not global. Nothing in Phase 7 caps
   total live child sessions across a workstation. A global ceiling — or at least a warning — is the
   natural Phase 8 hardening if fan-out-of-fan-outs becomes a real workflow.
4. **`EventBus` `'*'` re-emission (ADR-008)** remains known technical debt and is now carrying five
   more event types. Unchanged by this phase; noted because delegation is a heavy user of it.
5. **`@asterim/web` bundle is 1.6 MB** (481 KB gzip) and growing with each phase's UI. Code-splitting
   is a standing recommendation, not a gate item.

---

## 9. Phase 8 Transition Plan

Phase 7 is complete and self-consistent: the protocol (P7-01), its supervision surface (P7-02), its
intervention controls (P7-03), its concurrency model (P7-04) and its operator entry point (P7-05)
form a closed loop with 813 assertions over it, and all 39 acceptance criteria across the five
workstreams verify against the code at `d257161`. Nothing in the subsystem is stubbed, mocked in
production, or behind a flag.

Recommended sequencing for Phase 8:

1. **Persist batch results.** `BatchDelegationResult` currently survives a reload only because
   `delegation.batch_completed` is replayed from event history. A first-class record alongside
   `delegation_context_json` would make fan-out outcomes queryable rather than reconstructed.
2. **Global concurrency ceiling** across all parents (observation §8.3).
3. **Delegation transcripts as artifacts.** Children already name artifacts; wiring those to the
   Changes/Git subsystem would close the loop from delegated work to reviewable diff.
4. **Thread-level authorization** ahead of any multi-user surface (observation §8.1).

---

## 10. Reproduction

```bash
git checkout d257161

# Quality gates — --force defeats the Turbo cache so each result is live execution
pnpm typecheck --force        # 11/11 tasks, 0 errors
pnpm lint --force             # 7/7 tasks, 0 errors (619 warnings)
pnpm test -- --force          # 9/9 tasks, 36 suites, 3,719 assertions, 0 failures
pnpm build --force            # 7/7 tasks, 0 cached

# The two Phase 7 suites, standalone
pnpm --filter asterim exec tsx src/services/ai/__tests__/AgentDelegationService.test.ts
pnpm --filter @asterim/web exec tsx src/components/delegation/__tests__/DelegationUI.test.ts
```

---

## 11. Sign-Off

| Item | Status |
| :--- | :---: |
| `docs/phase7-production-gate.md` authored with audit matrices and evidence | **DONE** |
| P7-01 → P7-05 audited against their own acceptance criteria (7 + 8 + 7 + 9 + 8 = 39 criteria) | **39/39 PASS** |
| Monorepo typecheck — 0 errors | **PASS** |
| Monorepo lint — 0 errors | **PASS** |
| Full test battery — 0 failures | **PASS** |
| Production build — clean | **PASS** |
| Recursion depth bound (3) unweakened | **VERIFIED** |
| Concurrency bound (4) unweakened | **VERIFIED** |
| No product code modified by this gate | **VERIFIED** |

**Phase 7 — Multi-Agent Orchestration & Collaborative Workflows: PASS / READY FOR NEXT PHASE.**
