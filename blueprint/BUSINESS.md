# Business & Monetization Strategy

## Level 1: Product Principles
- The core local engine MUST be free and open to drive adoption.
- Monetization MUST come from convenience, cloud features, and enterprise security.

## Purpose
Defines the business model, pricing strategy, and licensing for AgentDeck.

## Scope
Company strategy and feature gating.

## Licensing Philosophy
- **Decision**: The Core Engine and Local UI SHALL be distributed under the MIT License (Open Core).
- **Trade-offs**: Risk of clones or forks.
- **Rationale**: Developer tools require massive top-of-funnel adoption. MIT licensing maximizes initial trust and distribution.

## Subscription Tiers

### 1. Community Edition (Free)
- **Functional Requirements**: MUST include the local server, unlimited local usage, and standard agent adapters. MUST function entirely offline.

### 2. Pro Tier (Paid Subscription)
- **Functional Requirements**: MUST unlock the Cloud Relay tunnel, mobile push notifications, and cross-device session syncing.
- **Rationale**: Individual power users will pay for the convenience of remote monitoring and untethered orchestration.

### 3. Enterprise Tier (Per-Seat Licensing)
- **Functional Requirements**: MUST include Immutable Audit Logs, SSO/SAML integration, and On-Premise Cloud Relay deployment options.
- **Rationale**: Organizations require strict compliance. They will pay to ensure agent actions are logged and access is managed via their identity provider.

## Growth Strategy
- **Phase 1**: Hacker News & Developer Twitter. Focus on the raw utility of the free local tool.
- **Phase 2**: Launch the Cloud Relay as a paid convenience feature.
- **Phase 3**: Direct B2B sales targeting Platform teams needing audit compliance for AI usage.

## Related Documents
- `PRODUCT.md`
- `RELEASE.md`
