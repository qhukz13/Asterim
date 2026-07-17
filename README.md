# AgentDeck

AgentDeck is the control plane for autonomous AI coding agents. It provides a secure, local-first interface to monitor, orchestrate, and control coding agents running on your workstation, directly from any connected mobile or desktop device.

## Core Capabilities

* **Live Telemetry Dashboard**: Stream high-frequency terminal output from AI agents into a responsive, real-time web interface without locking up your browser.
* **Interactive Interceptors**: Programmatically pause agent execution. Safely review high-risk actions (file edits, script executions) via standard Approve/Deny interfaces.
* **Cross-Device Orchestration**: Connect securely from mobile devices using end-to-end encrypted relay tunnels, allowing you to manage agents while away from your desk.
* **Zero-Config Pairing**: Secure, ephemeral 6-digit PINs and QR codes generated on startup for instant, trusted device pairing within your local network.

---

## Getting Started

### Prerequisites

To build and run AgentDeck, ensure the following are installed:

#### 1. Runtimes
* **Node.js** (v18 or higher)
* **pnpm** (v9 or higher)

#### 2. Native Build Tools
AgentDeck utilizes `node-pty` for robust terminal emulation, which requires native compilation tools on your host machine:
* **Windows**: Run `npm install --global windows-build-tools` (requires Administrative privileges) or install **Visual Studio Build Tools** (Desktop development with C++) and **Python**.
* **macOS**: Install Xcode Command Line Tools via `xcode-select --install`.
* **Linux**: Install standard build packages (e.g., `sudo apt install build-essential python3`).

#### 3. Supported AI Agents
AgentDeck interfaces with your existing CLI agents. Ensure they are installed and accessible on your system's `PATH`:
* **Claude Code**: `npm install -g @anthropic-ai/claude-code`
* **Aider**: `pip install aider-chat`
* **Antigravity**: Internal CLI (if applicable)

---

## Quick Start

1. **Clone the repository and install dependencies**:
   ```bash
   pnpm install
   ```

2. **Run in development mode**:
   ```bash
   pnpm dev
   ```

3. **Pair your device**:
   On startup, the terminal will print a localized onboarding banner and a QR code:
   ```text
   ==================================================
              AGENTDECK CONTROL PLANE
   ==================================================
     Local URL    : http://localhost:3000
     LAN URL      : http://192.168.1.34:3000
     Pairing PIN  : 813351
   ==================================================
   ```
   * Scan the generated QR code using your mobile device or open the Local/LAN URL directly in your browser.
   * The browser will securely pair using the PIN and launch the setup wizard to configure your default agent.

---

## Documentation & Product Specification

AgentDeck operates under a strict, documentation-driven methodology governed by the **Product Specification Blueprint**.

All major architectural decisions, workflows, and rules are documented in the `blueprint/` directory:

* 📄 [Product Specification](./blueprint/PRODUCT.md)
* 🏛️ [System Architecture](./blueprint/ARCHITECTURE.md)
* 🗺️ [Official Roadmap](./blueprint/ROADMAP.md)
* 🛠️ [Engineering Standards](./blueprint/ENGINEERING.md)
* 🤖 [AI Development Context](./blueprint/AI_CONTEXT.md)
* 🔐 [Security & Disclosure Policy](./SECURITY.md)

*(Note: Future development must always begin by consulting `blueprint/ROADMAP.md` and `blueprint/AI_CONTEXT.md`.)*
