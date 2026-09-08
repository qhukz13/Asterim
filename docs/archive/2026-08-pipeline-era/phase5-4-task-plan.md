# Phase 5.4 Task Plan: Intelligent Memory & Continuous Governance

**Milestone:** Phase 5.4  
**Status:** PROPOSED & ARCHITECTURALLY AUDITED  
**Date:** 2026-08-14  
**Orchestrator:** Antigravity  
**Executor:** Claude Code  

---

## 1. Current Architecture Findings & Subsystem Audit

An audit of the Phase 5.0–5.3 implementation across `apps/server`, `apps/web`, `packages/mcp-memory-server`, and `packages/shared` established the following:

1. **Single Source of Truth**:
   - [`ProjectMemoryService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/ProjectMemoryService.ts) is the single normative memory engine.
   - Fastify routes ([`apps/server/src/routes/memory.ts`](file:///c:/Projects/Asterim/apps/server/src/routes/memory.ts)) and MCP tools ([`packages/mcp-memory-server/src/index.ts`](file:///c:/Projects/Asterim/packages/mcp-memory-server/src/index.ts)) contain 0 duplicated SQL or lifecycle rules; all operations delegate to `ProjectMemoryService`.
2. **Persistence & Concurrency**:
   - SQLite backed by `node:sqlite` in `~/.asterim/asterim.db`.
   - Configured with `PRAGMA journal_mode = WAL;` and `PRAGMA busy_timeout = 5000;`, enabling concurrent readers and serializing competing multi-process writers safely.
3. **Transport & UI Layer**:
   - `@asterim/mcp-memory-server` provides stdio JSON-RPC (`get_project_briefing`, `query_decisions`, `record_decision`) with stdio isolation (`stdio-guard.ts`) and automatic CWD project resolution.
   - `apps/web` provides the Decision Explorer, Memory Timeline, Re-entry Briefing Card, `SupersedeDecisionModal`, `ArchiveDecisionModal`, `CreateRuleModal`, and `UpdateIntentModal`.
   - Real-time synchronization is driven by [`EventBus.ts`](file:///c:/Projects/Asterim/apps/server/src/services/EventBus.ts) $\rightarrow$ [`SocketManager.ts`](file:///c:/Projects/Asterim/apps/server/src/sockets/socketManager.ts) $\rightarrow$ [`useSocket.ts`](file:///c:/Projects/Asterim/apps/web/src/hooks/useSocket.ts) $\rightarrow$ [`useMemoryStore.ts`](file:///c:/Projects/Asterim/apps/web/src/stores/useMemoryStore.ts).
4. **Session & Execution Storage**:
   - `events` table records raw stream logs and tool executions.
   - `sessions` table tracks `agent_type`, `pid`, `started_at`, `updated_at`, `status`.
   - `approvals` table tracks security clearances.
5. **Git Subsystem**:
   - [`GitService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/git/GitService.ts) contains `DiffManager`, `StatusManager`, `CommitManager`, and `HistoryManager`, with active Git polling and `git.status` event broadcasting.

---

## 2. Actual Gaps & Problem Analysis

| Gap | Severity | Description |
| :--- | :---: | :--- |
| **1. Cross-Process Event Isolation** | **P0** | External MCP processes (Claude Code / Cursor) write directly to SQLite. Because `EventBus` is an in-memory Node `EventEmitter` within the Core server, writes made by external MCP processes do not fire the Core `EventBus`. Connected web clients only receive updates upon manual refresh or tab navigation. |
| **2. Static Code Anchors / No Drift Detection** | **P0** | Decisions store `decision_code_refs` (`filePath`, `symbolName`, `commitHash`). When anchored files are edited, renamed, or deleted in Git, the database records remain unchanged with no warning to agents or humans that an anchor has drifted. |
| **3. Decision Extraction Friction** | **P1** | Agents make architectural decisions during coding sessions, but frequently omit calling `record_decision`. Conversely, autonomous unconfirmed LLM writes directly into memory introduce hallucinations. A candidate staging queue with 1-click human review is missing. |
| **4. Briefing Bloat & Noise** | **P1** | As a project grows, `get_project_briefing` returns all active decisions and rules. There is no token budget bounding, no path-proximity filtering, and no scoped rule matching against the active file context. |

---

## 3. Recommended Phase 5.4 Architecture

```text
                                  ┌──────────────────────────────────┐
                                  │      AI Coding Agent Session     │
                                  │    (Claude / Antigravity / Cursor) │
                                  └─────────────────┬────────────────┘
                                                    │ stdio
                                                    ▼
                                      @asterim/mcp-memory-server
                                      ┌─────────────┴────────────┐
                                      │                          │
                                      ▼                          ▼
                                 Direct SQLite              Loopback IPC
                                 Write via WAL             POST /internal/events
                                      │                          │
                                      │                          ▼
                                      │                   Core Server (Fastify)
                                      │                          │
                                      │                          ▼
                                      │                   Core EventBus
                                      │                          │
                                      │                          ▼
                                      │                    SocketManager
                                      │                          │
                                      │                          ▼
                                      │                   Web UI (Zustand)
                                      ▼
                            ~/.asterim/asterim.db
                     ┌────────────────┴────────────────┐
                     ▼                                 ▼
           project_decisions / refs            candidate_decisions
                     ▲                                 ▲
                     │                                 │
           GitDriftDetector                    DecisionExtractor
      (Git Diff / AST Verification)       (Session Transcript Analyzer)
```

---

## 4. Implementation Ordering & Rationale

### Why Cross-Process Relay MUST Precede Extraction:
If Decision Extraction (P5.4-03) or Git Drift (P5.4-02) were built before the Cross-Process Relay (P5.4-01), any candidate decision generated by an external agent session or background extractor would silently commit to SQLite without notifying the Web UI. Building the **Cross-Process Memory Event Relay (P5.4-01)** first establishes the real-time event pipeline for all subsequent features.

### Sequence:
1. **P5.4-01 — Cross-Process Memory Event Relay & Live Sync** (P0)
2. **P5.4-02 — Git Staleness & Drift Engine** (P0)
3. **P5.4-03 — Decision Extraction Queue & Candidate Review UI** (P1)
4. **P5.4-04 — Relevance Ranking, Scoped Briefings & Noise Reduction** (P1)

---

## 5. Detailed Task Decomposition

### P5.4-01: Cross-Process Memory Event Relay & Live Sync
* **Priority:** P0 (Foundational Infrastructure)
* **Objective:** Allow `@asterim/mcp-memory-server` and external background processes to notify the running Core Server when memory mutations occur, triggering `EventBus` and pushing 0ms Socket.IO updates to connected browsers.
* **Technical Design:**
  - Fastify Core Server writes its local loopback URL and an ephemeral loopback token to `~/.asterim/server.json` upon startup (`{ "url": "http://127.0.0.1:<port>", "token": "<secret>" }`).
  - Core exposes loopback endpoint `POST /api/v1/internal/memory-events` guarded by the loopback token.
  - In `@asterim/mcp-memory-server`, after any successful mutating call (`record_decision`), the server reads `~/.asterim/server.json` (if present) and fires a fire-and-forget HTTP POST to notify Core.
  - Core receives the event and invokes `eventBus.publish(event)`, immediately notifying `SocketManager` and the Web UI.
  - If Core is not running, the MCP server silently continues with 0 delay and zero errors.
* **Files to Modify/Create:**
  - `apps/server/src/services/ServerRegistry.ts` [NEW]
  - `apps/server/src/routes/internal.ts` [NEW]
  - `apps/server/src/index.ts` [MODIFY]
  - `packages/mcp-memory-server/src/index.ts` [MODIFY]
  - `packages/mcp-memory-server/src/relay-client.ts` [NEW]
* **Acceptance Criteria:**
  1. MCP `record_decision` from an external terminal process instantly updates the open Web UI Decision Explorer without manual page refresh.
  2. If Core is stopped, MCP tools operate normally without warnings or crashes.
  3. Internal route rejects requests lacking the valid loopback secret.
* **Verification:**
  - Unit test in `packages/mcp-memory-server/__tests__/relay-client.test.ts`.
  - Integration test simulating real external MCP process writing while Socket.IO client is connected.

---

### P5.4-02: Git Staleness & Drift Engine
* **Priority:** P0 (Trust & Continuity)
* **Objective:** Detect when code changes (file edits, renames, deletions, symbol changes) cause existing architectural decisions to drift from codebase reality, without destructively deleting human decisions.
* **Technical Design:**
  - Implement `GitDriftDetector` in `apps/server/src/services/git/GitDriftDetector.ts`.
  - Evaluates `decision_code_refs` against Git working tree via `GitService`:
    - `FILE_MODIFIED`: Anchored file has unstaged/staged Git modifications or newer commit than `commit_hash`.
    - `FILE_DELETED`: Anchored file no longer exists in working directory.
    - `SYMBOL_NOT_FOUND`: Symbol name no longer exists in file content.
  - Computes `driftStatus: null | 'FILE_MODIFIED' | 'FILE_DELETED' | 'SYMBOL_NOT_FOUND'` for each code reference and aggregates at decision level.
  - Exposes `GET /api/v1/projects/:id/memory/decisions/drift` and attaches drift metadata to `getProjectBriefing()` and `listDecisions()`.
  - Displays visual drift badges in Decision Explorer and Timeline ("Anchor drifted: `AuthService.ts` modified in Git").
* **Files to Modify/Create:**
  - `apps/server/src/services/git/GitDriftDetector.ts` [NEW]
  - `apps/server/src/services/ProjectMemoryService.ts` [MODIFY]
  - `packages/shared/src/types.ts` [MODIFY]
  - `apps/web/src/components/memory/DecisionCard.tsx` / `DecisionExplorer.tsx` [MODIFY]
  - `apps/web/src/components/memory/MemoryTimelineView.tsx` [MODIFY]
* **Acceptance Criteria:**
  1. Modifying or deleting an anchored file flags the decision with appropriate drift status.
  2. Human-confirmed decisions are NEVER automatically deleted or silently invalidated.
  3. Decisions with drift display clear visual caution indicators in the UI and briefing.
* **Verification:**
  - Service test in `apps/server/src/services/__tests__/GitDriftDetector.test.ts`.
  - Component test verifying drift badge rendering in `DecisionExplorer.test.ts`.

---

### P5.4-03: Decision Extraction Queue & Candidate Review UI
* **Priority:** P1 (Intelligence & Human Governance)
* **Objective:** Automatically extract candidate architectural decisions from completed agent session event logs, presenting them in a dedicated review queue for 1-click human confirmation.
* **Technical Design:**
  - Add SQLite table `candidate_decisions` (`id`, `project_id`, `session_id`, `title`, `summary`, `rationale`, `constraints_json`, `related_files_json`, `code_refs_json`, `confidence`, `status: 'PENDING' | 'APPROVED' | 'REJECTED'`, `created_at`, `updated_at`).
  - Implement `DecisionExtractor` service analyzing `events` table (agent reasoning, tool invocations, git diffs) upon session completion.
  - REST endpoints:
    - `GET /api/v1/projects/:id/memory/candidates`
    - `POST /api/v1/projects/:id/memory/candidates/:id/approve` (converts candidate to active decision in `project_decisions` with `provenance: 'HUMAN_CONFIRMED'`)
    - `POST /api/v1/projects/:id/memory/candidates/:id/reject`
  - Web UI: "Candidate Decisions" queue drawer/tab in Memory view with Approve / Edit / Reject buttons.
* **Files to Modify/Create:**
  - `apps/server/src/services/DatabaseService.ts` (schema migration) [MODIFY]
  - `apps/server/src/services/DecisionExtractor.ts` [NEW]
  - `apps/server/src/routes/memory.ts` [MODIFY]
  - `apps/web/src/components/memory/CandidateDecisionQueue.tsx` [NEW]
  - `apps/web/src/stores/useMemoryStore.ts` [MODIFY]
* **Acceptance Criteria:**
  1. Candidate decisions are stored in staging table without polluting authoritative memory.
  2. Human approval transitions candidate to active `HUMAN_CONFIRMED` decision with 1.0 confidence.
  3. Rejection archives the candidate without affecting project history.
* **Verification:**
  - Extractor tests in `apps/server/src/services/__tests__/DecisionExtractor.test.ts`.
  - REST route tests in `apps/server/src/routes/__tests__/memory.test.ts`.
  - Component tests in `apps/web/src/components/memory/__tests__/CandidateQueue.test.ts`.

---

### P5.4-04: Relevance Ranking, Scoped Briefings & Noise Reduction
* **Priority:** P1 (Context Optimization & Token Efficiency)
* **Objective:** Keep agent project briefings compact (< 2 KB / ~1500 tokens) as project history grows, scoping architectural rules and decisions by file proximity and recency.
* **Technical Design:**
  - In `ProjectMemoryService.getProjectBriefing(projectId, options?: { targetFiles?: string[]; maxDecisions?: number })`:
    - Rule Scoping: Filters rules whose `scopePattern` glob matches any of `targetFiles` (or global `*`).
    - Decision Scoping: Scores active decisions:
      1. Exact file match on code refs (+10).
      2. Directory ancestor match (+5).
      3. Global unanchored decisions (+2).
      4. Recency decay for unanchored decisions.
    - Token Budget Cap: If total active decisions exceed budget (default 15), includes the top 15 ranked decisions and a summary line: `"Showing top 15 of 42 active decisions. Use query_decisions(filePath) for path-specific queries."`
  - In `@asterim/mcp-memory-server`, `get_project_briefing` accepts optional `targetFiles` array or active file path.
* **Files to Modify/Create:**
  - `apps/server/src/services/ProjectMemoryService.ts` [MODIFY]
  - `packages/mcp-memory-server/src/index.ts` [MODIFY]
  - `packages/shared/src/types.ts` [MODIFY]
* **Acceptance Criteria:**
  1. Project briefings stay strictly under the token limit regardless of total decision count.
  2. Scoped rules matching `services/auth/**` appear when querying auth files and are omitted when querying frontend files.
  3. Global unanchored rules and active intent always appear in all briefings.
* **Verification:**
  - Ranking tests in `apps/server/src/services/__tests__/BriefingRanking.test.ts`.
  - MCP tool tests in `packages/mcp-memory-server/__tests__/briefing-scoping.test.ts`.

---

## 6. Task Dependency Graph & Complexity Matrix

```text
[ P5.4-01: Cross-Process Event Relay ] (P0, Medium)
                  │
                  ├───────────────────────────────┐
                  ▼                               ▼
[ P5.4-02: Git Staleness & Drift ]   [ P5.4-03: Decision Extraction Queue ]
         (P0, Medium)                          (P1, High)
                  │                               │
                  └───────────────┬───────────────┘
                                  ▼
             [ P5.4-04: Relevance Ranking & Scoped Briefings ]
                               (P1, Medium)
```

---

## 7. Explicitly Rejected Approaches

1. **No Vector Databases (Pinecone / Chroma / Milvus / sqlite-vss)**:
   - *Rationale:* Vector search introduces massive native binary overhead, non-deterministic similarity thresholds, and hallucinated relevance. Structured path-matching and AST symbols provide 100% deterministic, zero-latency retrieval.
2. **No Autonomous Direct-to-Production LLM Memory Writes**:
   - *Rationale:* An LLM autonomously writing directly to authoritative memory creates compounding hallucination loops across sessions. The candidate queue (`Candidate -> Human Review -> Authoritative`) preserves human governance.
3. **No Automatic Decision Deletion on Git Drift**:
   - *Rationale:* Deleting decisions when files change destroys architectural rationale. Flagging drift non-destructively preserves the historical context while alerting engineers to re-evaluate.
4. **No Heavy External IPC Daemons (Redis / ZeroMQ)**:
   - *Rationale:* Violates Asterim's zero-configuration local-first principle. Lightweight loopback HTTP / registry files provide instant IPC with zero external dependencies.

---

## 8. Gate Conditions for Phase 5.5 / Phase 6

Phase 5.4 is certified complete when:
1. External MCP agent writes update the running Web UI in 0ms via loopback relay.
2. Git modifications trigger drift warnings on anchored decisions in UI and briefings.
3. Candidate decisions extracted from sessions can be reviewed and confirmed via the UI.
4. Project briefings remain strictly bounded and scoped by file proximity.
5. All test suites pass 100% and `pnpm run build` succeeds cleanly across all packages.
