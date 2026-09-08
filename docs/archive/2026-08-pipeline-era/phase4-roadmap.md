# Asterim Phase 4 — Developer Workstation (Local Engine Hardening) Roadmap

**Document Version**: 1.0.0 — SOURCE OF TRUTH FOR PHASE 4  
**Author**: Lead Systems & Platform Architect  
**Date**: August 8, 2026  
**Status**: Approved Specification  
**Target Platform**: Asterim Local-First AI Engineering Operating System  

---

## 1. Executive Summary & Goals

Phase 4 focuses on **Local Engine Hardening** to elevate Asterim from a prototype/MVP control plane to a production-grade developer workstation operating system with 99.9% local execution reliability across macOS, Linux, and Windows.

### Core Objectives:
1. **Fault-Tolerant Agent Subprocesses**: Process tree tracking, zombie cleanup (`SIGTERM` -> `SIGKILL` cascade), automatic crash recovery with backoff, and memory leak prevention.
2. **Hardened Terminal & PTY Streaming**: Zero-lag xterm.js rendering, output buffer backpressure throttling (handling 10,000+ line/s streaming without freezing the UI), ANSI escape code stability, and multi-shell support (bash, zsh, powershell, wsl).
3. **Hardened Safety & Security Engine**: AST/Regex command safety evaluation, path traversal protection (`../` sandbox enforcement), interactive mutation diff previews, and customizable auto-approval rules.
4. **Git Subsystem Polish**: Real-time git status tracking, branch switcher/creator, staged/unstaged diff inspector, conflict status detection, and `✨ Generate Commit` powered by local context.
5. **Persistent Workspace Context Indexer**: Fast file symbol extraction, debounced file watcher (`chokidar`), and token-efficient prompt context assembly.

---

## 2. PR Breakdown & Implementation Sequence

### PR 1: Fault-Tolerant Subprocess & Agent Execution Engine
* **Goal**: Robust process tree lifecycle, zombie process cleanup, automatic crash recovery with exponential backoff, and memory leak prevention.
* **Scope & Deliverables**:
  - `ProcessTreeManager`: Track child PID trees and ensure clean termination (`SIGTERM` with 3s timeout falling back to `SIGKILL`).
  - `AgentCrashRecovery`: Subprocess crash detection, restart loop protection (max 3 retries in 60s), and event notifications.
  - Orphan & Zombie Process Sweeper: Periodic cleanup of detached agent processes on workspace switch or app shutdown.
* **Target Files**:
  - `apps/server/src/services/AgentService.ts`
  - `apps/server/src/services/ProcessTreeManager.ts` [NEW]
  - `packages/adapters/src/SessionManager.ts`

### PR 2: Hardened Terminal & PTY Streaming with Backpressure Throttling
* **Goal**: Zero UI freeze or DOM degradation during heavy output streaming, cross-platform PTY compatibility.
* **Scope & Deliverables**:
  - `TerminalStreamThrottler`: Output buffer queue with requestAnimationFrame / 16ms chunking for xterm.js.
  - Cross-platform shell initialization (bash on macOS/Linux, PowerShell / WSL on Windows).
  - Terminal session re-attachment and scroll buffer retention.
* **Target Files**:
  - `apps/web/src/components/terminal/TerminalView.tsx`
  - `apps/server/src/services/TerminalService.ts`

### PR 3: Hardened Safety & Security Engine (Command AST & Path Traversal)
* **Goal**: Comprehensive shell command security parser and path sandbox enforcement.
* **Scope & Deliverables**:
  - Real-time command syntax scanner (detecting destructive commands like `rm -rf /`, `dd`, `chmod -R 777`).
  - Path traversal guard (blocking write/delete outside active project directory).
  - Automated diff preview before execution.
* **Target Files**:
  - `apps/server/src/services/ApprovalManager.ts`
  - `@asterim/shared` (Security policy types)

### PR 4: Git Subsystem Polish & One-Click Commit Generator
* **Goal**: Deep Git integration with status tracking, branch management, and AI commit message generation.
* **Scope & Deliverables**:
  - `GitStatusService`: Real-time status, branch listing, checkout, and unstaged/staged diff inspector.
  - `✨ Generate Commit`: Local diff analyzer to generate conventional commit messages.
* **Target Files**:
  - `apps/server/src/services/git/GitService.ts`
  - `apps/web/src/components/git/GitInspectorView.tsx`

### PR 5: Persistent Workspace Context Indexer & Symbol Parser
* **Goal**: Fast file symbol indexing and token-optimized prompt context window builder.
* **Scope & Deliverables**:
  - Workspace file watcher with debounced re-indexing.
  - AST symbol extractor for TypeScript, JavaScript, Python, Go, Rust.
  - Token-budget-aware context assembler for LLM prompts.
* **Target Files**:
  - `apps/server/src/services/ContextService.ts`
  - `apps/server/src/services/SymbolIndexer.ts` [NEW]

---

## 3. Verification & Quality Gates

- **Subprocess Recovery Test**: Process `kill -9` on agent PID automatically recovers session state without server crash.
- **Terminal Stress Test**: Stream 20,000 lines of fast output through PTY without dropping frames or freezing React UI.
- **Security Guard Test**: Command execution blocked when attempting path traversal (`../`) or forbidden destructive patterns.
- **Git Polish Test**: Stage, unstage, create branch, and generate commit message using local context.
- **Monorepo Build**: `pnpm run build` succeeds with zero TypeScript errors.
