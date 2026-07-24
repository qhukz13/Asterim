# Asterim Product Vision & Philosophy

## Strategic Identity

**Asterim is the operating system for AI software engineering teams.**

It is **NOT**:
* A simple ChatGPT / LLM API wrapper
* A single-agent chat dashboard
* Another generic code editor or IDE

Asterim is a collaborative operating environment designed from the ground up for developers, engineering managers, and autonomous AI agents to work side-by-side in structured, reproducible software development workflows.

---

## Core Product Pillars

1. **Projects**: Unified boundaries containing codebase state, git repositories, configuration, team access, and persistent context.
2. **Threads**: Multi-turn, stateful collaboration sessions between developers and AI agents with complete transcript history and tool telemetry.
3. **Missions**: High-level engineering goals broken down into verifiable task graphs executed by specialized agents with clear completion criteria.
4. **AI Agents**: Pluggable agent runtimes (Claude Code, Aider, Antigravity, custom CLI tools) managed, monitored, and orchestrated in isolated environments.
5. **Reviews**: First-class code review interface for agent-generated diffs, allowing line-by-line inspection, comment threads, and explicit change acceptance.
6. **Approvals**: Real-time promise-intercepted gate system ensuring agents cannot mutate files, run dangerous terminal commands, or make network calls without explicit human approval.
7. **Context**: Intelligent indexing, file selection, symbol maps, and graphified knowledge trees that provide agents with precise codebase understanding.
8. **Git**: Native integration with local and remote version control workflows (commits, branches, PRs, diff analysis).
9. **Team Collaboration**: Multi-user workspaces with organization-wide RBAC, shared thread history, mission delegation, and audit logging.

---

## Core Target Audience

* **Primary**: Engineering Leaders & Senior Developers managing AI-assisted software projects who require auditability, security, and structured agent execution.
* **Secondary**: High-velocity Indie Hackers and Full-Stack Engineers running multiple agent swarms concurrently across workstations.
* **Enterprise / Platform Teams**: Organizations needing team-wide agent governance, permission controls, and centralized context.

---

## Product Principles

1. **Local-First, Cloud-Enabled**: Local execution of heavy agent processes and PTY sessions with seamless cloud synchronization for team collaboration.
2. **Linear/Cursor-Grade Experience**: Focused, low-latency, clutter-free UX built for keyboard-driven power users.
3. **Absolute Auditability**: Every agent thought, tool call, command execution, and file modification is permanently recorded and reviewable.
4. **Human-in-the-Loop Governance**: Zero-friction approval workflows that keep developers in control without slowing down agent velocity.
5. **Interoperable Agent Ecosystem**: Bring your own agents and CLI tools via standard adapter interfaces rather than being locked into a single proprietary LLM model.
