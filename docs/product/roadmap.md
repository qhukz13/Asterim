# Roadmap

Replaces `blueprint/ROADMAP.md` (phases 7 to 10), `docs/product-backlog.md` and every `docs/phase*` plan. Those described a product that did not exist; this one starts from what runs today (`docs/audit/feature-inventory.md`).

Priorities: **P0** blocks launch. **P1** strongly recommended before public launch, never allowed to delay it more than a week. **P2** after launch. Each task with an id has a full specification in `docs/tasks/`.

Definition of the launch bar (from `docs/release-gate.md`): a stranger with Claude Code installed can find Asterim, install it, pair a browser, add a project, run a task, approve a command, see the diff, and come back tomorrow, without the founder's help.

## Phase 1: Release-ready (target: 3 to 4 weeks of focused work)

### P0

| Id | Task | Status |
| --- | --- | --- |
| P0-01 | Close the LAN auth bypass and remove the OAuth exchange (security S1, S2). | Done 2026-09-08 |
| P0-02 | Dashboard must talk to the origin that served it, never a hard-coded port. | Done 2026-09-08 |
| P0-03 | Real Claude Code adapter over stream-json with hook-based permission requests; thread session resume. | Done 2026-09-08, live-verified |
| P0-04 | Surface agent start failures as errors; remove Aider from the UI; stop forcing the terminal tab. | Done 2026-09-08 |
| P0-05 | Replace the landing, pricing and download pages with truthful copy and one install path. | Done 2026-09-08 (see `docs/design/landing-page.md`) |
| P0-06 | Publish `asterim` to npm from the release workflow, with the dashboard bundled, so the install command on the landing page is real. | Open, founder action (npm account, name check) |
| P0-07 | Windows-safe end-to-end smoke: packaged binary boots, pairs, runs a Claude Code turn, and writes one file through the gate. Scripted with puppeteer in `tools/e2e/`. | Open |
| P0-08 | First-run wizard detects installed CLIs and refuses to default to a missing one. | Done 2026-09-08 |
| P0-09 | Project add validates the folder exists; delete asks for confirmation. | Half done (validation done; confirmation open) |
| P0-10 | Privacy note and licence page reachable from the landing footer; state exactly what leaves the machine (agent API calls only). | Open (copy drafted in `docs/design/landing-page.md`) |
| P0-11 | Opt-in, anonymous, documented product events (install, first_pair, first_project, first_approval, first_diff_viewed, thread_resumed) to a self-hosted endpoint the founder owns; off by default in sovereign mode; never any code or paths. | Open; founder decision FD-4 |
| P0-12 | Crash reporting: `crash.log` already exists; add a "copy diagnostic bundle" button in Settings (versions, OS, last 200 log lines, no paths outside the data dir). | Open |

### P1

| Id | Task |
| --- | --- |
| P1-01 | Extract `ProjectWorkspace` from `App.tsx` into its own module with the tab strip as a component; remove remaining inline styles in the thread header. |
| P1-02 | Approval card shows Claude Code's own tool name and input (file diff preview for Edit/Write, command for Bash), not only description/command strings. |
| P1-03 | Per-thread "auto-approve read-only" and "always allow this command prefix" using Claude Code permission rules, written to `.claude/settings.local.json` on request. |
| P1-04 | Pairing token revocation: list paired devices in Settings, revoke, rotate the PIN on demand. |
| P1-05 | Deny-list of common secret variables from the agent environment (`AWS_*`, `GITHUB_TOKEN`, `*_SECRET`, `*_API_KEY`) with an allow-list override per environment. |
| P1-06 | Windows test hygiene: the MCP memory server live-probe assertion and any other `process.platform === 'win32'` timing checks. |
| P1-07 | Responsive pass of the dashboard at 1280×720 and 390×844: thread header wraps, tab overflow, overlay stacking. |
| P1-08 | Empty, loading and error states for Changes, Memory and the thread list. |
| P1-09 | `docs/` site generated from the repository docs instead of hand-written topics in `DocsPage.tsx`. |
| P1-10 | Antigravity adapter: strip the founder's e-mail filter, make the header filters configurable, label the adapter "best effort" in the UI. |

### P2 (after launch)

Bundle splitting; test runner migration (vitest) with coverage; `packages/memory-core` extraction; entitlement refresh fix; Codex adapter feasibility spike (the Codex CLI has no hook protocol yet; check quarterly).

## Phase 2: Launch

### Pre-launch checklist (owner: founder)

- Domain: decide whether `asterim.dev` will be registered (it does not resolve today) or whether the GitHub Pages/README is the landing page for the soft launch. FD-3.
- npm name `asterim` is free as of 2026-09-08; publish 0.2.0 from the release workflow (P0-06).
- Analytics endpoint stood up (P0-11) or the decision recorded to launch blind.
- Error monitoring: the diagnostic bundle button (P0-12) plus a GitHub issue template that asks for it.
- Support channel: GitHub Discussions, one pinned "how to report a broken session" thread.
- Legal: MIT licence (the GitHub repository currently shows Apache-2.0 while `LICENSE` says MIT; resolve, FD-5), privacy note, no ToS needed for a local tool.
- Launch assets: one 40-second screen recording of install → pair → task → approval → diff; three PNGs (approval card, transcript, Changes).

### Soft launch (2 weeks, 10 to 25 people)

Who: people already running Claude Code daily, recruited by direct message (Claude Code Discord/GitHub discussions, two or three engineering Slack communities, personal network). Not a public post.

Measure (from the opt-in events or from asking):

- Install-to-first-approval time and completion rate. Target: 70% reach a first approval within 10 minutes.
- Sessions per user per day on days 2 to 14. Target: 3 of 10 people use it on 5+ days.
- Approval decisions per session and denial rate (does the gate matter?).
- Threads resumed after restart.

Collect: every failed install on Windows/macOS/Linux; every "I expected X" comment; whether anyone opens the dashboard from a second device.

Bugs that block public launch: any data loss in the SQLite file, any unrecoverable stuck approval, any silent failure to start Claude Code, any LAN-reachable route without a token.

Signal of value: at least three people say unprompted that they stopped watching the terminal. If nobody does, the positioning in `docs/product/positioning.md` is wrong and the public launch waits.

### Public launch

Channels, in order of expected yield for this audience: Hacker News "Show HN" (with the recording, the honest scope, and the security model up front), the Claude Code community spaces, r/ClaudeAI and r/LocalLLaMA, a short technical post on how the permission hook works (the one novel engineering piece), and direct replies to people asking "how do I supervise multiple Claude Code sessions". Founder-led onboarding: offer a 20-minute call to the first 20 people who install and hit a problem.

## Phase 3: After launch

| Track | Now (next 4 to 8 weeks) | Next | Later | Maybe | Never |
| --- | --- | --- | --- | --- | --- |
| Product | Worktree-per-thread with a merge/discard action (the delegation prototype has the plumbing); diff preview in the approval card. | Codex adapter if a hook protocol appears; parallel thread board. | Scheduled tasks; cloud execution via Claude Code `--cloud`. | Visual pipeline editor. | Building our own model routing. |
| Growth | Recording + technical post; GitHub README that matches the landing. | Homebrew tap and winget once the npm package is stable. | Integrations: open a thread from a GitHub issue. | Marketplace listing. | Paid ads. |
| Retention | Searchable record across threads (approvals, diffs, decisions). | Project Memory surfaced as "what this project has decided" in the agent's system prompt (already implemented, hidden). | Digest of what agents did this week. | — | Gamification. |
| Monetisation | Waitlist only. | Pro: off-LAN remote access through the existing relay, multi-machine, priority support, once ten people ask. | Team: shared record and shared approvals, once two people at one company ask. | Enterprise: only via a partner. | Selling seats before the free loop retains. |
| Infrastructure | vitest migration; bundle split; CI on Windows. | Migration 007 (provider session column); `memory-core` package. | Signed installers. | — | Kubernetes. |
| Moat | The owned record: export, search, retention controls. | Cross-vendor adapters. | LAN-first collaboration without a vendor cloud. | Community adapter SDK. | Proprietary lock-in of the record. |

## Why Asterim could still matter in 2028

Models will keep improving and vendors will keep improving their own dashboards. Two things do not improve on their own: a record of what agents did that belongs to the developer rather than to a vendor account, and a single control point across vendors. Both compound: every thread run under Asterim makes the record more valuable, and every adapter makes the control point harder to replace. That is the bet. It is not "a better UI", and it is not the model.
