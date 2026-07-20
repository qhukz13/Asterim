# Workspace Architecture

This document describes how the UI layout and interaction model of Asterim naturally emerge from its Domain Model. It defines the structural layout, state ownership, routing, and selection models without dictating visual design or styling.

## The Core Principle

The Asterim Workspace UI is a direct, visual projection of the Domain Model hierarchy:
**Workspace → Projects → Threads (UI: "Sessions")**

Navigation must always flow from the broadest domain context (left) to the most specific execution context (right).

---

## Structural Layout

### Left Sidebar: The Workspace Level
The Left Sidebar is the entry point for the **Workspace** entity.
- **Content:** Displays the collection of **Projects** (children of the Workspace). 
- **Responsibility:** Allows the user to select the active Project or manage Workstation connections.
- **Emergence:** Because the Workspace owns Projects, this panel serves as the index of the Workspace.

### Center Sidebar: The Project Level
The Center Sidebar represents the currently selected **Project** entity.
- **Content:** Displays the collection of **Threads** (children of the Project), as well as project-level services like the **Git Subsystem** summary.
- **Responsibility:** Allows the user to select the active Thread (e.g., Main Session vs Parallel Task) or view high-level project status.
- **Emergence:** Because a Project owns its Threads and Git state, this panel scopes all actions to the repository selected in the Left Sidebar.

### Main Workspace: The Thread Level
The Main Workspace (the large central area) represents the currently selected **Thread**.
- **Content:** Displays the children of the Thread: **Events** (Timeline/Chat), **Context** (working set of files), **Terminal**, and active **Approvals**.
- **Responsibility:** This is the primary execution view where the AI agent operates.
- **Emergence:** Because a Thread owns the timeline and the context of the work, this area is dedicated entirely to the execution of the goal. The tabs here (Chat, Context, Changes, Terminal) are merely different lenses into the Thread's children.

### Inspector Panels: Entity Details
Inspector Panels (typically appearing on the far right or as overlays) represent deep-dives into specific **leaf nodes**.
- **Content:** Specific details based on the current selection. If a user selects a file in the Context tab, the Inspector shows file metadata or a preview. If they select a commit in the Git Subsystem, it shows the diff.
- **Responsibility:** Prevent the Main Workspace from being cluttered with secondary information.
- **Emergence:** Provides a standardized way to inspect the properties of any domain entity without losing the context of the Thread.

---

## State Ownership

State management MUST strictly follow the domain hierarchy to prevent data leakage and race conditions.

- **Global Store (Workspace Context):** Owns the list of known Workstations and Projects. Fetched on application load.
- **Project Store (Project Context):** Initialized when a Project is selected. Owns the Git Subsystem state (current branch, uncommitted changes) and the list of Threads.
- **Thread Store (Thread Context):** Initialized when a Thread is selected. Owns the Event timeline, the active Context (pinned files), and the state of the active Session (the running agent process).

*Crucial Rule:* A Thread Store must never mutate the Project Store's Git state directly; it must emit a command that the Project-level Git Subsystem handles.

---

## Routing

The URL routing scheme must map 1:1 with the domain hierarchy.

**Pattern:** `/workspace/project/:projectId/thread/:threadId`

- **`/workspace`**: The Empty Workspace state (no project selected).
- **`/workspace/project/:projectId`**: A project is selected, but no thread is active (or falls back to the Main Session).
- **`/workspace/project/:projectId/thread/:threadId`**: The fully resolved execution path.

This guarantees that deep-linking and state restoration naturally re-hydrate the correct domain entities in order: `Workspace -> Project -> Thread`.

---

## Selection Model

Asterim employs a strict **single-path active selection model**.

1. There is exactly ONE active Workspace per window.
2. There is exactly ONE active Project within that Workspace.
3. There is exactly ONE active Thread within that Project.

Parallelism is supported in the domain model (a Project can have many Threads running agents simultaneously), but the UI selection focuses the Main Workspace on only one Thread at a time to prevent cognitive overload. Background threads continue to process events and emit notifications without stealing focus.

---

## Conclusion

By deriving the UI directly from the domain model, Asterim avoids "feature soup." Every button, panel, and route has a strictly defined place because the entity it acts upon has a strictly defined parent.
