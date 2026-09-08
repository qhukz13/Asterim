# Security Audit (2026-09-08)

Scope: everything a user runs (`apps/server`, `apps/web`, `packages/adapters`, `packages/mcp-memory-server`) plus the relay and the marketing/account app. Method: code reading of every route, middleware and adapter, followed by live probes against a Core started the way the packaged binary starts (`node dist/index.js`, no `NODE_ENV`).

Threat model for a local-first tool: the attacker is another device on the same LAN, a malicious web page in the user's browser, or a repository the agent is pointed at. The Core listens on every interface by default (`HOST` defaults to `::`).

Severity: **CRITICAL** exploitable remotely without credentials; **HIGH** exploitable with low effort or by the agent itself; **MEDIUM** needs an unusual precondition; **LOW** hygiene.

## Findings

| ID | Severity | Finding | Evidence | Status |
| --- | --- | --- | --- | --- |
| S1 | **CRITICAL** | Unauthenticated REST access from the LAN. When `NODE_ENV` is not `production` (the packaged binary, `pnpm dev`, and every documented way to run the Core), `authMiddleware` assigns every request without a token a `defaultDevUser` carrying all entitlements. Verified live from the LAN address: listed projects, read settings, registered `C:\Windows` as a project. Registering and starting an MCP server spawns an arbitrary command (`McpProcessSupervisor.ts:515`), so this is remote code execution for anyone on the network. | `apps/server/src/middleware/authMiddleware.ts` (fallback block), `routes/mcp.ts` | **Fixed** in this session: the fallback only applies to loopback requests when `ASTERIM_CHANNEL=dev` and `ASTERIM_DEV_AUTH_BYPASS=true`; otherwise 401. |
| S2 | **CRITICAL** | Account takeover via the OAuth exchange. `POST /api/v1/auth/oauth/token` was on the public allow-list and `oauthTokenExchange` never validated `code`; any non-empty code minted a session for the oldest user, creating one if none existed. | `controllers/AuthController.ts` (`oauthTokenExchange`), `routes/auth.ts` | **Fixed**: route removed. Desktop deep-link login is not a launch feature. |
| S3 | **HIGH** | The command "security analysis" is a set of regexes that miss trivial variants (`rm -r -f /`, `find / -delete`, `echo … \| base64 -d \| sh`, `python -c`). Approval requests for Antigravity depend on TUI text matching, so a prompt the FSM does not recognise executes with no gate. The product marketed this as "AST command safety". | `services/ApprovalManager.ts` (`evaluateCommandSecurity`), `TerminalFSM.ts` | **Mitigated** for Claude Code: the new adapter routes Claude Code's own permission requests through the gate, so nothing that Claude Code would ask about runs unasked. Marketing copy corrected. Heuristics remain a hint, not a guarantee. |
| S4 | **HIGH** | Stripe webhooks are processed unsigned when `STRIPE_WEBHOOK_SECRET` is unset (a warning is logged). Anyone could POST `customer.subscription.created` and upgrade any account. | `routes/webhooks.ts` | **Fixed**: unsigned deliveries are refused with 503 unless `ASTERIM_ALLOW_UNSIGNED_STRIPE_WEBHOOKS=true` (local testing only). |
| S5 | **HIGH** | No rate limit, e-mail verification or password reset on `/auth/login` and `/auth/register`. Credential stuffing is unthrottled. | `controllers/AuthController.ts` | **Deferred**: the account system is not part of the launch. The portal is removed from navigation; endpoints stay for future work. Tracked in `docs/product/roadmap.md`. |
| S6 | **HIGH** | Agent subprocesses inherit the full host environment (only `ASTERIM_*` is filtered). Cloud credentials, tokens and API keys in the developer's shell reach the agent, its transcript and the model. | `packages/adapters/src/sdk/ProcessManager.ts` (`sanitizeAgentEnv`) | **Open**. Inherent to running a developer's own CLI. Documented in `docs/architecture/agents.md`; a deny-list for common secret variables is a Phase 1 P1 task. |
| S7 | **MEDIUM** | Socket.IO handshake accepts only pairing tokens; JWTs from the account system are never valid for the dashboard. Not a hole, but it means "accounts" never protected anything. | `sockets/socketManager.ts` | Documented. |
| S8 | **MEDIUM** | Pairing PIN is passed in the URL (`/?pin=`) and therefore into browser history and proxy logs; the resulting token lives in `localStorage` for 30 days with no revocation. | `PinScreen.tsx`, `PairingService.ts` | **Open**, accepted for launch (local LAN convenience). The QR flow is the reason. Revocation is a P1 task. |
| S9 | **MEDIUM** | Entitlements are frozen into the JWT at login and the refresh endpoint hard-codes a fixed list, so plan changes never reach a running session and a Pro user is downgraded on refresh. | `AuthController.ts` (`refresh`) | Deferred with the account system. |
| S10 | **MEDIUM** | Remote pairing over the relay validates the PIN with no attempt counter, unlike the HTTP route. | `services/RelayClient.ts` | **Open**; relay is frozen. |
| S11 | **MEDIUM** | Secrets echoed by an agent are only redacted if they are in the vault; the shell environment is not. `server.log` captures all stdout. | `utils/logger.ts`, `SecretVaultService.ts` | **Open**; documented. |
| S12 | **MEDIUM** | No security headers (CSP, `X-Frame-Options`, `Referrer-Policy`). The dashboard is same-origin with the API, so clickjacking a paired session is plausible on a LAN. | `server.ts` | **Fixed**: minimal header set added on every response. |
| S13 | **LOW** | Refresh cookie lacks `Secure`. Fine on localhost, wrong behind TLS. | `AuthController.ts` | Deferred with accounts. |
| S14 | **LOW** | `window.__ZUSTAND_STORES` and the debug lifecycle hooks ship in production bundles. | `apps/web/src/App.tsx`, `utils/debug.tsx` | **Open**; trivial. |
| S15 | **LOW** | `pairing_pin.txt` is written to the process working directory, not the data directory. | `PairingService.ts` | **Open**; gitignored. |
| S16 | **LOW** | Any absolute path can be registered as a project. With auth enforced this is the user's own choice, but a non-existent path produced a confusing agent error. | `routes/projects.ts` | **Fixed**: existence check with a clear 400. |
| S17 | **INFO** | No telemetry, analytics SDKs or crash reporters exist. Sovereign mode verifiably disables the relay, push and remote AI providers. | `SovereignMode.ts`, `AiService.ts` | Good. Keep as a stated guarantee. |
| S18 | **INFO** | Relay in development mode accepts unsigned tunnel registrations and logs a warning; the container image requires `RELAY_SECRET`. | `apps/relay/src/relayServer.ts` | Acceptable. |

## What is genuinely good

- Password hashing (scrypt, per-user salt, constant-time compare), refresh-token rotation, hashed refresh tokens at rest.
- Secret vault: settings and environment credentials encrypted at rest, plaintext rows migrated and the database compacted, values redacted from logs.
- Pairing brute-force protection (exponential back-off, 15-minute lockout).
- Loopback-only internal endpoint with a per-boot token and constant-time comparison.
- Stripe signature verification implements the timestamp tolerance correctly.
- Zero telemetry and a real air-gap switch.

## Residual risk statement for launch

After the fixes above, the launch build (local Core, dashboard paired by PIN, Claude Code adapter) has no known remotely exploitable issue. The remaining risks are inherent to the product: the agent runs with the developer's privileges and environment, and the dashboard is served over plain HTTP on the LAN. Both are stated plainly in `docs/product/overview.md` and in the landing-page FAQ.
