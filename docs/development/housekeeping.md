# Housekeeping record (2026-09-08)

What was moved or removed during the audit, and why, so nobody hunts for it.

## Archived to `docs/archive/2026-08-pipeline-era/`

- Every top-level `docs/*.md` from the June to August 2026 phases (phase plans, PR walkthroughs, design reports, production gates, the old operations runbook, the old security audit). Historical only.
- `decisions.md` (DEC-001 to DEC-032) as `decisions-register-2026-08.md`. Decisions from now on are ADRs in `docs/decisions/`.
- `tasks.md`, the root `phase-3-report.md` and `product-bugs.md`.
- The orchestrator pipeline state: `tasks/current.md`, `tests/current.md`, `tests/report.md`, `test/current.md`, `reports/current.md`, `.pipeline/config.json` under `pipeline/`. The untracked `.pipeline/` runtime files (logs, `orchestrator.token`, `state.json`, `workers.json`) were deleted; the token was a credential and must not be committed anywhere.
- Old marketing screenshots (`docs/screenshots/0*.png`, `design-00*`, `p5.*`) under `screenshots/`. They show the fabricated demo, not the product.

## Deleted

- Root debug scripts: `test-exec.js`, `test-loop.js`, `test-regex.js`, `test-socket.js`, `run-loop-test.js`, `run-loop-test2.js`, `trigger-message.js`, `test_commit.txt`.
- `apps/server/test_client_start.ts`, `apps/server/test_start.ts`.
- `packages/adapters/test-*.js`, `temp_approval_test*.js`, `test_agy*.js` (ad-hoc TUI experiments).
- Tracked files under `scratch/` (the directory is gitignored; they had been force-added).
- Untracked artefacts: `agent_debug.log`, `fsm_debug.log`, `agentdeck.db`, `temp-verify/`, `temp_test_nogit/`.
- Marketing: `components/home/*` (the eight "acts" and the fabricated workstation sandbox), `components/common/*`, `AccountLayout.tsx`, `WorkspaceSettings.tsx`, `pages/Login.tsx`, `pages/Register.tsx`, `pages/DownloadPage.tsx`, `assets/*`, `App.css`.
- The OAuth exchange route and controller path (security S2).

## Kept deliberately

- `blueprint/` in place with a superseded banner: many archived documents link into it.
- `graphify-out/`: the founder's knowledge-graph tool output.
- `skills-lock.json`, `scripts/sandbox/`: not understood well enough to delete; candidates for the next pass.
- Frozen subsystems in `apps/server` and `apps/web` (see `PROJECT_CONTEXT.md`): founder decision FD-2.

## New locations

- `tools/e2e/core-loop.mjs`: the puppeteer smoke test and screenshot source (tracked; `scratch/` is not).
- `docs/screenshots/e2e/`: real product captures used by the README and the site (`apps/marketing/public/screens/`).
