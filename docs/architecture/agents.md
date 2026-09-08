# Agents and Adapters

## WHAT

The adapter layer runs a coding agent as a child process of the Core, turns what the agent does into `AsterimEvent`s, and carries the human's decisions back to the agent. Two adapters exist: **Claude Code** (primary, structured protocol) and **Antigravity** (best effort, terminal scraping). Aider is not implemented.

## WHY

The dashboard, the approval gate, the transcript and the record all consume one event stream regardless of which agent produced it. That is the whole point of Asterim: one gate and one record across vendors. The adapter is the only place that knows a vendor's protocol.

## WHERE

| Piece | Path |
| --- | --- |
| Adapter SDK (base class, session manager, process manager, registry, types) | `packages/adapters/src/sdk/` |
| Claude Code adapter | `packages/adapters/src/providers/claude/ClaudeAdapter.ts` |
| Antigravity adapter and terminal FSM | `packages/adapters/src/providers/antigravity/` |
| Mock agent script (used with `MOCK_AGENT=true`) | `packages/adapters/mock-antigravity.js`, copied to `apps/server/dist/` |
| Core orchestration (start, stop, crash restart, permissions, session ids) | `apps/server/src/services/AgentService.ts` |
| Approval gate | `apps/server/src/services/ApprovalManager.ts` |
| Event contract | `packages/shared/src/events.ts` |
| Tests | `packages/adapters/src/providers/claude/__tests__/ClaudeAdapter.test.ts`, `packages/adapters/src/sdk/__tests__/ProcessManager.test.ts` |

## HOW

### Claude Code

```text
dashboard ──client.chat_message──▶ AgentService ──sendCommand──▶ ClaudeAdapter
                                                                    │ stdin: {"type":"user",...}
                                                                    ▼
                                                            claude -p --input-format stream-json
                                                                   --output-format stream-json
                                                                   --permission-prompt-tool stdio
                                                                    │ stdout: system/init, stream_event,
                                                                    │         assistant, user, result,
                                                                    │         control_request(can_use_tool)
                                                                    ▼
ClaudeAdapter ──agent.stream / chat.message / agent.tool_call / agent.tool_result / agent.status──▶ EventBus
ClaudeAdapter ──permissionResolver(ask)──▶ AgentService.requestNativePermission ──▶ ApprovalManager
        ◀── {approved} ◀──────────────────────────────── client.approval_response (the person clicked)
        │ stdin: {"type":"control_response", response:{behavior:"allow"|"deny"}}
```

1. `AgentService.startAgent` resolves the profile, the workspace directory and the remembered provider session id, builds a `permissionResolver` closure bound to the thread, and calls `SessionManager.startSession('claude', …)`.
2. `ClaudeAdapter.start` spawns the CLI (found via `ASTERIM_CLAUDE_BIN`, `~/.local/bin/claude`, then `PATH`; an npm `.cmd` shim is replaced by running its `cli.js` with the current Node). It writes an `initialize` control request, marks itself ready, and reports `idle`.
3. Each user message is one JSON line on stdin. The adapter reports `working`.
4. Output lines are parsed one per line. `stream_event` text deltas become `agent.stream` (accumulated text, one message id); `assistant` becomes `chat.message` plus `agent.tool_call` per tool block; `user` tool results become `agent.tool_result`; `result` becomes `idle` with duration and cost, or `error`.
5. A `control_request` with `subtype: can_use_tool` is a permission prompt. The adapter calls the resolver; the Core runs its heuristics for the risk label, raises the normal approval (`ApprovalManager.requestApproval`, 5-minute timeout, persisted), and returns the decision; the adapter answers with a `control_response` (`allow` with `updatedInput`, or `deny` with a message the model reads).
6. If the CLI sends `control_cancel_request` for a pending ask (a `PreToolUse` hook or a permission rule in the user's Claude Code settings decided first), the adapter aborts the ask's `AbortSignal`, the Core cancels the approval card, and a warning is logged in the thread. `ASTERIM_CLAUDE_DISABLE_HOOKS=true` passes `--settings {"disableAllHooks":true}` so that Asterim's card is the only decider.
7. `system/init` carries the provider session id; the adapter publishes `agent.session`, and `AgentService` stores it in `settings` under `provider_session:<threadId>`. The next start of that thread passes `--resume <id>`. Clear chat deletes the key and stops the process.

Verified on 2026-09-08 with Claude Code 2.1.251 on Windows: a Write request produced the card, an allow created the file, a withheld answer kept the file from being created for 20 seconds until answered (`scratchpad/probe-nohooks.mjs` in the audit session).

### Antigravity

`AntigravityAdapter` spawns `agy` in a PTY (`ProcessManager`, node-pty, 1000 columns), feeds every chunk into an `@xterm/headless` terminal, diffs screen snapshots and runs `TerminalFSM` over the diff to detect messages, approval prompts and multiple-choice questions. Approval answers are the literal `y`/`n` written to stdin. MCP tools reach it through a text protocol (`ASTERIM_TOOL_CALL` lines) described in the session instructions. `MOCK_AGENT=true` swaps `agy` for `mock-antigravity.js`. This adapter breaks whenever Google changes the TUI and is labelled best effort in the UI.

## CONTRACT

- Adapters publish only the event types in `packages/shared/src/events.ts`; the Core enriches every payload with `projectId` and `threadId` and the dashboard filters on both.
- `handlesApprovalsNatively === true` means the Core must never write `y`/`n` into the adapter's stdin; the decision travels through the adapter's own protocol.
- `LaunchConfig.permissionResolver` is the only way a native adapter may ask a human. Without it, the adapter must deny.
- An adapter never passes `--dangerously-skip-permissions` or `bypassPermissions`.
- Agent subprocess environment = `sanitizeAgentEnv(process.env)` (all `ASTERIM_*` stripped except `ASTERIM_DATA_DIR` and `ASTERIM_CHANNEL`) + workspace secrets + adapter extras. Everything else in the developer's shell is visible to the agent.
- The provider session id is stored in the `settings` table; a migration to a `threads` column is planned (debt D24).

## MODIFYING

- To add an adapter: subclass `BaseAdapter`, implement `getLaunchCommand` and `createParser` (or override `start`/`sendCommand`/`stop` for a non-PTY protocol as the Claude adapter does), register it in `packages/adapters/src/index.ts`, add its id to the `agentType` unions in `AgentService.ts`, the dashboard engine dropdown in `App.tsx`, `StartupService` binary detection, and the first-run wizard. Write a protocol test that feeds captured output lines and asserts events.
- To change what the approval card shows for Claude Code, edit `describePermission` in `AgentService.ts`.
- To change Claude Code flags, edit `ClaudeAdapter.getLaunchCommand` and the launch-command assertions in the test.

## DO NOT

- Do not scrape Claude Code's terminal. The stream-json protocol exists; use it.
- Do not auto-approve anything on the Core side. The risk heuristics label; they do not decide.
- Do not send a `control_response` after a `control_cancel_request`.
- Do not disable the user's hooks by default.
- Do not add `AskUserQuestion` back without implementing the answer path (the host would have to return `updatedInput` with answers).
- Do not let a session start reported as `idle` when the spawn failed; it must be `error` (this hid the stub adapter for months).
