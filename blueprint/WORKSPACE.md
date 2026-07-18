# Workspace Architecture

## Level 2: Product Requirements
- The UI MUST be organized around a persistent Workspace, not temporary pages.
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
- **Tabs**: Chat, Terminal, Files, Diff, Logs.
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
