# Security Policy

## Reporting

Open a private security advisory on GitHub (Security → Report a vulnerability) or e-mail the maintainer listed in `package.json`. Please do not open a public issue for a vulnerability. You will get an answer within seven days.

## Supported versions

The latest published `asterim` release only.

## Security model

Asterim is a local-first control layer for AI coding agents. It runs on the developer's machine as the developer's user, and it runs the agent (Claude Code; Antigravity as a preview) as that user in a project folder. Asterim adds an approval gate in front of the agent's commands and file writes; it does not add a sandbox.

- **Authentication.** A six-digit PIN printed at start is exchanged for an HMAC-signed 30-day token. Every `/api/v1/` route and the Socket.IO handshake require it, on every interface. Five wrong PINs lock the address out for fifteen minutes.
- **Network.** The Core listens on all interfaces by default so a phone can pair over the LAN, over plain HTTP. Set `HOST=127.0.0.1` to keep it on the machine. Do not expose the port to the internet.
- **Permissions.** The Claude Code adapter never passes `--dangerously-skip-permissions`. Permission prompts are answered by the person through the approval card; a request nobody answers within five minutes is denied. A hook or rule in the user's own Claude Code settings can decide before Asterim is asked; `ASTERIM_CLAUDE_DISABLE_HOOKS=true` prevents that.
- **Data.** Everything is in `~/.asterim` (mode 0700; database 0600). Credentials stored by Asterim are encrypted at rest and redacted from logs. Asterim makes no outbound connections of its own; `ASTERIM_SOVEREIGN_MODE=true` turns off the frozen cloud features as well.
- **Environment.** The agent inherits the developer's shell environment (except Asterim's own variables). Secrets in that environment are visible to the agent, as they are when running the CLI directly.

The last full audit, its findings and their status: `docs/audit/security-audit.md`.
