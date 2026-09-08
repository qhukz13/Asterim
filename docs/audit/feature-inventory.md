# Feature Inventory (verified 2026-09-08)

Every row was checked against the implementation, not the documentation. "Verified live" means it was exercised on this machine today (Windows 10, Node 24, `claude` 2.1.251 and `agy` installed, Core booted from `apps/server/dist` and from source with `MOCK_AGENT=true`). "Suite" means a passing automated suite drives that code path.

Status vocabulary: `COMPLETE` · `MOSTLY COMPLETE` · `PARTIAL` · `PROTOTYPE` · `BROKEN` · `DEAD` · `PLANNED ONLY` · `UNKNOWN`

"MVP critical" means required for a stranger to complete the core loop: run a coding agent on a repo, watch it work, approve or deny what it wants to do, see the resulting diff.

## 1. Core loop

| Feature | Status | Evidence | MVP critical | Problems | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Claude Code adapter | **BROKEN (stub)** | `packages/adapters/src/providers/claude/ClaudeAdapter.ts` spawns `node -e 'console.log("Claude stub running")'` with a no-op parser. Verified live: prompt vanished, server log says `Failed to start agent … File not found`, UI kept showing a green "Agent Ready" pill. | Yes | The headline integration does not exist and the first-run wizard defaults to it. | Rebuilt in this session on Claude Code's headless stream-json protocol with hook-based permission interception. See `docs/architecture/agents.md`. |
| Aider adapter | **BROKEN (stub)** | `AiderAdapter.ts` is the same stub. | No | Advertised on the landing page and pricing. | Removed from the UI and copy until implemented. |
| Antigravity adapter | **PARTIAL** | Real TUI scraper: `AntigravityParser.ts` + `terminal/TerminalFSM.ts` (587 lines of regex over an `@xterm/headless` screen). Verified live with the mock: the approval gate fired and resolved; agent replies never reached the chat; the extracted description was the generic "Do you want to proceed?". The parser hard-codes the founder's e-mail as a header filter. | Yes (second path) | Screen scraping breaks on every TUI change. Google shipped Antigravity 2.0 with its own multi-agent manager in May 2026. The mock path resolves to `C:\Projects\mock-antigravity.js` from the packaged bundle, so `MOCK_AGENT=true` is broken for the binary. | Keep as a best-effort second adapter. |
| Approval gate | **MOSTLY COMPLETE** | `ApprovalManager.ts`: persisted in SQLite, 5-minute timeout, recovered on boot, cancelled with its thread; overlay in `App.tsx`. Verified live. | Yes | Risk analysis is regex heuristics (`CRITICAL_PATTERNS`) that `rm -r -f`, `find -delete` or a base64 pipe walk past. Marketed as "AST". The reply is a literal `y`/`n` written to stdin. | Keep the gate. For Claude Code, use the CLI's own permission requests instead of guessing from screen text. Stop calling it AST. |
| Chat transcript | **PARTIAL** | `ChatView.tsx` renders markdown and tool accordions; fed only by adapter events. With the mock nothing arrived. | Yes | Entirely dependent on adapter parsing quality. | Feed it from structured stream-json events. |
| Terminal view | **COMPLETE** | `TerminalService.ts` spawns a real shell per project; xterm + 16 ms throttler. Verified live (PowerShell). | Yes | Windows forces winpty; `cd` hack for paths with spaces. | Keep. |
| Changes (git status, diff, branches, commit, push, remote) | **MOSTLY COMPLETE** | `services/git/*` over a CLI `GitProvider`; drift, remote and worktree suites pass. Not exercised live. | Yes | AI commit message needs an installed agent CLI and falls back to a canned string. | Keep; exercise in the release gate. |
| Question overlay | **COMPLETE** | `QuestionOverlay` in `App.tsx`; only the Antigravity FSM emits it. | No | — | Keep. |
| Projects and threads | **COMPLETE** | `routes/projects.ts`, `ProjectManager.ts`. Verified live. | Yes | No folder picker (the user types an absolute path); no existence check; delete has no confirmation. | Existence check added in this session; picker later. |
| First-run wizard | **COMPLETE** | `FirstRunWizard.tsx`. Verified live. | Yes | Defaulted to an engine that did not work. Generic copy. | Rewritten around the engines actually detected on the machine. |
| Device pairing (PIN, QR, lockout) | **COMPLETE** | `PairingService.ts`, suite passes, verified live. | Yes | Backend port 3000 was hard-coded in `useAuth.ts`, `utils/auth.ts`, `App.tsx`, `FirstRunWizard.tsx`; pairing failed on port 3001 with "Network/CORS error". | Fixed in this session: the dashboard talks to the origin that served it. |

## 2. Workspace, environments, memory

| Feature | Status | Evidence | MVP critical | Problems | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Environments (personal, company, client, experimental) | **MOSTLY COMPLETE** | `WorkspaceService.ts`, `EnvironmentSettingsView.tsx`, keyboard-navigable switcher. | No | A single-user product pretending to be multi-tenant. Members, invitations and roles exist in the schema, but `rbacGuard` / `entitlementGuard` are used in 1 of 25 route files (`enterprise.ts`). | Keep the personal environment; hide the rest until a second user exists. |
| Environment secrets vault | **COMPLETE** | `SecretVaultService.ts`, `EnvironmentSecretService.ts`, suites pass; startup migrates plaintext rows and compacts the database. | No | Good work, no demand yet. | Keep, de-emphasise. |
| Project Memory (decisions, intents, rules, briefing, drift, candidate queue) | **COMPLETE** | `ProjectMemoryService.ts` (1,139 lines), `routes/memory.ts`, `@asterim/mcp-memory-server`, 8+ suites. | No | Large and well tested, but no user asked for it. Two processes write one SQLite file. The MCP package deep-imports `apps/server/src`. | Keep behind the Memory tab; do not market it until a user asks. |
| Context service and symbol indexer | **UNKNOWN** | `ContextService.ts`, `SymbolIndexer.ts`, `ContextView.tsx`; no tests, not exercised. | No | — | Verify or remove after launch. |
| Command palette, inspector, panel store | **COMPLETE** | `CommandPalette.tsx`, `InspectorPanel.tsx`, `usePanelStore.ts`. | No | Inspector content is mostly static labels. | Keep. |

## 3. Agent ecosystem

| Feature | Status | Evidence | MVP critical | Problems | Recommendation |
| --- | --- | --- | --- | --- | --- |
| MCP server supervisor and registry UI | **COMPLETE** | `services/mcp/*`, 5 suites. | No | Registering a server spawns an arbitrary command (`McpProcessSupervisor.ts:515`); combined with the auth bypass below this was remote code execution on the LAN. | Keep, now behind real auth. |
| MCP tool bridge over PTY text (`ASTERIM_TOOL_CALL` lines) | **COMPLETE, questionable** | `BaseAdapter.scanForToolCalls`, `McpToolGateway`. | No | Teaches a CLI agent a private text protocol because the adapter cannot see its tool calls. Claude Code speaks MCP natively, so this layer is redundant for it. | Keep for Antigravity; not used by the Claude Code adapter. |
| Skills discovery (`.agents/skills`) | **COMPLETE** | `SkillService.ts`, suite. | No | Marginal value. | Keep, off the primary nav. |
| Agent profiles (6 built-in roles) | **COMPLETE** | `ProfileService.ts`, suite. Persona injected as the first PTY message. | No | Duplicates Claude Code's own `--append-system-prompt` and agents. | Keep, off the primary nav. |
| Delegation (parent/child threads, sandboxes, verification) | **PROTOTYPE** | `AgentDelegationService.ts` (2,243 lines), suites pass. | No | Every child is an adapter session; with a stub adapter nothing ever ran for real. | Frozen. |
| Team agents (shared agents, turn queue, governance) | **PROTOTYPE** | `TeamAgentService.ts` (1,969 lines), `AgentTurnLock.ts`, UI tab. | No | There is no second user: socket auth is one pairing token per Core. | Frozen; tab hidden. |
| Pipelines (YAML DAG, worktree fleet, triggers, PR synthesis) | **PROTOTYPE** | `services/pipeline/*`, `PipelineDashboard.tsx`, suites pass. | No | Built in two days by an automated loop on top of a non-working adapter. | Frozen; tab hidden. |
| Enterprise fleet policy and SIEM export | **PROTOTYPE** | `services/enterprise/*`, 229-assertion suite. | No | No customer; GitHub (Feb 2026) and Anthropic (managed settings, OpenTelemetry) ship this natively. | Frozen; not marketed. |
| Desktop daemon (tray, autostart, OS toasts) | **PARTIAL** | `services/desktop/*`, routes, card. | No | There is no desktop app to drive it. | Frozen. |
| Sovereign mode (no outbound network) | **COMPLETE** | `SovereignMode.ts`, suite. | No | — | Keep; honest differentiator. |
| Release channels and CLI (`db:status`, snapshots, `data:clone`) | **COMPLETE** | `cli/*`, `MigrationEngine.ts`, suites, verified boot. | No | — | Keep. |

## 4. Accounts, billing, cloud

| Feature | Status | Evidence | MVP critical | Problems | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Register, login, refresh, logout, me | **PARTIAL** | `AuthController.ts` works in isolation (scrypt, HS256 JWT, rotating refresh cookie). | Only if selling | The account portal in `apps/marketing` never sends the access token (zero `Authorization` headers) and the middleware never reads cookies, so `/me`, sessions, devices and keys all fail. In dev mode every request is `usr_dev`, who does not exist (404). No e-mail verification, no password reset, no login rate limit. | Do not launch a SaaS account system. Local pairing is the product's auth. Portal removed from navigation. |
| OAuth / desktop deep-link exchange | **BROKEN, critical** | `oauthTokenExchange` never validates `code`; it logs the caller in as the oldest user. The route was on the public allow-list. | No | Account takeover. | Route removed in this session. |
| Sessions, trusted devices, API keys | **PARTIAL** | Routes exist; the portal cannot call them. | No | — | Frozen. |
| Plans and entitlements | **PARTIAL** | `PlanService.ts`, `EntitlementService.ts`. `refresh` hard-codes entitlements regardless of plan. | No | Prices disagree: $19 in code, $20 on the site. | Frozen. |
| Stripe checkout, portal, webhooks | **PARTIAL** | Raw HTTP gateway, signature verification with tolerance window, suite. Never run against Stripe. Accepts unsigned webhooks when the secret is unset. | No | Nothing to sell: every "Pro" feature (relay, push, sync) is a prototype. | Frozen until a paid feature works. Unsigned webhooks now refused. |
| Cloud relay server | **MOSTLY COMPLETE** | `relayServer.ts`: HMAC registration, rate limits, reaper, suite. | No | Fine as infrastructure. | Keep dormant. |
| Relay client and E2E tunnel | **PROTOTYPE** | `RelayClient.ts`, the E2E branch of `useSocket.ts`, `ConnectWorkstationModal`. A remote "project" is a tunnel id. Never verified. | No | Sovereign mode disables it; remote PIN attempts are not rate limited. | Frozen. Claude Code's own Remote Control now covers phone approvals. |
| Web push | **PARTIAL** | `PushService.ts`, VAPID keys in the vault. Unverified. | No | — | Frozen. |
| mDNS discovery | **PARTIAL** | `mDNSService.ts`. Unverified. | No | — | Frozen. |

## 5. Marketing site (`apps/marketing`)

| Feature | Status | Evidence | MVP critical | Problems | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Landing page (8 "acts") | **PARTIAL, misleading** | `components/home/Act1..Act8`, `AsterimWorkstationSandbox.tsx` (892 lines of fake UI). | Yes | Claims "Open-Core v1.0 Released", `npx asterim`, `npm install -g asterim` (no such package on npm), "AST Command Safety", "Claude Code 3.7", "Hardware Enclave", "RISK SCORE 8.4/10". 100+ inline style objects in one file. | Replaced in this session. See `docs/design/landing-page.md`. |
| Pricing page | **PARTIAL, misleading** | Pro $20 "BETA", Enterprise "PLANNED", a 💡 emoji notice. | Yes | Sells features that do not work. | Replaced: Free now, Pro waitlist. |
| Download page | **FAKE** | `wget https://releases.asterim.dev/asterim.AppImage`, `brew install asterim/tap/asterim`, `.deb 0.4.5`, `wsl --install asterim`, all "AVAILABLE NOW". None exist; `asterim.dev` does not resolve. | Yes | Actively destroys trust. | Removed; one honest install path. |
| Docs page | **PARTIAL** | Static topics inline, including "Privacy Policy" and "Terms". | Yes | Repeats the false claims. | Regenerated from `docs/`. |
| Account portal | **BROKEN** | See section 4. | No | — | Removed from navigation. |

## 6. Platform

| Feature | Status | Evidence | MVP critical | Problems | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Monorepo build, typecheck, lint | **COMPLETE** | Run today: typecheck exit 0; lint 0 errors, ~710 warnings; build succeeded. | Yes | 1.75 MB JS bundle with no code splitting; 162 explicit `any` in server and web. | Keep; split later. |
| Automated tests | **MOSTLY COMPLETE** | 43 hand-rolled `tsx` suites, about 5,300 assertions. Today: one failure (`mcp-memory-server` live probe, Windows exit code `null`). | Yes | No runner, no coverage, no browser E2E. `CLAUDE.md` claimed no tests existed. | Keep; add one browser E2E for the core loop. |
| CI and release workflows | **COMPLETE** | `.github/workflows/ci.yml`, `release.yml` (draft release, image smoke test). | Yes | Not re-run by me. | Keep. |
| Docker images | **COMPLETE** | Two Dockerfiles, runbook. | No | Agent CLIs are not in the image, so a containerised Core can only run the mock. | Keep for the relay; de-emphasise for the Core. |
| Crash log, server log, pruning | **COMPLETE** | `server.ts`, `PruningService.ts`. | Yes | stdout is redirected to `server.log`; only vault secrets are redacted. | Keep. |
| Error tracking and product analytics | **PLANNED ONLY** | None, by design (DEC-028, zero telemetry). | Yes for learning from a launch | Without opt-in signals nothing can be learned from a launch. | Opt-in, anonymous, documented events (Phase 1, P1). |
