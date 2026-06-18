# AgentDeck Tasks

This file is the single source of truth for project progress.



## TODO



## IN PROGRESS

(None)

## DONE

- **TSK-015**: Mobile UI Optimization
  - *Description*: Update the dashboard to be fully mobile-responsive.
  - *Priority*: High
  - *Dependencies*: TSK-006
  - *Status*: DONE

- **TSK-010**: Implement Aider adapter
  - *Description*: Create the adapter to interface with the Aider CLI tool.
  - *Priority*: High
  - *Dependencies*: TSK-004, TSK-003
  - *Status*: DONE
- **TSK-011**: Implement Claude Code adapter
  - *Description*: Create the adapter to interface with Claude Code.
  - *Priority*: Medium
  - *Dependencies*: TSK-004, TSK-003
  - *Status*: DONE

- **TSK-013**: Approval System
  - *Description*: Mechanism to pause agent execution and request client approval.
  - *Priority*: High
  - *Dependencies*: TSK-004, TSK-005
  - *Status*: DONE

- **TSK-012**: Git monitoring module
  - *Description*: Watch local git repositories for changes and diffs.
  - *Priority*: Medium
  - *Dependencies*: TSK-004
  - *Status*: DONE

- **TSK-014**: Project Management API
  - *Description*: Endpoints to list, add, and remove projects.
  - *Priority*: Medium
  - *Dependencies*: TSK-002
  - *Status*: DONE

- **TSK-006**: Basic dashboard
  - *Description*: Scaffold the React frontend for the control center.
  - *Priority*: High
  - *Dependencies*: TSK-005
  - *Status*: DONE

- **TSK-005**: Websocket communication
  - *Description*: Set up Socket.IO server and client connection logic.
  - *Priority*: High
  - *Dependencies*: TSK-004
  - *Status*: DONE

- **TSK-004**: Event bus
  - *Description*: Implement the internal pub/sub event system.
  - *Priority*: High
  - *Dependencies*: TSK-003
  - *Status*: DONE

- **TSK-003**: Shared types
  - *Description*: Define the core TypeScript interfaces (Events, Adapters, Project state) in a shared package.
  - *Priority*: High
  - *Dependencies*: TSK-002
  - *Status*: DONE

- **TSK-002**: Monorepo setup
  - *Description*: Initialize the monorepo using standard tooling (e.g., pnpm workspaces, Turbo).
  - *Priority*: High
  - *Dependencies*: TSK-001
  - *Status*: DONE
- **TSK-001**: Documentation
  - *Description*: Create foundational architecture, roadmap, decisions, and tasks documents.
  - *Priority*: Critical
  - *Dependencies*: None
  - *Status*: DONE
