# P0-11: Local usage summary (replaces opt-in telemetry for the MVP)

**Objective.** A user can see, on their own machine, what Asterim and their agents have actually done — and can copy that summary into a feedback conversation if they choose. No network calls.

**Context.** The first draft of this task specified opt-in anonymous events posted to a founder-owned endpoint. That was reconsidered on 2026-09-09 for three reasons: the trust model is part of the product's value (`SECURITY.md` states Asterim makes no outbound connections), the soft-launch cohort is 10 to 25 people where interviews beat counters, and a purely local summary is *also a user-facing feature* rather than instrumentation the user tolerates. Network telemetry is deferred to a decision before the public launch (FD-F).

**Why this exists.** Phase 2 needs the numbers in `docs/product/experiments.md` § What we measure, and needs them without contradicting the product's own promise.

**Files and systems involved.** New `apps/server/src/services/UsageSummary.ts`; `apps/server/src/cli/` (a `stats` subcommand alongside `db:status`); `apps/server/src/routes/system.ts` (`GET /api/v1/system/usage`); a Settings panel in `apps/web`; `docs/product/experiments.md`.

**Current behaviour.** The data exists — `events`, `approvals`, `sessions`, `threads`, `projects` — and nothing reads it back for the user.

**Desired behaviour.** `asterim stats` prints, and the Settings panel shows, a summary derived entirely from the local database:

```text
Asterim usage — since 2026-09-10 (14 days)

Sessions            37 across 9 days
Projects             3
Threads             12   (median 2 per session)
Agent turns         148  (claude 148, antigravity 0)
Approvals           64   approved 58 · denied 4 · expired 2 · withdrawn 0
First approval      4m12s after first launch
Views opened        chat 37 · changes 21 · terminal 9 · memory 2
Start failures       1   (binary_missing)
```

A "Copy summary" button puts the same text on the clipboard.

**Implementation requirements.**
- One read-only query pass; no writes; no network; no identifiers of any kind.
- Never include a project name, path, prompt, command, file name or tool input. Counts and durations only.
- "Withdrawn" counts approvals cancelled because the user's own Claude Code hooks or rules decided first — it is how we learn whether the gate is being pre-empted in the field.
- The Settings panel states plainly: this is local, it is never sent anywhere, and sharing it is the user's choice.

**Constraints.** No new dependencies. Must work when the database is nearly empty. Must not slow start-up: computed on demand.

**Edge cases.** A database migrated from an older version with missing columns; a user with zero approvals; a very large `events` table (query with bounds).

**Acceptance criteria.**
- [ ] `asterim stats` prints the summary and exits without starting a server.
- [ ] The Settings panel shows the same numbers, with a working copy button.
- [ ] No path, name, prompt or command appears in the output, verified against a project whose name and path contain distinctive strings.
- [ ] Zero network requests during and after generation, verified by capture.
- [ ] Works on a database with no approvals and no sessions.

**Testing requirements.** Unit test over a seeded temporary database asserting each counter and the absence of identifying strings; one manual run on the founder's real database before the cohort ships.

**Done definition.** Command, endpoint, panel and test merged; `docs/product/experiments.md` § What we measure points at it; `SECURITY.md` and the site's privacy section state that the summary is local and never transmitted.
