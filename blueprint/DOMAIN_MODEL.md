# Asterim Domain Model

This document defines the fundamental business objects and concepts that make up the Asterim architecture. It serves as the source of truth for the domain entities, their responsibilities, lifecycles, and relationships.

## Purpose

The domain model exists to ensure that every screen, panel, service, and interaction in Asterim is a natural consequence of a well-defined conceptual structure, rather than an accumulation of arbitrary features.

## Domain Hierarchy

The fundamental concepts of Asterim follow this hierarchy:

- **Workspace**
  - **Workstations**
  - **Projects**
    - **Git Subsystem**
    - **Threads**
      - **Context**
      - **AgentExecution**
        - **Agent**
      - **Events** (Timeline/History)
      - **Terminal**
      - **Approvals**

---

## Entities

### Workspace
#### Purpose
The global root context of the application. It represents the user's instance of Asterim.
#### Responsibilities
- **Owns:** Global settings, the collection of Projects, and known Workstations.
- **Never owns:** Code files, git history, or agent execution state.
#### Lifecycle
- **Created:** On first launch (Empty Workspace state) or implicit initialization.
- **Changed:** When user modifies global settings or pairs with new workstations.
- **Destroyed:** By uninstalling the application or deleting the `~/.asterim` data directory.
#### Relationships
- **Parent:** None (Root).
- **Children:** Workstations, Projects.
#### Current State
Fully implemented via `DatabaseService` and local storage (`~/.asterim`).

### Workstation
#### Purpose
Represents a physical or remote machine running the Core Server where agents execute.
#### Responsibilities
- **Owns:** Connection details (IP, port), connectivity status.
- **Never owns:** The UI state or Project data (though it hosts the backend that accesses it).
#### Lifecycle
- **Created:** Discovered via mDNS or explicitly paired by the user.
- **Changed:** When connection status changes (online/offline).
- **Destroyed:** Removed from known workstations.
#### Relationships
- **Parent:** Workspace.
- **Children:** None.
#### Current State
Implemented via `WorkstationConfig` and `mDNSService.ts`. Currently primarily used for `localhost`, but architected for remote execution.

### Project
#### Purpose
Bounds the context of an agent's work to a specific software repository or directory.
#### Responsibilities
- **Owns:** The absolute path on the Workstation, the Git Subsystem, and Threads.
- **Never owns:** Agent configuration (owned by Workspace/Thread) or actual agent processes (owned by AgentExecution).
#### Lifecycle
- **Created:** By the user adding a local folder.
- **Changed:** When renamed or relocated.
- **Destroyed:** When the user removes the project from the Workspace.
#### Relationships
- **Parent:** Workspace.
- **Children:** Git Subsystem, Threads.
#### Current State
Fully implemented in `ProjectManager.ts` and the `projects` table.

### Git Subsystem
#### Purpose
Wraps version control, exposing it as a seamless project capability rather than a standalone tool.
#### Responsibilities
- **Owns:** Branch management, commit history, staging area, diff generation.
- **Never owns:** File contents (owned by the filesystem).
#### Lifecycle
- **Created:** Implicitly exists if `.git` is present in the Project path, or explicitly initialized.
- **Changed:** File modifications, staging, committing, branching.
- **Destroyed:** Deleting the `.git` directory.
#### Relationships
- **Parent:** Project. (Git applies to the entire project, not a single thread).
- **Children:** None.
#### Current State
Implemented in `GitService.ts` and related managers.

### Thread
#### Purpose
Represents a persistent, long-lived conversation and goal-oriented mission within a Project. A Thread may live for days or weeks, representing an ongoing line of work. It is the primary unit of continuity in Asterim.
#### Responsibilities
- **Owns:** The logical continuity of work, Events (history), Context, Terminals, and Approvals.
- **Never owns:** The physical AI process (owned by AgentExecution).
#### Lifecycle
- **Created:** Automatically created on Project creation (Main Thread), or explicitly by the user for parallel tasks.
- **Changed:** When new events (messages, actions) are appended, or when Context is updated.
- **Destroyed:** When deleted by the user.
#### Relationships
- **Parent:** Project.
- **Children:** Context, AgentExecutions, Events, Terminal, Approvals.
#### Current State
Implemented in `DatabaseService` (as `threads` table). The UI currently refers to Threads as "Sessions" in some places — this will be aligned during the terminology migration phase.

### AgentExecution
#### Purpose
Represents a single, transient execution of an AI agent process within a Thread. Multiple AgentExecutions may belong to the same Thread over time (e.g., after crashes, restarts, or new prompts following idle periods).
#### Responsibilities
- **Owns:** The process ID (PID), startup time, execution status (running, stopped, crashed), and the agent type used.
- **Never owns:** The chat history or project state (owned by Thread and Project).
#### Lifecycle
- **Created:** When the user starts the agent in a Thread.
- **Changed:** When the agent process status changes (e.g., crashes or exits).
- **Destroyed:** When the process terminates. (The record remains in the database for auditing).
#### Relationships
- **Parent:** Thread.
- **Children:** Agent.
#### Current State
Implemented in `AgentService.ts` and the `sessions` table (to be renamed to `agent_executions` during terminology migration).

### Agent
#### Purpose
The active AI engine executing the work (e.g., Aider, Claude, Antigravity).
#### Responsibilities
- **Owns:** Interaction with the LLM, parsing workspace files, emitting events.
- **Never owns:** The UI or the database.
#### Lifecycle
- **Created:** Instantiated by the `SessionManager` via an adapter.
- **Changed:** Receives stdin and configuration changes.
- **Destroyed:** When the AgentExecution stops.
#### Relationships
- **Parent:** AgentExecution.
- **Children:** None.
#### Current State
Implemented via `IAgentAdapter` in `packages/shared/src/adapters.ts`.

### Context
#### Purpose
The first-class entity that tracks what the agent is currently working with, replacing the traditional IDE file explorer. Context is the bridge between the user's intent and the agent's execution — it defines the "working set" for a Thread.
#### Responsibilities
- **Owns:** The active mission description, pinned files, the working set of files being read/modified, and related knowledge references.
- **Never owns:** The files themselves (only references to them).
#### Lifecycle
- **Created:** Explicitly initialized when a Thread is created. Starts empty.
- **Changed:** By the Agent reading/modifying files, by the user pinning/unpinning items, or by AI-suggested context additions.
- **Destroyed:** Cleared when the thread is reset. Historical context states are preserved for versioning.
#### Relationships
- **Parent:** Thread.
- **Children:** None (contains data, not child entities).
#### Design Requirements
Context MUST support:
- **Persistence:** Stored in the backend database, not derived from transient frontend state.
- **Synchronization:** Changes are broadcast to all connected clients via the EventBus.
- **Restoration:** On reconnect or app restart, the exact Context state is restored from the database.
- **Future History/Versioning:** The schema should be designed to support snapshotting Context at key moments (e.g., before/after an AgentExecution) for future rollback and audit capabilities.
#### Current State
Fully implemented in the backend via `contexts` and `context_entries` tables, managed by `ContextRepository` and `ContextService`. The frontend consumes this state via the `useThreadContext` hook.

### Event
#### Purpose
Represents a discrete occurrence in the system (e.g., chat message, file change, log, approval request), driving the reactive architecture.
#### Responsibilities
- **Owns:** Timestamp, source, type, and payload.
- **Never owns:** Business logic.
#### Lifecycle
- **Created:** Emitted by the `EventBus`.
- **Changed:** Immutable.
- **Destroyed:** Hard-deleted if history is cleared.
#### Relationships
- **Parent:** Thread (or Project for global events).
#### Current State
Fully implemented via `EventBus.ts` and the `events` table.

### Approval
#### Purpose
Represents a request from the Agent that requires explicit user confirmation (e.g., running a terminal command).
#### Responsibilities
- **Owns:** Action description, command to be executed, and approval status (pending, approved, rejected).
#### Lifecycle
- **Created:** Emitted by the Agent Adapter.
- **Changed:** When the user approves or rejects it.
- **Destroyed:** Once acted upon, it remains as historical record.
#### Relationships
- **Parent:** Thread.
#### Current State
Implemented in `ApprovalManager.ts` and the `approvals` table.

---

## Domain Rules & Justifications

### Why does Context belong to Thread instead of Project?
If Context belonged to the Project, multiple concurrent agents (parallel tasks) would overwrite each other's working sets. By scoping Context to the Thread, Asterim supports concurrent AI execution natively.

### Why does Git belong to Project instead of Workspace?
Git tracks the state of a specific repository. A Workspace can contain multiple independent repositories (Projects), each with its own branch, commit history, and remote.

### Why do AgentExecutions belong to Threads?
A Thread represents the persistent, long-lived mission (the "conversation" and "goal"). An AgentExecution represents a single physical execution of the AI tool trying to achieve that goal. If an agent crashes, a new AgentExecution is created within the same Thread to resume work. Multiple executions naturally accumulate over the lifetime of a Thread — this is the correct model because the Thread's identity and history survive any individual process.

### Why do Approvals belong to Threads?
Approvals are blocking requests made by an agent during its execution to achieve a specific thread's goal. They are part of the timeline of events for that task.

---

## Identified Architectural Problems

During the domain discovery process, the following structural misalignments between the current implementation and the ideal domain model were identified:

1. **Terminology Misalignment (`Session` table → `AgentExecution`)**
   - **Problem:** The backend `sessions` table currently represents transient process executions, but the name "session" collides with the UI terminology where "Session" sometimes refers to the long-lived Thread concept.
   - **Decision:** The backend `sessions` table will be renamed to `agent_executions` to clearly distinguish it from the persistent Thread. This is mechanical work to be performed after the architecture stabilizes.
   - **Status:** Deferred to Phase 4.

2. **Context is Not a First-Class Backend Entity**
   - **Problem:** The Context (pinned files, working set) is vital to the domain model but lacks a dedicated table or backend state manager. It exists only as transient frontend state.
   - **Impact:** Makes persistence, cross-device syncing, state restoration, and future versioning impossible.
   - **Decision:** Formalize `Context` in `DatabaseService.ts` as a first-class child of Thread with persistence, synchronization, restoration, and future versioning support.
   - **Status:** Done (Phase 1 complete).

3. **EventBus Wildcard Fragility (ADR-008)**
   - **Problem:** As noted in `ARCHITECTURE.md`, the Node `EventEmitter` is using a hacky literal `'*'` string convention for global logging.
   - **Impact:** Brittle architecture that will fail as event complexity scales.
   - **Decision:** Replace with a lightweight typed event bus or simple pub/sub solution. Avoid heavy dependencies like RxJS unless strongly justified.
   - **Status:** To be evaluated. Not blocking Phase 1.

4. **Terminal UI Coupling**
   - **Problem:** The frontend Terminal implementation is currently tightly coupled to `node-pty` payloads (`client.terminal_input`, `terminal.data`).
   - **Impact:** Leaks backend implementation details into the frontend, making it harder to swap the agent's CLI runner or support different terminal models.
   - **Status:** To be addressed during Phase 3 (component refactoring).

---

## Implementation Roadmap

The following phased approach establishes the correct architecture before performing mechanical migrations.

### Phase 1: Formalize Context as a First-Class Domain Entity (DONE)
- ~~Design and create the `context_items` table in SQLite, linked to Threads.~~
- ~~Implement a `ContextService` on the backend that manages persistence and broadcasts changes via EventBus.~~
- ~~Expose REST/WebSocket APIs for Context CRUD operations.~~
- ~~Design the schema with future history/versioning in mind (e.g., snapshot timestamps, version counters).~~

### Phase 2: Align Frontend State Ownership
- Refactor the frontend stores to strictly match the domain hierarchy:
  - `WorkspaceStore` → owns Projects and Workstations.
  - `ProjectStore` → owns Threads and Git Subsystem state.
  - `ThreadStore` → owns Context, Events, AgentExecution state, and Approvals.
- Ensure Context state is driven by the backend, not derived from transient UI state.

### Phase 3: Refactor Components to Follow the Domain Hierarchy
- Decouple the Terminal UI from `node-pty` specifics.
- Ensure each UI panel maps to exactly one domain level (Left Sidebar = Workspace, Center Sidebar = Project, Main Area = Thread).
- Eliminate any component that reaches across domain boundaries.

### Phase 4: Terminology & Database Migrations
- Rename the `sessions` table to `agent_executions`.
- Update all backend service references (`SessionManager` → `ExecutionManager`, etc.).
- Align the UI copy to use "Thread" consistently for the long-lived concept.
- Update API routes and WebSocket event types to match the new terminology.
