# AgentDeck Roadmap

## PHASE 0: Research
**Goals:** Define the core architecture, constraints, and data models.
**Deliverables:**
- Initial documentation (`architecture.md`, `roadmap.md`, `tasks.md`, `decisions.md`).
- Evaluation of event bus libraries and websocket frameworks.
- Analysis of Aider and Claude Code integration methods.
**Success Criteria:** A clear, documented path forward that any engineer can understand.
**Risks:** Underestimating the difficulty of intercepting standard output/input from various agent CLIs.

## PHASE 1: Local MVP
**Goals:** Build the foundation and a basic working interface on the local machine.
**Deliverables:**
- Monorepo setup.
- Event bus implementation.
- Basic websocket server.
- Simple local web dashboard.
- A "Dummy" agent adapter for testing.
**Success Criteria:** The dashboard can connect to the server, send a command, and receive dummy logs/events in real-time.
**Risks:** Choosing the wrong monorepo tooling that slows down development.

## PHASE 2: Agent Integrations
**Goals:** Connect real AI agents to the system.
**Deliverables:**
- Google Antigravity Adapter implementation.
- Claude Code Adapter implementation.
- File system and Git monitoring modules.
- Approval interception system.
**Success Criteria:** A user can run Antigravity through AgentDeck and approve/deny actions from the local web dashboard.
**Risks:** Agents updating their CLI output formats and breaking adapters.

## PHASE 3: Mobile-first Experience
**Goals:** Make the dashboard highly usable on phones and tablets.
**Deliverables:**
- Mobile-optimized responsive UI redesign.
- Local network discovery (mDNS).
- PWA manifest and offline/caching support.
**Success Criteria:** A user can access AgentDeck from their phone by scanning a QR code or via local auto-discovery, with a native-feeling UI.
**Risks:** Local network firewalls blocking mDNS or connections.

## PHASE 4: Multi-device Support
**Goals:** Allow multiple projects and multiple devices to interact seamlessly.
**Deliverables:**
- SQLite database integration for state persistence.
- Session management.
- Multi-project dashboard views.
**Success Criteria:** A user can switch between different projects on their phone, seeing the history and current state of each independent agent session.
**Risks:** State synchronization issues between multiple active clients.

## PHASE 5: Cloud Features
**Goals:** Allow access to AgentDeck outside the local network.
**Deliverables:**
- Cloud relay server implementation.
- E2E encryption for the tunnel.
- Push notification system for mobile apps.
**Success Criteria:** A user can approve a coding action from their phone while away from their local network securely.
**Risks:** High latency, relay server scaling costs, and strict security requirements.

## PHASE 6: Commercial Release
**Goals:** Launch AgentDeck to the public.
**Deliverables:**
- Standalone binaries (Windows, Mac, Linux).
- Polish, telemetry, and crash reporting.
- Marketing site and documentation.
**Success Criteria:** 1,000 active weekly developers using AgentDeck.
**Risks:** User adoption, maintaining support for rapidly evolving third-party AI agents.

## PHASE 7: Advanced UI & SaaS Platform
**Goals:** Transform the local tool into a connected SaaS platform with a premium interface.
**Deliverables:**
- SaaS Website Authentication and User Profiles (subscription management, cloud settings).
- UI Redesign: General dashboard homepage and persistent project sidebar.
- Multiple chat sessions/threads within a single project.
- Advanced Git Diff and File Viewer interface.
- Complete overhaul and bug fixes for the Live Terminal view.
**Success Criteria:** Users can log in with a cloud account, manage multiple chat threads, review code diffs natively, and seamlessly switch projects via the sidebar.
**Risks:** Complexity in syncing local CLI state with cloud user profiles; building a performant in-browser code diff viewer.
