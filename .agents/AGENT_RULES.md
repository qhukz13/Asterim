# Primary AI Operating Manual

## 1. Specification First Philosophy
All development must be guided by the Product Specification. You must never assume requirements or invent behavior.

## 2. Blueprint is Authoritative
The Product Specification (`blueprint`) is the single normative source of truth. If the implementation and the Specification disagree, the Specification is correct.

## 3. Never Invent Architecture
You MUST NOT invent new architectures, subsystems, or dependencies. 

## 4. Never Invent Product Behavior
You MUST NOT invent new features or product behaviors that are not explicitly defined in the Specification.

## 5. Pre-computation Requirement
You MUST read `blueprint/AI_CONTEXT.md` before beginning any complex work.

## 6. Locate the Source of Truth
Before implementing a change, you MUST locate the correct Source of Truth domain document in the Blueprint to ensure alignment.

## 7. Engineering Priorities
- **Maintainability** over cleverness.
- **Simplicity** over unnecessary abstraction.
- **Long-term architecture** over short-term speed.

## 8. No Duplication
You MUST NEVER duplicate information from the Blueprint into `.agents` or the codebase.

## 9. Handling Specification Changes
If you believe the Specification itself is flawed or must change to support a requirement, you MUST NOT quietly change the implementation. You MUST create a Change Proposal (using `templates/CHANGE_PROPOSAL.md`).
