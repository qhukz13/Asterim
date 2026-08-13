# Phase 5.1 — Cross-Agent MCP Memory Server Task Plan

**Document Version**: 1.0.0  
**Status**: Canonical Task Plan  
**Author**: Asterim Lead Architect & Orchestrator  
**Target Subsystem**: `packages/mcp-memory-server`

---

## 1. Validated Architecture & Design Decisions

### 1.1 Architecture & Boundary
```text
┌────────────────────────────────────────────────────────┐
│             AI Agent (Claude Code / Antigravity)       │
└───────────────────────────┬────────────────────────────┘
                            │  Model Context Protocol
                            │  (stdio transport)
                            ▼
┌────────────────────────────────────────────────────────┐
│             @asterim/mcp-memory-server                 │
│         (packages/mcp-memory-server)                   │
│                                                        │
│   ┌────────────────────────────────────────────────┐   │
│   │           Project Context Resolver             │   │
│   │   (--project / ASTERIM_PROJECT_ID / CWD match) │   │
│   └───────────────────────┬────────────────────────┘   │
│                           │                            │
│   ┌───────────────────────▼────────────────────────┐   │
│   │               MCP Tools Registry               │   │
│   │  • get_project_briefing                        │   │
│   │  • query_decisions                             │   │
│   │  • record_decision                             │   │
│   └───────────────────────┬────────────────────────┘   │
└───────────────────────────┼────────────────────────────┘
                            │ (Local In-Process Call)
                            ▼
┌────────────────────────────────────────────────────────┐
│               ProjectMemoryService                     │
│                   (DatabaseService)                    │
│             ~/.asterim/asterim.db (WAL)                │
└────────────────────────────────────────────────────────┘
```

1. **No Duplicated Business Logic**: `@asterim/mcp-memory-server` acts strictly as an MCP translation layer. It delegates 100% of decision creation, code reference mapping, intent queries, briefing aggregation, and lifecycle validation to `ProjectMemoryService`.
2. **Direct Local SQLite Access**: The MCP server directly initializes `ProjectMemoryService` and `DatabaseService` using Node 22 native `node:sqlite` in WAL mode. It does not require a running HTTP server daemon on port 3000, allowing Claude Code or CLI agents to work fully standalone.
3. **Transport Standard**: **`stdio` transport** via `@modelcontextprotocol/sdk`. Stdio is universal across Claude Code, Cursor, Antigravity, and Zed without network port collisions or firewall restrictions. SSE is deferred to Phase 5.x remote cloud relay.
4. **Project Identity Resolution**:
   - Priority 1: Explicit CLI argument `--project <id>` or `--project-path <path>`.
   - Priority 2: Environment variable `ASTERIM_PROJECT_ID=<id>`.
   - Priority 3: **CWD Auto-Detection** — Matching `process.cwd()` against `projects.path` in SQLite. When an agent runs in a repo folder, Asterim automatically resolves the project ID with zero manual configuration.

---

## 2. Minimum MCP Toolset Specification

### Tool 1: `get_project_briefing`
* **Purpose**: Allows an agent starting a session to immediately understand the project state, active decisions, rules, active intent, and recent work without human re-explanation.
* **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "projectId": { "type": "string", "description": "Optional project UUID override" }
    }
  }
  ```
* **Execution**: Calls `projectMemoryService.getProjectBriefing(resolvedProjectId)`.
* **Output**: Formatted JSON containing active decisions, rules, intent, recent sessions, and approvals.

### Tool 2: `query_decisions`
* **Purpose**: Allows an agent to search and retrieve relevant architectural decisions, optionally filtered by file path or lifecycle status.
* **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "filePath": { "type": "string", "description": "Filter decisions linked to a specific file path" },
      "status": { "type": "string", "enum": ["ACTIVE", "STALE", "SUPERSEDED", "ARCHIVED"], "description": "Filter by decision status (defaults to all or ACTIVE)" },
      "projectId": { "type": "string", "description": "Optional project UUID override" }
    }
  }
  ```
* **Execution**: Calls `projectMemoryService.findRelevantDecisions(resolvedProjectId, filePath)` if `filePath` is provided, else `projectMemoryService.listDecisions(resolvedProjectId, { status })`.

### Tool 3: `record_decision`
* **Purpose**: Allows an agent to persist an architectural decision with rationale, constraints, and related files.
* **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "title": { "type": "string", "description": "Short summary title of the decision" },
      "summary": { "type": "string", "description": "Brief description of what was decided" },
      "rationale": { "type": "string", "description": "Why this decision was made and what alternatives were rejected" },
      "constraints": { "type": "array", "items": { "type": "string" }, "description": "Architectural or technical constraints" },
      "relatedFiles": { "type": "array", "items": { "type": "string" }, "description": "File paths governed by this decision" },
      "confidence": { "type": "number", "minimum": 0, "maximum": 1, "description": "Confidence score (0.0 to 1.0, default 0.75 for agent statements)" },
      "projectId": { "type": "string", "description": "Optional project UUID override" }
    },
    "required": ["title", "summary", "rationale"]
  }
  ```
* **Execution**: Calls `projectMemoryService.createDecision(...)` with `provenance: 'AGENT_STATEMENT'` and default confidence `0.75`.

---

## 3. Critical Security & Boundary Model

1. **No Arbitrary SQL / Filesystem Escapes**: The MCP server only invokes typed `ProjectMemoryService` methods. No arbitrary SQL or shell execution is exposed.
2. **Project Isolation**: Queries and writes are strictly scoped to the resolved `projectId`. Accessing an unattached project ID fails validation.
3. **Safe Error Handling**: All tool invocations wrap execution in `try / catch`, returning standard MCP error responses (`isError: true`, formatted message) rather than crashing the stdio process.

---

## 4. End-to-End Dogfood Scenario

1. **Session A (Write)**:
   - Agent is tasked with an architectural change (e.g. "Use scrypt for auth password hashing").
   - Agent calls `record_decision({ title: "scrypt Password Hashing", summary: "...", rationale: "...", relatedFiles: ["apps/server/src/services/PasswordService.ts"] })`.
   - Decision is persisted in SQLite with `provenance: 'AGENT_STATEMENT'`.
2. **Session B (Fresh Start Re-Entry)**:
   - A fresh agent session starts later.
   - Agent calls `get_project_briefing()`.
   - Agent receives the previous architectural decision, active intent, and rules without human re-explanation.
3. **Session C (Context Query)**:
   - Agent edits `apps/server/src/services/PasswordService.ts`.
   - Agent calls `query_decisions({ filePath: "apps/server/src/services/PasswordService.ts" })`.
   - Agent retrieves the exact rationale and constraints for password hashing.

---

## 5. Task Sequence & Breakdown

```text
[P5.1-01: MCP Architecture & Transport Audit] ──► [P5.1-02: Package Setup & SDK Scaffold]
                                                                 │
                                                                 ▼
[P5.1-04: Briefing & Query MCP Tools]        ◄── [P5.1-03: Project Context Resolver]
            │
            ▼
[P5.1-05: Record Decision MCP Tool]          ──► [P5.1-06: Stdio Test Suite & Validation]
                                                                 │
                                                                 ▼
[P5.1-08: Docs, Claude Config & Blueprint]   ◄── [P5.1-07: End-to-End Dogfood Scenario]
```

### Task Definitions:
* **P5.1-01**: MCP Architecture & Transport Audit (Read-only validation of MCP SDK compatibility and build setup).
* **P5.1-02**: Package Setup (`packages/mcp-memory-server`) with TypeScript configuration, binary script entry, and `@modelcontextprotocol/sdk`.
* **P5.1-03**: Project Context Resolver (`resolveProjectContext` via `--project`, `ASTERIM_PROJECT_ID`, and CWD lookup in SQLite).
* **P5.1-04**: Implement `get_project_briefing` and `query_decisions` MCP tools with stdio transport.
* **P5.1-05**: Implement `record_decision` MCP tool with Zod validation and provenance default (`AGENT_STATEMENT`).
* **P5.1-06**: Automated Stdio Test Suite verifying MCP protocol handshakes, tool listing, tool invocation, error formatting, and isolation.
* **P5.1-07**: End-to-End Dogfood Scenario (Session A record $\rightarrow$ Session B fresh briefing $\rightarrow$ Session C query).
* **P5.1-08**: Documentation, Claude Code integration configuration (`~/.claude/mcp.json` / `claude mcp add`), and Blueprint sync.

---

## 6. Known Risks & Mitigation

1. **Stdio Deadlock on Uncaught Stdout Logs**: Any rogue `console.log` from imported services would corrupt the MCP JSON-RPC protocol over stdio.  
   *Mitigation*: Redirect `console.log` in the MCP process to `process.stderr` or a log file so `process.stdout` is exclusively reserved for JSON-RPC messages.
2. **CWD Resolution Mismatch**: Developer running agent in a subfolder (e.g. `c:\Projects\Asterim\apps\server`) rather than workspace root.  
   *Mitigation*: CWD resolver checks exact match, parent directory traversal, and git repo root.
3. **Database Concurrency**: Multiple agents querying/recording decisions simultaneously.  
   *Mitigation*: SQLite Write-Ahead Logging (WAL) handles concurrent read/write transactions cleanly.
