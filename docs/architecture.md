# AgentDeck Architecture

## Product Vision
AgentDeck is a local-first control center for AI coding agents. It aims to provide developers with a structured, AI-native interface to monitor and control coding agents running on their computers directly from a phone, tablet, or another device. AgentDeck replaces remote desktop access with an intuitive dashboard showing current tasks, progress, git diffs, logs, and actionable approvals without being tightly coupled to any specific agent.

## System Architecture
AgentDeck uses an event-driven, adapter-based architecture. The system consists of:
1. **Core Engine**: Manages event routing, state, and coordination.
2. **Agent Adapters**: Pluggable modules that interface with specific AI agents (e.g., Claude Code, Aider, Roo Code).
3. **Websocket Server**: Provides real-time bidirectional communication with client devices.
4. **Dashboard Client**: A responsive web application (mobile-first) serving as the UI.
5. **Local Database**: Stores project metadata, session history, and configuration.

## High Level Diagram
```mermaid
graph TD
    Client[Mobile/Web Client] <-->|WebSockets / REST API| Server[Local Node.js Server]
    Server <--> EventBus[Event Bus]
    EventBus <--> StateManager[State Manager]
    EventBus <--> AdapterManager[Adapter Manager]
    
    AdapterManager <--> AiderAdapter[Aider Adapter]
    AdapterManager <--> RooAdapter[Roo Code Adapter]
    AdapterManager <--> ClaudeAdapter[Claude Code Adapter]
    
    AiderAdapter <--> AiderProcess[Local Aider Process]
    RooAdapter <--> RooProcess[Local Roo Process]
    
    Server <--> DB[(Local SQLite DB)]
```

## Module Descriptions
- **API/Server Module**: Exposes REST endpoints for configuration and WebSocket endpoints for real-time telemetry.
- **Event Bus Module**: Central pub/sub system for all internal communication.
- **Adapter Module**: Standardized interface for interacting with different agents. Handles standardizing agent outputs (logs, diffs, state) into AgentDeck events.
- **Project Monitor Module**: Watches the file system and Git repository to report file modifications and project status independently of the agent.
- **Approval System Module**: Intercepts actions requiring user approval from the adapters and routes them to the client.

## Event System Design
The Event System is the backbone of AgentDeck. It is fully asynchronous.
- **Topics**: `agent.log`, `agent.status`, `agent.approval_request`, `file.changed`, `git.diff`, `client.command`, `client.approval_response`.
- **Payload Structure**: All events follow a strict schema containing `timestamp`, `source` (adapter/client id), `type`, and `payload`.

## Adapter System Design
Adapters implement a common `IAgentAdapter` interface:
- `start(config)`
- `stop()`
- `sendCommand(cmd)`
- `onEvent(callback)`
New agents can be supported by writing a new adapter that maps the agent's stdout/stderr/API to the AgentDeck event schemas.

## API Design
- **REST**: `/api/v1/projects`, `/api/v1/agents`, `/api/v1/sessions`. Used for fetching historical data, configuration, and initialization.
- **GraphQL (Optional future)**: For complex queries over project histories.

## Websocket Design
- **Protocol**: Socket.IO for robust fallback and broadcasting.
- **Rooms**: Each active project or session is a room. Clients join rooms to receive localized telemetry.
- **Message Types**: Telemetry updates (one-way server-to-client), commands (client-to-server), and approval handshakes (bidirectional).

## Security Model
- **Local Network Only (MVP)**: Server binds to local network IP. 
- **Authentication**: A pairing PIN or QR code system is required for a new device on the local network to authenticate with the local server.
- **Authorization**: All destructive commands (e.g., executing arbitrary shell commands, git pushes) require explicit approval.

## Local Network Communication
The server will broadcast its presence on the local network using mDNS (Bonjour/Zeroconf) so mobile clients can discover the AgentDeck server automatically without manual IP entry.

## Future Cloud Synchronization Strategy
- **Relay Server**: A hosted cloud relay that securely bridges local servers to mobile devices outside the local network via WebRTC or encrypted WebSocket tunnels.
- **E2E Encryption**: All payloads routed through the cloud must be end-to-end encrypted; the cloud relay cannot read the code or logs.

## Mobile Application Strategy
- **Phase 1**: Responsive PWA (Progressive Web App) served directly from the local server.
- **Phase 2**: Native wrapper (React Native or similar) to handle push notifications for approval requests.

## Database Strategy
- **MVP**: Local SQLite. It requires zero setup from the user, stores data in a single file, and is fast enough for single-user concurrent access.
- **Schema**: Tables for `Projects`, `Sessions`, `Events` (pruned periodically), and `Settings`.

## Deployment Strategy
- **Distribution**: npm package (`npm install -g agentdeck`) or single executable binaries via pkg/nexe.
- **Updates**: Auto-update mechanism for the server and web client.

## Scalability Considerations
- **Event Throttling**: High-frequency logs from agents must be batched and throttled before sending over WebSockets.
- **Log Pruning**: Historical logs will grow fast; the database must auto-prune logs older than X days or limit by size.
- **Adapter Isolation**: Misbehaving agent processes shouldn't crash the main AgentDeck process. Adapters may eventually run in separate child processes or worker threads.
