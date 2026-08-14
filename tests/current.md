# [GATE-P5] — Phase 5 Comprehensive Production & Integration Gate

**Gate ID:** GATE-P5  
**Phase:** Phase 5 — Project Memory & Continuous Governance Subsystem  
**Assigned Agent:** Claude Code (Execution Engineer)  
**Orchestrator:** Antigravity (CTO / Lead Architect)  
**Status:** ASSIGNED  
**Date:** 2026-08-14  

---

## 1. Objective

Execute a comprehensive, realistic production and integration gate for the entire Phase 5 Project Memory subsystem (Phases 5.0–5.4 and SEC-01 Sovereign Mode) across real processes, real Git repositories, real MCP transports, and real Socket.IO clients.

Audit the subsystem against data sovereignty, air-gap guarantees, governance invariants, and failure resilience, and produce the authoritative audit document [`docs/phase5-production-gate.md`](file:///c:/Projects/Asterim/docs/phase5-production-gate.md).

---

## 2. Testing Mandates & Protocols

* **Real Execution First**: Do not rely merely on mock units or past claims. Execute real processes (`stdio` JSON-RPC for MCP, HTTP/WebSocket for Fastify/Socket.IO, real temporary Git repos for drift).
* **Clear Evidentiary Classification**: In your findings and report, strictly categorize every verified capability as:
  - `VERIFIED through real execution`
  - `VERIFIED through automated tests`
  - `INFERRED from code inspection`
  - `NOT VERIFIED`
* **Zero Feature Code Modifications**: This is a production gate and audit. Do **not** implement Phase 6 or add unapproved product features.

---

## 3. Scope of Verification

### 3.1 End-to-End Multi-Agent Memory & Relay Flow
Verify the live dogfooding scenario:
1. Auto-resolution of project from CWD and nested subfolders.
2. Initial `get_project_briefing` retrieval by an agent with zero conversational history.
3. Decision recording via `@asterim/mcp-memory-server` over `stdio` JSON-RPC.
4. Instant 0ms broadcast to developer Web UI via DEC-026 Loopback Relay (`POST /api/v1/internal/relay/event` -> EventBus -> Socket.IO room).
5. Human decision supersede and archive flows with lineage tracking (`supersededBy`, `supersedes`).

### 3.2 Decision Extraction & Human Confirmation Lifecycle
Verify DEC-027 Staged Extraction:
1. Session transcript parsed from `events` table by `DecisionExtractor`.
2. Candidates staged into `candidate_decisions` table with status `PENDING`.
3. Proof that unconfirmed candidates **never** pollute `project_decisions`.
4. Human approval transitions candidate to `project_decisions` with `provenance: 'HUMAN_CONFIRMED'` and `confidence: 1.0`.
5. Candidate rejection marks `REJECTED` with zero decision mutations.

### 3.3 Real Git Drift & Staleness Engine
Verify DEC-027 Non-Destructive Drift Detection in a real Git working tree:
1. Decision anchored to `filePath`, `symbolName`, and `commitHash`.
2. Working tree file modifications and symbol renames.
3. Drift detector identifies `FILE_MODIFIED` and `SYMBOL_NOT_FOUND`.
4. Proof that drift is non-destructive (the decision status remains `ACTIVE` or `SUPERSEDED`, never deleted).
5. UI drift badge renders caution state.

### 3.4 Relevance Ranking, Scoped Briefings & Governance Invariants
Verify `MemoryRelevanceEngine`:
1. Lexical and file-anchor scoring (provenance weight + touchPath boost + keyword match - drift penalty).
2. Context windowing (`limit`) bounds decision count.
3. **Governance Invariant**: 100% of active `architecturalRules` and `currentIntent` are preserved even under `limit: 0`.

### 3.5 Cross-Project Security & Isolation
Verify multi-tenant workspace boundaries:
1. Project A cannot access or see Project B's decisions, rules, or intents.
2. MCP memory server started in Project B strictly rejects writes targeting Project A (`DEC-023`).
3. CWD resolution containment check prevents escaping workspace boundaries.

### 3.6 Sovereign Mode Air-Gap Gate
Verify DEC-028 Sovereign Mode (`ASTERIM_SOVEREIGN_MODE=true` and `--sovereign`):
1. Asterim Core initiates **ZERO outbound network requests** (RelayClient disabled, PushService suppressed, telemetry = 0).
2. Agent subprocess environment sanitization (`ProcessManager` strips internal keys while preserving `ASTERIM_DATA_DIR`).
3. Explicit documentation of the boundary between Asterim network activity and external agent CLI model calls.

### 3.7 Failure, Concurrency & Recovery Testing
Verify system robustness under stress:
1. Concurrent SQLite writes between Core Fastify server and MCP memory server processes under WAL mode and `PRAGMA busy_timeout = 5000`.
2. MCP stdio recovery from malformed JSON-RPC frames and invalid arguments.
3. Transport resilience on server restart.

---

## 4. Required Deliverables

1. **Gate Audit Document**: Create [`docs/phase5-production-gate.md`](file:///c:/Projects/Asterim/docs/phase5-production-gate.md) covering all 16 required sections:
   1. Executive Summary
   2. End-to-End Verification
   3. Multi-Agent Verification
   4. Decision Extraction Verification
   5. Git Drift Verification
   6. Relevance / Briefing Verification
   7. Cross-Project Isolation
   8. Sovereign Mode Verification
   9. Data Sovereignty Matrix (Storage location, encryption, access, transmission)
   10. Failure & Recovery Results
   11. Performance / DX Results
   12. Security Findings (including plaintext keys and PIN brute-force status)
   13. Production Blockers
   14. Phase 5 Final Verdict (`PASS`, `CONDITIONAL PASS`, or `BLOCKED`)
   15. Recommended Phase 5.5 Hardening
   16. Recommendation for Phase 6
2. **Execution Report**: Overwrite [`reports/current.md`](file:///c:/Projects/Asterim/reports/current.md) with the comprehensive test execution summary matching `.agents/templates/REPORT_TEMPLATE.md`.

---

## 5. Verification Commands

```bash
# Force rebuild shared package and MCP binary
pnpm --filter @asterim/shared build
pnpm --filter @asterim/mcp-memory-server build

# Run all test suites across server, MCP, web, and adapters
pnpm --filter asterim exec tsx src/services/memory/__tests__/MemoryRelevanceEngine.test.ts
pnpm --filter asterim exec tsx src/routes/__tests__/memory.test.ts
pnpm --filter asterim exec tsx src/routes/__tests__/memory-candidates.test.ts
pnpm --filter asterim exec tsx src/services/memory/__tests__/DecisionExtractor.test.ts
pnpm --filter asterim exec tsx src/services/git/__tests__/GitDriftDetector.test.ts
pnpm --filter asterim exec tsx src/services/__tests__/SovereignMode.test.ts
pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/retrieval_tools.test.ts
pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/record_decision.test.ts
pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/dogfood_scenario.test.ts
pnpm --filter @asterim/web exec tsx src/components/memory/__tests__/DecisionExplorer.test.ts
pnpm --filter @asterim/web exec tsx src/components/memory/__tests__/CandidateReview.test.ts
pnpm --filter @asterim/adapters exec tsx src/sdk/__tests__/ProcessManager.test.ts

# Full monorepo build check
pnpm run build
```

---

## 6. Self-Review Checklist

- [ ] All 10 verification dimensions audited with real evidence
- [ ] No product feature code altered outside test fixtures / docs
- [ ] `docs/phase5-production-gate.md` created with all 16 sections
- [ ] Final verdict issued with clear classification of blockers / non-blockers
- [ ] `reports/current.md` updated with full test results
