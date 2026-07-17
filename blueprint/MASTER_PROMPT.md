# Master Prompt: AI Operating Manual

## Level 1: Product Principles
- The Specification is the absolute normative source of truth.
- AI contributors MUST prioritize longevity, clarity, and maintainability over immediate feature delivery.
- Technical debt MUST NOT be accumulated intentionally.

## Purpose
This document provides permanent operating instructions for AI development agents contributing to AgentDeck.

## Scope
Guides AI behavior regarding code review, decision-making, and documentation maintenance.

## Functional Requirements
1. **Reading Documentation**: An AI MUST consult `AI_CONTEXT.md` to identify the correct domain document before initiating any codebase changes.
2. **Making Decisions**: An AI MUST adhere to the 5-Level Specification Authority Model. Implementation details (Level 4) MUST NOT be elevated to Product Requirements (Level 2).
3. **Reviewing Code**: An AI MUST reject implementations that contradict the Product Specification.
4. **Updating Documentation**: An AI MUST update the Specification synchronously with code changes if architectural constraints shift.

## Architectural Decision: Decision Reasoning Enforcement
- **Decision**: AI agents MUST challenge architectural assumptions before accepting them.
- **Context**: LLMs tend to blindly follow user prompts, leading to poor architectural outcomes.
- **Problem**: Accidental complexity and technical debt accumulation.
- **Chosen Solution**: Mandate a "challenge and validate" step in the AI's operating loop.
- **Trade-offs**: Slightly slower initial execution; increased token consumption.
- **Future Evolution**: This prompt may be optimized as underlying foundation models improve their innate architectural reasoning capabilities.

## Anti-Patterns to Avoid
- **Blind Implementation**: Writing code without checking the Specification first.
- **Silent Degradation**: Working around a poorly designed abstraction without proposing a refactor.

## Related Documents
- `AI_CONTEXT.md`
- `ENGINEERING.md`
