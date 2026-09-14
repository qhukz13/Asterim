# Phase 4.5 — Experience & Visual Design Audit

**Audit Date**: August 11, 2026  
**Auditor**: Lead Product Designer, Creative Director & UX Engineer  
**Target Application**: `@asterim/marketing` (`apps/marketing`)  

---

## 1. Current Experience Score Card

| Category | Score (1-10) | Diagnostic Summary |
| :--- | :---: | :--- |
| **Product Comprehension** | **6/10** | Takes ~15s to understand Asterim is a control plane around agents, but lacks live visual execution representation in the hero. |
| **Visual Identity** | **6/10** | Clean dark theme, but relies on common SaaS tropes (dark background + green gradient + static tabbed cards). Lacks distinct visual topology. |
| **Professionalism** | **8/10** | CSS design tokens centralized, builds cleanly, responsive navigation works well. |
| **Interaction Quality** | **5/10** | Demos rely on tab switching and static mocked buttons rather than deep, interactive product simulations. |
| **Animation Quality** | **6/10** | Basic CSS transitions exist, but lacks stateful, purposeful motion communicating control-plane topology. |
| **Product Demonstration** | **5/10** | Previews are static representations of logs and cards rather than interactive execution state engines. |
| **Information Hierarchy** | **7/10** | Story flow improved, but sections still rely heavily on card containers rather than architectural narratives. |
| **Mobile UX** | **7/10** | Mobile drawer works, but complex interactive demos feel compressed on small screens. |
| **Accessibility** | **8/10** | Focus rings (`:focus-visible`), ARIA tab roles, and semantic HTML structure verified. |
| **Performance** | **9/10** | Builds in 1.0s, zero external heavy 3D/video dependencies. Fast load times. |

---

## 2. Generic Pattern Audit

| Generic Pattern | Why It Feels Generic | Evidence in Codebase | Replacement Strategy |
| :--- | :--- | :--- | :--- |
| **Static Tabbed Feature Card Container** | Tab switching feels like a generic marketing widget rather than controlling a live workstation engine. | `InteractiveProductDemo.tsx` rendering basic mock tabs. | Create a **Live Interactive Control Plane Simulator** with interactive step progression, execution state changes, real AST hazard clearance, and scope switching. |
| **Centered Hero with Command Copy Box** | Standard AI SaaS pattern seen in hundreds of developer sites. | `HeroSection.tsx` centered text + terminal snippet. | Pair the hero headline directly with an **Interactive Control Plane Topology Map** demonstrating `Environment -> Agent -> AST Security -> Clearance`. |
| **Repetitive Card Grid Containers** | Repeating dark box + icon + title + text across multiple sections dilutes visual identity. | `CapabilitiesGrid.tsx`, `PlatformMatrixSection.tsx`. | Shift from card-heavy grids to open, typography-driven architectural narratives and full-width technical control panels. |
| **Unanchored Accent Glows** | Radial emerald green background gradients applied decoratively. | `index.css` radial gradients. | Derive an Asterim-specific visual language from the product's architecture: event streams, AST path bounds, process trees, and scope boundaries. |

---

## 3. Interaction & Demo Audit

| Interactive Component | Current Interaction | Value to User | Problem | Recommended Redesign |
| :--- | :--- | :--- | :--- | :--- |
| **`AgentStreamTab`** | Toggle stream pause/resume. Auto-appending string array. | Low | Feels like a static log typewriter. | Upgrade to an **Interactive Agent Execution Engine** with state transitions (`IDLE` -> `RUNNING` -> `TOOL CALL` -> `SECURITY CHECK` -> `COMPLETED`), adjustable frame throttler, and process metrics. |
| **`SecurityGuardTab`** | Approve/Reject state toggle on a single command string. | Medium | Static single-state simulation. | Build an **Interactive AST Hazard Inspector** where users can select sample commands (`rm -rf`, `curl | bash`, `cat /etc/shadow`), view AST path traversal analysis, risk scores, and clearance controls. |
| **`EnvironmentTab`** | Tab click between Personal, Company, Client presets. | Medium | Changes text paragraph and secret counts. | Build an **Interactive Scope Switcher** showing active project file trees, scoped API secret boundaries, attached MCP tools, and permission policies updating in real time. |
| **`MobileTunnelTab`** | Static mobile push notification card mockup. | Low | Looks like a static image replacement. | Build an **Interactive Remote E2E Relay Monitor** with live Noise protocol status, ping latency, and interactive mobile approval prompt button. |

---

## 4. Animation Audit

| Animation / Motion | Purpose | Current Quality | Action | Recommendation |
| :--- | :--- | :--- | :--- | :--- |
| **Pty Log Stream Auto-Append** | Simulate live terminal stream | Medium | **IMPROVE** | Animate state changes, step transitions, and PTY frame rate throttler indicators. |
| **Tab Switch Transitions** | Switch preview tabs | High | **KEEP** | Smooth tab transitions with ARIA `aria-selected` updates. |
| **Button Hover Scaling** | Primary CTA feedback | High | **KEEP** | Restrained 1px translate shift and background color shift. |
| **Background Radial Glow** | Atmospheric depth | Medium | **REMOVE / RESTRAIN** | Replace generic radial glow with structured control-plane grid lines and topology node connectors. |

---

## 5. Product Story Audit

- **What is Asterim?**: The local-first AI engineering operating system / control plane.
- **Who is it for?**: Developers who direct autonomous AI coding agents (Claude Code, Aider, custom scripts).
- **What problem does it solve?**: Unvetted shell commands, orphaned PID processes, mixed project secrets, lost AST context.
- **Why is it different?**: Asterim does not replace AI models—it provides the control plane around them (environments, security, PTY throttling, MCP, Skills, approvals, cross-surface monitoring).
