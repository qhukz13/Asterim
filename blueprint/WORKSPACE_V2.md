# Asterim Workspace V2 Architecture

The Asterim Workspace is the operating environment for AI software engineering. It is not a dashboard or a traditional IDE. It is an intent-driven control plane where human engineers and AI agents collaborate.

The UI is strictly a visual projection of the underlying Domain Architecture.

## 1. Domain Representation & Hierarchy

The interface naturally exposes the underlying Domain Model hierarchy:

**Workspace** → **Projects** → **Threads** → **Executions** → **Views** → **Inspector**

No UI concept exists without a clear mapping to one of these domain entities. The application layout is built from this hierarchy outward.

## 2. Navigation & Interaction Model

Navigation in Asterim represents movement through the domain, not movement between visual pages. 

### Selection Model & Focus
Asterim uses a **single-path active selection model**. There is exactly one active path at any given time:
One Workspace -> One Project -> One Thread -> One active View -> One Inspector focus.
While background threads run, the user's focus is dedicated to the active selection.

### Navigation Hierarchy
- **URL Model:** URLs are the absolute source of truth for the active path: `/workspace/project/:projectId/thread/:threadId/view/:viewId`
- **Deep Linking:** Hydrates the entire state tree from the URL path.
- **Keyboard Navigation:** Command Palette-first navigation (`Cmd/Ctrl + K`). Number keys toggle Views. Tab switches focus regions.
- **Navigation History:** Standard browser history enables jumping back and forth between contexts instantly.

### Interaction Flow Propagation
State flows strictly top-down. Changes in selection at a higher level cascade down to lower levels:

- **Selecting a Project:**
  ↳ Updates active Project context
  ↳ Re-renders the Thread list
  ↳ Scopes the Command Palette to the repository
  ↳ Updates Workspace title & breadcrumbs

- **Selecting a Thread:**
  ↳ Initializes the active Thread Store
  ↳ Loads Thread history, Context, and Events
  ↳ Mounts the primary Views (Chat, Terminal, Diff)
  ↳ Populates the Inspector with Thread metadata

- **Selecting a File in a View:**
  ↳ Updates the Inspector to display File metadata
  ↳ Exposes Git history and blame in the Inspector
  ↳ Exposes file-specific AI actions in the Command Palette

- **Selecting an Agent Execution:**
  ↳ Inspector displays execution runtime status
  ↳ Shows logs and process metadata

## 3. State Ownership & Architecture

State management strictly follows the domain hierarchy. Local component state must never become the source of truth for domain data.

### WorkspaceStore
- **Ownership:** Global user context, Projects list, Workstations list.
- **Lifetime:** App Lifecycle.
- **Persistence:** Local Storage / SQLite.
- **Synchronization:** Polling / EventBus.
- **Parent Store:** Root.

### ProjectStore
- **Ownership:** Scoped repository data, Git subsystem status, Threads list.
- **Lifetime:** Exists while a Project is selected.
- **Persistence:** SQLite.
- **Synchronization:** File system watchers, Git polling.
- **Parent Store:** WorkspaceStore.

### ThreadStore
- **Ownership:** Active Thread context, Event timeline.
- **Lifetime:** Exists while a Thread is selected.
- **Persistence:** SQLite.
- **Synchronization:** EventBus (multi-client ready).
- **Parent Store:** ProjectStore.

### ExecutionStore
- **Ownership:** Running executions, execution lifecycle, runtime status, logs, active execution selection.
- **Lifetime:** Exists while a Thread is selected.
- **Persistence:** SQLite.
- **Synchronization:** EventBus / Process streams.
- **Parent Store:** ThreadStore.

### ViewStore
- **Ownership:** Active view, available views, view history, per-thread view state.
- **Lifetime:** Exists while a Thread is selected.
- **Persistence:** Local Storage.
- **Synchronization:** Derived from UI interaction.
- **Parent Store:** ThreadStore.

### InspectorStore
- **Ownership:** Active domain selection path.
- **Lifetime:** Transient (tied to active selection).
- **Persistence:** Volatile.
- **Synchronization:** Derived strictly from current selection focus.
- **Parent Store:** Root (Global context-aware).
- **Rule:** The Inspector never owns business data. It only reflects the currently selected domain entity.

### PanelStore
- **Ownership:** User's visual configuration (sizes, collapsed states, docking).
- **Lifetime:** App Lifecycle.
- **Persistence:** User Preferences (Local Storage).
- **Synchronization:** None.
- **Parent Store:** Root.

### CommandPaletteStore
- **Ownership:** Global and scoped commands, search indices.
- **Lifetime:** App Lifecycle.
- **Persistence:** Volatile.
- **Synchronization:** Driven by active stores (ProjectStore/ThreadStore scope the available commands).
- **Parent Store:** Root.

## 4. Primary Views (The Main Workspace)

The main workspace does not contain disparate "Tabs". It contains different **Views** of the exact same Thread. A Thread is the primary working object; the UI merely provides lenses into its execution.

- **Chat View:** The conversational timeline and event stream.
- **Terminal View:** The raw stdout/stderr of the active agent and tools.
- **Diff View:** The code changes proposed or made by the active Thread.
- **Blueprint View:** The architectural plans and context maps relevant to the Thread.

## 5. The Inspector System

The Inspector is the contextual hub for metadata, persistent state, and subsystems. It adapts based on the user's focus, keeping the primary Views clear of clutter.

### Thread Context
Context (the working set of files, knowledge, and mission constraints) is **not a view**. It is persistent state belonging to the Thread. Therefore, Context lives natively within the Inspector when a Thread is focused, allowing the user to view the active working set regardless of whether they are looking at the Chat View or the Diff View.

### Git Subsystem
Git is a first-class subsystem exposed through the Inspector. 
- When viewing a File Diff, the Inspector shows commit history, blame, and branch status.
- When viewing the overall Thread, the Inspector shows uncommitted changes, sync status, and allows triggering Commits or Pull Requests.

### Secondary Actions
All contextual AI actions (e.g., "Summarize file", "Explain Diff", "View logs") live in the Inspector.

## 6. Configurable Panel System

To act as a robust operating environment, Asterim employs a highly flexible panel architecture:

- **Docking Regions:** Strict drop zones for panels (Left, Right, Bottom).
- **Collapsible & Resizable:** User-defined sizing with snap points.
- **Future Customization:** The architecture natively supports undocking into floating windows or saving custom layout workspaces per-project. This avoids future UI rewrites.

## 7. Product-First Thinking

The objective of Workspace V2 is to establish the long-term Workspace architecture that Asterim can grow on for years. By treating the environment as an OS mapping strictly to the domain model, we ensure that new subsystems (cloud relay, multi-agent missions, marketplaces) fit naturally into the architecture without forcing redesigns of the user experience.
