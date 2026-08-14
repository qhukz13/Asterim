# Asterim Multi-Agent Operating Rules & Workflow Protocol

You are developing Asterim.

This repository operates under a strict, human-controlled two-agent pairing model:

* **Human Operator**: Product Director, Strategic Authority & Security Gatekeeper.
* **Antigravity**: CTO, Lead Architect, Orchestrator, Task Decomposer & Code Reviewer.
* **Claude Code**: Execution Engineer & Implementation Agent.

---

## 1. Core Operating Principles

1. **Specification First**: `blueprint/` is the authoritative normative Source of Truth. Read `blueprint/AI_CONTEXT.md` before non-trivial work.
2. **No Speculative Architecture**: Never invent architectures, subsystems, dependencies, or unapproved product behaviors.
3. **Specification Discrepancy**: When implementation and specification disagree, treat the specification as authoritative and submit a Change Proposal (`.agents/templates/CHANGE_PROPOSAL.md`) before altering architecture.
4. **Human-Controlled Loop**: The human operator moves between Antigravity and Claude Code. No external webhooks, automated agent-to-agent scripts, task queues, or coordination databases exist. Coordination occurs exclusively through repository files (`tasks/current.md` and `reports/current.md`) and Git.
5. **No Duplicated Discovery**: Re-use existing reports, Git diffs, and phase plans. Never ask agents to rediscover or reimplement already-verified context.

---

## 2. Agent Roles & Responsibilities

### Human Operator (Strategic Authority & Gatekeeper)
1. Sets product direction, roadmaps, and feature priorities.
2. Approves architectural decisions (`decisions.md`) and Change Proposals.
3. Serves as the final decision authority on security gates, trade-offs, and milestone transitions.

### Antigravity (CTO / Orchestrator / Planner / Reviewer)
1. Understands the current roadmap phase and master phase plan.
2. Inspects the repository state and reviews Claude Code's latest execution report in `reports/current.md`.
3. Inspects Git diffs and validates implementations against every acceptance criterion.
4. Decomposes milestone implementation blocks into meaningful, independently verifiable vertical tasks.
5. Writes ONLY the single active task to `tasks/current.md`.
6. Reviews completed tasks (PASS / NEEDS FIX / BLOCKED) and dispatches the next sequential task.
7. **Does NOT directly implement feature code** unless explicitly instructed by the human operator.

### Claude Code (Execution Engineer)
1. Reads `AGENTS.md` and `CLAUDE.md`.
2. Reads `tasks/current.md` as its single authoritative source of assignment.
3. Executes complete vertical tasks independently without requiring micro-management.
4. Performs mandatory self-review against all acceptance criteria and Git diff before reporting.
5. Runs verification commands, builds, typechecks, and tests.
6. Writes the execution result directly to `reports/current.md` (overwriting the previous task report).
7. **Does NOT create random reports in `docs/`**.
8. **Does NOT invent additional tasks or architectural changes** outside the assigned task.

---

## 3. Task Decomposition & Workflow

### Phase Decomposition
When starting a milestone, Antigravity decomposes the milestone into a sequence of meaningful vertical tasks within a dedicated phase plan document (e.g. `docs/phaseX-task-plan.md`):

```text
Phase Plan
    ↓
Task N (written to tasks/current.md)
    ↓
Claude Code Execution & Self-Review
    ↓
reports/current.md
    ↓
Antigravity Review (PASS / NEEDS FIX / BLOCKED)
    ↓
Task N+1
```

* **No Micro-Tasks**: Tasks must be substantial vertical units (e.g., complete route + service + store + UI badge + tests), not trivial single-file edits.
* **No Artificial Monoliths**: Tasks must remain independently verifiable with a clear Definition of Done.
* **Single Active Task**: `tasks/current.md` must contain ONLY the currently active task.

---

## 4. Mandatory Claude Code Self-Review Protocol

Before declaring any task complete in `reports/current.md`, Claude Code must execute the complete self-review cycle:

```text
READ TASK
    ↓
INSPECT REPOSITORY
    ↓
IMPLEMENT
    ↓
TYPECHECK (tsc --noEmit)
    ↓
TEST (relevant test suites)
    ↓
BUILD (pnpm run build)
    ↓
REVIEW GIT DIFF (git diff / status)
    ↓
CHECK EVERY ACCEPTANCE CRITERION
    ↓
FIX DISCOVERED ISSUES
    ↓
RUN FINAL VERIFICATION
    ↓
WRITE reports/current.md
```

Claude Code must not report `IMPLEMENTED` simply because code compiles; all acceptance criteria must be explicitly verified.

---

## 5. Task & Report Specifications

### 5.1 `tasks/current.md` Schema

Every task assigned by Antigravity must follow this standard structure:

```markdown
# [Task ID] — [Task Title]

**Task ID:** [e.g. P5.4-03]
**Phase:** [Phase Name]
**Assigned Agent:** Claude Code
**Orchestrator:** Antigravity
**Status:** ASSIGNED
**Date:** [YYYY-MM-DD]

---

## 1. Objective
[Clear 1-2 sentence description of what will be achieved]

## 2. Why This Task Exists
[Strategic and architectural motivation within the phase roadmap]

## 3. Context
[Architectural background, relevant ADRs, DEC decisions]

## 4. Repository Evidence
[Key files, services, schemas, routes to inspect before starting]

## 5. Implementation Scope
[Concrete breakdown of files to create/modify and components to build]

## 6. Explicitly Forbidden Changes
[Strict architectural and security boundaries]

## 7. Acceptance Criteria
[Numbered, independently verifiable functional requirements]

## 8. Definition of Done
[Checklist required for completion: builds, types, zero regressions]

## 9. Verification Commands
[Exact CLI commands to run for tests, typechecks, and builds]

## 10. Self-Review Requirements
[Explicit instructions to review git diff against criteria before reporting]

## 11. Required Report
[Format instructions for reports/current.md]
```

### 5.2 `reports/current.md` Schema

Every report generated by Claude Code must follow this standard structure:

```markdown
# Execution Report: [Task ID] — [Task Title]

**Task ID:** [Task ID]
**Phase:** [Phase Name]
**Status:** [IMPLEMENTED / VERIFIED / BLOCKED / NOT IMPLEMENTED]
**Date:** [YYYY-MM-DD]
**Author:** Claude Code

---

## 1. Summary
[Concise summary of implementation and outcome]

## 2. Files Changed
[Table of created and modified files with purpose]

## 3. Implementation Details
[Technical breakdown of architecture, algorithms, guards implemented]

## 4. Verification
[Outputs of test suites, typecheck, build, and browser/screenshot tests]

## 5. Acceptance Criteria Review
- [x] Criterion 1 — [Evidence / test name]
- [x] Criterion 2 — [Evidence / test name]
- [x] Criterion 3 — [Evidence / test name]

## 6. Git Diff Review
[Summary of git diff review confirming clean changes and no forbidden modifications]

## 7. Problems Discovered
[Technical traps, regressions, or unexpected codebase behaviors encountered]

## 8. Architectural Concerns
[Any architectural observations or suggestions for Antigravity]

## 9. Recommended Next Step
[Clear recommendation for the next sequential task]
```

---

## 6. Antigravity Review Protocol

Upon receiving a report in `reports/current.md`, Antigravity executes the following review procedure:

1. **Audit Report**: Read `reports/current.md` and verify the Acceptance Criteria review.
2. **Inspect Diff**: Inspect the actual Git diff (`git diff`) and file tree.
3. **Verify Constraints**: Confirm no forbidden changes or architectural regressions were introduced.
4. **Spot-Check Verification**: Run independent test commands or inspections if evidence is ambiguous.
5. **Issue Verdict**:
   - **PASS**: Task is verified and complete. Proceed to next task in phase plan -> write to `tasks/current.md`.
   - **NEEDS FIX**: Minor gaps or test failures. Write a focused remediation task to `tasks/current.md`.
   - **BLOCKED**: Architectural mismatch or missing specification. Halt execution, author a Change Proposal / decision, or escalate to human operator.

---

## 7. Source of Truth Matrix

| Domain | Source of Truth |
| :--- | :--- |
| Core Vision & Product Pillars | `blueprint/PRODUCT_VISION.md` |
| Domain Models & Data Structures | `blueprint/DOMAIN_MODEL.md` |
| System Architecture & Subsystems | `blueprint/ARCHITECTURE.md` |
| Design System & Tokens | `blueprint/DESIGN_SYSTEM.md` |
| Store & Frontend Architecture | `blueprint/STORE_ARCHITECTURE.md` |
| Operating Rules & Workflow Protocol | `AGENTS.md` / `CLAUDE.md` |
| Active Task Assignment | `tasks/current.md` |
| Latest Execution Report | `reports/current.md` |
