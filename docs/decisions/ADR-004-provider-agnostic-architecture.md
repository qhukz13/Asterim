# ADR-004: Provider-agnostic architecture, single-provider MVP

**Status.** Accepted 2026-09-09.

**Context.** Asterim's product definition places it above coding agents, independent of any one vendor (`docs/product/overview.md`). Its MVP ships with Claude Code only. Two failure modes sit either side of that: building adapters nobody asked for, and letting the Core grow assumptions that are really Claude Code's shape, so that the second real provider forces a redesign.

The audit produced useful evidence here. The original abstraction assumed every agent is a PTY whose screen is scraped; the Claude Code adapter is a structured-protocol host with no terminal at all. Supporting both required widening `LaunchConfig` and `BaseAdapter` (a `permissionResolver`, a `handlesApprovalsNatively` flag, an adapter that overrides `start`/`sendCommand`/`stop` entirely) but not touching the Core's model of projects, threads, events or approvals. That is the evidence the layer is real.

**Decision.**

1. The MVP implements exactly one provider seriously: Claude Code. No development time goes to Aider, Codex or any other provider.
2. Antigravity stays as-is, labelled **PREVIEW**, with zero further investment. It is retained because it is the second structurally different provider shape, and it is the only thing that stops the abstraction quietly becoming Claude-shaped.
3. The Core may not assume a provider is a PTY, speaks a text protocol, streams tokens, has a session id, supports resume, or asks for permission at all. Those are adapter capabilities (`AdapterCapabilities`), and the Core branches on them.
4. The abstraction is not widened for hypothetical providers. It widens when a real second implementation demands it, which is how it widened for Claude Code.
5. Adding a provider must be: a `BaseAdapter` subclass, a `registerProvider` line, an entry in the engine list and binary detection, and a protocol test. Nothing in `apps/web`, no schema change, no new route.

**Consequences.** A third provider is a bounded piece of work whenever demand appears, and "which agents does it support" never requires a rewrite as an answer. The cost is carrying one PREVIEW adapter that will occasionally break when Google changes a TUI; that cost is accepted and disclosed rather than hidden.

**Recorded as a rule.** MVP: Claude Code. Architecture: provider-agnostic. Post-launch: additional agents strictly on observed demand.
