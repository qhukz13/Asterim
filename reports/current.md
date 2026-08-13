# Phase 5.1 Dogfood Report

## Status

**READY FOR PHASE 5.2**

---

## Executive Summary

Phase 5.0 (Project Memory Core) and Phase 5.1 (Cross-Agent MCP Memory Server) were evaluated under a simulated real-world developer and AI-agent pairing workflow. 

Beyond unit and integration tests, we performed a multi-session, multi-process dogfood validation spanning three distinct agent contexts (Claude Code, Antigravity, and Cursor), verifying:
1. Frictionless startup and automatic project context resolution via CWD longest-prefix matching.
2. Cross-session continuity: an architectural decision recorded by an agent in Session A was immediately discovered, understood, and respected by a new agent in Session B without human intervention or re-prompting.
3. Strict project boundary isolation and rejection of cross-project writes from a neighboring workspace.
4. Concurrency resilience under active database lock contention (verifying the `PRAGMA busy_timeout = 5000` fix).
5. 100% stdio protocol purity with zero log leakage onto stdout.

The system proves that Asterim Project Memory provides genuine, persistent architectural continuity across disjoint agent sessions.

---

## Systems Verified

| Subsystem | Verified Behavior | Status |
| :--- | :--- | :---: |
| **`@asterim/mcp-memory-server`** | Stdio JSON-RPC 2.0 transport over Node 22 (`node:sqlite`). Bundle size 54.69 KB. | **VERIFIED** |
| **`stdio-guard`** | Intercepts `globalThis.console`, routing all database and server logs to `stderr`. | **VERIFIED** |
| **`resolveProjectContext`** | 4-tier resolution (`--project` $\rightarrow$ `--project-path` $\rightarrow$ `ASTERIM_PROJECT_ID` $\rightarrow$ CWD auto-detection). | **VERIFIED** |
| **`get_project_briefing`** | Deterministic JSON snapshot containing active decisions, rules, intent, and session history. | **VERIFIED** |
| **`query_decisions`** | File-anchored lookup (`filePath`) and status lifecycle filtering (`status`). | **VERIFIED** |
| **`record_decision`** | Write path with agent defaults (`provenance: 'AGENT_STATEMENT'`, `confidence: 0.75`), enum checks, and boundary enforcement. | **VERIFIED** |
| **`DatabaseService` Concurrency** | SQLite WAL mode + `PRAGMA busy_timeout = 5000` preventing instant `SQLITE_BUSY` lock failures. | **VERIFIED** |

---

## Real MCP Client Validation

A real child process executing `packages/mcp-memory-server/dist/index.js` was initialized over stdio JSON-RPC:
* **Initialize Handshake**: Protocol version `2024-11-05` negotiated successfully; server announced `{"name":"asterim-mcp-memory","version":"0.1.0"}`.
* **Tool Discovery**: `tools/list` returned all 3 memory tools with complete input schemas and enum constraints.
* **Metadata & Scoping**: `get_project_briefing` returned project-scoped memory without requiring explicit flags.

---

## Session A — Initial Investigation & Architectural Decision

* **Agent Role**: Claude Code working in `Asterim Core Platform` workspace (`/workspace/asterim-core`).
* **Actions**:
  1. Called `get_project_briefing`: received active intent ("Establish local-first cross-agent project memory core") and standing architectural rules ("All MCP memory operations must delegate strictly to ProjectMemoryService"). Active decisions count: 0.
  2. Called `query_decisions({ filePath: 'apps/server/src/services/AuthService.ts' })`: confirmed no existing decisions governed password hashing.
  3. Called `record_decision`:
     - **Title**: *"Adopt Argon2id for User Password Hashing"*
     - **Summary**: Argon2id memory-hard hashing with 64MB cost and 3 iterations.
     - **Rationale**: Resists GPU-accelerated dictionary attacks.
     - **Constraints**: *"Never store or log plaintext passwords"*, *"Provide automatic rehash on login"*.
     - **Code Refs**: Anchored to `apps/server/src/services/AuthService.ts#hashPassword` and `AuthService.ts#verifyPassword`.
     - **Confidence**: `0.95`.
* **Result**: Decision persisted with ID `c4635292-5a2a-456d-8aaf-6f6ae0f3cfc5`, `provenance: 'AGENT_STATEMENT'`, `confidence: 0.95`. Process terminated cleanly.

---

## Session B — Subsequent Agent Session (Cross-Session Continuity)

* **Agent Role**: Antigravity re-entering the project in a nested subdirectory (`apps/server/src/services/`) without passing `--project`.
* **Actions**:
  1. Auto-resolution automatically matched CWD to `proj-asterim-dogfood` via longest-prefix containment.
  2. Called `get_project_briefing`: found 1 active decision (*"Adopt Argon2id for User Password Hashing"*) and inherited the constraints.
  3. Called `query_decisions({ filePath: 'apps/server/src/services/AuthService.ts' })`: immediately returned the Argon2id decision and its anchored code refs.
  4. Recorded follow-up decision: *"Enforce 15-minute Sliding Expiration for Session Tokens"* with constraint *"Rotate refresh tokens on every renewal"*, anchored to `SessionService.ts`.
* **Conclusion**: The new agent understood the prior architectural choices and constraints **purely from Asterim Project Memory** without needing the human operator to restate context.

---

## Cross-Agent Validation & Boundary Testing

* **Agent Role**: Cursor simulated working in a separate registered workspace: `Neighbor Service` (`/workspace/neighbor-svc`).
* **Observations**:
  1. **Project Isolation**: `get_project_briefing` returned 0 active decisions (zero data leakage from Project Primary).
  2. **Boundary Enforcement**: Attempted `record_decision` with `projectId: 'proj-asterim-dogfood'`. Call was strictly rejected in-band:
     `"Cannot record decision for project 'proj-asterim-dogfood' from workspace of project 'proj-asterim-neighbor'."`
  3. **Input Validation**: Malformed requests (missing required title/summary/rationale, out-of-bounds confidence `150`, unknown argument typo `relatedFile`) were all rejected in-band before transaction opening.

---

## Concurrency & Lock Contention Testing

* **Scenario**: A background writer held an open SQLite write transaction (`BEGIN IMMEDIATE`) on `asterim.db` for 1500ms while an MCP client attempted `record_decision`.
* **Observed Result**: The MCP client waited 1534ms and succeeded smoothly once the lock cleared, confirming that `PRAGMA busy_timeout = 5000` prevents instant lock crashes.

---

## Developer Experience

**Score: 8.5 / 10**

### Strengths
* **Zero Configuration for CWD**: Launching MCP from anywhere inside the project workspace automatically binds the right project.
* **Deterministic & Compact**: The briefing delivers high-signal context (intent, standing rules, active decisions) in under 1 KB of structured JSON, saving substantial context window budget.
* **Resilient Protocol Handling**: Handled errors return clean in-band JSON-RPC text responses, keeping the client connection alive across validation failures.

### Opportunities for Improvement
* **Agent Proactivity**: External LLMs do not inherently know to call `get_project_briefing` on turn 1 unless prompted in `.cursorrules`, `CLAUDE.md`, or custom instructions.
* **Binary Relocatability**: `dist/index.js` currently requires referencing the absolute path inside the Asterim checkout because `@modelcontextprotocol/sdk` is external.

---

## Problems Discovered

### P0 (Blocking)
* *None*.

### P1 (Significant Value Reduction)
* **Cross-Process Event Broadcasting**: MCP writes commit to SQLite, but the running Core dashboard does not live-update over WebSocket until page reload because `EventBus` is in-process memory. (Recorded in `blueprint/audit/MISSING_SPECIFICATION.md` § 4).

### P2 (Improvements)
* **Standalone Binary Bundling**: Bundle or publish `@asterim/mcp-memory-server` so clients don't depend on the repo's `node_modules`.
* **Automated CI Concurrency Suite**: Add a multi-process lock contention test into the standard turbo test pipeline.

---

## Product Value Assessment

Asterim Project Memory successfully solves the **"amnesia between sessions"** problem for AI coding assistants. When multiple agents collaborate on a codebase across sessions, memory shifts from ephemeral conversational context into durable, auditable project infrastructure.

---

## Phase 5.2 Readiness

**READY FOR PHASE 5.2**

The memory core and MCP layer are production-ready for UI integration. We proceed to Phase 5.2:
1. Project Decision Explorer UI.
2. Memory Timeline View.
3. Re-entry Memory Briefing Card.

---

## Evidence

* Verification Script: [`dogfood_gate_verification.ts`](file:///C:/Users/qhukz/.gemini/antigravity/brain/3c7d09d7-4759-482c-8e03-46e6927ede69/scratch/dogfood_gate_verification.ts)
* Test Suite Runs:
  - `packages/mcp-memory-server/src/__tests__/dogfood_scenario.test.ts` (49/49 PASS)
  - `packages/mcp-memory-server/src/__tests__/record_decision.test.ts` (82/82 PASS)
  - `packages/mcp-memory-server/src/__tests__/retrieval_tools.test.ts` (71/71 PASS)
  - `packages/mcp-memory-server/src/__tests__/resolver.test.ts` (42/42 PASS)
  - `packages/mcp-memory-server/src/__tests__/stdio_scaffold.test.ts` (28/28 PASS)
  - `apps/server/src/services/__tests__/ProjectMemoryService.test.ts` (217/217 PASS)
  - `apps/server/src/routes/__tests__/memory.test.ts` (77/77 PASS)
* Full Monorepo Build: 7/7 packages clean (3.98s).
