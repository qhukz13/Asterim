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
      - **Sessions**
        - **Agent**
      - **Context**
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
- **Never owns:** Agent configuration (owned by Workspace/Thread) or actual agent processes (owned by Session).
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
Represents a persistent conversation and goal-oriented timeline within a Project.
#### Responsibilities
- **Owns:** The logical continuity of work, Events (history), Context, Terminals, and Approvals.
- **Never owns:** The physical AI process (owned by Session).
#### Lifecycle
- **Created:** Automatically created on Project creation (Main Session), or explicitly by the user for parallel tasks.
- **Changed:** When new events (messages, actions) are appended.
- **Destroyed:** When deleted by the user.
#### Relationships
- **Parent:** Project.
- **Children:** Sessions, Context, Events, Terminal, Approvals.
#### Current State
Implemented in `DatabaseService` (as `threads` table). *Note: The UI often refers to this concept as "Session", creating a naming collision with the backend's "Session" entity.*

### Session
#### Purpose
Represents the transient, active execution of an AI agent process within a Thread.
#### Responsibilities
- **Owns:** The process ID (PID), startup time, and execution status (running, stopped, crashed).
- **Never owns:** The chat history or project state (owned by Thread and Project).
#### Lifecycle
- **Created:** When the user starts the agent in a Thread.
- **Changed:** When the agent process status changes (e.g., crashes or exits).
- **Destroyed:** When the process terminates. (The record remains in the database for auditing).
#### Relationships
- **Parent:** Thread.
- **Children:** Agent.
#### Current State
Implemented in `AgentService.ts` and the `sessions` table.

### Agent
#### Purpose
The active AI engine executing the work (e.g., Aider, Claude, Antigravity).
#### Responsibilities
- **Owns:** Interaction with the LLM, parsing workspace files, emitting events.
- **Never owns:** The UI or the database.
#### Lifecycle
- **Created:** Instantiated by the `SessionManager` via an adapter.
- **Changed:** Receives stdin and configuration changes.
- **Destroyed:** When the Session stops.
#### Relationships
- **Parent:** Session.
- **Children:** None.
#### Current State
Implemented via `IAgentAdapter` in `packages/shared/src/adapters.ts`.

### Context
#### Purpose
Tracks what the agent is currently working with, replacing the traditional IDE file explorer.
#### Responsibilities
- **Owns:** The active mission description, pinned files, and the working set of files being read/modified.
- **Never owns:** The files themselves.
#### Lifecycle
- **Created:** Implicitly exists within a Thread.
- **Changed:** By the Agent reading files or the user pinning context.
- **Destroyed:** Cleared when the task is complete or the thread is reset.
#### Relationships
- **Parent:** Thread.
#### Current State
Partially implemented. Currently inferred from UI state and recent events, but lacks a strict backend model.

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

### Why do Sessions belong to Threads?
A Thread represents the persistent, logical intent (the "chat history" and "goal"). A Session represents the physical execution of the AI tool trying to achieve that goal. If an agent crashes, a new Session is created within the same Thread to resume work, preserving the context and history.

### Why do Approvals belong to Threads?
Approvals are blocking requests made by an agent during its execution to achieve a specific thread's goal. They are part of the timeline of events for that task.

---

## Identified Architectural Problems

During the domain discovery process, the following structural misalignments between the current implementation and the ideal domain model were identified:

1. **Duplicated / Conflicting Concepts (`Thread` vs `Session`)**
   - **Problem:** The UI Blueprint (`WORKSPACE.md`) refers to "Sessions" (Main Session vs Parallel Sessions) as the persistent container for work. However, the Backend Database uses `Thread` for the persistent container and `Session` for transient process execution. 
   - **Impact:** Cognitive overload and naming collisions. The UI is coupled to a different semantic meaning than the backend.
   - **Recommendation:** Rename the backend `Thread` to `Session`, and rename the backend `Session` to `Execution` or `ProcessRun` to align with the UI semantics.

2. **Context is Not a First-Class Backend Entity**
   - **Problem:** The Context (pinned files, working set) is vital to the UI design but lacks a dedicated table or strict backend state manager. It is currently implicitly derived or handled purely in the frontend.
   - **Impact:** Makes cross-device syncing or deep-linking to an exact context state difficult.
   - **Recommendation:** Formalize `Context` in `DatabaseService.ts` as a child of the Thread/Session.

3. **EventBus Wildcard Fragility (ADR-008)**
   - **Problem:** As noted in `ARCHITECTURE.md`, the Node `EventEmitter` is using a hacky literal `'*'` string convention for global logging.
   - **Impact:** Brittle architecture that will fail as event complexity scales.

4. **Terminal UI Coupling**
   - **Problem:** The frontend Terminal implementation is currently tightly coupled to `node-pty` payloads (`client.terminal_input`, `terminal.data`).
   - **Impact:** Leaks backend implementation details into the frontend, making it harder to swap the agent's CLI runner or support different terminal models.
