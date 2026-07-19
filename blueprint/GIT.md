# Git Support Specification

## Level 2: Product Requirements

- Git exists to support AI workflows.
- Git MUST remain compatible with every Git hosting provider.
- Git MUST NOT depend on GitHub or any specific vendor APIs.
- Git operations MUST be local-first.
- Advanced Git operations may remain in the terminal.
- Common workflows MUST be accessible from the UI.

## Purpose

This document defines the normative specification for the Git Subsystem within Asterim. It outlines the architecture, responsibilities, user workflows, and relationship with other subsystems.

## Product Philosophy

Git is an implementation detail of a Project, not a top-level application concept.
Users manage code within an AI Workspace; version control happens as a natural consequence of that work.

In the user interface, the term **Git** should be avoided. Instead, Asterim uses the concept of **Changes** (which encompasses repository status, diffs, staged files, and branches) to map to Git operations under the hood.

## System Architecture

The Git Subsystem operates in Tier 1 (Asterim Core) to execute local Git commands and expose real-time status through the Event Bus.

The subsystem is composed of a central `GitService` and domain-specific managers:

- **GitService**: Orchestrates the Git lifecycle.
- **GitProvider**: Abstraction layer executing local Git CLI commands (`git`).
- **RepositoryManager**: Manages the `.git` directory presence, initialization, and repository errors.
- **StatusManager**: Tracks modified, staged, and untracked files.
- **DiffManager**: Computes and supplies diff contents for review.
- **CommitManager**: Manages staging logic and commit execution.
- **BranchManager**: Handles branch resolution, switching, and creation.
- **RemoteManager**: Manages push, pull, fetch, and sync against remote providers.
- **HistoryManager**: Provides recent commit logs and timeline data.

## User Workflows

The Git Subsystem lives primarily within the **Changes** tab of the Main Workspace.

1. **Reviewing Changes**: As files are modified (by users or AI), the `StatusManager` updates the Changes tab in real-time.
2. **Reviewing Diffs**: Selecting a modified file opens a native Diff Viewer inside the workspace.
3. **Approving AI Code**: A core workflow. When an AI Mission completes, the user reviews the diffs in the Changes tab before staging.
4. **Committing**: Users commit staged files directly via the UI. **AI agents MUST NEVER commit automatically without explicit user approval.**
5. **Syncing**: Users pull and push branches from the UI, keeping local-first capabilities while supporting remote collaboration.

## Repository Lifecycle

1. When a Project is loaded, Asterim checks for a `.git` directory.
2. If found, the repository is loaded into `RepositoryManager`.
3. The `GitService` begins emitting `git.status` updates over the Event Bus.
4. If no `.git` is found, the Changes tab exposes a "Initialize Repository" flow.

## Commit Lifecycle

1. Files move from Untracked/Modified to Staged via the UI.
2. The user reviews changes and provides a commit message (or uses an AI-suggested message).
3. The commit is executed locally.
4. `StatusManager` resets the local view.

## Branch Lifecycle

- Current branch is prominently displayed.
- Users can switch or create local branches.
- Advanced branching strategies (rebasing, cherry-picking) are left to the terminal for the MVP.

## Remote Synchronization

- The `RemoteManager` interacts with `origin` (or the default remote).
- The system must not store user credentials natively, instead relying on the user's local `ssh-agent` or standard Git credential manager to authenticate.

## Security Considerations

- All commands must be executed strictly against the Project's working directory.
- `child_process.exec` calls must sanitize file paths and branch names to prevent command injection.
- Git operations must run under the user's local permissions.

## Relationship with Other Subsystems

- **Missions**: Git supports Missions by providing exact diff context before and after the AI executes a task.
- **Cloud Relay**: Remote mobile clients can view and approve changes because `GitService` routes status updates through the `EventBus` to the `RelayClient`.
- **Workspace**: Git state is deeply integrated into the Project state, allowing seamless transitions between Chat, Files, and Changes tabs.

## Future Roadmap

The architecture must support future integration of:

- Pull Requests / Merge Requests
- Conflict Resolution UI
- Interactive Rebasing
- Graphical Commit Timelines
- Deep provider integrations (GitHub, GitLab, Gitea) as optional adapters on top of the local-first layer.
