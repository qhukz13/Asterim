# P0-12: "Copy diagnostics" button in Settings

**Objective.** A user who hits a problem can paste one block of text into a GitHub issue that tells us what we need, without leaking their code or paths.

**Context.** There is no error tracking by design. `crash.log` and `server.log` exist in the data directory but users do not know where, and pasting `server.log` leaks project paths and prompts.

**Why this exists.** Soft-launch support depends on it (roadmap Phase 2, metrics doc "Diagnostic bundle").

**Files and systems involved.** `apps/server/src/routes/system.ts` (new `GET /api/v1/system/diagnostics`), `apps/server/src/utils/channel.ts` (version, channel), `apps/server/src/services/StartupService.ts` (binary detection), `apps/web/src/components/DeveloperSettings.tsx` or `AISettings.tsx` (button), `apps/web/src/utils/auth.ts` (headers).

**Current behaviour.** Settings has AI settings and developer settings; no diagnostics.

**Desired behaviour.** Settings → "Diagnostics" card with a "Copy diagnostics" button. Clicking copies a Markdown block:

```text
Asterim 0.2.0 (dev channel) · Node 22.x · win32 10.0.19045
Claude Code: found (2.1.251) · Antigravity: not found
Data dir: <redacted> · DB schema: 6 · uptime: 14m
Last 200 log lines (paths under the data dir and project folders replaced with <path>):
...
```

**Implementation requirements.**
- The route builds the bundle server-side and returns `{ text }`. Read the last 200 lines of `server.log` and the last 50 of `crash.log` if present.
- Redact: every registered project path, the data directory, the home directory, anything matching the vault redactor. Replace with `<path>` / `<home>`.
- Never include prompts or chat content: filter out lines containing `client.chat_message` payloads.
- The button uses `navigator.clipboard.writeText` and shows "Copied" for two seconds; fall back to a read-only textarea when the clipboard is blocked.

**Constraints.** Authenticated route like every other under `/api/v1/`. No new dependencies.

**Edge cases.** Log file missing (fresh install); log line longer than 2,000 characters (truncate); Windows path separators in redaction.

**Acceptance criteria.**
- [ ] Bundle contains versions, OS, adapter detection, schema version, uptime, and the log tail.
- [ ] No absolute path from outside the data directory survives redaction (test with a project under `C:\Users\<name>\...` and under `/home/<name>/...`).
- [ ] No chat content survives.
- [ ] Works when `server.log` does not exist.

**Testing requirements.** Unit test for the redaction function with Windows and POSIX paths; manual check of the button on the release gate.

**Done definition.** Route + button + test + one line in Docs → Troubleshooting telling users to paste the bundle.
