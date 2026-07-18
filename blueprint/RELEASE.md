# Release & Launch Strategy

## Level 2: Product Requirements

- Releases MUST pass strict security and performance audits.

## Purpose

Defines the Launch Readiness criteria and QA checklists.

## Beta Strategy

- **Requirement**: The Public Beta MUST be gated to ensure the core loop handles edge cases.

## Release Blockers

A release MUST NOT be shipped if:

1. An agent can crash the Core Server.
2. The UI disconnects from the Event Bus silently without attempting reconnection.
3. The UI takes more than 1 second to render 10,000 lines of terminal output.

## QA Checklist

- [ ] Cross-OS Native Build Test (Windows, Mac, Linux).
- [ ] Concurrent Agent Load Test (3+ agents).
- [ ] Disconnect/Reconnect State Recovery Test.

## Production Readiness

A release is only production-ready if all P0 tasks (Critical Blockers) are resolved. P0 tasks include Device Pairing, Auth Layers, Log Pruning, and Session Recovery.
