# Product Strategy

## Level 1: Product Principles
- AgentDeck MUST provide unparalleled visibility and strict, interceptable control over agent actions.
- The product MUST prioritize Developer Trust above all else.

## Purpose
Defines the core problem, target audience, and fundamental philosophy of AgentDeck.

## Scope
Guides feature triage, product management, and UX design.

## Problem Statement
Autonomous AI coding agents (Claude Code, Aider) lack visibility and safety controls. Giving them unconstrained access to a local filesystem and shell is dangerous. 
- **Requirement**: The system MUST solve the "black box" problem by translating scrolling terminal text into structured, parseable telemetry.
- **Requirement**: The system MUST bridge the trust gap via Approval Gates.

## Target Audience
- **Primary**: The Senior Software Engineer / Tech Lead. Highly technical, skeptical of "magic", wants verifiable control.
- **Secondary**: Indie Hackers (speed, concurrent agent execution) and Platform Engineers (audit logs, RBAC).
- **Development Workstation Users**: Developers using a lightweight laptop connected to a local, heavy execution environment.
- **Anti-Targets**: Non-technical users looking for no-code tools.

## The Golden Loop
The core behavioral loop the product MUST optimize for:
1. **Command**: User dispatches an agent via the UI.
2. **Monitor**: User passively observes streaming telemetry (requires throttling to handle 10,000+ lines without UI lockup).
3. **Intercept**: System pauses agent and requests Approval via Promise interception.
4. **Approve/Deny**: User evaluates the diff/command.
5. **Continue**: Agent resumes.
*Architectural Constraint*: Latency between step 3 and 4 MUST be minimized across all devices (Local and Remote).

## North Star Metric
**Time-to-Approval (TTA)**: The average time elapsed between an agent hitting an Approval Gate and the user responding. A low TTA indicates high user trust and low friction in the UX.

## Competitive Positioning
AgentDeck IS NOT a code editor or IDE. It IS a control plane.
- **Alternatives Considered**: Building agent orchestration directly into an IDE extension (like VS Code).
- **Decision Rationale**: IDE extensions tether the user to a specific workstation. A standalone control plane allows true remote, untethered orchestration via mobile devices while the heavy computation runs on the desktop.

## Boundaries (What AgentDeck is NOT)
- The system SHALL NOT train or host foundational LLM models.
- The system SHALL NOT be a general-purpose chat application.

## Related Documents
- `PRODUCT_MAP.md`
- `BUSINESS.md`
