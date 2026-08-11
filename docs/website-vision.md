# Asterim Marketing Website Vision & Narrative Strategy

**Version**: 3.0.0  
**Target Application**: `@asterim/marketing` (`apps/marketing`)  
**Design Tier**: Linear, Cursor, Raycast, Vercel  

---

## 1. Executive Product Thesis

> **"Asterim gives you a control plane for the AI coding agents you already use."**

Asterim is NOT another chat wrapper, IDE extension, or single-agent prompt UI. It is an **AI-native control plane and operating environment** designed from the ground up for software developers, tech leads, and engineering organizations running autonomous AI coding agents (Claude Code, Aider, Codex, Antigravity, and custom CLI tools) across workspaces.

---

## 2. Target User Profile

* **Primary**: Power-user Senior Developers, Tech Leads, and Engineering Managers running CLI-based AI agents who demand total auditability, AST-level command clearance, and zero-trust security controls.
* **Secondary**: High-velocity Indie Hackers and Full-Stack Engineers orchestrating multi-agent swarms concurrently across workstations.
* **Platform & Enterprise Teams**: Engineering organizations requiring centralized environment scoping, secret management, and cross-device remote control.

---

## 3. Core Problem & Promise Matrix

| Core Problem | Asterim Core Promise |
| :--- | :--- |
| **Terminal Chaos**: AI agents live in disconnected, unmonitored terminal windows across local machines. | **Unified Control Plane**: Single observable workstation interface unifying state, telemetry, and live agent streams. |
| **Black-Box Hazard**: Agents run destructive terminal commands (`rm -rf`, force pushes, unverified network access) silently. | **AST Security Interception**: Promise-intercepted gate system scanning AST command hazards with mandatory Approve/Reject controls. |
| **Environment Leakage**: Secret keys and sensitive directory paths leak between personal, corporate, and client projects. | **Scoped Environments**: Isolated environment profiles scoping file paths, environment variables, attached MCP tools, and secret policies. |
| **Tethered Workstation**: You cannot monitor or approve long-running agent tasks when away from your desk. | **Local-First, Remote-Enabled**: Local PTY execution with encrypted cloud relay and cross-platform remote approval (Mobile & Web). |

---

## 4. The First 30–60 Seconds Experience Test

When a developer arrives at the Asterim landing page, within 30 seconds they must experience:
1. **Immediate Clarity**: A sharp 1-sentence value proposition and an immediate one-click quickstart pill (`npm install -g asterim`).
2. **Tactile Software Preview**: An interactive, functional Asterim Workstation frame positioned right in the hero viewport, allowing the user to click through live agent streams, approve an AST security hazard, switch environment scopes, and inspect multi-agent swarm telemetry.
3. **Visceral Realization**: *"This isn't generic AI slop or marketing fluff—this is an actual control plane for the tools I already use."*

---

## 5. The 8-Act Scroll Narrative Architecture

The website is structured as a continuous 8-Act narrative flow:

```
┌─────────────────────────────────────────────────────────┐
│ Act 1: The Problem — Disconnected Terminal Chaos        │
├─────────────────────────────────────────────────────────┤
│ Act 2: The Control Plane — Unified Workstation          │
├─────────────────────────────────────────────────────────┤
│ Act 3: Interactive Workstation Sandbox (Real React UI)  │
├─────────────────────────────────────────────────────────┤
│ Act 4: Multi-Agent Swarm Telemetry & Parallel Running   │
├─────────────────────────────────────────────────────────┤
│ Act 5: Scoped Environments & Zero-Trust Isolation       │
├─────────────────────────────────────────────────────────┤
│ Act 6: AST Security Guard & Real-Time Interception     │
├─────────────────────────────────────────────────────────┤
│ Act 7: Cross-Platform Remote Relay (Mobile/Web Tunnel) │
├─────────────────────────────────────────────────────────┤
│ Act 8: Call to Action — Local-First Installation        │
└─────────────────────────────────────────────────────────┘
```

### Act 1: The Problem (Terminal Chaos)
- **Visual**: Raw, overflowing CLI terminal windows spilling over each other with unmonitored agent logs.
- **Narrative**: You already use AI coding agents. But every agent lives in an isolated, dark terminal window with zero visibility and unbounded permissions.

### Act 2: The Control Plane (Unified Architecture)
- **Visual**: Terminal chaos resolves into Asterim's clean workstation layout.
- **Narrative**: Transform terminal chaos into a structured, observable local-first control plane.

### Act 3: Interactive Workstation Sandbox (Real React UI)
- **Visual**: A full-scale, pixel-perfect interactive Workstation component mirroring `apps/web`.
- **Interactions**:
  - Live agent log streaming with line numbers and 16ms backpressure metrics.
  - AST Security Guard intercept dialog with working `Approve` / `Reject` triggers.
  - Environment Scope dropdown switching between `Personal`, `Company`, and `Client` presets.
  - Swarm tab showing 4 active agents working on different repository files in parallel.

### Act 4: Multi-Agent Swarm & Telemetry
- **Visual**: Asymmetric 2-column split view displaying real-time agent state matrix (Claude Code, Aider, Codex, Antigravity).
- **Narrative**: Orchestrate multi-agent swarms without context collision. Each thread maintains its own isolated process, PTY stream, and context state.

### Act 5: Scoped Environments & Zero-Trust Isolation
- **Visual**: Live interactive scope switcher demonstrating how environment configs, API keys, and workspace paths automatically load and drop based on project boundaries.
- **Narrative**: Never leak client secrets or corporate credentials. Scoped environments restrict agent file system access and inject context safely.

### Act 6: AST Security Guard & Command Clearance
- **Visual**: Full-width code/CLI split view highlighting intercepted commands (`rm -rf`, `sudo`, `curl | bash`).
- **Narrative**: Real-time promise interception. No dangerous terminal command executes without explicit clearance.

### Act 7: Cross-Platform Remote Relay
- **Visual**: Workstation desktop UI paired with a responsive mobile tunnel card illustrating cloud relay synchronization.
- **Narrative**: Monitor long-running agent threads on the go. Approve security gates from your phone while heavy PTY processing stays local.

### Act 8: Call to Action & Developer Quickstart
- **Visual**: Minimalist terminal banner with quickstart command (`npm install -g asterim`), OS binary downloads (AppImage, DMG, EXE), and links to GitHub / Documentation.

---

## 6. Spline & 3D Policy

- **Strict Constraint**: Spline or 3D animations are strictly restricted to subtle background atmosphere or hero depth (e.g. ambient star/horizon depth).
- **Prohibition**: Spline MUST NEVER be used to mock up product UI, buttons, terminal windows, or control panels.
- **Implementation Rule**: All product previews, control panels, command dialogs, and workspace frames MUST be real React DOM components styling real code and interactive states.
