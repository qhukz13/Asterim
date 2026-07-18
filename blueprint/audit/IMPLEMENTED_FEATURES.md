# Implemented Features

This document catalogs all features currently verifiable in the `/Asterim` codebase.

## Core Runtime
- **Fastify API**: Handles REST requests and static file serving.
- **SQLite Database**: Embedded local storage (`~/.agentdeck/asterim.db`) tracking projects, events, settings, and sessions.
- **Event Bus**: Centralized pub/sub mechanism (`EventEmitter`).
- **Pruning Service**: Automatically prunes DB events older than 7 days or beyond a 50,000 capacity.

## Security & Auth
- **Device Pairing**: 6-digit PIN system that generates HMAC-SHA256 session tokens.
- **Middleware**: Fastify and Socket.IO authentication middleware ensuring protected routes.
- **Session Recovery**: Cleans up zombie sessions on server restart.

## Adapters
- **Aider Adapter**: Interfaces with the Aider CLI.
- **Claude Code Adapter**: Interfaces with the Claude Code CLI.
- **Antigravity Adapter**: Interfaces with the internal Google Antigravity CLI.
- **Approval Manager**: Intercepts destructive commands and requests UI approval via Promises.

## Client UI
- **PWA Setup**: Icons, manifest, and basic service worker layout.
- **Chat/Terminal UI**: Displays streaming stdout/stderr with basic ANSI parsing.
- **Onboarding Wizard**: QR code generation and path audit checks.
