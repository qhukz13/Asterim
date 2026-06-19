# AgentDeck

AgentDeck is a local-first control center for AI coding agents. It provides a structured, AI-native interface to monitor and control coding agents running on your computer directly from a phone, tablet, or another device.

![AgentDeck Dashboard Mockup](./assets/agentdeck_dashboard_mockup.png)

## Key Features

* 💻 **Live Telemetry Dashboard**: Stream terminal output from AI agents in a responsive, real-time web interface.
* 🛡️ **Interactive Approval Interceptors**: Pause agent execution and review high-risk actions (file edits, script executions) with standard Approve/Deny buttons.
* 📱 **Mobile & Remote Support**: Connect securely from mobile devices using end-to-end encrypted relay tunnels.
* 🔒 **Console QR Onboarding**: Start the server to see a pairing PIN and QR code in the terminal for instant, auto-configured pairing.

---

## Getting Started

### Prerequisites

To build and run AgentDeck, you need the following requirements:

#### 1. Core Runtimes
* **Node.js** >= 18
* **pnpm** >= 9

#### 2. Native Compilation Tools
AgentDeck relies on `node-pty` for terminal emulation, which requires native build tools:
* **Windows**: Run `npm install --global windows-build-tools` from an administrative terminal, or ensure you have **Visual Studio Build Tools** installed with the "Desktop development with C++" workload, along with **Python**.
* **macOS**: Install Xcode Command Line Tools via `xcode-select --install`.
* **Linux**: Install standard compiler packages (e.g. `sudo apt install build-essential python3`).

#### 3. Supported AI Agents (Install on PATH)
Ensure your preferred CLI agents are installed and accessible on your system's PATH:
* **Claude Code**: [Anthropic Claude Code](https://github.com/anthropic-ai/claude-code) (`npm install -g @anthropic-ai/claude-code`)
* **Aider**: [Aider Chat CLI](https://aider.chat) (`pip install aider-chat`)

---

### Quick Start

1. **Clone the repository and install dependencies**:
   ```bash
   pnpm install
   ```

2. **Run in development mode**:
   ```bash
   pnpm dev
   ```

3. **Pair your device**:
   * On startup, the terminal prints an onboarding welcome banner:
     ```
     ==================================================
                WELCOME TO AGENTDECK v0.1
           AI Agent Control Plane is Initialized
     ==================================================
       Local URL    : http://localhost:3000
       LAN URL      : http://192.168.1.34:3000
       Pairing PIN  : 813351
     ==================================================
     ```
   * Scan the generated **Pairing QR Code** in your terminal using your mobile device, or navigate to the Local/LAN URL.
   * The browser will automatically pair using the PIN query parameter and launch the onboarding setup wizard to select your default agent.

---

## Documentation

For detailed information on design decisions, specifications, and architecture:
* 📄 [Architecture Specification](./docs/architecture.md)
* 📋 [ADR Decisions Log](./docs/decisions.md)
* 🗺️ [Project Roadmap](./docs/roadmap.md)
* 🏗️ [Pending Task List](./docs/tasks.md)
* 🔐 [Security & Disclosure Policy](./SECURITY.md)
