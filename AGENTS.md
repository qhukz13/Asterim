# AGENTS.md

Operating rules for any coding agent (Claude Code, Codex, Antigravity, others) working on Asterim. `CLAUDE.md` holds the same rules with Claude Code specifics.

## Sources of truth

1. `PROJECT_CONTEXT.md`: the product, the status, the invariants.
2. `docs/`: architecture (`docs/architecture/*.md`), product (`docs/product/*.md`), tasks (`docs/tasks/*.md`), the release gate.
3. The code. When docs and code disagree, report the disagreement; do not silently change either to match the other.

`blueprint/`, `docs/archive/` and everything they reference are history. Do not implement from them.

## The loop

Read the task specification → read the architecture page for the area → inspect the existing services, stores and routes to reuse them → implement the smallest change that meets the acceptance criteria → run `pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build` → verify each acceptance criterion by running it → update docs whose CONTRACT changed → write a short report (what changed, what was verified, what was left out and why).

There is no orchestrator, no `tasks/current.md`, no `reports/current.md`. Tasks are files in `docs/tasks/`; reports go in the pull request description.

## Never

- Invent product behaviour, subsystems or dependencies that the task does not ask for.
- Skip permissions in any adapter (`--dangerously-skip-permissions`, `bypassPermissions`).
- Add a route that answers without a token.
- Commit, push, tag or publish. A person does that.
- Advertise a capability that has not been exercised end to end.
- Extend a frozen subsystem (list in `CLAUDE.md`) without a founder decision.

## Always

- Say what you ran and what it printed. "Tests pass" without output is not evidence.
- Distinguish IMPLEMENTED, VERIFIED, BLOCKED and NOT DONE in reports.
- Prefer deletion to addition when both satisfy the task.
- Keep temporary files in `scratch/`.
