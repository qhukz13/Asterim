# Asterim Workspace Architecture

Asterim is an AI-native Workspace, NOT just another IDE. Traditional IDEs are organized around files. Asterim is organized around developer intent. The user does not think "I need App.tsx", the user thinks "I'm implementing Git". Everything in the UI reinforces this mental model.

The Workspace is the primary interface where a user and an AI agent collaborate on a Project.
It is a layout designed for concurrent AI tasks, minimal UI friction, and deep context management.
- Every screen MUST reinforce the hierarchy: Workspace -> Projects -> Sessions -> Agent.

## Purpose

This document defines the normative specification for the Asterim Workspace. It outlines the information hierarchy, layout architecture, navigation rules, and empty states.

## Information Hierarchy

The application is structured around a strict four-level hierarchy. Navigation must always flow from top to bottom.

1. **Workspace**: The global context (User, Workstation, Settings, Overlay System).
2. **Projects**: A collection of related code and sessions managed by agents.
3. **Sessions**: Individual execution threads within a project (Main Session vs Parallel Sessions).
4. **Agent**: The active AI engine running inside a session (Claude, Aider, Antigravity).

## Layout Architecture

The application root is the `WorkspaceShell`, which maintains a persistent three-column layout.

### 1. TopBar

The global application header.

- **Current Responsibilities**: Current Workspace, Current Workstation status, Mobile Pairing entry point.
- **Future Expansion**: User Profile, Notifications, Relay Status, Global Search / Command Palette, Teams.

### 2. Navigation Sidebar (Left Column)

The primary navigation root.

- **Current Responsibilities**: Project List.
- **Future Expansion**: Missions, Approvals, Teams, Plugins, Settings.

### 3. Session Sidebar (Center Column)

The context-aware session manager for the selected project.

- **Responsibilities**: Displays the Main Session and any Parallel Sessions. Allows creating new sessions. Displays session status.

### 4. Main Workspace (Right Column)

The primary work area for the selected session.

- **Tabs**: Chat, Terminal, Context, Changes, Logs.

### 3. Context Tab
Answers the question: "What is the agent currently working with?"
This replaces the traditional IDE file explorer with an AI-focused context view.
- **Mission Area**: Explicitly states the active task or goal.
- **Pinned / Active Context**: A list of files currently being read or modified by the agent, keeping the working set small and focused.
- **Related Files**: Suggestions or related knowledge bases.
- **AI Placeholders**: Features like `✨ Suggest Files` or context summarization.
- **Future Ready**: Built to support Context sharing, Session snapshots, and Knowledge Context without restructuring.

### 4. Changes Tab
Version control is exposed as a seamless project capability rather than a standalone Git client.
- **Top Summary Card**: A compact overview showing repository name, current branch, ahead/behind sync status, file counts, and the last commit.
- **Changed Files List (Left Column, 30%)**: A unified list of all changed files. Each row features a checkbox for staging/unstaging, relative path grouping, and a status badge (M, A, D, R).
- **Diff Viewer (Right Column, 70%)**: Selecting a file in the left column displays its raw diff here, preparing the DOM for future syntax highlighting.
- **Commit Panel**: Situated beneath the diff viewer, prioritizing the commit action. Includes a multiline textarea and a "Generate Commit Message" AI action.
- **Toolbar**: A compact, minimal action bar in the upper right containing Pull, Push, Sync, and Fetch commands.

*Design Principle*: The Changes tab must be calm, minimal, information-dense, and highly readable, avoiding large empty cards and relying on spacing and typography for structure.

- **BottomPrompt**: Persistent input area.

### 5. Overlay System

A global modal/dialog manager.

- **Usage**: All full-screen creation or pairing flows (Create Project, Connect Workstation, Developer Settings) MUST be implemented as overlays triggered from the Navigation Sidebar or TopBar, never as dedicated routing pages.

## Navigation Rules

### Restore Behaviour

On startup, the system MUST automatically restore the user's previous working state, prioritizing in this exact order:

1. Restore previous workstation.
2. Restore previous project.
3. Restore previous session.
4. Restore previous active tab.

If restoration fails at any level, the system gracefully falls back to the highest available level, or ultimately, the Empty Workspace state.

### Empty Workspace State

Displayed when no projects exist, the active workstation is unavailable, or on first application launch.

- **Requirement**: This MUST NOT be a blank screen. It MUST be a polished onboarding experience presenting actionable next steps (e.g., "Add Project", "Open Existing Project", "Connect Workstation").

## Design Philosophy

- **Premium & Calm**: The UI should feel comparable to professional tools such as Linear, Raycast, Warp, or modern IDEs.
- **Design Tokens**: All styling MUST consume reusable design tokens (Colors, Typography, Spacing, Radius, Shadows, Motion, Breakpoints). Inline styles and ad-hoc CSS are strictly prohibited.
- **Future Scalability**: No future feature (Cloud Workstations, Project Analytics) should require redesigning the dashboard layout. The three-column Shell is permanent.
