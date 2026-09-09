# The First-Users Experiment

The soft launch is a research instrument, not a growth exercise. Its question is:

> **Does Asterim add enough on top of a coding agent that experienced users voluntarily keep it in their workflow?**

Nothing here presumes the answer. In particular, the earlier draft of this repository named one signal in advance ("users stop watching the terminal"); that is now one hypothesis among seven, and not the most likely to be decisive.

## Hypotheses

Each is falsifiable. Each names what would confirm it, what would refute it, and what we would build next if it held.

| Id | Hypothesis | Confirmed by | Refuted by | If it holds, build |
| --- | --- | --- | --- | --- |
| **H1 Visibility** | Asterim makes autonomous agent execution easier to understand. | Users keep the transcript open while working; they describe what the agent did without re-reading the terminal. | "The CLI output is fine"; the window sits closed. | Richer transcript: diffs inline, tool timelines, search within a thread. |
| **H2 Control** | Asterim makes permissions and destructive actions safer and easier to manage. | The gate stays on; users deny things; someone reports catching an action they did not want. | Users immediately want blanket auto-approve; the gate is described as friction. | Better cards (content preview), per-project rules, allow-lists that stick. |
| **H3 Parallelism** | Asterim makes several concurrent agent tasks or projects manageable. | More than one thread or project in regular use; users ask for a board, notifications, or per-thread isolation. | Everyone uses exactly one thread, one project. | Worktree-per-thread, a run board, notifications — and the frozen delegation code becomes relevant. |
| **H4 Context** | Asterim makes persistent project context easier to maintain. | Users open Memory unprompted, or ask "can it remember X across sessions?" | Nobody opens it; nobody asks. | Promote Project Memory: decisions surfaced into the agent's prompt, searchable across threads. |
| **H5 Workflow** | The overall AI-assisted development workflow is meaningfully better with Asterim in it. | Unprompted "this is part of my setup now"; usage survives the novelty week. | Usage decays after day 2 with no complaint — the sign of indifference, which is worse than criticism. | Whatever H1–H4 pointed at, deepened. |
| **H6 Automation** | Asterim enables workflows that are awkward or impossible directly in a terminal. | Users ask for scheduling, triggers, chained tasks, review steps, or run something twice the same way. | No such requests in four weeks. | The frozen pipeline and verification code stops being dead weight and becomes the roadmap. |
| **H7 Retention** | Users voluntarily return after the first session. | Use on day 3 and day 7 without prompting. | One session, then silence. | Nothing — this one is the gate on everything else. |

H7 is the meta-hypothesis: if it fails, the others are academic. H3 and H6 are the ones that decide whether Asterim is a supervisor or a control layer, which is why the frozen subsystems are frozen rather than deleted.

## What we measure

Quantitative, from what the user can see locally and chooses to share (`docs/tasks/P0-11-local-usage-summary.md` — no telemetry for the soft launch):

- Install succeeded, and on which OS.
- Time from install to first successful agent turn.
- Time from install to first approval decision.
- First task completed, or abandoned and where.
- Sessions per day, days used out of the trial window.
- Threads per session; projects per user.
- Approvals: total, denied, expired, and how many were withdrawn by the user's own Claude Code hooks.
- Which views were opened at all (transcript, terminal, changes, memory).

Qualitative, from conversation — the primary instrument at this cohort size:

## Interview script

Run at day 3 and day 14, twenty minutes, recorded with permission. Ask, do not lead.

**Before**
1. Walk me through how you use Claude Code today. What does a normal session look like?
2. What is annoying about it? What have you built or hacked around it?
3. How many agent sessions do you typically have going at once?

**First contact**
4. What did you think Asterim was, before you installed it?
5. What happened when you installed it? Where did you hesitate?
6. What was the first thing that made sense? The first thing that did not?

**Use**
7. What did you actually do with it? (Then: show me.)
8. What did you ignore completely?
9. Was there a moment it was useful? Describe it.
10. Was there a moment it got in your way?
11. What did you expect it to do that it does not?

**Value**
12. If it vanished tomorrow, what would you go back to doing?
13. Would you keep using it? What would make you uninstall it?
14. Would you recommend it to someone, and to whom specifically?

**Money** — ask all of it, do not stop at the first no.
15. You already pay for Claude Code. Would you pay for this as well?
16. If yes: for what, specifically? What would have to be included?
17. If no: what would have to be true for that to change?
18. Would you rather this were free and open source forever, and why?
19. What would you expect a paid version to cost, if it existed?

The monetisation risk is explicit and unresolved: **users already pay for the agent, so a second subscription needs a reason.** Do not design pricing before the answer exists. Plausible answers to test: a team dimension (more than one person), a machine dimension (remote access, several machines), a retention dimension (the record and its history), or none — the product may be free forever with the value elsewhere.

## Cohort and cadence

10 to 25 people who already run Claude Code most days, recruited by direct message, not by a public post. Two weeks. A short written check-in at day 3, a call at day 14. Everyone is told plainly: this is an experiment, the founder wants to know what is wrong with it, and nothing is being measured behind their back.

## What ends the experiment early

Any of: data loss, an approval that cannot be resolved, a silent failure to start the agent, or a route reachable on the LAN without a token. These stop the trial and go back to Phase 1.

## Output

One page per hypothesis: confirmed, refuted, or no signal, with the evidence. That page decides the positioning, the pricing question, the public-launch message, and what gets built in Phase 4. Nothing in Phase 3 or 4 is committed before it exists.
