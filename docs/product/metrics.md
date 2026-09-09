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

### Local only, for the MVP (task P0-11)

**Decision, 2026-09-09: no network telemetry ships with the MVP.** Three options were considered — opt-in anonymous events, nothing at all, or local metrics the user can see and voluntarily share. The third wins for the soft launch because the trust model is part of the product's value, because a 10-to-25-person cohort is better served by interviews than counters, and because a local summary is a feature the user gets rather than instrumentation they tolerate.

`asterim stats` and a Settings panel compute the numbers below from the local database, on demand, with no network calls and no identifiers. A copy button lets the user paste them into a conversation if they want to.

Shipped 2026-09-09 as `apps/server/src/services/UsageSummary.ts`, `asterim stats` and the Settings panel. It reports: sessions and days used; projects and threads; agent turns by provider; tool calls; approvals split into approved, denied, expired and withdrawn; time from first launch to the first approval; and start failures grouped by `DiagnosisCode`. Views opened is **not** reported — no view-opened event exists, and adding one purely to answer a research question is the instrumentation this decision rejected.

"Withdrawn" is the count of approvals cancelled because the user's own Claude Code hooks or permission rules decided first. It is how we learn whether the gate is being pre-empted in the field, and it exists in no competitor's instrumentation.

Whether anything is ever transmitted is deferred to FD-F, to be decided with the Phase 2 evidence in hand. It is explicitly not a launch requirement.

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
