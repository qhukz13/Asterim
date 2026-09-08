# Development Workflow and Task Specifications

## The loop

1. Read `PROJECT_CONTEXT.md`. It is short on purpose.
2. Read the task specification in `docs/tasks/<id>.md`, or write one with the template below before touching code.
3. Read the architecture page for the area (`docs/architecture/*.md`). Each page ends with a **Contract**, **Modifying** and **Do not** section; those are the rules.
4. Implement. Prefer the smallest change that meets the acceptance criteria. Reuse existing components, tokens and services.
5. Verify: `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build`, then whatever the task's Testing section says. For anything on the core loop, run the relevant rows of `docs/release-gate.md` by hand.
6. Review your own diff against every acceptance criterion before declaring done. "It compiles" is not done.
7. Update the docs that describe what you changed. If a Contract changed, say so in the PR description.

There is no automated orchestrator anymore. `.pipeline/`, `tasks/current.md`, `reports/current.md` and `tests/current.md` are archived and not read by anything.

## Task specification template

Every task that someone else (human or agent) will execute uses this shape. Vague tasks ("improve dashboard") are rejected; a task must be executable without reconstructing the whole project.

```markdown
# <TASK ID>: <Title>

**Objective.** One sentence: what will be true when this is done.

**Context.** Two to five sentences: where this sits in the product, what the user experiences today.

**Why this exists.** The user or system problem, with a pointer to the audit/roadmap entry.

**Files and systems involved.** Exact paths. Name the services, stores, routes and event types touched.

**Current behaviour.** What happens now, concretely (steps to reproduce if it is a bug).

**Desired behaviour.** What happens after, concretely.

**Implementation requirements.**
- Bullet list of must-dos (APIs to use, patterns to follow, components to reuse).

**Constraints.**
- What must not change (contracts, event shapes, database compatibility, security rules).

**Edge cases.**
- Enumerate them.

**Acceptance criteria.**
- [ ] Verifiable statements, one per line.

**Testing requirements.** Which suites to extend or add, which manual gate rows to run, what to screenshot.

**Done definition.** Typecheck, lint, tests and build green; acceptance criteria ticked with evidence; docs updated.
```

Examples live in `docs/tasks/`.

## Commit and branch conventions

- Branch from `main`; one task per branch; commit messages `type(scope): summary` (`feat`, `fix`, `docs`, `chore`, `refactor`, `test`).
- Never commit `~/.asterim*` contents, `pairing_pin.txt`, logs, or `scratch/` output.
- Agents never commit or push on their own; a person reviews the diff and commits.

## Housekeeping rules

- Temporary scripts go in `scratch/` (gitignored). Not in the repo root, not in `packages/adapters/`.
- No new documentation files outside `docs/` and the root `README.md` / `PROJECT_CONTEXT.md` / `CLAUDE.md`.
- No new `any`. Fix a warning in code you touch.
