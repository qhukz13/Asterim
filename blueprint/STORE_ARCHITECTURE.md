# Asterim Store Architecture

This document defines the state hierarchy, responsibilities, and lifetimes of all stores within the Workspace V2 architecture.

## 1. Global Stores (App Lifecycle)

### WorkspaceStore
* **Ownership:** Global user context, Projects list, Workstations list.
* **Lifetime:** Application Lifecycle.
* **Persistence:** SQLite / Local Storage.
* **Synchronization:** EventBus.
* **Parent Store:** Root.
* **Responsibilities:** Managing the topmost entry point to Asterim.

### PanelStore
* **Ownership:** User's visual configuration (panel sizes, collapsed states, docking).
* **Lifetime:** Application Lifecycle.
* **Persistence:** Local Storage.
* **Synchronization:** None.
* **Parent Store:** Root.
* **Responsibilities:** Persisting the layout structure across sessions.

### CommandPaletteStore
* **Ownership:** Global and scoped commands, search indices, visibility state.
* **Lifetime:** Application Lifecycle.
* **Persistence:** Volatile.
* **Synchronization:** EventBus.
* **Parent Store:** Root.
* **Responsibilities:** Serving as the central global interaction system.

### InspectorStore
* **Ownership:** The active domain selection path (e.g., selected file, selected execution). Derives contextual secondary actions.
* **Lifetime:** Transient (tied to active selection).
* **Persistence:** Volatile.
* **Synchronization:** Subscribes to other stores to derive metadata based on focus.
* **Parent Store:** Root (Global context-aware).
* **Responsibilities:** Powering the Right Inspector panel. *Rule:* The InspectorStore never owns business data. It only holds a reference to what is selected.

## 2. Domain-Scoped Stores

### ProjectStore
* **Ownership:** Scoped repository data, Git subsystem status, Threads list.
* **Lifetime:** Exists while a Project is selected.
* **Persistence:** SQLite.
* **Synchronization:** File system watchers, Git polling.
* **Parent Store:** WorkspaceStore.
* **Responsibilities:** Exposing repository-level context to the workspace.

### ThreadStore
* **Ownership:** Active Thread context, Event timeline. (Executions are explicitly managed by `ExecutionStore`).
* **Lifetime:** Exists while a Thread is selected.
* **Persistence:** SQLite.
* **Synchronization:** EventBus.
* **Parent Store:** ProjectStore.
* **Responsibilities:** Representing the long-lived mission and timeline.

### ExecutionStore
* **Ownership:** Running executions, execution lifecycle, runtime status, logs, active execution selection.
* **Lifetime:** Exists while a Thread is selected.
* **Persistence:** SQLite.
* **Synchronization:** EventBus / Process streams.
* **Parent Store:** ThreadStore.
* **Responsibilities:** Managing physical AI processes, supporting multiple simultaneous agents.

### ViewStore
* **Ownership:** Active view, available views, view history, per-thread view state.
* **Lifetime:** Exists while a Thread is selected.
* **Persistence:** Local Storage (for restoring last open view per thread).
* **Synchronization:** Derived from Thread and User Action state.
* **Parent Store:** ThreadStore.
* **Responsibilities:** Managing UI presentation lenses into the Thread, keeping visual state out of the ThreadStore.
