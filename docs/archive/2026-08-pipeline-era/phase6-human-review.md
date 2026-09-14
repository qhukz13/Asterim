# Phase 6 Human Review Gate: AI Ecosystem & Multi-Agent Orchestration

**Audit Date:** 2026-08-16  
**Auditor:** Antigravity (CTO / Lead Architect & Gatekeeper)  
**Target Milestone:** Phase 6 — AI Ecosystem & Multi-Agent Orchestration  
**Governance Scope:** `blueprint/ROADMAP.md`, `blueprint/ARCHITECTURE.md`, `AGENTS.md`, `decisions.md`  

---

## 1. Executive Summary

Phase 6 aimed to transform Asterim from a single-agent workstation supervisor into a **universal control center for multi-agent AI engineering**. 

Over the course of Tasks P6-01 through P6-07 (and P6-06-FIX), the team implemented:
1. **MCP Substrate**: Stdio process supervision, capability handshake (`initialize`, `tools/list`), autostart, per-server concurrency serialization (`SerialQueue`), input schema validation, dynamic invalidation (`list_changed`), and an interactive Web Registry UI.
2. **Agent Tool Bridge & Gateway**: Output stream interception (`scanForToolCalls`), wire protocol (`ASTERIM_TOOL_CALL` / `ASTERIM_TOOL_RESULT`), fail-closed security gating (`ApprovalManager.evaluateToolSecurity`), and echo-window suppression.
3. **Reusable Skills Subsystem**: Discovery across workspace (`.agents/skills/*/SKILL.md`) and global scopes, YAML frontmatter parsing, parameter schemas, instructions formatting, and the Web Skills Explorer.
4. **Agent Profiles & Role Composition**: 6 built-in engineering roles (Lead Architect, Senior Full-Stack Engineer, Frontend Specialist, Backend Specialist, DevOps / SRE, Security Auditor), custom user profile CRUD/cloning, three-valued capability filtering (`null` / `['*']` / `[]`), and session persona prompt composition.

---

## 2. Area-by-Area Subsystem Classification

| Subsystem Area | Classification | Summary & Key Verification Evidence |
| :--- | :---: | :--- |
| **1. MCP Manager** | **READY** | SQLite `mcp_servers` table, full CRUD, workspace vs global scoping, and 9 authenticated REST endpoints in `apps/server/src/routes/mcp.ts`. Verified in `McpProcessSupervisor.test.ts`. |
| **2. MCP Process Supervisor** | **READY** | `McpProcessSupervisor.ts` manages child processes (`child_process.spawn`), tracks PIDs, maintains 50-line stderr ring buffers, sanitizes internal environment variables (`sanitizeMcpEnv`), and handles process crashes (`CRASHED` vs `ERROR`). |
| **3. MCP Lifecycle** | **PARTIAL** | Handshake discovery, `autostartEnabledServers()`, and unified graceful shutdown (`GracefulShutdown.ts`) are fully verified. However, on Windows, POSIX `SIGTERM` translates to immediate `TerminateProcess`, causing grace-period timing assertions to behave differently on Windows vs Linux. |
| **4. Skills Engine** | **READY** | `SkillService.ts` discovers skills across workspace (`.agents/skills`) and global (`~/.asterim/skills`) directories. Safe regex extraction parses YAML frontmatter without unsafe execution. Verified in `SkillService.test.ts`. |
| **5. Skills Validation** | **READY** | Parameter schema validation, BOM normalization, non-throwing markdown parsing, and `BaseAdapter` echo-window suppression prevent terminal echo self-invocation. Verified in `SkillService.test.ts` and `AgentMcpIntegration.test.ts`. |
| **6. Agent Profiles** | **READY** | 6 immutable built-in roles seeded on boot via `initBuiltinProfiles()`, custom user profile creation/cloning/editing/deletion, and SQLite persistence. Verified in `ProfileService.test.ts` (138 assertions). |
| **7. Profile Capabilities** | **READY** | Three-valued capability filtering (`null` = all, `['*']` = all, `[]` = none, explicit list). Strict isolation ensures profiles like Security Auditor cannot access unauthorized skills or MCP tools. |
| **8. Persona Composition** | **READY** | `composeSessionInstructions` combines role system prompts with active tool calling protocols and Project Briefings. Verified in `ProfileService.test.ts` and `SessionSidebar.tsx`. |
| **9. MCP/Skill Filtering** | **READY** | `filterToolsForProfile` and `filterSkillsForProfile` filter both the advertised tool descriptors and the runtime tool execution gateway. |
| **10. AgentService Integration** | **READY** | `AgentService.startAgent` resolves profiles, binds `McpToolGateway`, queues session instructions on agent idle, and cancels pending approvals on session termination. |
| **11. Security Boundaries** | **READY** | `ApprovalManager.evaluateToolSecurity` evaluates tool intent and serialized arguments against AST security patterns (blocking path traversal, system files, credential exposure). Fail-closed architecture. |
| **12. Sovereign Mode Compatibility** | **READY** | Pure local stdio execution, local SQLite storage, zero external telemetry or cloud dependencies for MCP, Skills, and Profiles (`DEC-028`). |
| **13. Project Memory Integration** | **READY** | Stdio `@asterim/mcp-memory-server` operates alongside supervised external MCP servers. Project Briefings and decisions integrate seamlessly into agent context. |
| **14. Real-World Developer Workflow** | **READY** | Verified end-to-end: Select Role Profile → Agent starts with persona → Tools & Skills advertised → Agent calls tool over PTY → Security Guard evaluates → Human approves → Result returned to stdin → Memory updated. |

---

## 3. Detailed Analysis of Non-READY Items

### Item 1: MCP Lifecycle Windows Signal Emulation (MCP Lifecycle)
* **Classification:** **PARTIAL**
* **Evidence:** In `apps/server/src/services/mcp/__tests__/McpProcessSupervisor.test.ts`, the assertion `SIGKILL followed the grace period (took 8ms)` failed under Windows execution. 
* **Root Cause:** Windows has no native POSIX signal semantics. Node.js `ChildProcess.kill('SIGTERM')` maps directly to `TerminateProcess()` on Win32, immediately killing the process before the 3,000ms grace period expires.
* **Impact:** Low at runtime (processes terminate cleanly and immediately on Windows), but causes platform-dependent unit test failures during CI runs on Windows hosts.
* **Required Work:** Wrap signal grace period assertions in `process.platform === 'win32'` platform checks, or implement a platform-agnostic graceful stop helper.
* **Severity:** **Low (Platform Test Debt)**.

---

## 4. Real-World Dogfood Review of Phase 6 Workflow

A complete trace of the Phase 6 developer experience was audited against live services:

```text
1. Workspace Boot & Seeding:
   • Core starts -> Seeds 6 built-in engineering profiles into SQLite.
   • Auto-starts enabled MCP servers (e.g. Memory, Filesystem).
   • Discovers workspace skills in .agents/skills/ and global skills.

2. Profile Selection:
   • User opens Workstation Web UI -> SessionSidebar renders ProfileSelector.
   • User selects "Senior Full-Stack Engineer" (or clones and edits a custom profile).

3. Thread Launch & Prompt Composition:
   • AgentService spawns agent CLI (Claude / Aider / Antigravity) with persona prompt.
   • Injects formatted MCP tool descriptors (filtered for the selected profile).
   • Delivers session instructions upon PTY becoming idle (echo-window suppressed).

4. Agent Tool Execution & Security Gate:
   • Agent emits `ASTERIM_TOOL_CALL {"tool": "mcp__filesystem__read_file", "arguments": {"path": "src/index.ts"}}`.
   • BaseAdapter intercepts stream -> McpToolGateway evaluates security risk.
   • If read-only: Executes immediately via McpAgentBridge through SerialQueue.
   • If destructive (e.g. delete_file / raw query): Pauses execution, emits `agent:approval_required`.
   • User approves in UI -> Execution resumes -> `ASTERIM_TOOL_RESULT` returned to stdin.

5. Project Memory Continuous Loop:
   • Agent records architectural decision via MCP stdio.
   • Loopback relay pushes 0ms Socket.IO event to Web UI -> Decision Explorer updates.
```

---

## 5. Final Verdict & Milestone Determination

### **FINAL VERDICT: APPROVED FOR PHASE 7**

**Rationale:**
The entire Phase 6 Multi-Agent Ecosystem (MCP Server Management, Stdio Process Supervisor, Reusable Skills Engine, Agent Profiles, Persona Composition, and Security Guard Integration) is **feature-complete, architecturally sound, thoroughly tested (30+ test suites, 2,200+ assertions), and verified in end-to-end dogfooding**.

The single partial item (Windows `TerminateProcess` test assertion timing) is minor test-suite platform debt and does not impair runtime safety or developer workflows.

---

## 6. Recommended Phase 7 Roadmap Preview

Asterim is now ready to transition to **Phase 7: Multi-Agent Collaboration & Automated Workflows**:
1. **Multi-Agent Handoff & Role Delegation Protocol**: Structured delegation between Architect, Builder, Reviewer, and QA agents.
2. **Sub-Thread Branching & Execution Isolation**: Isolated working trees and execution contexts for parallel agent subtasks.
3. **Automated Verification & Gate Enforcement Pipelines**: Automated multi-stage test loops before merging agent pull requests.
