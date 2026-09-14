# Blueprint (historical)

> **Superseded on 2026-09-08.** This directory is the specification the project was built against between June and August 2026. The audit in `docs/audit/current-state-audit.md` found that it no longer describes the code (for example, it treats Claude Code and Aider adapters as complete when both were stubs, and it plans phases 7 to 10 that were built by an unattended loop on top of that). It is kept for history and is **not** a source of truth.
>
> Current sources of truth: `PROJECT_CONTEXT.md` (root) and `docs/` (index in `docs/README.md`). Do not implement from these files. Do not update them; write in `docs/` instead.

Original contents follow unchanged.
# Asterim Product Specification

## Level 1: Product Principles

- Asterim is the control plane for autonomous AI coding agents.
- This repository contains the normative Product Specification.

## Purpose

This directory (`blueprint`) contains the definitive requirements for Asterim. If the source code is lost, the product SHALL be entirely recoverable from these documents.

## Scope

Human onboarding and project orientation.

## The 5-Level Specification Authority Model

This specification adheres to the following hierarchy:

1. **Level 1 (Product Principles)**: Timeless truths (e.g., Local-First).
2. **Level 2 (Product Requirements)**: What the system MUST do (technology-agnostic).
3. **Level 3 (Architecture)**: Conceptual patterns (Event-driven).
4. **Level 4 (Current Implementation)**: Specific tech (Fastify, SQLite).
5. **Level 5 (Examples)**: Diagrams and workflows.
   Lower levels MUST NEVER redefine higher levels.

## How to Read this Specification

- **Humans**: Start with `PRODUCT.md` to understand _why_ we are building this, then `ARCHITECTURE.md` to understand _how_.
- **AI Agents**: Start with `AI_CONTEXT.md`.

## Related Documents

- `PRODUCT.md`
- `AI_CONTEXT.md`
