# Design System & UX Specification

## Level 1: Product Principles

- The UI MUST be calm, precise, and engineering-first.
- The product MUST NOT use generic "AI magic" aesthetics (neon gradients, sparkles).

## Purpose

Defines the normative aesthetic language and UX interaction rules.

## Brand Identity

- **Requirement**: The UI MUST use a Monochrome color palette with a single high-contrast Accent Green for primary actions and success states.
- **Rationale**: Developers stare at screens all day. Monochrome reduces cognitive load and eye strain. Green implies "Go" or "Success" in terminal environments.

## Typography

- **Requirement**: The UI MUST use a highly legible sans-serif for application chrome and a monospace font for all agent output.
- **Level 4 Current Implementation**: Inter (Sans-serif) and JetBrains Mono (Monospace).
- **Alternatives Considered**: System fonts (SF Pro, Segoe UI).
- **Trade-offs**: Custom web fonts cause minor layout shifts on load, but guarantee cross-platform consistency.

## Interaction & Motion

- **Requirement**: Animations MUST NOT exceed 200ms.
- **Rationale**: Snappy interactions feel professional. Long, sweeping animations feel sluggish and frustrating to power users.

## Accessibility

- **Requirement**: The UI MUST be fully navigable via keyboard. A mouse MUST NOT be required for the Golden Loop (Monitor -> Intercept -> Approve).
