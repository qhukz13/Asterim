# AgentDeck

AgentDeck is a local-first control center for AI coding agents. It provides a structured, AI-native interface to monitor and control coding agents running on your computer directly from a phone, tablet, or another device.

## Vision

Instead of remote desktop access, AgentDeck provides a specialized dashboard. You can monitor agent activity, approve/deny destructive actions, review git diffs, and send new tasks without sitting in front of your computer. 

Currently, the system is designed to support:
- Aider
- Claude Code

*The architecture is adapter-based, allowing for easy integration with future AI coding agents.*

## Monorepo Architecture

This project is structured as a Turborepo monorepo using `pnpm` workspaces:

- **`apps/server`**: Fastify backend that runs the EventBus, WebSocket server, and Agent Adapters.
- **`apps/web`**: React + Vite local web dashboard featuring a premium, mobile-optimized UI.
- **`packages/shared`**: Shared TypeScript interfaces (`Events`, `State`, `Adapters`).
- **`packages/adapters`**: Wrappers for the AI CLIs (`AiderAdapter`, `ClaudeAdapter`).

## Getting Started

### Prerequisites
- Node.js >= 18
- pnpm >= 9

### Installation

1. Install dependencies across the entire workspace:
```bash
pnpm install
```

2. Start the development server (runs both the backend and frontend simultaneously):
```bash
pnpm dev
```

3. Open your browser:
- Desktop: Navigate to `http://localhost:5173`
- Mobile: Navigate to `http://<YOUR_LOCAL_IP>:5173` on the same network.

## Documentation

For deep dives into the system design and project status, please review the `docs/` folder:
- [Architecture](./docs/architecture.md)
- [Roadmap](./docs/roadmap.md)
- [Architecture Decision Records (ADRs)](./docs/decisions.md)
- [Task Board](./docs/tasks.md)
