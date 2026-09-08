# Asterim Documentation

Start with [`PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md) at the repository root. It is the single source of truth for what Asterim is, what runs, what is frozen, and how to verify work. Everything below is detail.

## Product

- [overview.md](product/overview.md): what Asterim is, for whom, the core promise and workflow.
- [positioning.md](product/positioning.md): September 2026 market research, competitive matrix, where Asterim can win.
- [roadmap.md](product/roadmap.md): Phase 1 (release-ready), Phase 2 (launch), Phase 3 (after launch), Now/Next/Later/Maybe/Never.
- [metrics.md](product/metrics.md): observability minimum and the few metrics that matter.

## Audit (2026-09-08)

- [current-state-audit.md](audit/current-state-audit.md): the full audit report and the strategic answer.
- [feature-inventory.md](audit/feature-inventory.md): every feature with status, evidence and recommendation.
- [security-audit.md](audit/security-audit.md): findings by severity, what was fixed, what remains.
- [technical-debt.md](audit/technical-debt.md): debt triage with launch relevance.

## Architecture

Each page answers WHAT, WHY, WHERE, HOW, CONTRACT, MODIFYING, DO NOT.

- [overview.md](architecture/overview.md)
- [agents.md](architecture/agents.md): adapters, the Claude Code protocol, the approval gate.
- [frontend.md](architecture/frontend.md)
- [database.md](architecture/database.md)
- [authentication.md](architecture/authentication.md)
- [billing.md](architecture/billing.md) (frozen)
- [infrastructure.md](architecture/infrastructure.md)

## Development

- [setup.md](development/setup.md)
- [workflow.md](development/workflow.md): the loop, the task specification template, conventions.
- [testing.md](development/testing.md)
- [housekeeping.md](development/housekeeping.md): what was archived or removed and why.

## Design

- [design-system.md](design/design-system.md): tokens, components, rules for the dashboard.
- [landing-page.md](design/landing-page.md): audit of the old site, system, information architecture, copy.

## Decisions

- [FOUNDER_DECISIONS.md](decisions/FOUNDER_DECISIONS.md): the short list only the founder can close.
- [ADR-001-claude-code-native-protocol.md](decisions/ADR-001-claude-code-native-protocol.md)
- [ADR-002-scope-freeze.md](decisions/ADR-002-scope-freeze.md)
- [ADR-003-local-auth-only.md](decisions/ADR-003-local-auth-only.md)

## Tasks

Executable specifications in [`tasks/`](tasks/), one file per roadmap id, written so that a weaker agent can complete them without reconstructing the project.

## Release

- [release-gate.md](release-gate.md): the hard checklist.

## Archive

`archive/2026-08-pipeline-era/` holds the previous documentation, roadmaps, pipeline state and reports. They describe intentions, not the code; read them for history only.
