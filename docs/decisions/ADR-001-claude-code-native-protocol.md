# ADR-001: Drive Claude Code through its headless protocol, not a terminal

**Status.** Accepted 2026-09-08, implemented and live-verified.

**Context.** The original adapter design wrapped every agent in a PTY and parsed the screen (`AntigravityParser` + `TerminalFSM`). The Claude Code adapter was a stub. Claude Code exposes a JSON-lines protocol (`-p --input-format stream-json --output-format stream-json`) and a host permission protocol (`--permission-prompt-tool stdio`: `control_request` with `subtype: can_use_tool`, answered by `control_response`). The same protocol backs Anthropic's Agent SDK.

**Decision.** `ClaudeAdapter` spawns the CLI with pipes, not a PTY; parses structured lines into Asterim events; hands `can_use_tool` requests to the Core's `permissionResolver`, which raises the standard approval; answers with `allow` + `updatedInput` or `deny` + message; honours `control_cancel_request` by withdrawing the card. The PTY tool-call text protocol (`ASTERIM_TOOL_CALL`) is not used for Claude Code. `AskUserQuestion` is disallowed so the model asks in prose.

**Consequences.**
- No screen scraping for the primary adapter; the transcript is exact.
- Asterim only sees what Claude Code asks about in its default permission mode. A user's own hooks or rules can decide first; `ASTERIM_CLAUDE_DISABLE_HOOKS=true` makes Asterim the only decider.
- The adapter depends on the CLI's protocol staying stable; the shapes are documented in the Agent SDK's type definitions, which is a better contract than a TUI.
- `BaseAdapter` remains PTY-centric; the Claude adapter overrides `start`, `sendCommand`, `stop`. A later refactor can split the base class.

**Alternatives rejected.** An HTTP `PermissionRequest` hook (tried first; the CLI routes prompts to the stdio host and the hook never fired in that mode). An MCP permission-prompt tool (works, but requires an extra server process for one function). Screen scraping (fragile, the reason the stub existed).
