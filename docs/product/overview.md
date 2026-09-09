# Asterim: Product Definition

This document is written in two levels on purpose. The first is what Asterim **is** as a product. The second is what ships **first**. Confusing them is what produced the previous version of this repository, where the vision was implemented before the first level worked.

Every statement elsewhere in `docs/` is labelled with one of four words. Use them.

| Label | Meaning |
| --- | --- |
| **CURRENT** | Runs today, verified. |
| **MVP** | Must exist for the first public release. |
| **POST-MVP** | Considered only after the first users tell us it matters. |
| **VISION** | What Asterim could become. Never an instruction to build. |

---

## 1. The product (VISION)

**Asterim is a local-first control layer for AI coding agents.**

Coding agents write code. Asterim owns everything around them: the projects they work in, the tasks they are given, the permissions they operate under, the context they carry, the record of what they did, and eventually the coordination between several of them.

```text
                        You
                         │
                    ┌────▼─────┐
                    │ ASTERIM  │   the layer you own
                    └────┬─────┘
       ┌─────────────┬───┴────┬──────────────┐
   Projects       Tasks    Context      Permissions
       │             │        │              │
       └─────────────┴───┬────┴──────────────┘
                         │
                  Agent Runtime            ← one interface, many providers
                         │
       ┌─────────────────┼──────────────────┐
   Claude Code      Antigravity        Future agents
```

Asterim sits above the agents, not beside them and not inside them. The durable things — what a project is, what was decided, what was allowed, what happened — belong to Asterim and outlive any one agent, any one session and any one vendor.

**Asterim is deliberately not:** another coding agent, an editor, an inline autocomplete, a generic AI automation platform, a generic agent dashboard, a cloud SaaS, or a bundle of enterprise features. It is also not a replacement for the agent CLIs; it drives them.

## 2. The first release (MVP)

**Asterim makes working with Claude Code substantially easier to control, observe and manage, on one machine.**

That is the whole MVP. It is narrow because the layer above only earns the right to exist if the first thing under it works exceptionally well.

In the MVP a developer can: install Asterim, pair a browser (including a phone on the same network), point it at a project folder, give Claude Code a task, watch what it says and does, approve or deny every command and file write, review the diff, and come back tomorrow to a thread that resumes.

**Claude Code first is not Claude Code only.** The architecture is provider-agnostic and stays that way (`docs/decisions/ADR-004-provider-agnostic-architecture.md`). No MVP time goes into new providers. Antigravity already exists and stays as the second, structurally different provider that keeps the abstraction honest; it is labelled **PREVIEW** and receives no further investment.

## 3. Target user

**MVP:** a developer who already runs Claude Code on real repositories most days, on Windows, macOS or Linux, and who has more going on than one terminal tab comfortably holds. They are technical enough to install from npm or from source and opinionated enough to tell us why something is wrong.

**Not the first customer:** teams needing shared accounts, enterprises needing SSO and audit exports, people who want no GUI, anyone expecting a hosted product.

## 4. The problem

Stated as a hypothesis, because which part of it actually bites is the thing the first users will tell us:

> "I run one or more coding agents that can execute commands and change files. Watching them means living in terminal scrollback; not watching them means trusting them. Either way, what happened yesterday is gone — I cannot search it, and neither can the agent."

The three candidate pains inside that, in the order the market currently talks about them: **parallel sessions** you cannot keep straight, **permissions** you either answer one at a time or disable entirely, and **history** that is scrollback rather than a record. Which one is the wedge is an open question (`docs/product/experiments.md`).

## 5. The promise

**MVP:** run your coding agent, see what it is doing, approve what matters, and keep the record — locally, on any device on your network.

**VISION:** the place where your agents' work lives — projects, tasks, context and history that persist across sessions, machines and providers.

## 6. Core workflow (MVP)

```text
Discover   →  Install (npm, one command)  →  Pair (PIN, any browser on the LAN)
   →  Add a project folder  →  Give a task  →  Watch the transcript
   →  Approve or deny each command and file write  →  Review the diff and commit
   →  Return tomorrow; the thread resumes
```

First value must arrive in under five minutes and must be the approval moment: the agent asks, you decide, and it obeys.

## 7. Differentiation (hypotheses, not claims)

The "GUI for Claude Code" category exists and is crowded. Being a nicer window is not a strategy. What may be defensible, in decreasing order of confidence:

1. **The record you own.** Approvals, denials, tool calls and diffs in a local database, searchable across sessions and days. The category's own reviewers name unsearchable scrollback as the pain; nobody local-first owns the answer.
2. **Local-first with no account and no telemetry**, open source, with a verifiable air-gap switch. Most alternatives are closed desktop apps with cloud or team tiers.
3. **Any device on your network**, without a vendor cloud in the path.
4. **Provider-agnostic by construction**, already proven against two structurally different agent protocols.

Everything above is to be tested, not asserted. See `docs/product/positioning.md`.

## 8. Principles

- Truth over polish. Nothing is shown that has not been exercised end to end, and anything not shipping carries a status label.
- One working path beats three half-working ones.
- The agent never commits, pushes or deploys without a human action.
- Local-first is a product value, not a deployment detail. Cloud arrives only where it clearly beats local, never because SaaS is monetisable.
- The MVP stays narrow; the architecture stays extensible; the vision stays ambitious; the launch stays empirical.

## 9. Status (CURRENT, 2026-09-09)

The core loop works with Claude Code through its headless protocol and native permission requests, verified end to end on Windows. Antigravity works through terminal scraping (PREVIEW). Everything else in the repository — team agents, pipelines, delegation, fleet policy, accounts, billing, relay, desktop daemon — is **frozen**: not deleted, not marketed, not extended, and revisited only if the first users show the need (`docs/decisions/ADR-002-scope-freeze.md`).
