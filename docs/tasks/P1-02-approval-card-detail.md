# P1-02: Show the real tool input on the approval card

**Objective.** For a Claude Code permission request, the card shows what will actually happen: the full command for Bash, the file path and a preview of the content or the edit for Write/Edit, the URL for WebFetch.

**Context.** Today the card shows `Description` (for example `Write: ASTERIM_LIVE_TEST.txt`) and `Command` (the path). The content that would be written is not visible, so a person approves a write blind. Claude Code sends the full `tool_input` in the `can_use_tool` request; the adapter already forwards it to `AgentService.requestNativePermission`.

**Why this exists.** The approval gate is the product's promise; an approval you cannot evaluate is theatre (security audit S3 follow-up; positioning §4.1).

**Files and systems involved.** `apps/server/src/services/AgentService.ts` (`describePermission`, `requestNativePermission`), `apps/server/src/services/ApprovalManager.ts` (`requestApproval` payload), `packages/shared/src/events.ts` (`agent.approval_request` payload type), `apps/web/src/App.tsx` (`ApprovalOverlay`), `apps/web/src/hooks/useSocket.ts` (approval state), `apps/web/src/components/InspectorPanel.tsx` (pending action review).

**Current behaviour.** `agent.approval_request.payload = { actionId, description, command, securityAnalysis }`. The overlay renders `description` and `command` as text.

**Desired behaviour.** The payload additionally carries `tool: { name, input }` (input truncated to 20 KB per string field). The overlay renders, by tool:
- `Bash` / `PowerShell`: the command in a monospace block; the agent's `description` above it.
- `Write`: path, then the first 60 lines of `content` in a monospace block with a "… N more lines" footer.
- `Edit` / `MultiEdit`: path, then `old_string` → `new_string` as a two-colour diff (reuse the diff block styles from `ChangesView`).
- `WebFetch`: URL.
- anything else: JSON of the input, pretty-printed, collapsed above 40 lines.

**Implementation requirements.**
- Add the optional `tool` field to the shared payload type; producers that do not know the tool (Antigravity) omit it, and the overlay falls back to today's rendering.
- Truncate on the server, never in the browser, so the persisted `approvals` row and the event stay bounded.
- Keep the 5-minute countdown, Deny/Approve buttons and keyboard handling unchanged.
- Add the same detail to the Inspector's pending-action card.

**Constraints.** No new dependencies. Do not change `client.approval_response`. Do not log `content` to `server.log`.

**Edge cases.** Binary or very long content; `Edit` with `replace_all`; a `tool_input` that fails to serialise; two pending approvals from different threads.

**Acceptance criteria.**
- [ ] A Write request shows the content preview; an Edit shows old → new; a Bash shows the command.
- [ ] Antigravity approvals still render as before.
- [ ] `approvals.command` stays under 20 KB for a 1 MB write.
- [ ] Keyboard: Escape denies, Enter approves, focus starts on Deny.

**Testing requirements.** Extend `ClaudeAdapter.test.ts` for the forwarded input; add a rendering test for the truncation helper; manual gate rows A6 and A7.

**Done definition.** Card shows real inputs for the three tool families, tests green, screenshot updated in `docs/screenshots/e2e/02-approval-card.png`.
