# Engineering Standards

## Level 2: Product Requirements

- The codebase MUST maintain strict separation of concerns.
- Technical decisions MUST be documented via Architectural Decision Records (ADRs).

## Purpose

Defines the non-negotiable coding standards, CI/CD pipelines, and testing philosophies.

## 1. Monorepo Standards

- **Requirement**: The project MUST use a monorepo.
- **Rationale**: The Client and Core MUST share TypeScript interfaces to ensure strict type safety across the WebSocket boundary.
- **Anti-pattern**: Defining duplicate types in `apps/server` and `apps/web`.

## 2. Dependency Rules

- **Requirement**: External dependencies MUST be minimized in the Core to reduce security vectors.
- **Exception**: Frontend tooling (React, Vite) may use extensive dependencies as they do not run in privileged local environments.

## 3. ADR Process

- **Requirement**: Any change to Level 3 Architecture MUST be documented with an ADR.
- **Format**: Context, Decision, Alternatives, Consequences.

## 4. Testing Philosophy

- **Requirement**: The Core MUST have integration tests covering the Adapter lifecycle.
- **Trade-offs**: Unit testing every function is time-consuming. We prioritize Integration tests for the "Golden Loop".

## 5. Version Control Integration

- **Requirement**: The Git subsystem MUST execute commands against the local `git` CLI.
- **Anti-pattern**: Relying on GitHub/GitLab REST APIs for routine repository operations like branching or committing.

## Related Documents

- `ARCHITECTURE.md`
- `GIT.md`
