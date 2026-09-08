# Observability and Metrics

## Observability (minimum for launch)

Asterim is a local tool with no telemetry by default (DEC-028). Observability therefore has two halves: what the user can see and send, and what the founder can learn with consent.

### On the user's machine

| Signal | Where | Status |
| --- | --- | --- |
| Application log | `<dataDir>/server.log` (stdout redirected, vault secrets redacted) | Exists |
| Crash log | `<dataDir>/crash.log` (uncaught exceptions, unhandled rejections) | Exists |
| Agent start failures | `agent.status` with `status: error` in the thread; also in `server.log` | Fixed 2026-09-08 (was reported as idle) |
| Permission decisions | `approvals` table (`approved`, `denied`, `expired`, `cancelled`) | Exists |
| Tool calls and results | `events` table (`agent.tool_call`, `agent.tool_result`) | Exists for Claude Code |
| Turn cost and duration | `agent.status` message after each turn (`Done · 12s · $0.031`) | Exists |
| Diagnostic bundle | Settings → "Copy diagnostics" (versions, OS, adapter detection, last 200 log lines) | Task P0-12, open |

### With consent (task P0-11, founder decision FD-4)

Six events, one random install id, no paths, no prompts, no code. Sent to a founder-owned endpoint. Off in sovereign mode, off until the user ticks the box in the first-run wizard, source visible in `apps/server/src/services/Telemetry.ts` when it exists.

`install`, `first_pair`, `first_project`, `first_approval`, `first_diff_viewed`, `thread_resumed`. Plus `agent_start_failed` with the adapter id and a coarse reason (`binary_missing`, `exit_nonzero`, `not_logged_in`).

## Metrics (the few that matter)

**North Star candidate: approved actions per active user per week.** An approval is the moment Asterim delivered its promise (the agent wanted to do something, the person saw it and decided). It rises with usage and with trust, and it cannot be gamed by opening the app.

**Activation:** first approval within 10 minutes of install. Target 70% of installs that reach pairing.

**Retention:** users with at least one approval on 3 of the 7 days after their first. Target 30% in the soft launch.

**Reliability:** share of threads with at least one `agent_start_failed`; share of approvals that expired (300 s) rather than being answered. Targets: under 5% and under 10%.

**Monetisation (later):** waitlist sign-ups per 100 active users; conversion once Pro exists.

## Product analytics dashboard (soft launch)

One page, updated daily from the event endpoint (or from interview notes if launching blind):

| Column | Meaning |
| --- | --- |
| Installs | `install` events |
| Paired | `first_pair` / installs |
| First approval ≤ 10 min | `first_approval` within 10 min of `install` / paired |
| Day-3 return | users with an approval on day 3 |
| Start failures | `agent_start_failed` by reason |
| Resumes | `thread_resumed` per user |
