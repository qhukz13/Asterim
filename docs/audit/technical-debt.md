# Technical Debt Triage (2026-09-08)

Severity is about launch risk, not elegance. "Fix before launch" is a yes only when the item blocks the core loop, a stranger's first session, or security.

| # | Issue | Severity | Impact | Effort | Fix before launch? | Status |
| --- | --- | --- | --- | --- | --- | --- |
| D1 | Claude Code and Aider adapters are stubs (`packages/adapters/src/providers/{claude,aider}`). | Critical | Product does nothing for the users it advertises to. | L | **Yes** | Claude Code adapter rebuilt this session; Aider removed from UI. |
| D2 | Dashboard hard-codes backend port 3000 in four files. | High | Pairing fails on any other port; dev channel (3001) unusable. | S | **Yes** | Fixed: backend derived from `window.location.origin`. |
| D3 | `authMiddleware` dev fallback grants a full user to any unauthenticated request outside `NODE_ENV=production`. | Critical | LAN RCE (see security audit S1). | S | **Yes** | Fixed. |
| D4 | `oauthTokenExchange` accepts any code. | Critical | Account takeover. | S | **Yes** | Route removed. |
| D5 | `App.tsx` is 1,216 lines with the tab strip, overlays and workspace logic inline; ten tabs rendered with duplicated inline style objects. | High | Every UX change is risky; first-time users see ten tabs. | M | Partly | Tab strip reduced to the core views; extraction of `ProjectWorkspace` is a Phase 1 P1 task. |
| D6 | Inline `style={{}}` everywhere (100+ per file in marketing, similar in web) instead of the token-based classes that exist. | Medium | Inconsistent spacing and colour; impossible to theme. | L | No | Landing page rewritten with classes; app migration is post-launch. |
| D7 | Antigravity adapter is a TUI screen scraper with the founder's e-mail hard-coded as a filter. | High | Breaks on every Antigravity release. | L | No | Documented as best-effort; Claude Code is the primary path. |
| D8 | `MOCK_AGENT` mock script path is relative to source layout and wrong in the bundle. | Medium | Cannot demo or smoke-test the packaged binary. | S | **Yes** | Fixed: resolved from the package root at build and runtime. |
| D9 | Approval security analysis is regex, not AST. | High | False sense of safety; copy said "AST". | M | Copy: yes. Engine: no | Copy fixed; Claude Code path uses the CLI's own permission requests. |
| D10 | `ASTERIM_TOOL_CALL` text protocol teaches agents a private tool-calling convention over a PTY. | Medium | Fragile; redundant for MCP-native agents. | M | No | Bypassed by the Claude Code adapter. |
| D11 | 40k+ lines of prototype subsystems (delegation, team agents, pipelines, fleet policy, desktop daemon) built by an unattended loop in 48 hours on top of D1. | High | Maintenance surface, cognitive load, misleading roadmap. | L to remove | No | Frozen and hidden from primary navigation; disposition decided per subsystem in ADR-005, after the first-users experiment. |
| D12 | `packages/mcp-memory-server` deep-imports `apps/server/src/services/*`. | Medium | Adding an `exports` map to the server breaks the MCP server. | M | No | Documented; extract `packages/memory-core` later. |
| D13 | Two processes (Core, MCP memory server) write one SQLite file. | Medium | Busy-timeout failures under load. | M | No | Documented contract (WAL, 5 s busy timeout). |
| D14 | Hand-rolled test harness (`tsx` scripts with manual assertion counters), no runner, no coverage, one Windows-only failure (`mcp-memory-server` live probe exit code). | Medium | Hard to see what is tested; CI red on Windows. | M | Partly | Windows probe guarded; runner migration is post-launch. |
| D15 | 1.75 MB main JS bundle, no code splitting. | Low | Slow first load on LAN devices. | S | No | Post-launch. |
| D16 | 162 explicit `any` types in server and web; ~710 lint warnings. | Low | Type safety erosion. | M | No | Ratchet: no new `any`. |
| D17 | Documentation sprawl: 90+ files in `docs/`, a normative `blueprint/` that disagrees with the code, `CLAUDE.md` stating there are no tests. | High | Agents and humans cannot find the truth. | M | **Yes** | Replaced by `PROJECT_CONTEXT.md` and `docs/`; old material archived. |
| D18 | Marketing copy and pages claim non-existent installs, releases and features. | Critical (trust) | Anyone who tries to install fails immediately. | M | **Yes** | Landing, pricing and download replaced. |
| D19 | Debug scripts and logs committed at repo root and in `packages/adapters` (`test-*.js`, `agent_debug.log`, `fsm_debug.log`, `agentdeck.db`). | Low | Noise. | S | No | Deleted where clearly dead; listed in `docs/development/housekeeping.md`. |
| D20 | `.env.example` documents `AGENTDECK_*` names nothing reads. | Low | Misleads operators. | S | **Yes** | Rewritten. |
| D21 | `engines.node >= 18` while `node:sqlite` needs 22+. | Low | Confusing install failures. | S | **Yes** | Set to `>=22`. |
| D22 | Entitlements frozen into JWT; refresh hard-codes them. | Medium | Wrong plan behaviour. | S | No | Deferred with accounts. |
| D23 | `EventBus` wildcard `'*'` re-emit and synchronous dispatch (ADR-008). | Low | Works; hostile subscribers can throw into publishers. | M | No | Leave. |
| D24 | Thread session id for Claude Code stored in the `settings` key-value table instead of a column. | Low | Slightly awkward; avoids a migration for launch. | S | No | Migration 007 post-launch. |
