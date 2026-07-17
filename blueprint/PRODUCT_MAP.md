# Ecosystem Map

## Level 2: Product Requirements
- The product MUST explicitly separate local execution from remote management.

## Purpose
A strict hierarchical map of all AgentDeck subsystems and their relationships.

## Scope
Product boundaries.

## 1. AgentDeck Core (The Engine)
The local Node.js runtime executing on the developer's machine.
- **Subsystems**: State Manager, Event Bus, Database (SQLite), WebSocket Server, Adapter Manager.

## 2. Agent Adapters (The Plugins)
The translation layer between the Core and third-party tools.
- **Implementations**: Claude Code Adapter, Aider Adapter, Custom Script Adapters.

## 3. AgentDeck Client (The Interface)
The UI consumed by the user.
- **Subsystems**: Terminal Viewer, Diff Viewer, Mission Dashboard, Project Selector.
- **Implementations**: Local Web App (localhost), Mobile PWA (Remote).

## 4. AgentDeck Cloud (The SaaS)
The remote infrastructure.
- **Subsystems**: Cloud Relay (WebSocket Tunneling), Licensing Server, Account Portal.

## Architecture Rule
- A subsystem in Tier 1 (Core) MUST NOT directly depend on Tier 4 (Cloud) to function. The system MUST degrade gracefully to local-only operation if the Cloud is unreachable.

## Related Documents
- `ARCHITECTURE.md`
