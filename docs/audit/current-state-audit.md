# Asterim: Current State Audit and Strategic Answer (2026-09-08)

> **Corrected 2026-09-09.** Every technical finding below stands and was re-verified. Two strategic conclusions were overturned by the founder's review and are wrong as written here:
>
> 1. **"Asterim is a local supervisor for coding agents"** collapsed the product into its first release. The product is a local-first control layer for AI coding agents; the supervisor is the MVP. `docs/product/overview.md` carries the two-level definition.
> 2. **The frozen subsystems were treated as probably worthless.** They are unvalidated, which is not the same thing. Delegation and pipelines are the existing implementations of hypotheses H3 and H6, which the first users will test; their disposition waits for that evidence (`docs/decisions/ADR-005-frozen-code-disposition.md`).
>
> A third item was narrowed rather than overturned: the single predefined success signal ("users stop watching the terminal") is now one of seven hypotheses (`docs/product/experiments.md`), and the positioning below did not survive competitive testing (`docs/product/positioning.md` §5).
>
> Read this page as the record of what was found in the code on 2026-09-08. Read `docs/product/` for what to do about it.

This is the report the founder asked for: what Asterim actually is today, what was found, what was changed during the audit session, and what to do next. Detailed evidence lives in the sibling documents; this page is the summary and the verdict.

## Method

- Read every governing document (`blueprint/`, `docs/`, `CLAUDE.md`, `AGENTS.md`, the pipeline state) and then ignored them in favour of the code.
- Read every route, middleware, adapter, the socket layer, the stores and the marketing app.
- Booted the packaged binary and the source build, paired a browser, added a project, ran the three adapters, probed the LAN with `curl`, ran the full test suite, typecheck, lint and build.
- Researched the September 2026 market (sources in `docs/product/positioning.md`).
- Implemented and live-verified the highest-priority fixes, then rewrote the documentation around what runs.

## Product

Asterim set out (June 2026) to be a local dashboard and safety layer for autonomous coding agents. Over 248 commits it grew, via an unattended Antigravity↔Claude orchestration loop, into a claimed "AI engineering platform" with team agents, pipelines, enterprise fleet policy, accounts, billing and a cloud relay. None of that had a user. The one integration the whole product rests on, the Claude Code adapter, was a stub that printed `Claude stub running` and exited; the Aider adapter was the same stub; only the Antigravity terminal scraper did anything, and it was tuned to the founder's own machine (his e-mail address is a header filter in the parser).

The problem the product addresses is real but has narrowed. Vendors now ship single-agent dashboards (Claude Code Agent View, the Codex app, Antigravity 2.0's Agent Manager). What remains unowned is a supervisor across vendors, on the developer's machine, with a record the developer keeps. That is the product now: see `docs/product/overview.md`.

## Architecture

Sound at the core: one privileged Fastify process owning SQLite, an event bus, agent processes and git; a thin React client over Socket.IO; adapters isolating vendor protocols; versioned migrations; a secret vault. Unsound at the edges: 40k lines of prototype subsystems layered on a broken adapter; a PTY text protocol teaching agents a private tool-call syntax; `App.tsx` at 1,200 lines with ten tabs; port 3000 hard-coded in the client; documentation that contradicted the code. Details: `docs/architecture/*.md`, `docs/audit/technical-debt.md`.

## UX

A first-time user, before this audit: chose "Claude Code" in the wizard by default, typed a task, was silently switched to a PowerShell tab, and saw a green "Agent Ready" pill over a session that had died. Ten tabs, emoji in labels, a modal that took an absolute path with no validation. After: the wizard shows which CLIs were detected and refuses to default to a missing one; five tabs plus "More"; failures are red and named; sending a task stays on the chat; the approval card shows the tool, the path or command, and a countdown. Still to do: layout at 1280×720, delete confirmation, richer card content (`docs/product/roadmap.md` P1).

## Landing page

The old site advertised `npm install -g asterim` (no such package), `brew install asterim/tap/asterim`, AppImage/.deb/.exe downloads "AVAILABLE NOW", "AST command safety", "Claude Code 3.7", "Hardware Enclave Scoped", "RISK SCORE 8.4/10", a v1.0 release badge, and an 892-line fabricated dashboard. `asterim.dev` does not resolve. The account portal never sent an auth header. All of it was replaced with a restrained, class-based site whose every sentence maps to a release-gate row, with real screenshots captured by the e2e script. `docs/design/landing-page.md` holds the audit, the design system, the IA and the copy.

## Security

Two critical findings, both fixed and re-verified: any device on the LAN could call every API route without a token whenever `NODE_ENV` was not `production` (which is always, for the binary), including registering and starting an MCP server, i.e. remote code execution; and a public OAuth exchange that signed any caller in as the oldest user. Also fixed: unsigned Stripe webhooks accepted, missing security headers, unvalidated project paths. Open and documented: the agent inherits the developer's environment; the regex "security analysis" is a label, not a guarantee; pairing tokens cannot be revoked before expiry. `docs/audit/security-audit.md`.

## Production readiness

Before: not deployable to strangers (no working adapter, LAN RCE, fake installs). After this session: the core loop is verified end to end on Windows with real Claude Code (pair → project → task → approval card → approve → file written → transcript closed; deny → file untouched → model explains; withheld answer → CLI waits), typecheck, lint (0 errors), tests and build are green, and the site tells the truth. Remaining blockers are founder actions and small tasks: npm publish (P0-06), the clean-machine test (P0-07), the diagnostics button (P0-12), the local usage summary (P0-11), delete confirmation (P0-09). `docs/release-gate.md`.

## Market

Single-vendor visibility is solved by the vendors. The funded cross-vendor competitors (Nimbalyst $20/user teams, Superset $15/user) are closed and young; the open-source ones churn (Vibe Kanban's company shut down in April 2026, Crystal was deprecated). Enterprise governance belongs to GitHub and Anthropic. There is room for an open-source, local, cross-vendor supervisor with an owned record, aimed at a tech lead on a small team, sold later as remote access and multi-machine. `docs/product/positioning.md`.

## Competitors

Claude Code itself (Agent View, Remote Control, auto mode) is the largest threat for Claude-only visibility; the Codex app and Antigravity 2.0 for their vendors; Nimbalyst for positioning. Asterim should not compete on single-agent UX, cloud execution or enterprise consoles.

## Positioning

"Run your coding agent. Approve every risky step from any browser on your network. Keep the record on your machine." One gate across vendors; an owned record; nothing leaves the machine; threads that survive restarts.

## Major risks

1. Anthropic opens Agent View to third-party agents or ships LAN/remote supervision for free. Mitigation: the owned record and cross-vendor gate compound over time; ship fast, measure, and be honest if the niche closes.
2. Claude Code's host protocol changes. Mitigation: the adapter is one file with a protocol test; the SDK types are the contract.
3. The founder's environment masks bugs (global hooks auto-approve; Antigravity scraper tuned to one machine). Mitigation: `ASTERIM_CLAUDE_DISABLE_HOOKS`, the e2e script, a clean-VM row in the release gate.
4. Nobody installs. Mitigation: soft launch with 10 to 25 hand-picked Claude Code users before any public post.

## Technical debt

`docs/audit/technical-debt.md`: 24 items; the ones that blocked launch are done (auth bypass, OAuth route, adapter, port, mock path, engines, `.env.example`, docs); the frozen subsystems (D11) are dispositioned in ADR-005; `App.tsx` extraction, bundle splitting and the test runner are post-launch.

## Missing features (that matter)

npm package; diagnostics button; delete confirmation; delete/revoke pairing devices; richer approval card (content preview); responsive pass; local usage summary; Codex adapter (blocked on the Codex CLI exposing a permission protocol).

## Recommended changes (done unless marked)

- Narrow the *first release* to the core loop (ADR-002). Confirmed by the founder on 2026-09-09, with the correction that the narrowing describes the MVP and not the product.
- Real Claude Code adapter over the native protocol (ADR-001). Done.
- Local pairing as the only auth (ADR-003). Done.
- Honest site, honest README, honest docs. Done.
- Archive the pipeline-era documentation and prototypes. Docs done; code frozen, disposition per ADR-005.
- Publish, soft-launch, measure. **Founder.**

## What changed in this session (for the diff reviewer)

Server: `authMiddleware.ts` (loopback-only opt-in bypass), `routes/auth.ts` (OAuth exchange removed), `routes/webhooks.ts` (unsigned refused), `routes/projects.ts` (path validation), `server.ts` (security headers), `AgentService.ts` (native permission resolution, session persistence, error status, describePermission), `ActiveAgentProvider.ts` (binary resolution), `package.json` (mock copy), 11 test files (explicit dev-auth opt-in), `dogfood_scenario.test.ts` (Windows exit-code guard), `GitWorktreeService.test.ts` (autocrlf pinned off in temp repos), `CliDatabaseTooling.test.ts` (home override now sets `USERPROFILE` too; subprocess spawns `process.execPath` with tsx's entry). None of these three suites had ever run to completion on Windows because turbo aborted the chain at the first failure. **Side effect to know about:** on the first full run today the CLI suite's `HOME`-only override pointed at the real `C:\Users\qhukz\.asterim` and migrated `asterim.db` to schema version 6 (additive migrations, a snapshot `asterim.db.bak.1788895968778` was written first). The Core would have applied the same migrations on its next start; nothing was deleted. Adapters: `ClaudeAdapter.ts` (rewritten), `types.ts`, `BaseAdapter.ts`, `AntigravityAdapter.ts` (mock path), new `ClaudeAdapter.test.ts` (23 checks). Web: `App.tsx` (tab strip, engines, emoji, no forced terminal, wizard binaries), `FirstRunWizard.tsx` (rewritten), `layout.css` (`.view-tab`), `vite.config.ts` (socket proxy), and every `:3000` fallback replaced by the origin. Marketing: rewritten (`index.css`, `App.tsx`, `Home.tsx`, `PricingPage.tsx`, `DocsPage.tsx`, `Navbar.tsx`, `Footer.tsx`, `MobileNavDrawer.tsx`, `InstallCommand.tsx`, `GithubIcon.tsx`, `site.ts`, `index.html`), fake pages deleted, real screenshots added. Repo: `README.md`, `CLAUDE.md`, `AGENTS.md`, `PROJECT_CONTEXT.md`, `.env.example`, `package.json` (Node ≥ 22), `.agents/*` redirected, `blueprint/README.md` banner, `tools/e2e/core-loop.mjs`, `docs/` rebuilt, old material archived, debug leftovers deleted.

## If I were the founder of Asterim today

1. **Keep:** the Core (Fastify + SQLite + event bus), the pairing model, the new Claude Code adapter, the approval gate and its persistence, the Changes view, the terminal, the secret vault, sovereign mode, the migration engine, the test discipline, Project Memory (hidden, as a later moat).
2. **Remove:** the account portal, the fake site, the Aider stub (done). The rest is frozen, not condemned: delegation and pipelines are the existing implementations of hypotheses H3 and H6, and their disposition waits for the first-users report (ADR-005).
3. **Redesign:** the thread workspace (`App.tsx` extraction, five tabs, 1280 px layout), the approval card (show the content that will be written), first run (done), the docs site (generate from `docs/`).
4. **Build:** npm publish, diagnostics button, delete confirmation, device revocation, secret-variable deny-list, worktree-per-thread with merge/discard (the one piece of the delegation prototype worth promoting).
5. **Not build:** cloud execution, accounts, billing, enterprise policy, team agents, a visual pipeline editor, our own model routing, a mobile app. The vendors own those or nobody asked.
6. **Launch with:** Claude Code + the gate + Changes + resume, free, MIT, one install command, one 40-second recording, one honest page.
7. **How:** 10 to 25 hand-picked Claude Code users for two weeks, interviews, fix what breaks, then Show HN and the Claude Code communities with the permission-protocol write-up as the technical hook.
8. **Measure:** install → first approval within 10 minutes (70%), day-3 return (30%), approved actions per active user per week (north star), start failures by reason, withdrawn cards (hooks pre-empting).
9. **After launch:** searchable record across threads; worktree-per-thread; Codex adapter when its CLI allows; Pro (off-LAN access, multi-machine) when ten people ask; Project Memory surfaced into the agent's prompt.
10. **What could make it serious:** being the place where every agent's actions on a developer's machine are gated and recorded, regardless of vendor, with the record compounding into the context those agents run with. Models will improve; the developer's ownership of what happened will not come from a vendor.

The original concept ("mission control for autonomous agents") should change substantially: not a control plane for a fleet, a supervisor for one developer's agents that a team can grow into. Everything built for the fleet before there was a supervisor was premature, and the audit's strongest recommendation is to stop building it until the loop has users.
