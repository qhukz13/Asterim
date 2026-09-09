# Roadmap

Four phases. Phase 1 is committed work. Phase 2 is an experiment. Phases 3 and 4 are deliberately undecided, because the experiment decides them — writing them down as commitments now would repeat the mistake that produced the previous roadmap.

Status labels follow `docs/product/overview.md`: **CURRENT**, **MVP**, **POST-MVP**, **VISION**.

---

## Phase 1 — Release-ready MVP

**Goal.** A stranger who already uses Claude Code can install Asterim, understand what it is for, run a real task, see what the agent is doing, safely approve or deny its actions, review the result, and come back the next day — without the founder's help.

**Not in this phase.** Any second provider, any speculative feature, anything from the frozen list, any monetisation, any cloud.

### P0 — blocks the first release

| Id | Task | Status |
| --- | --- | --- |
| P0-01 | Close the LAN auth bypass; remove the OAuth exchange (security S1, S2). | Done 2026-09-08 |
| P0-02 | Dashboard talks to the origin that served it, never a hard-coded port. | Done 2026-09-08 |
| P0-03 | Claude Code adapter over the native stream protocol, with permission requests routed to the approval card and session resume. | Done 2026-09-08, live-verified |
| P0-04 | Agent start failures reported as errors; Aider removed from the UI; no forced tab switch on send. | Done 2026-09-08 |
| P0-05 | Landing, pricing and docs pages made truthful; fake download and account pages removed. | Done 2026-09-08 |
| P0-06 | Publish `asterim` to npm from the release workflow so the install command is real. | Open — needs the npm account (FD-A) |
| P0-07 | Clean-machine end-to-end test: fresh account or VM, install, pair, run a Claude Code task through the gate. Script exists (`tools/e2e/core-loop.mjs`); it has only run on the founder's machine. | Open |
| P0-08 | First-run wizard detects installed CLIs and never defaults to a missing one. | Done 2026-09-08 |
| P0-09 | Project add validates the folder; delete asks for confirmation. | Validation done; confirmation open |
| P0-10 | Privacy and licence statements reachable from the site and the README, stating exactly what leaves the machine. | Site done; README open |
| P0-11 | Local usage summary the user can see and choose to share. **No network telemetry for the soft launch.** | Open — rewritten, see task spec |
| P0-12 | "Copy diagnostics" button in Settings: versions, OS, adapter detection, redacted log tail. | Open |
| P0-13 | Status labels (AVAILABLE NOW / PREVIEW / PLANNED) applied consistently in the product UI and on the site; Antigravity labelled PREVIEW in the engine picker. | Open |

### P1 — strongly recommended before strangers see it

| Id | Task |
| --- | --- |
| P1-02 | Approval card shows the real tool input: the command for Bash, the content or diff for Write and Edit. **The highest-value item in this list** — it is the difference between a gate and a rubber stamp. |
| P1-01 | Extract `ProjectWorkspace` from `App.tsx`; tab strip and overlays as components. Unblocks P1-02 and P1-07. |
| P1-07 | Responsive pass at 1280×720 and 390×844: thread header, tab overflow, overlay stacking. |
| P1-08 | Empty, loading and error states for Changes, Memory and the thread list. |
| P1-11 | Landing page second pass against the quality bar (`docs/design/landing-page.md` §6). Cheap parts now, full pass before Phase 3. |
| P1-04 | Pairing device list and revocation; PIN rotation on demand. |
| P1-05 | Deny-list for common secret environment variables reaching the agent, overridable per environment. |
| P1-03 | Per-thread "always allow this command prefix", written through Claude Code's own permission rules. |
| P1-09 | Docs site generated from `docs/` instead of hand-maintained page content. |
| P1-10 | Antigravity: remove the hard-coded founder e-mail filter; make header filters configurable. |
| P1-06 | Remaining Windows test-harness defect (ConPTY console attachment in the PTY integration suite). |

### P2 — after the first users, regardless of what they say

Bundle splitting, vitest migration with coverage, `packages/memory-core` extraction, entitlement refresh fix.

---

## Phase 2 — First users (soft launch)

**Goal: learn.** Not growth, not revenue, not press.

10 to 25 people who already run Claude Code most days, recruited by direct message. Two weeks. The full design — seven hypotheses, what confirms and refutes each, what is measured, the interview script including the monetisation questions — is `docs/product/experiments.md`.

Entry criteria: Phase 1 P0 complete, the release gate signed off on a machine that is not the founder's.

Exit criteria: one page per hypothesis marked confirmed, refuted or no signal, with evidence.

Nothing about positioning, pricing, packaging or the public launch message is decided before that page exists.

---

## Phase 3 — Public launch

**Decided by Phase 2, not before.** The open questions it answers:

- Which hypothesis is the wedge, and therefore what the headline says.
- Whether Asterim is free forever, and if not, what dimension is charged for (people, machines, history, or something the users name).
- Which capability gets promoted and which stays quiet.
- Where the audience actually is.

Provisional and revisable: a Show HN with a real recording, the Claude Code community spaces, and a technical write-up of the permission protocol, which is the one genuinely novel piece of engineering. Founder-led onboarding for the first cohort of installs.

---

## Phase 4 — Post-launch product development

**Possibilities, not commitments.** Each is tied to the hypothesis that would justify it; most already have frozen code behind them (`docs/decisions/ADR-005-frozen-code-disposition.md`).

| Direction | Justified by | State today |
| --- | --- | --- |
| Searchable record across threads and days | H1, H7 | Data exists; no search UI |
| Worktree-per-thread with merge or discard | H3 | Frozen delegation code |
| Repeatable and chained tasks, triggers, verification | H6 | Frozen pipeline code |
| Project context surfaced into the agent's prompt | H4 | Project Memory, hidden |
| Notifications when an agent finishes or asks | H3 | Frozen desktop daemon |
| Additional providers (Codex when its CLI exposes a permission protocol) | Demand | ADR-004 |
| Remote access beyond the LAN | Demand | Frozen relay |
| Team dimension | Demand + monetisation | Frozen team agents |
| Cloud or hybrid execution | Demand, and only if it beats local | Nothing |

Local-first is not traded away for any of these. Cloud arrives where it clearly wins, not because SaaS is monetisable.

---

## The shape of the whole thing

```text
VISION      local-first control layer for AI coding agents
   │
MVP         Claude Code, one machine, exceptionally well executed
   │
   ▼
10–25 users → learn which hypothesis is true
   │
   ▼
positioning, pricing, public launch decided by evidence
   │
   ▼
build only what the users showed matters → expand beyond one agent
```
