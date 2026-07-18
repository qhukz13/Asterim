## Development Workflow

Every development task follows this workflow:

1. Read AI_CONTEXT.md
2. Locate the Source of Truth
3. Read the relevant specification
4. Validate the requested change
5. Propose Specification Changes if required
6. Implement
7. Review
8. Synchronize documentation

# AI Context Map

## Level 1: Product Principles

- The architecture and specification must be instantly navigable by automated agents.
- There is exactly one canonical location for every concept.

## Purpose

Serves as the mandatory entry point for AI development agents, providing the Source of Truth Matrix.

## Scope

Agent onboarding and context building.

## Source of Truth Matrix

When tasked with a modification, identify the domain and consult the corresponding document:

| Domain                           | Source of Truth    |
| :------------------------------- | :----------------- |
| Core Philosophy & User Personas  | `PRODUCT.md`       |
| Monorepo Structure & Ecosystem   | `PRODUCT_MAP.md`   |
| System Architecture & Subsystems | `ARCHITECTURE.md`  |
| Business Logic & Pricing         | `BUSINESS.md`      |
| Coding Standards & CI/CD         | `ENGINEERING.md`   |
| UI/UX & Aesthetics               | `DESIGN_SYSTEM.md` |
| Roadmap & Planning               | `DEVELOPMENT.md`   |
| Launch & Readiness               | `RELEASE.md`       |
| AI Operating Rules               | `MASTER_PROMPT.md` |

## Document Map

- **README.md**: The human entry point.
- **AI_CONTEXT.md**: You are here.

## Navigation Guide

1. Read `README.md`.
2. Read this document.
3. Identify the relevant domain.
4. Read the domain document.
5. Execute the task.

## Future Evolution

If a new domain emerges (e.g., a massive pivot to hardware), a new domain document SHALL be added and registered here.
