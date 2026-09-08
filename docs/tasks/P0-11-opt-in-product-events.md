# P0-11: Opt-in, anonymous product events

**Objective.** With the user's explicit consent, six events reach an endpoint the founder owns, so the soft launch can be measured. Off by default. Nothing about code, paths or prompts.

**Context.** Asterim has no telemetry (a stated guarantee, `SECURITY.md`). The soft launch needs install-to-first-approval and day-3 return numbers (`docs/product/metrics.md`). Founder decision FD-4 must be accepted before this task starts.

**Why this exists.** Without it, launch decisions are anecdotes.

**Files and systems involved.** New `apps/server/src/services/Telemetry.ts`; `apps/server/src/routes/system.ts` (settings `telemetry_opt_in`, `install_id`); `apps/web/src/components/overlays/FirstRunWizard.tsx` (the consent checkbox, unchecked by default, with the six event names listed); `apps/web/src/components/DeveloperSettings.tsx` (toggle); `apps/server/src/services/SovereignMode.ts` (hard off); `docs/product/metrics.md`; the Docs page Privacy section.

**Current behaviour.** No events, no endpoint.

**Desired behaviour.** When `telemetry_opt_in = true` and sovereign mode is off, `Telemetry.track(name)` POSTs `{ installId, event, version, os, node, ts }` to `ASTERIM_TELEMETRY_URL` (default: the founder's endpoint, overridable, empty disables). Events: `install`, `first_pair`, `first_project`, `first_approval`, `first_diff_viewed`, `thread_resumed`, plus `agent_start_failed { adapter, reason }` where reason ∈ `binary_missing | exit_nonzero | not_logged_in | other`.

**Implementation requirements.**
- `installId` is a random UUID created once and stored in `settings`; regenerating it in Settings is one click.
- Fire-and-forget with a 3-second timeout; failures are silent and never retried more than once.
- The payload schema is a TypeScript type in one place and printed verbatim in the Docs Privacy section.
- The wizard checkbox text: "Send six anonymous usage events (install, pairing, first project, first approval, first diff viewed, thread resumed) and start failures to the maintainer. No code, paths or prompts. Off by default."

**Constraints.** No third-party analytics SDK. No event carries a project name, path, prompt, tool input, hostname or username. Sovereign mode overrides the setting.

**Edge cases.** Endpoint unreachable; user opts out later (stop immediately, keep the install id); multiple Cores on one machine (separate install ids per data dir is acceptable).

**Acceptance criteria.**
- [ ] With the box unchecked, zero outbound requests (verified with a packet capture or a mock endpoint).
- [ ] With it checked, each of the seven events arrives once with exactly the documented fields.
- [ ] Sovereign mode sends nothing regardless of the setting.
- [ ] The Docs Privacy section and `SECURITY.md` describe the events and the switch.

**Testing requirements.** Unit test with an injected fetch recording calls; manual capture during the release gate.

**Done definition.** Endpoint live (founder), service + UI + docs merged, FD-4 marked closed.
