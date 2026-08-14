# Phase 5 Production & Integration Gate — Audit Document

**Gate ID:** GATE-P5
**Phase:** Phase 5 — Project Memory & Continuous Governance Subsystem
**Auditor:** Claude Code (QA / Verification Agent)
**Orchestrator:** Antigravity
**Date:** 2026-08-14
**Repository state:** `d10c422`, working tree clean

---

## 1. Executive Summary

The Phase 5 Project Memory subsystem (5.0–5.4 plus SEC-01 Sovereign Mode) was audited against
the verification plan in `tests/current.md`. Twenty test suites were executed — the twelve named
in the plan plus eight further Phase 5 suites that exist in the repository and cover plan scope
the named commands do not reach. All twenty pass: **1,488 assertions, 0 failures**. The full
monorepo build passes (7/7 turbo tasks).

Three additional **real-execution probes** were run because the plan mandates "Real Execution
First" and the automated suites verify those areas by stub or by in-process injection:

1. A socket-level differential of the built Core binary in sovereign vs. normal mode.
2. A four-process concurrent-write probe against one SQLite database with the Core running.
3. A malformed-JSON-RPC resilience probe against the built MCP binary.

All three confirm the subsystem behaves as specified. The functional claims of Phase 5 hold up
under real process execution.

Two classes of defect were found. Neither originates in Phase 5 feature code:

- **`tsc --noEmit` fails in `apps/server`** with 4 errors. All four are in files last modified
  before the Phase 5 commits; `pnpm run build` masks them because `tsup` transpiles without
  typechecking. Pre-existing debt, not a Phase 5 regression, but the repository does not
  currently typecheck.
- **Security posture findings** — an unmitigated pairing-PIN brute-force surface, two live
  `pairing_pin.txt` credential files tracked in Git, a world-readable memory database, and a
  plaintext VAPID private key. Section 12 records these in full.

**Verdict: CONDITIONAL PASS** (Section 14).

---

## 2. End-to-End Verification

| Plan item (§3.1) | Result | Classification |
| :--- | :--- | :--- |
| 1. Auto-resolution of project from CWD and nested subfolders | PASS | VERIFIED through automated tests |
| 2. Initial `get_project_briefing` with zero history | PASS | VERIFIED through real execution |
| 3. Decision recording over `stdio` JSON-RPC | PASS | VERIFIED through real execution |
| 4. 0ms broadcast via DEC-026 Loopback Relay | PASS | VERIFIED through real execution |
| 5. Supersede / archive with lineage | PASS | VERIFIED through automated tests |

`resolver.test.ts` (42 assertions) covers nested resolution explicitly — *"a nested subfolder
resolves to the innermost project, not the ancestor"*, *"a deeply nested subfolder still resolves
to the innermost project"*, and sibling containment.

`dogfood_scenario.test.ts` (62 assertions) drives the built MCP binary against the **live**
`~/.asterim/asterim.db`, asserting the database is not mutated (size and sha256 unchanged, no
rollback journal left behind).

`relay_e2e.test.ts` (24 assertions) is the strongest evidence in the suite: it spawns the Core
Fastify server in its own process, a real Socket.IO client, and the built MCP binary over stdio,
then asserts a decision recorded by the agent reaches the browser-equivalent client — and that
*"delivery is prompt, not on a poll interval"*. It further proves the agent is unaffected when
the Core is not running, and that decisions are durable regardless of relay availability.

The concurrency probe (Section 10) independently corroborates the relay: 60 of 60 decisions
recorded by four separate MCP processes produced 60 `memory.*` rows written by the **Core**
process, meaning the loopback relay fired on every single write under contention.

---

## 3. Multi-Agent Verification

Four MCP memory-server processes were run concurrently against one database with the Core
Fastify process live on the same file. Every process resolved the same project, wrote
independently, and all writes were durable. No process observed `SQLITE_BUSY` or
`database is locked`. See Section 10 for the full figures.

`ProcessManager.test.ts` (23 assertions, real `spawn`) verifies that agent subprocesses are
handed a scrubbed environment: the child cannot see `ASTERIM_RELAY_URL` or the sovereign flag,
but retains `ASTERIM_DATA_DIR`, colour settings, and the rest of the environment. An explicitly
passed variable still wins over the scrub.

Classification: **VERIFIED through real execution.**

---

## 4. Decision Extraction Verification

| Plan item (§3.2) | Result | Classification |
| :--- | :--- | :--- |
| 1. Transcript parsed from `events` by `DecisionExtractor` | PASS | VERIFIED through automated tests |
| 2. Candidates staged `PENDING` in `candidate_decisions` | PASS | VERIFIED through automated tests |
| 3. Unconfirmed candidates never pollute `project_decisions` | PASS | VERIFIED through automated tests |
| 4. Approval → `HUMAN_CONFIRMED`, `confidence: 1.0` | PASS | VERIFIED through automated tests |
| 5. Rejection marks `REJECTED`, zero decision mutations | PASS | VERIFIED through automated tests |

`DecisionExtractor.test.ts` (60 assertions) asserts every staged candidate is `PENDING`, carries
an extraction timestamp and no review timestamp, and that *"project_decisions is untouched
(DEC-027)"*. `memory-candidates.test.ts` (52 assertions) covers the HTTP lifecycle and asserts
*"rejecting every candidate deletes no existing decision"*.

The staging boundary is the load-bearing invariant of DEC-027 and it holds.

---

## 5. Git Drift Verification

| Plan item (§3.3) | Result | Classification |
| :--- | :--- | :--- |
| 1. Decision anchored to `filePath`, `symbolName`, `commitHash` | PASS | VERIFIED through real execution |
| 2. Working-tree modification and symbol rename | PASS | VERIFIED through real execution |
| 3. `FILE_MODIFIED` and `SYMBOL_NOT_FOUND` detected | PASS | VERIFIED through real execution |
| 4. Drift is non-destructive | PASS | VERIFIED through automated tests |
| 5. UI drift badge renders caution state | PASS | VERIFIED through automated tests |

`GitDriftDetector.test.ts` (64 assertions) creates real temporary Git repositories and shells out
to the real `git` CLI. It additionally covers the degraded paths: a project that is not a Git
repository, and a project path that does not exist — both are reported without throwing.

Non-destructiveness is confirmed from the other side as well: `memory.test.ts` asserts *"the
drifted decision is still returned, not filtered out (DEC-027)"*, carrying its drift annotation
rather than being suppressed. `DecisionExplorer.test.ts` covers the drift filter and badge.

---

## 6. Relevance / Briefing Verification

| Plan item (§3.4) | Result | Classification |
| :--- | :--- | :--- |
| 1. Lexical and file-anchor scoring | PASS | VERIFIED through automated tests |
| 2. Context windowing bounds decision count | PASS | VERIFIED through automated tests |
| 3. **Governance invariant** under `limit: 0` | PASS | VERIFIED through automated tests |

The governance invariant is the sharpest requirement in the plan and is tested directly.
`MemoryRelevanceEngine.test.ts` (63 assertions) asserts that under an explicit cap *"every rule
survives"*, *"the intent survives"*, and — at `limit: 0` — *"even a zero limit keeps every rule"*
and *"and the intent"*, *"while returning no decisions"*. The cap keeps the highest-ranked
decisions, not the first seen.

`retrieval_tools.test.ts` (87 assertions) confirms the same behaviour across the MCP boundary:
a limit caps decisions *"while rules survive the cap"* and *"the intent survives it"*. A negative
limit is refused with the parameter named in the error. Briefings are byte-identical across
repeated identical scoped requests, so ranking is deterministic.

---

## 7. Cross-Project Isolation

| Plan item (§3.5) | Result | Classification |
| :--- | :--- | :--- |
| 1. Project A cannot see Project B decisions / rules / intents | PASS | VERIFIED through automated tests |
| 2. MCP in Project B rejects writes targeting Project A (DEC-023) | PASS | VERIFIED through real execution |
| 3. CWD resolution containment | PASS | VERIFIED through automated tests |

`memory.test.ts` asserts over HTTP that *"Project B sees none of Project A decisions"*, and the
same for rules and intent. `memory-candidates.test.ts` asserts approving or rejecting another
project's candidate returns **400** and *"creates nothing in that project"* / *"leaves it
PENDING"*.

`record_decision.test.ts` (82 assertions) seeds a *second, genuinely registered* project so the
cross-project rejection cannot pass vacuously — a rejected write is refused because of the
project boundary, not because the target does not exist.

Containment is segment-safe: `resolver.test.ts` has a dedicated `segment-safe containment`
block, resolves `/workspace/projects/asterim-core/apps/../lib` correctly, and asserts *"a path
outside every project does not match by prefix"*.

---

## 8. Sovereign Mode Verification

### 8.1 Automated evidence

`SovereignMode.test.ts` (21 assertions) replaces `socket.io-client` and `web-push` with recorders
at module-load time and asserts they are never invoked under `ASTERIM_SOVEREIGN_MODE=true`,
while confirming both *are* invoked with the switch off — so the assertions cannot pass
vacuously. It also verifies the switch contract exactly: the literal string `'true'` enables it,
while `'1'`, `'TRUE'`, and `'false'` do not; `--sovereign` enables it; and it is read live rather
than captured at import. A configured remote AI provider (`gemini`) is replaced by local `agent`
execution.

### 8.2 Real-execution socket differential

The built binary `apps/server/dist/index.js` was started twice with a temporary data directory,
and its kernel sockets were enumerated from `/proc/<pid>/fd` matched against `/proc/net/{tcp,udp}`.

| Mode | Sockets held by the Core process |
| :--- | :--- |
| `ASTERIM_SOVEREIGN_MODE=true` | `TCP6 LISTEN :3995` · `UDP 0.0.0.0:5353` · **no outbound TCP** |
| Sovereign off (baseline) | `TCP ESTABLISHED 127.0.0.1:37510 → 127.0.0.1:4000` · `TCP6 LISTEN :3998` · `UDP 0.0.0.0:5353` |

The relay egress socket present in the baseline is **absent** in sovereign mode, and the log
carries `[RelayClient] Sovereign Mode active: Cloud Relay connection disabled.` This is the
strongest available proof short of a packet filter, and it is consistent with the automated
recorder assertions.

Classification: **VERIFIED through real execution.**

### 8.3 Telemetry

A dependency scan for `posthog`, `mixpanel`, `segment`, `amplitude`, `sentry`, `google-analytics`
and `datadog` across every `package.json` returns nothing. DEC-028 §2 (Zero Telemetry Policy)
holds. Classification: **VERIFIED through code inspection.**

### 8.4 Finding — mDNS is not suppressed

**UDP port 5353 (mDNS) remains bound in sovereign mode.** The Core continues to advertise itself
on the local network segment when the air-gap switch is on.

This is LAN-scoped multicast, not internet egress, and it carries no project memory — but the
plan's §3.6.1 criterion is worded as "**ZERO** outbound network requests," and mDNS multicast is
outbound network activity. DEC-028 §3 enumerates only three things sovereign mode disables
(RelayClient, Web Push, remote AI providers); mDNS is not among them, so the **implementation
matches the approved ADR while falling short of the gate's literal wording.** This is a
specification gap for Antigravity to rule on, not a defect introduced by Phase 5.

### 8.5 Agent subprocess boundary

`ProcessManager` strips internal keys (`ASTERIM_RELAY_URL`, the sovereign flag) from the agent
subprocess environment while preserving `ASTERIM_DATA_DIR` — verified by real `spawn` in
`ProcessManager.test.ts`.

**The boundary must be stated plainly:** sovereign mode governs *Asterim's own* network activity.
It does not and cannot prevent an external agent CLI (`claude`, `aider`, `agy`) launched as a
subprocess from making its own model API calls over the network. Asterim scrubs its internal
keys from that subprocess and does not proxy or intercept its traffic. Air-gap guarantees for the
agent CLI itself are the operator's responsibility, enforced at the network or container layer.
DEC-028 does not currently state this boundary explicitly; Section 15 recommends it be added.

---

## 9. Data Sovereignty Matrix

| Data class | Storage location | Encryption at rest | Access control | Transmission |
| :--- | :--- | :--- | :--- | :--- |
| Project decisions, rules, intents | `~/.asterim/asterim.db` (SQLite, WAL) | **None** | Filesystem, mode **0644** (see §12.3) | Local only; `memory.*` events over loopback + LAN Socket.IO |
| Candidate decisions | same database, `candidate_decisions` | None | as above | Never transmitted until human confirmation |
| Session transcripts / events | same database, `events` | None | as above | Broadcast to paired clients in the project room |
| Git working-tree state | Read from disk on demand, not copied | n/a | OS filesystem | Never transmitted; drift is computed locally |
| Loopback relay token | `~/.asterim/server.json`, mode **0600** | None | Owner-only ✓ | Loopback interface only, token-gated |
| Device pairing PIN | `pairing_pin.txt` in CWD, mode 0644, **tracked in Git** | None | World-readable (see §12.2) | Printed to console, encoded in the pairing QR |
| VAPID private key | `settings` table, plaintext JSON | **None** | as database | Used only for Web Push; suppressed in sovereign mode |
| User account credentials | `users` table | Password hashed | Database file perms | Local |
| API keys | `api_keys` table — `key_hash` + `key_prefix` only | **Hashed ✓** | Database file perms | Local |
| Telemetry / analytics | **Does not exist** | n/a | n/a | **None** |

The design intent of local-first sovereignty is met at the *network* boundary and confirmed by
real execution. It is weaker at the *local filesystem* boundary: the memory database is
world-readable and unencrypted, so any local user account can read every project decision,
session transcript, and rule. See §12.3.

---

## 10. Failure & Recovery Results

### 10.1 Concurrent SQLite writes (§3.7.1) — real execution

Four MCP memory-server processes each recorded 15 decisions as fast as they could into one
database while the real Core Fastify process was live on the same file.

```
journal_mode at seed: {"journal_mode":"wal"}
core started, alive = true
launching 4 concurrent MCP writers x 15 decisions each = 60 expected rows
  writer 0: 15 ok, 0 tool-errors, SQLITE_BUSY seen: false
  writer 1: 15 ok, 0 tool-errors, SQLITE_BUSY seen: false
  writer 2: 15 ok, 0 tool-errors, SQLITE_BUSY seen: false
  writer 3: 15 ok, 0 tool-errors, SQLITE_BUSY seen: false

RESULT
  expected decisions:        60
  successful tool responses: 60
  tool errors:               0
  rows in project_decisions: 60
  memory.* rows in events (Core-side writes): 60
  journal_mode: {"journal_mode":"wal"}
  any SQLITE_BUSY / database-is-locked observed: false
  core process alive at end: true
  core reported lock errors: false
```

Every write landed. The 60 Core-side `memory.*` event rows prove the loopback relay fired on
every write while five processes contended for the same database. `PRAGMA journal_mode = WAL`
and `PRAGMA busy_timeout = 5000` are confirmed in `DatabaseService.ts:45` and `:59`, each
wrapped in a guard that degrades with a warning rather than failing.

Classification: **VERIFIED through real execution.**

### 10.2 MCP stdio resilience to malformed frames (§3.7.2) — real execution

Seven hostile frames were sent to the built MCP binary, followed by a survival check:

| Frame | Process survived | Response |
| :--- | :--- | :--- |
| Plain garbage (`this is not json {{{`) | yes | *(none)* |
| Truncated JSON object | yes | *(none)* |
| Valid JSON, missing `method` | yes | *(none)* |
| Unknown method | yes | `-32601 Method not found` ✓ |
| `tools/call` with unknown tool | yes | `isError: true`, "Unknown tool: not_a_tool" ✓ |
| `record_decision` with no arguments | yes | `isError: true`, "'title' is required…" ✓ |
| `record_decision` with wrong types | yes | `isError: true`, "'title' must be a string, received number." ✓ |
| **Survival check:** valid `tools/list` | yes | answered with **3 tools** ✓ |

Across the whole abusive session, stdout carried **6 lines, 0 non-JSON** — the stdio purity
guarantee holds even under malformed input, and diagnostics stayed on stderr.

**Minor finding:** the three frames that fail to parse or lack a `method` receive **no response
at all**. JSON-RPC 2.0 specifies `-32700` (Parse error) and `-32600` (Invalid Request) for these
cases. The server is resilient — it never crashes and never corrupts stdout — but a client that
sends a malformed frame carrying an `id` waits until its own timeout instead of being told. See
§12.5.

### 10.3 Transport resilience on restart (§3.7.3)

`relay_e2e.test.ts` covers the Core being absent: the descriptor is removed on shutdown,
`record_decision` still succeeds and returns a decision id, and both decisions are durable
regardless of the relay. `relay-client.test.ts` (23 assertions) covers the Core being
*unresponsive*: a hanging Core is abandoned at the timeout rather than when it eventually
answers, and neither a connection failure nor a malformed URL surfaces to the caller.

Memory recording is correctly decoupled from relay availability.

---

## 11. Performance / DX Results

| Measurement | Result |
| :--- | :--- |
| Full monorepo build (`pnpm run build`) | **22.4s**, 7/7 tasks (4 cached) |
| `@asterim/shared` build | `tsc`, clean |
| `@asterim/mcp-memory-server` build | `tsup`, 80.18 KB CJS, 41ms |
| `asterim` server bundle | 607.94 KB CJS, 160ms |
| 20 test suites, 1,488 assertions | all pass |
| MCP cold start to `ready on stdio` | ~2.5s including project resolution |
| 60 concurrent cross-process decision writes | completed within the 9s probe window, zero contention errors |
| Relay delivery | asserted prompt, not poll-interval based |

Developer experience notes: every suite is a self-contained `tsx` script that seeds a temporary
`ASTERIM_DATA_DIR`, prints `PASS`/`FAIL` per assertion, cleans up its temp directories, and exits
non-zero on failure. Several carry comments explaining precisely why they cannot pass vacuously.
This is a genuinely high-quality harness for a repository with no test runner.

---

## 12. Security Findings

### 12.1 Pairing PIN brute-force — **unmitigated**

`PairingService.validatePin()` is a plain string comparison:

```ts
public validatePin(pin: string): boolean {
  return this.currentPin === pin;
}
```

There is **no attempt counter, no lockout, no delay, and no rate limiting anywhere in the
server** — a repository-wide search for `rate-limit` / `rateLimit` / `@fastify/rate` returns
nothing. `/api/v1/auth/pair` is explicitly exempt from the auth middleware, and the server binds
`::` (it prints a LAN URL and a pairing QR code). The PIN is 6 digits — a 10⁶ keyspace, which an
attacker on the same network segment can exhaust rapidly. The PIN rotates only on server restart.

**Severity: High.** This is the weakest link in the local security model.

### 12.2 `pairing_pin.txt` is tracked in Git

```
$ git ls-files | grep pairing_pin
apps/server/pairing_pin.txt
pairing_pin.txt
```

Two live credential files are under version control, and neither is matched by `.gitignore`.
Because the PIN is rewritten on every server start, they also dirty the working tree during
routine work — both were modified by this gate's own test runs and had to be restored.

**Severity: High** (credential in version control; would be published by any repository push).

### 12.3 Memory database is world-readable

```
644 /home/qhukz/.asterim/asterim.db
600 /home/qhukz/.asterim/server.json
```

`server.json` (the loopback relay token) is correctly owner-only. The database that holds every
project decision, rule, intent, candidate, and session transcript is **0644** and unencrypted, so
any local user account can read the entire project memory. This directly weakens the DEC-028 §1
"Zero External Leakage" mandate at the local boundary.

**Severity: Medium** (local access required).

### 12.4 VAPID private key stored in plaintext

`PushService` persists generated VAPID keys as plaintext JSON in the `settings` table
(`PushService.ts:20–29`). Combined with §12.3 this is readable by any local user.

**Severity: Low–Medium.** Suppressed entirely under sovereign mode.

### 12.5 Malformed JSON-RPC frames are silently dropped

See §10.2. Non-conformance with JSON-RPC 2.0 error reporting (`-32700` / `-32600`). No crash, no
stdout corruption, no data risk. **Severity: Low.**

### 12.6 Positive findings

- **API keys are hashed** — the `api_keys` table stores `key_hash` (UNIQUE) plus a `key_prefix`
  for display. No plaintext key material.
- **The internal relay endpoint is well guarded.** `/api/v1/internal/*` is exempt from the auth
  middleware but defends itself with three independent layers: a loopback-address check
  (IPv4-mapped IPv6 normalised), the `x-asterim-loopback-token` header issued in `server.json`
  (mode 0600), and an event-shape allowlist that refuses anything that is not a well-formed
  `memory.*` event carrying a `projectId`. `internal.test.ts` (51 assertions) confirms the
  endpoint refuses everything once the descriptor is cleared. This is the correct design for a
  route that publishes straight onto the EventBus.
- **Zero telemetry / analytics dependencies** anywhere in the monorepo.
- **The live database is never mutated by read-path tooling** — `dogfood_scenario.test.ts`
  verifies size and sha256 are unchanged after a real MCP probe against `~/.asterim/asterim.db`.

---

## 13. Production Blockers

**No blocker originates in Phase 5 feature code.** Every functional criterion in the plan's §3
scope is verified.

Repository-level items that should be resolved before a production release:

| # | Item | Severity | Phase 5 regression? |
| :--- | :--- | :--- | :--- |
| B1 | `tsc --noEmit` fails in `apps/server` (4 errors) — the repo does not typecheck, and `pnpm run build` cannot catch it because `tsup` does not typecheck | High | **No** — pre-existing |
| B2 | Pairing PIN brute-force unmitigated (§12.1) | High | No |
| B3 | `pairing_pin.txt` tracked in Git, two copies (§12.2) | High | No |
| B4 | `asterim.db` world-readable, unencrypted (§12.3) | Medium | No |

The four typecheck errors:

```
src/controllers/AuthController.ts(354,34): error TS2304: Cannot find name 'OAuthCodeExchangeRequest'.
src/services/AgentService.ts(164,17): error TS2339: Property 'socketManager' does not exist on type 'typeof import(".../sockets/socketManager")'.
src/services/ContextService.ts(109,59): error TS2339: Property 'type' does not exist on type 'ContextEntry'.
src/services/ai/providers/GeminiProvider.ts(2,29): error TS2307: Cannot find module './IAIProvider' or its corresponding type declarations.
```

None of these files was touched by the five Phase 5 commits (`f036b89..d10c422`); they were last
modified on 2026-07-23, 2026-08-07, and 2026-08-08. `@asterim/web`, `@asterim/shared`,
`@asterim/adapters`, and `@asterim/mcp-memory-server` all typecheck clean.

---

## 14. Phase 5 Final Verdict

### CONDITIONAL PASS

The Phase 5 Project Memory & Continuous Governance subsystem is **functionally verified**. All
ten verification dimensions were audited; every functional acceptance criterion in §3 of the
plan passes, the majority through real process execution rather than mocks. The governance
invariant, the DEC-027 staging boundary, cross-project isolation, non-destructive drift, and the
DEC-026 loopback relay all hold under real load and under failure.

The conditions attached to this pass are **B1–B4 in Section 13**, none of which is a Phase 5
regression. They are repository-level debt and security-posture gaps that Phase 5 inherited and
did not introduce — but they are real, and B1 in particular means the repository does not
currently typecheck despite a green build.

The `tests/current.md` §6 self-review checklist is satisfied: all ten dimensions audited with
real evidence, no product feature code altered, this document created with all 16 sections, the
verdict classified, and `reports/current.md` updated.

---

## 15. Recommended Phase 5.5 Hardening

| # | Recommendation | Addresses |
| :--- | :--- | :--- |
| H1 | Restore `tsc --noEmit` to green in `apps/server` and add a `typecheck` task to `turbo.json` + CI, so `tsup`'s lack of typechecking can never again hide type errors behind a green build | B1 |
| H2 | Add attempt-limiting to `PairingService.validatePin` — a counter with exponential backoff and lockout, plus a rate limiter on `/api/v1/auth/pair`. Consider widening the PIN keyspace | §12.1 |
| H3 | `git rm --cached` both `pairing_pin.txt` files and add `pairing_pin.txt` to `.gitignore`. Treat the committed PINs as disclosed | §12.2 |
| H4 | Create `~/.asterim/` at mode 0700 and `asterim.db` at 0600, matching the care already taken with `server.json` | §12.3 |
| H5 | Encrypt the VAPID private key at rest, or derive it per-install and keep it out of the general `settings` table | §12.4 |
| H6 | Return `-32700` / `-32600` for unparseable and invalid JSON-RPC frames instead of dropping them silently | §12.5 |
| H7 | Rule on mDNS under sovereign mode: either suppress the advertisement when the switch is on, or amend DEC-028 §3 to state that LAN discovery is intentionally retained | §8.4 |
| H8 | Add the agent-CLI network boundary to DEC-028 explicitly — sovereign mode governs Asterim's own egress, not that of subprocess agent CLIs | §8.5 |
| H9 | Correct the stale `~/.agentdeck/` reference in `.gitignore` (the real data dir is `~/.asterim/`), consistent with the known-stale `.env.example` | Documentation |
| H10 | Untrack `packages/*/tsconfig.tsbuildinfo` — `*.tsbuildinfo` is in `.gitignore` but two files predate the rule and dirty the tree on every build | Hygiene |

---

## 16. Recommendation for Phase 6

**Proceed to Phase 6, with H1–H4 scheduled as a Phase 5.5 hardening task first.**

The Phase 5 subsystem is a sound foundation to build on. Its architecture held up under adversarial
testing: the staging boundary between candidates and decisions, the loopback relay's decoupling
from memory durability, and the governance invariant in the relevance engine are all properly
load-bearing rather than incidental. The test harness the phase leaves behind — 20 self-contained
suites, several explicitly designed not to pass vacuously — is an asset Phase 6 should extend
rather than replace.

Two caveats for Phase 6 planning:

1. **Do not build on a repository that does not typecheck.** H1 should land before Phase 6 feature
   work begins; every additional module written against `AgentService` or `ContextService` compounds
   the existing type debt.
2. **The pairing PIN is the weakest link in the security model** (§12.1–§12.2). If Phase 6 widens
   network exposure in any way, H2 and H3 become blockers rather than hardening items.

Phase 6 should also consider adopting a real test runner. The hand-rolled harness is excellent but
every suite reimplements assertion counting, temp-directory lifecycle, and cleanup; CI currently
runs only `lint` and `build`, so **none of these 1,488 assertions execute in CI** — they pass only
when someone runs them by hand. Wiring the existing suites into CI would be a high-value, low-risk
change.
