# Founder Decisions

Decisions only the founder can make. Everything else in the 2026-09 audit was decided and implemented under stated assumptions (see `PROJECT_CONTEXT.md` § Assumptions). Keep this list short; close items by editing them, not by appending.

## FD-1: Confirm the narrowed product scope

**Decision.** Ship the "local supervisor for coding agents" defined in `docs/product/overview.md`, with Claude Code as the primary adapter and Antigravity as best-effort, and freeze everything else.

**Context.** The repository contains ten-plus subsystems (team agents, pipelines, fleet policy, accounts, billing, relay, desktop daemon, delegation, memory, MCP bridge) built on top of a Claude adapter that was a stub. None has a user. The only advantage Asterim can defend is the cross-vendor gate plus an owned record, and that needs one path to work flawlessly.

**Options.** (a) Narrow as proposed. (b) Keep the enterprise/team story and ship accounts + billing first. (c) Pivot to a pure library/CLI (no dashboard).

**Recommendation.** (a).

**Why.** (b) sells features that GitHub and Anthropic already ship natively and that Asterim cannot secure today (accounts are broken end to end). (c) throws away the one thing that works and is differentiated (the gate with a UI reachable from another device).

**If we do nothing.** The site keeps advertising installs that fail; nobody gets past minute one.

## FD-2: Delete or keep the frozen subsystems

**Decision.** Whether the frozen code (about 40k lines: `services/ai/TeamAgentService.ts`, `services/pipeline/*`, `services/enterprise/*`, `services/desktop/*`, `services/ai/AgentDelegationService.ts`, the account portal, relay client) stays in the tree hidden, moves to a branch, or is deleted.

**Options.** (a) Keep hidden (current state). (b) Move to `archive/2026-08-prototypes` branch and delete from `main`. (c) Delete outright.

**Recommendation.** (b) within a month of launch. Keep it now so the launch diff stays small and the tests keep passing.

**Why.** Hidden code still costs typecheck time, migration surface (six migrations create tables nobody reads) and confusion for every agent that opens the repo. A branch loses nothing.

**If we do nothing.** Every future contributor and every coding agent reads 120k lines to find the 15k that matter.

## FD-3: Domain and hosting for the landing page

**Decision.** Register `asterim.dev` (it does not resolve today) and host the static marketing build, or launch from the GitHub README plus GitHub Pages.

**Recommendation.** Register the domain if the name is kept (FD-6), host on GitHub Pages or Cloudflare Pages (static, free), point the README at it. Do not stand up the account portal.

**If we do nothing.** The site's own metadata (`og:url`) points at a dead domain.

## FD-4: Opt-in product analytics

**Decision.** Whether to add the opt-in event ping described in task P0-11, given the zero-telemetry principle (DEC-028).

**Options.** (a) Opt-in ping, six events, no identifiers beyond a random install id, disabled in sovereign mode, source visible. (b) No analytics; rely on interviews.

**Recommendation.** (a). The soft launch is a measurement exercise; without install-to-first-approval numbers the launch teaches nothing. Opt-in with visible source keeps the promise honest.

**If we do nothing.** Launch decisions get made on anecdotes.

## FD-5: Licence

**Decision.** `LICENSE` in the repository is MIT; GitHub displays Apache-2.0 for the repository; `blueprint/BUSINESS.md` says MIT. Pick one.

**Recommendation.** MIT (simplest, matches the file). Fix the GitHub metadata.

## FD-6: Name

**Decision.** Keep "Asterim". The git remote still points at `qhukz13/AgentDeck`, `agentdeck.db` sits at the repository root, and `.env.example` used `AGENTDECK_*` until today. The npm name `asterim` is free.

**Recommendation.** Keep Asterim; claim the npm name now; update the remote URL.

## FD-7: Pricing intent for the waitlist

**Decision.** What the "Pro" waitlist on the landing page promises. Proposed: remote access off-LAN through the relay, multiple machines in one dashboard, priority support, at $12 to $19 per month, available "when ten people have asked".

**Recommendation.** Promise nothing more specific than that. The code has `$19` (Pro) and `$49` (Team); the site said `$20`. Neither has been tested with a buyer.

## FD-8: Founder time

**Decision.** The Phase 1 P0 list is about three to four weeks of one person's focused time, with P0-06 (npm publish) and P0-11 (analytics endpoint) needing accounts only the founder can create. Confirm the calendar or cut P0-11.
