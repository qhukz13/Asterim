# PROJECT_CONTEXT.md

The minimum a person or a coding agent needs before touching Asterim. Written 2026-09-08 after a full audit; keep it current when contracts change. Detail lives in `docs/` (index: `docs/README.md`).

## What Asterim is

A local supervisor for coding agents. It runs Claude Code (primary) or Antigravity (best effort) as a child process in a project folder on the developer's machine, streams what the agent says and does into a browser dashboard reachable on the LAN, and stops the agent before every command or file write until the person approves. Approvals, denials, tool calls and diffs are stored in a SQLite file the developer owns. Nothing leaves the machine except the agent's own API calls.

Not: an IDE, a cloud service, an enterprise governance console, a replacement for the agent CLIs.

## Status (2026-09-08)

- **Working and live-verified:** pairing, projects, threads, Claude Code adapter (stream-json, native permission requests answered through the approval card, session resume), transcript, terminal, Changes, deny path, restart recovery. `tools/e2e/core-loop.mjs` passes 10/10 against the built binary.
- **Best effort:** Antigravity adapter (terminal scraping).
- **Frozen, hidden, kept for now (founder decision FD-2):** team agents, pipelines, worktree fleet, delegation, fleet policy/SIEM export, desktop daemon, accounts/JWT, Stripe billing, cloud relay, web push, mDNS. They compile and their tests pass; they are not in the primary navigation and are not marketed.
- **Removed:** the OAuth code exchange (account takeover), the LAN auth bypass, the Aider stub from the UI, the fake download page and account portal, the fabricated landing page.
- **Not yet done for launch:** npm publish (P0-06), diagnostics button (P0-12), opt-in analytics decision (FD-4), delete confirmation (P0-09), privacy/licence pages linked (done on the site; P0-10 remains for the README).

## Tech stack

pnpm 9 + turbo monorepo. Node 22+ (`node:sqlite`). TypeScript 5. Fastify 4 + Socket.IO 4 (`apps/server`, package name `asterim`). React 18 + Vite 5 + zustand + wouter (`apps/web`). React 19 + Vite 8 static site (`apps/marketing`). `node-pty` for the Antigravity PTY and the Terminal view. No ORM, no test runner (plain `tsx` scripts), no telemetry.

## Map

```text
apps/server/src/
  server.ts, index.ts            boot and CLI entry
  services/AgentService.ts       agent lifecycle, native permission resolution, session ids
  services/ApprovalManager.ts    approval gate (memory + `approvals` table), risk heuristics
  services/EventBus.ts           singleton bus; '*' re-emit
  sockets/socketManager.ts       Socket.IO rooms, history replay, event persistence
  middleware/authMiddleware.ts   pairing token / JWT; loopback-only dev bypass
  services/PairingService.ts     PIN, tokens, lockout
  services/git/                  GitService over managers over CLI git
  services/DatabaseService.ts, migrations/   node:sqlite, versioned migrations 001-006
  routes/                        25 route files under /api/v1 (core: projects, git, system, auth, ai, memory)
apps/web/src/
  App.tsx                        workspace, tab strip (PRIMARY_VIEWS/MORE_VIEWS), approval overlay
  hooks/useSocket.ts             events → state
  utils/auth.ts                  backend = window.location.origin; token per origin
  stores/                        zustand; URL is the source of truth (Router.tsx)
packages/adapters/src/
  sdk/                           BaseAdapter, SessionManager, ProcessManager, types (LaunchConfig, NativePermissionAsk)
  providers/claude/ClaudeAdapter.ts        the primary adapter
  providers/antigravity/                   TUI scraper + TerminalFSM
packages/shared/src/events.ts    the event contract
apps/marketing/src/              Home, PricingPage, DocsPage, site.ts (facts), index.css
tools/e2e/core-loop.mjs          puppeteer smoke test + screenshots
docs/                            everything else (see docs/README.md)
```

## Commands

```bash
pnpm install
pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build
pnpm --filter asterim dev                      # Core from source, dev channel :3001, ~/.asterim-dev
ASTERIM_CHANNEL=dev pnpm --filter @asterim/web dev   # dashboard with proxy :5173
node apps/server/dist/index.js                 # packaged Core, :3000, ~/.asterim
ASTERIM_URL=http://localhost:3000 ASTERIM_PIN=<pin> ASTERIM_PROJECT_PATH=<repo> node tools/e2e/core-loop.mjs
```

## Environment

`PORT`, `HOST` (default `::`), `ASTERIM_CHANNEL` (stable|dev), `ASTERIM_DATA_DIR`, `ASTERIM_SOVEREIGN_MODE`, `ASTERIM_CLAUDE_BIN`, `ASTERIM_CLAUDE_DISABLE_HOOKS`, `MOCK_AGENT`, `ASTERIM_DEV_AUTH_BYPASS` (loopback + dev only). Cloud/billing variables are listed in `.env.example` and are unused at launch.

## Critical invariants (do not break)

1. No route under `/api/v1/` answers without a token on any interface, except `auth/pair|login|register|refresh` and `webhooks/stripe`. The dev bypass needs `ASTERIM_DEV_AUTH_BYPASS=true` **and** a loopback address **and** `NODE_ENV !== production`.
2. Adapters never pass `--dangerously-skip-permissions`. The Core never auto-approves; heuristics label, humans decide.
3. An adapter with `handlesApprovalsNatively` never receives `y`/`n` on stdin; the decision goes back through its protocol (`control_response`).
4. Every event payload carries `projectId` and `threadId`.
5. `~/.asterim/asterim.db` from any earlier version must open; migrations are additive and immutable once applied.
6. The dashboard talks to `window.location.origin` (or an explicitly selected workstation). No hard-coded ports.
7. `agent.stream` and `agent.log` are never persisted.
8. A failed agent start is reported as `status: error`, never `idle`.
9. The agent never commits, pushes or deploys without an explicit human action.
10. Marketing copy states only what the release gate has exercised.

## Claude Code adapter in one paragraph

`claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-mode default --disallowedTools AskUserQuestion --permission-prompt-tool stdio [--resume <id>]`, spawned with `child_process`, stdin/stdout pipes. The adapter writes an `initialize` control request, then one JSON user message per turn. It parses `system/init` (session id), `stream_event` (text deltas), `assistant` (text + tool_use), `user` (tool_result), `result` (cost, errors), and `control_request` with `subtype: can_use_tool`, which it hands to the Core's `permissionResolver`; the Core raises the normal approval and the adapter answers with `control_response` (`allow` + `updatedInput`, or `deny` + message). `control_cancel_request` aborts the ask (the user's own Claude Code hooks or rules decided first) and the card is withdrawn with a log line. `ASTERIM_CLAUDE_DISABLE_HOOKS=true` makes Asterim the only decider. Verified 2026-09-08 with Claude Code 2.1.251 on Windows, including a 20-second withheld answer.

## Known problems

- Layout at 1280×720: thread header wraps, action buttons crowd the tab strip (P1-07).
- The Antigravity parser hard-codes the founder's e-mail as a header filter (P1-10).
- `App.tsx` is 1,200 lines (P1-01).
- Force-killing the Core on Windows can leave WAL sidecars that make the next start fail with `disk I/O error` (documented; boot-time advice is a P1).
- One test needed a Windows guard (`mcp-memory-server` live probe); ~710 lint warnings, 0 errors.
- The repository's GitHub metadata says Apache-2.0 while `LICENSE` is MIT (FD-5). The git remote still points at `AgentDeck` (FD-6).

## Assumptions made during the audit (founder may overrule)

- Claude Code is the primary adapter; Antigravity is second; Aider is dropped.
- Accounts, billing, relay and everything "team" or "enterprise" are frozen until the free local loop has users.
- The launch is free; Pro is a waitlist.
- User hooks in Claude Code are respected by default.

## Where to go next

`docs/product/roadmap.md` for priorities, `docs/tasks/` for executable specs, `docs/release-gate.md` before any release, `docs/decisions/FOUNDER_DECISIONS.md` for the eight things only the founder can decide.
