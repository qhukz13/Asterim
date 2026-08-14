# Execution Report: GATE-P5 — Phase 5 Comprehensive Production & Integration Gate

**Task ID:** GATE-P5
**Phase:** Phase 5 — Project Memory & Continuous Governance Subsystem
**Status:** VERIFIED (with conditions — see §7 and §8)
**Date:** 2026-08-14
**Author:** Claude Code (QA / Verification Agent)

---

## 1. Summary

The Phase 5 Project Memory subsystem (5.0–5.4 and SEC-01 Sovereign Mode) was audited against the
verification plan in `tests/current.md`. This was a verification gate: **no product code was
modified.**

Twenty test suites were executed — the twelve named in the plan plus eight further Phase 5 suites
that exist in the repository and cover plan scope the named commands do not reach (§3.1.4 relay,
§3.5.3 containment, §3.7.3 restart resilience). All twenty pass: **1,488 assertions, 0 failures.**
The full monorepo build passes (7/7 turbo tasks, 22.4s).

Because the plan mandates "Real Execution First", three additional real-execution probes were run
against the **built binaries** in areas where the automated suites verify by stub or by in-process
injection:

1. **Sovereign-mode socket differential** — kernel sockets enumerated from `/proc`. The outbound
   relay socket present in the baseline is absent under `ASTERIM_SOVEREIGN_MODE=true`.
2. **Cross-process concurrency** — 4 MCP processes × 15 decisions against one database with the
   Core live: 60/60 rows landed, zero `SQLITE_BUSY`.
3. **Malformed JSON-RPC** — 7 hostile frames to the MCP binary: survived all, stdout purity
   preserved, recovered fully.

All functional acceptance criteria in §3 of the plan are verified. Two defects were found, neither
originating in Phase 5 feature code: the server fails `tsc --noEmit` with 4 pre-existing errors,
and the security posture has real gaps (§7). The gate verdict is **CONDITIONAL PASS**.

## 2. Files Changed

| File | Type | Purpose |
| :--- | :--- | :--- |
| `docs/phase5-production-gate.md` | Created | The authoritative gate audit document, all 16 required sections (plan §4.1) |
| `tests/report.md` | Created | QA verification report in the assigned QA-agent format |
| `reports/current.md` | Overwritten | This execution report (plan §4.2) |

**No product code, test, or configuration file was modified.** `git status` is clean apart from
these deliverables. Real-execution probe scripts were written to the session scratchpad, never to
the repository.

Two tracked files (`apps/server/pairing_pin.txt`, and `packages/{adapters,shared}/tsconfig.tsbuildinfo`)
were dirtied as a side effect of running the mandated verification commands — a started server
rewrites its PIN, and builds rewrite build info. Both were restored with `git checkout --`; the
underlying hygiene problem is reported in §7.

## 3. Implementation Details

Not applicable — this task is a verification gate, not an implementation task. The verification
methodology was:

- **Suites**: each suite run individually via `pnpm --filter <pkg> exec tsx <path>`, exit code and
  assertion count captured per run.
- **Socket differential**: the built `apps/server/dist/index.js` started twice with a temporary
  `ASTERIM_DATA_DIR`; socket inodes read from `/proc/<pid>/fd` and matched against
  `/proc/net/{tcp,tcp6,udp,udp6}`. `ss -p` could not attribute sockets to PIDs in this
  environment, so the first probe attempt returned no data and was discarded as a probe failure
  rather than reported as evidence.
- **Concurrency**: four MCP processes driven over stdio while the real Core process held the same
  WAL database, then row counts verified from an independent connection.
- **Malformed frames**: hostile frames written to the MCP binary's stdin with a post-abuse
  `tools/list` survival check and a stdout-purity scan over the whole session.

## 4. Verification

| Check | Command | Result |
| :--- | :--- | :--- |
| Shared build | `pnpm --filter @asterim/shared build` | PASS |
| MCP build | `pnpm --filter @asterim/mcp-memory-server build` | PASS (80.18 KB, 41ms) |
| 12 named suites | plan §5 commands | PASS — 842/842 assertions |
| 8 further Phase 5 suites | relay_e2e, relay-client, resolver, stdio_scaffold, MemoryTimeline, useMemoryStore, internal, ProjectMemoryService | PASS — 646/646 assertions |
| Full build | `pnpm run build` | PASS — 7/7 tasks, 22.447s |
| Typecheck | `pnpm --filter <pkg> exec tsc --noEmit` × 5 | **FAIL in `asterim` (4 errors)**; other 4 packages clean |
| Sovereign socket differential | `/proc` enumeration, built binary | PASS (finding: mDNS) |
| Concurrent writes | 4 MCP processes + live Core | PASS — 60/60, no `SQLITE_BUSY` |
| Malformed JSON-RPC | 7 frames + survival check | PASS (finding: no parse-error reply) |

Per-suite assertion counts, full command output, and the socket tables are recorded in
`tests/report.md` and `docs/phase5-production-gate.md`.

## 5. Acceptance Criteria Review

- [x] **§3.1 End-to-end multi-agent memory & relay flow** — nested CWD resolution, zero-history
      briefing, stdio decision recording, DEC-026 loopback broadcast, supersede/archive lineage.
      Items 2–4 verified through real execution (`relay_e2e` spawns Core + Socket.IO client + built
      MCP binary; delivery asserted prompt, not poll-based). 60/60 relay notifications also
      observed under concurrency.
- [x] **§3.2 Decision extraction & human confirmation** — candidates staged `PENDING`;
      "project_decisions is untouched (DEC-027)" asserted directly; approval and rejection paths
      verified; "rejecting every candidate deletes no existing decision".
- [x] **§3.3 Real Git drift & staleness** — `GitDriftDetector.test.ts` uses real temporary Git
      repositories and the real `git` CLI, including non-repo and missing-path degraded cases.
      Non-destructiveness confirmed from the route side: drifted decisions are still returned with
      their annotation, not filtered out.
- [x] **§3.4 Relevance ranking & governance invariant** — the cap keeps the highest-ranked, not the
      first seen; at `limit: 0` every rule and the intent survive while zero decisions are
      returned; the same holds across the MCP boundary; scoped briefings are byte-identical on
      repeat.
- [x] **§3.5 Cross-project security & isolation** — Project B sees none of Project A's decisions,
      rules or intent over HTTP; acting on a foreign candidate returns 400 and mutates nothing;
      `record_decision.test.ts` seeds a second genuinely-registered project so the DEC-023
      rejection cannot pass vacuously; containment is segment-safe.
- [~] **§3.6 Sovereign Mode air-gap gate** — **PARTIAL.** Items 2 (ProcessManager env scrub, real
      `spawn`) and 3 (boundary documented) verified. Item 1 verified for relay, push, AI provider
      and telemetry — the outbound relay socket is provably absent — **but UDP 5353 (mDNS) remains
      bound in sovereign mode**, so the literal "ZERO outbound network requests" wording is not
      met. The implementation matches DEC-028 §3, which does not list mDNS. Needs an
      architectural ruling.
- [x] **§3.7 Failure, concurrency & recovery** — 60/60 concurrent cross-process writes with WAL and
      `busy_timeout = 5000` confirmed and zero lock errors; MCP survives all malformed frames with
      stdout purity intact; recording succeeds and stays durable whether the Core is absent or
      unresponsive.
- [x] **§4.1 Gate audit document** — `docs/phase5-production-gate.md` created with all 16 sections.
- [x] **§4.2 Execution report** — this file, matching the `AGENTS.md` §5.2 schema.
- [x] **§6 Self-review checklist** — all 10 dimensions audited with real evidence; no product code
      altered; 16 sections present; verdict issued with blockers classified.

## 6. Git Diff Review

`git status` at the end of verification shows only the three deliverables listed in §2. No source
file, test file, schema, route, service, store, or configuration file differs from `d10c422`. The
prohibition in plan §2 ("Zero Feature Code Modifications") is satisfied — no Phase 6 work and no
unapproved product features were introduced.

The two files dirtied by running the mandated commands were restored to `HEAD` before this report
was written, and the diff was captured first (3 files, 3 insertions, 3 deletions — all
regenerated content, no semantic change).

## 7. Problems Discovered

1. **`tsc --noEmit` fails in `apps/server`** — 4 errors in `AuthController.ts`, `AgentService.ts`,
   `ContextService.ts`, `GeminiProvider.ts`. All four files predate the Phase 5 commits
   (`git diff --name-only f036b89~1 HEAD` does not list them). `pnpm run build` passes regardless
   because `tsup` transpiles without typechecking, so a green build actively hides this.
   **Pre-existing; not a Phase 5 regression.**
2. **mDNS is not suppressed under sovereign mode** — UDP 5353 stays bound with the air-gap switch
   on. LAN-scoped and carries no memory data, but it is outbound network activity. Specification
   gap rather than a bug: DEC-028 §3 lists only RelayClient, Web Push and remote AI providers.
3. **Pairing PIN brute-force is unmitigated (High)** — `validatePin` is plain string equality; no
   attempt counter, lockout, delay or rate limiting exists anywhere in the server;
   `/api/v1/auth/pair` is exempt from auth middleware and the server binds `::`. 6-digit keyspace.
4. **`pairing_pin.txt` is tracked in Git (High)** — two copies (`pairing_pin.txt`,
   `apps/server/pairing_pin.txt`), neither matched by `.gitignore`. Live credentials in version
   control, and they dirty the tree on every server start.
5. **`~/.asterim/asterim.db` is mode 0644 and unencrypted (Medium)** — every project decision, rule
   and session transcript is readable by any local user. `server.json` is correctly 0600.
6. **VAPID private key is stored as plaintext JSON** in the `settings` table (Low–Medium).
7. **Malformed JSON-RPC frames get no reply** — parse errors and missing-`method` frames are
   dropped silently instead of returning `-32700` / `-32600`. No crash, no stdout corruption; a
   client with an outstanding `id` simply waits for its own timeout. (Low.)
8. **Stale `~/.agentdeck/` reference in `.gitignore`**, mirroring the known-stale `.env.example`.
   The real data directory is `~/.asterim/`.

Positive findings worth recording: API keys are stored hashed (`key_hash` + `key_prefix`, no
plaintext); the `/api/v1/internal/*` relay endpoint is defended by three independent layers
(loopback-address check, `server.json` token, `memory.*` event-shape allowlist); and the monorepo
contains zero telemetry or analytics dependencies.

## 8. Architectural Concerns

1. **The green build is not a safety net.** `turbo.json` has no `typecheck` task and CI runs only
   `lint` and `build`. Since `tsup` does not typecheck, type errors can accumulate indefinitely
   behind a passing build — which is exactly what has happened. This is the single highest-value
   process fix available.
2. **None of the 1,488 assertions run in CI.** The Phase 5 harness is genuinely good — 20
   self-contained suites, several written with explicit comments about why they cannot pass
   vacuously (`stdio_scaffold` asserts both stdout purity *and* that the stderr log appeared, so a
   build where the database never loaded would not pass). That quality is currently unguarded:
   the suites only run when someone runs them by hand.
3. **The sovereign-mode boundary needs to be stated, not implied.** DEC-028 governs Asterim's own
   egress. It does not and cannot prevent an external agent CLI (`claude`, `aider`, `agy`) spawned
   as a subprocess from making its own model API calls. `ProcessManager` scrubs internal keys from
   that subprocess but does not proxy or intercept its traffic. Operators deploying to air-gapped
   environments need this written down explicitly in the ADR.
4. **The pairing PIN is the weakest link in the local security model** and it sits in front of a
   server that binds all interfaces. If any future phase widens network exposure, items 3 and 4 in
   §7 escalate from hardening to blocking.

## 9. Recommended Next Step

1. **Rule on the mDNS question (§7.2).** This requires an architectural decision, not an
   implementation fix — either amend DEC-028 §3 to state that LAN discovery is deliberately
   retained under sovereign mode, or dispatch a task to suppress the advertisement when the switch
   is on. The audit cannot resolve it unilaterally.
2. **Dispatch a Phase 5.5 hardening task** covering H1–H4 of the gate document: restore
   `tsc --noEmit` to green in `apps/server` and add a `typecheck` task to `turbo.json` + CI; add
   attempt-limiting and rate limiting to the pairing PIN; `git rm --cached` both `pairing_pin.txt`
   files, add them to `.gitignore`, and treat the committed PINs as disclosed; create
   `~/.asterim/` at 0700 and `asterim.db` at 0600.
3. **Wire the existing 20 suites into CI** — high value, low risk, and it converts an
   already-written harness into an actual regression guard.
4. **Hold Phase 6 feature work until H1 lands.** Every further module written against
   `AgentService` or `ContextService` compounds the existing type debt.

Full detail, evidence and the 16-section audit are in `docs/phase5-production-gate.md`; the
QA-format verification report is in `tests/report.md`.
