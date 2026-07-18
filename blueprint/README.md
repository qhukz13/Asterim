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
- **Humans**: Start with `PRODUCT.md` to understand *why* we are building this, then `ARCHITECTURE.md` to understand *how*.
- **AI Agents**: Start with `AI_CONTEXT.md`.

## Related Documents
- `PRODUCT.md`
- `AI_CONTEXT.md`
