# PROJECT_CONTEXT.md

The minimum a person or a coding agent needs before touching Asterim. Written 2026-09-08 after a full audit, corrected 2026-09-09 after a strategy review. Keep it current when contracts change. Detail lives in `docs/` (index: `docs/README.md`).

## Read the labels

Every claim in this repository is one of four things. Confusing them is what produced the previous version of this codebase, where the vision was built before the first layer worked.

| Label | Meaning |
| --- | --- |
| **CURRENT** | Runs today, verified. |
| **MVP** | Must exist for the first public release. |
| **POST-MVP** | Considered only after the first users show it matters. |
| **VISION** | What Asterim could become. Never an instruction to build. |

## What Asterim is (VISION)

**A local-first control layer for AI coding agents.** Coding agents write code; Asterim owns everything around them — the projects they work in, the tasks they are given, the permissions they run under, the context they carry, and the record of what they did. Those things outlive any one session, any one agent and any one vendor.

```text
              You
               │
          ┌────▼─────┐
          │ ASTERIM  │
          └────┬─────┘
    ┌──────┬───┴───┬──────────┐
 Projects Tasks  Context  Permissions
    └──────┴───┬───┴──────────┘
               │
        Agent Runtime          ← one interface, many providers
               │
    ┌──────────┼──────────┐
 Claude Code  Antigravity  Future agents
```

Not: another coding agent, an editor, an autocomplete, a generic automation platform, a generic agent dashboard, a cloud SaaS, or a bundle of enterprise features.

## What ships first (MVP)

**Asterim makes working with Claude Code substantially easier to control, observe and manage, on one machine.** Install, pair a browser (a phone on the same network counts), point at a project folder, give Claude Code a task, watch what it does, approve or deny every command and file write, review the diff, come back tomorrow to a thread that resumes.

Claude Code first is not Claude Code only: the architecture stays provider-agnostic (ADR-004), but no MVP time goes to new providers.

## Status (CURRENT, 2026-09-09)

- **Working and live-verified:** pairing, projects, threads, the Claude Code adapter (native stream protocol, permission requests answered through the approval card, session resume), transcript, terminal, Changes, deny path, restart recovery. `tools/e2e/core-loop.mjs` passes 10/10 against the built binary.
- **PREVIEW:** Antigravity adapter (terminal scraping). Kept because it is the second structurally different provider and keeps the abstraction honest. No further investment.
- **Frozen** (present, tested, hidden, not marketed, not extended): team agents, pipelines, worktree fleet, delegation, fleet policy and SIEM export, desktop daemon, accounts and JWT, Stripe billing, cloud relay client, web push, mDNS. Disposition per subsystem in ADR-005; several are the existing implementations of hypotheses the first users will test, so they are frozen rather than condemned.
- **Removed:** the OAuth code exchange (account takeover), the LAN auth bypass, the Aider stub from the UI, the fake download page and account portal, the fabricated landing page.
- **Open for the MVP:** npm publish (P0-06), clean-machine test (P0-07), delete confirmation (P0-09), local usage summary (P0-11), diagnostics button (P0-12), status labels (P0-13).

## Tech stack

pnpm 9 + turbo monorepo. Node 22+ (`node:sqlite`). TypeScript 5. Fastify 4 + Socket.IO 4 (`apps/server`, package `asterim`). React 18 + Vite 5 + zustand + wouter (`apps/web`). React 19 static site (`apps/marketing`). `node-pty` for the Antigravity PTY and the Terminal view. No ORM, no test runner (plain `tsx` scripts), no telemetry.

## Map

```text
apps/server/src/
  server.ts, index.ts            boot and CLI entry
  services/AgentService.ts       agent lifecycle, native permission resolution, session ids
  services/ApprovalManager.ts    the gate (memory + `approvals` table), risk heuristics
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
  sdk/                           BaseAdapter, SessionManager, ProcessManager, types
  providers/claude/ClaudeAdapter.ts        the MVP adapter
  providers/antigravity/                   PTY scraper + TerminalFSM (PREVIEW)
packages/shared/src/events.ts    the event contract
apps/marketing/src/              Home, PricingPage, DocsPage, site.ts (facts), index.css
tools/e2e/core-loop.mjs          puppeteer smoke test + screenshots
docs/                            everything else (see docs/README.md)
```

## Commands

```bash
pnpm install
pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run build
pnpm --filter asterim dev                           # Core from source, dev channel :3001, ~/.asterim-dev
ASTERIM_CHANNEL=dev pnpm --filter @asterim/web dev   # dashboard :5173 with proxy
node apps/server/dist/index.js                      # packaged Core, :3000, ~/.asterim
ASTERIM_URL=http://localhost:3000 ASTERIM_PIN=<pin> ASTERIM_PROJECT_PATH=<repo> node tools/e2e/core-loop.mjs
```

## Environment

`PORT`, `HOST` (default `::`), `ASTERIM_CHANNEL` (stable|dev), `ASTERIM_DATA_DIR`, `ASTERIM_SOVEREIGN_MODE`, `ASTERIM_CLAUDE_BIN`, `ASTERIM_CLAUDE_DISABLE_HOOKS`, `MOCK_AGENT`, `ASTERIM_DEV_AUTH_BYPASS` (loopback + dev only). Cloud and billing variables are in `.env.example` and unused.

## Critical invariants (do not break)

1. No route under `/api/v1/` answers without a token on any interface, except `auth/pair|login|register|refresh` and `webhooks/stripe`. The dev bypass needs `ASTERIM_DEV_AUTH_BYPASS=true` **and** a loopback address **and** `NODE_ENV !== production`.
2. Adapters never pass `--dangerously-skip-permissions`. The Core never auto-approves; heuristics label, humans decide.
3. An adapter with `handlesApprovalsNatively` never receives `y`/`n` on stdin; the decision returns through its own protocol.
4. Every event payload carries `projectId` and `threadId`.
5. `~/.asterim/asterim.db` from any earlier version must open; migrations are additive and immutable once applied.
6. The dashboard talks to `window.location.origin` (or an explicitly selected workstation). No hard-coded ports.
7. `agent.stream` and `agent.log` are never persisted.
8. A failed agent start is reported as `status: error`, never `idle`.
9. The agent never commits, pushes or deploys without an explicit human action.
10. The Core may not assume a provider is a PTY, streams text, has a session id, or asks for permission at all. Those are `AdapterCapabilities` (ADR-004).
11. Asterim makes no outbound network connections of its own. Any change to that is a product decision, not an implementation detail.
12. Anything shown to a user that is not shipping carries a status word: BETA, PREVIEW or PLANNED.

## Claude Code adapter in one paragraph

`claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages --permission-mode default --disallowedTools AskUserQuestion --permission-prompt-tool stdio [--resume <id>]`, spawned with `child_process`, stdin/stdout pipes. The adapter writes an `initialize` control request, then one JSON user message per turn. It parses `system/init` (session id), `stream_event` (text deltas), `assistant` (text + tool_use), `user` (tool_result), `result` (cost, errors), and `control_request` with `subtype: can_use_tool`, which it hands to the Core's `permissionResolver`; the Core raises the normal approval and the adapter answers with `control_response` (`allow` + `updatedInput`, or `deny` + message). `control_cancel_request` aborts the ask (the user's own Claude Code hooks or rules decided first) and the card is withdrawn with a log line. `ASTERIM_CLAUDE_DISABLE_HOOKS=true` makes Asterim the only decider. Verified 2026-09-08 with Claude Code 2.1.251 on Windows, including a 20-second withheld answer.

## Known problems

- Layout at 1280×720: thread header wraps, action buttons crowd the tab strip (P1-07).
- The approval card shows what will actually happen (command, file content, before/after for an edit, create versus overwrite). Done 2026-09-09.
- The Antigravity parser hard-codes the founder's e-mail as a header filter (P1-10).
- `App.tsx` is 1,200 lines (P1-01).
- Force-killing the Core on Windows can leave WAL sidecars that make the next start fail with `disk I/O error`. The fix is to make sure no other Asterim process holds the file and start again. **Never move or delete `asterim.db-wal`**: it holds writes not yet in the main file, and discarding it loses recent projects, threads and approvals.
- One Windows test-harness defect remains (ConPTY console attachment in the PTY integration suite, P1-06); ~700 lint warnings, 0 errors.
- GitHub metadata says Apache-2.0 while `LICENSE` is MIT (FD-B). The git remote still points at `AgentDeck` (FD-C).

## Decisions already made (do not relitigate without evidence)

- Product definition is two-level: control layer (VISION), Claude Code MVP (`docs/product/overview.md`).
- Provider-agnostic architecture, single-provider MVP (ADR-004).
- Frozen subsystems kept, disposition decided by the first-users experiment (ADR-005).
- Local pairing is the only authentication at launch (ADR-003).
- No network telemetry for the MVP; a local usage summary instead (P0-11, FD-F).
- Positioning, pricing and the public-launch message are decided by Phase 2, not before (`docs/product/experiments.md`).

## Where to go next

`docs/product/overview.md` for what this is, `docs/product/roadmap.md` for the four phases, `docs/product/experiments.md` for what the first users are meant to teach us, `docs/tasks/` for executable specs, `docs/release-gate.md` before any release, `docs/decisions/FOUNDER_DECISIONS.md` for what needs the founder and when.
