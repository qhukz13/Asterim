# AgentDeck Official Roadmap

## Level 2: Product Requirements
- Future development MUST always begin by reading this ROADMAP.md.

## Vision
To build the definitive control plane for autonomous AI coding agents, providing developers with verifiable control, deep visibility, and cross-device orchestration capabilities without compromising local security.

## Current Milestone
**Phase 3 & 4: Mobile-First Experience & Multi-Device Support**
- **Objective**: Ensure the local dashboard is accessible and highly usable on mobile devices, allowing seamless switching between projects and persistent agent sessions.
- **Success Criteria**: A user can securely scan a QR code to connect their mobile device and manage concurrent Aider, Claude, and Antigravity sessions. A laptop user can seamlessly discover and connect to a local Desktop workstation via mDNS.
- **Remaining Work**: PWA offline support, Throttling high-frequency PTY output for mobile browsers.

## Active Tasks
| ID | Priority | Description | Dependencies | Status |
| :--- | :--- | :--- | :--- | :--- |
| P1-001 | High | Push Notification Reliability (HTTPS required) | None | Planned |
| P1-003 | Medium | Agent Binary Detection at Startup | None | Planned |
| P1-004 | High | Hardened Approval Regex | None | Planned |
| P1-007 | Medium | Agent Auto-Restart | None | Planned |
| P1-008 | Low | ESLint + Prettier Configuration across all apps | None | Planned |
| P1-009 | High | CI Pipeline for automated PR checks | None | Planned |
| P1-010 | High | Windows PATH and Spaces Fix for PTY | None | Bug |

## Next Milestones
1. **Phase 5: Cloud Features**: Cloud relay server implementation, E2E encryption, global remote push notifications.
2. **Phase 6: Commercial Release**: Standalone binaries, marketing site, telemetry, public beta.
3. **Phase 7: SaaS Platform**: Subscriptions, multi-thread chat, advanced diff viewer.

## Future Ideas
*(Not yet approved for development)*
- Extending adapter coverage to Roo Code (VS Code extension).
- Extending adapter coverage to Codex CLI.
- Dark/Light mode toggle.
- Database Migration System.

## Completed Milestones
- **Phase 0: Research**: Evaluated event buses, Socket.IO, Fastify, and adapter strategies.
- **Phase 1: Local MVP**: Monorepo setup, Event bus, SQLite storage, Terminal PTY, Basic web dashboard.
- **Phase 2: Agent Integrations**: Claude Code, Aider, and Antigravity adapters implemented. Device pairing, session recovery, and HMAC auth implemented.
