# CLAUDE.md

Guidance for Claude Code (and any coding agent) working in this repository.

## The one rule that explains the others

**The MVP is narrow. The architecture is extensible. The vision is ambitious.** Asterim is a local-first control layer for AI coding agents (the product); it ships first as a Claude Code supervisor on one machine (the MVP). Do not implement the vision because a document describes it. Every claim in `docs/` is labelled **CURRENT**, **MVP**, **POST-MVP** or **VISION** — only the first two are instructions.

## Read first

1. `PROJECT_CONTEXT.md` (root): what Asterim is, what runs, what is frozen, the invariants. Five minutes.
2. `docs/README.md`: index of everything else.
3. For a task: `docs/tasks/<id>.md`, then the relevant `docs/architecture/*.md` page (each ends with CONTRACT / MODIFYING / DO NOT).

`blueprint/` is historical. It described intentions, and the code diverged from it. When `blueprint/` and `docs/` disagree, `docs/` wins; when `docs/` and the code disagree, say so in your report and fix whichever is wrong.

## Commands

pnpm 9 + turbo monorepo, Node 22+.

```bash
pnpm install
pnpm run typecheck
pnpm run lint            # 0 errors required; warnings are legacy
pnpm run test            # 44 hand-rolled tsx suites; each prints "N passed, M failed"
pnpm run build           # shared → adapters → web → server (+ marketing, relay, mcp)
pnpm --filter asterim dev                          # Core from source, dev channel :3001, data in ~/.asterim-dev
ASTERIM_CHANNEL=dev pnpm --filter @asterim/web dev # dashboard :5173 with proxy
node apps/server/dist/index.js                     # packaged Core, :3000
ASTERIM_URL=http://localhost:3000 ASTERIM_PIN=<pin> ASTERIM_PROJECT_PATH=<repo> node tools/e2e/core-loop.mjs
```

Package names: the Core is `asterim`, the dashboard `@asterim/web`, the site `@asterim/marketing`, shared contract `@asterim/shared`, adapters `@asterim/adapters`.

## Definition of done

Typecheck, lint and tests green; build green; every acceptance criterion in the task verified by running it, not by reading the code; docs updated where a CONTRACT changed. For anything on the core loop (pair → project → task → approval → diff), run the relevant rows of `docs/release-gate.md` or `tools/e2e/core-loop.mjs`.

## Invariants (do not break)

See `PROJECT_CONTEXT.md` § Critical invariants. The short list: no unauthenticated `/api/v1/` route on any interface; never `--dangerously-skip-permissions`; the Core never auto-approves; native adapters never get `y`/`n` on stdin; every event carries `projectId` and `threadId`; old databases keep opening; the dashboard talks to its own origin; a failed agent start is `error`, never `idle`; the Core makes no outbound connections of its own; the Core assumes nothing about a provider's shape; anything not shipping carries a status word; marketing states only what the release gate exercised.

## Conventions

- Reuse before inventing: tokens in `apps/web/src/styles/tokens.css`, components listed in `docs/design/design-system.md`. One emerald accent. No emoji in the UI. No gradients or glow.
- Tests: plain `tsx` scripts next to the code in `__tests__/`, added to the workspace `test` script (`docs/development/testing.md`).
- Temporary scripts go in `scratch/` (gitignored). Screenshots from tooling go in `docs/screenshots/<topic>/`.
- Do not add documentation files outside `docs/`, `README.md`, `PROJECT_CONTEXT.md`, `CLAUDE.md`.
- No new `any`. Fix a lint warning in code you touch.
- Agents never commit or push; a person reviews the diff.

## Frozen areas

`services/ai/TeamAgentService.ts`, `services/pipeline/`, `services/enterprise/`, `services/desktop/`, `services/ai/AgentDelegationService.ts`, `RelayClient.ts`, `PushService.ts`, `mDNSService.ts`, `BillingService.ts`, accounts. Do not extend them. They are frozen pending the first-users experiment, and several are the existing implementations of hypotheses it will test (`docs/decisions/ADR-005-frozen-code-disposition.md`). Keep their tests passing.

## Environment notes for this machine

Windows 10, PowerShell default shell, Claude Code at `~/.local/bin/claude.exe`. The Core must be stopped gracefully (`Ctrl+C`); a force-kill can leave SQLite WAL sidecars and the next start fails with `disk I/O error` until they are cleared. Global Claude Code hooks on this machine auto-decide permissions; start the Core with `ASTERIM_CLAUDE_DISABLE_HOOKS=true` when testing the approval card.
