# Asterim: Product Definition

## What Asterim is

Asterim is a local supervisor for coding agents. It runs on the developer's own machine, starts an agent (Claude Code today, Antigravity best-effort) inside a project folder, streams what the agent says and does into a browser dashboard, and stops the agent every time it wants to run a command or change a file until the developer approves. Every approval, denial, tool call and resulting diff is stored in a SQLite database the developer owns. Nothing leaves the machine except the agent's own API traffic.

## What Asterim is not

- Not an IDE, not an editor, not a chat app.
- Not a cloud service. There is no hosted Asterim; the relay and account features are frozen prototypes.
- Not a replacement for Claude Code, Codex or Antigravity. It drives them.
- Not an enterprise governance console. GitHub and Anthropic sell those.

## Target user (first customer)

A senior engineer or tech lead who already pays for Claude Code (Pro or Max), runs it on real repositories several times a day, and has been burned or nearly burned by an agent doing something they did not intend. They work on Windows, macOS or Linux, often from a laptop on the same network as a desktop that does the heavy lifting. They want to see and gate what agents do without babysitting a terminal, and they want a record they can look at afterwards.

Anti-targets for the first release: teams needing shared accounts, enterprises needing SSO and SIEM, people who want no GUI, and anyone expecting a hosted product.

## Core problem

"I run coding agents that can execute commands and edit files. The only way I can supervise them is to sit in front of the terminal and answer prompts one by one. When I step away, I either stop the agent or let it run unsupervised, and either way I have no durable record of what it did or what I allowed."

## Core promise

**Run your coding agent, approve every risky step from any browser on your network, and keep the full record on your machine.**

## Core workflow

```text
Discover      Landing page: one sentence, one screenshot of the approval card, one install command.
   ↓
Install       npm install -g asterim  (or pnpm dlx) → `asterim` prints a URL and a PIN.
   ↓
Pair          Open the URL on this machine or a phone on the same network, enter the PIN.
   ↓
First value   Add a project folder → type a task → the agent starts → the first approval card appears
              → approve → the Changes view shows the diff. Under five minutes.
   ↓
Repeat        Threads per task, resumable after restart; Terminal for the shell; Changes to commit.
   ↓
Pay           Not at launch. A Pro waitlist collects intent for remote access off-LAN and multi-machine.
   ↓
Retain        The record: previous threads, approvals and diffs are searchable, per project.
```

## Differentiation (why it deserves to exist)

1. One approval gate and one record across agents from different vendors, on the developer's machine.
2. Supervision from any device on the LAN without a vendor cloud and without a relay.
3. Open source, zero telemetry, an air-gap switch that verifiably disables every outbound connection Asterim itself makes.
4. Threads resume across restarts with the provider's own session id.

None of these is "a beautiful UI". Each is a workflow the vendor tools cannot offer for each other.

## Principles for every product decision

- Truth over polish: nothing is advertised that has not been exercised end to end.
- One working path beats three half-working ones.
- The agent never commits, pushes or deploys without a human action.
- A feature that is not reachable from the core loop within two clicks does not ship in the primary navigation.

## Status (2026-09-08)

The core loop works with Claude Code through its headless protocol and hook-based permission requests (implemented and verified in the 2026-09 audit). Antigravity works through terminal scraping and is labelled best-effort. Everything else in the repository (team agents, pipelines, fleet policy, accounts, billing, relay, desktop daemon) is frozen and hidden from the primary navigation until the core loop has real users. See `docs/product/roadmap.md`.
