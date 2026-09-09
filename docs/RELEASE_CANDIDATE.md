# Release candidate report — 0.2.0

Written 2026-09-09, at the end of Phase 1. Everything below was measured on this
machine against the packaged build, not read from code. Where something was not
measured, it says so.

**Recommendation: do not start the cohort until the four founder actions in
section 7 are done.** Three of them are one-time setup. The fourth is the npm
publish, and until it happens the install command on the landing page fails.

---

## 1. What Phase 1 was asked for, and what happened

| # | Asked for | State |
| --- | --- | --- |
| 1 | Approval card as a real control, not a cosmetic confirmation | Done. Shipped in the previous commit; two defects found and fixed since. |
| 2 | Diagnostics that give actionable causes | Done. |
| 3 | Delete confirmation | Done. |
| 4 | Clean-machine validation | Done, and repeated after every change since. |
| 5 | npm publishing | Prepared. The publish itself is a founder action. |
| 6 | Remaining release-gate blockers | 25 of 34 rows now carry measured evidence. Nine need a machine or a person I do not have. |
| 7 | P1 items that materially improve the first-user experience | Two done: the responsive pass, and the cheap half of the landing page. |

Six commits, 59 files, +2405 / −245.

## 2. The approval gate, verified both ways

The card is connected to Claude Code's own permission protocol. Nothing about
it is simulated: the request arrives as a `can_use_tool` control request over
stdio, and the answer goes back as a `control_response` the CLI is blocking on.

Verified on every end-to-end run against the packaged binary:

- **A file write.** The card names the action, the path, whether the file
  exists, and the content that would be written. Approve: the file appears with
  that content. Deny: the file is not on disk, and the agent replies that the
  write was denied, says what it would have created, and asks how to proceed.
- **A shell command.** The card reads "Run a shell command on this machine",
  quotes the agent's own description of it, and shows the exact command. Denied,
  the file that command would have created is not on disk.
- **On a phone.** The card sits 14 px from each screen edge at 390×844, takes
  focus when it opens, has 44 px buttons, and Escape denies. The file is not
  written afterwards.

One thing worth stating plainly, because it changes how the gate should be read:
**the gate sees what the agent attempts, not what it was asked.** Asked to "run
`echo hello`", Claude Code will often just reply "hello" without invoking
anything, and no card appears because nothing was attempted. The first version
of the shell check failed for exactly that reason.

A second thing, found by running the same denied request repeatedly: an agent on
a resumed thread remembers being denied, and after a few refusals it stops
retrying and asks what you are actually trying to accomplish. That is correct
behaviour and it is worth knowing before someone reports it as a bug.

## 3. Two security findings, both closed

Both were found by walking the release gate against the running binary rather
than by reading code. Neither was in the audit as written.

**The account system was a second front door past the pairing PIN.** Asterim's
stated credential is a six-digit PIN. The account system — register, login,
refresh, JWTs — belongs to the frozen cloud subsystems, but it shipped in the
same binary with its endpoints on the auth middleware's public allow-list,
because an unauthenticated registration endpoint has to be. A POST to
`/api/v1/auth/register` from the network, with any address and any password,
returned a token; that token listed the operator's projects, read the
diagnostics bundle, and registered an MCP server with an arbitrary command,
which the supervisor then spawns. Remote code execution, no PIN, no interaction
from the operator. The audit had this as S5 and rated it HIGH on the grounds
that credential stuffing was unthrottled; it missed that an account was worth
having. Now CRITICAL and fixed: the whole system is gated on
`ASTERIM_ENABLE_ACCOUNTS`, off by default and forced off in sovereign mode, with
account tokens refused everywhere including ones minted while it was on. A test
holds each of those lines.

**One MCP server that exits immediately crash-looped the Core.** Found while
cleaning up after the proof above. Writing to the dead process's stdin does not
throw; it emits an error, and a stream with no listener turns that into an
uncaught exception. The workstation would not start on any boot until the row
was deleted from the database by hand, and any user who mistypes an MCP command
can cause it. Fixed, and recorded as S19.

Also done in this area:

- A path-traversal guard ahead of the static handler, because the shipped
  `@fastify/static` has a route-guard bypass whose fix needs Fastify 5. Verified
  against literal, percent-encoded, double-encoded and backslash forms.
- Dependency overrides that cleared 20 of 25 high advisories at patch level.
- The relay no longer dials a default URL on every boot, so "Asterim makes no
  outbound connections" is true by construction rather than because the default
  happened to point at this machine.

## 4. What is now true that was not

- `asterim stats` and a Settings panel report how much this machine has used
  Asterim, computed from the local database with no identifiers and no network
  call. The test proves both: it seeds a database whose project name, path,
  prompt and command are distinctive strings and fails if any reaches the
  output, and it replaces every outbound primitive with one that throws before
  running the whole path again.
- The README states exactly what leaves the machine and what is stored where.
- A project folder that does not exist now says so. The Core always refused it
  correctly; the dialog was discarding the message, so the click looked like it
  had done nothing.
- The dashboard no longer collides with itself at 1280×720, and the approval
  card is usable on a phone.
- The landing page leads with the approval moment, uses legible captures of the
  current build, no longer names a price for something unbuilt, and describes
  phone support accurately: approving works, driving the whole workspace does
  not.

## 5. Tests

| | |
| --- | --- |
| Typecheck | Clean, 11 packages |
| Lint | 0 errors |
| Build | Clean |
| Server suites | 33 of 34 pass |
| End-to-end core loop | 11 of 11 |
| Gate checks | 3 of 3 |

The one failing suite is `AgentMcpIntegration.test.ts`, at 156 of 160
assertions, on a ConPTY console-attachment defect in node-pty (P1-06). It is a
harness defect: the path it covers is exercised against the real product by the
end-to-end run. Two corrections to what was previously recorded about it — it is
not intermittent, and an interactive terminal does not avoid it.

That suite used to sit in the middle of an `&&`-joined chain, so nine suites
after it had never run on Windows. Moving it to the end surfaced five real
defects those suites were hiding, including a verification step that hung
forever instead of timing out because killing a shell on Windows leaves its
grandchild holding the pipes. All five are fixed.

## 6. Release gate

Twenty-five of thirty-four rows carry measured evidence with the date. Nine
remain, and every one needs a machine or a person that is not available here:

- Install on Windows 11, macOS and Ubuntu.
- The dashboard on a real phone over the LAN.
- The first-run wizard with Claude Code absent.
- Transcript, status pill and cost; clear chat starting a fresh session; empty
  and loading states — a manual walk-through.
- Committing from the Changes view in a real repository and checking the author.
- Driving the Antigravity mock to a card.
- Someone other than the author following the docs verbatim.

## 7. Founder actions before the cohort

1. **Create the npm account and add `NPM_TOKEN`**, then tag a release. Until
   `asterim` is published, the install command on the landing page fails, so the
   site must not go live first. This is FD-A.
2. **Walk the nine open gate rows**, or accept them explicitly in writing.
3. **Decide on Fastify 5.** Five high advisories are open on Fastify 4 and every
   fix is in a major. The traversal guard covers the one that matters for a LAN
   workstation, but the upgrade is the top P1 and it does not get smaller.
4. **Choose the cohort and the interview dates.** The instruments are ready:
   `docs/product/experiments.md` for the seven hypotheses,
   `.github/ISSUE_TEMPLATE/broken_session.yml` for support, and `asterim stats`
   for the numbers a user can choose to share.

## 8. What I would watch first

- **Whether anyone denies anything.** If every card is approved without reading,
  the gate is a speed bump and H2 is in trouble. The usage summary counts
  denials, expiries and withdrawals separately for this reason.
- **Withdrawn approvals.** A non-zero count means the user's own Claude Code
  hooks or rules are deciding before Asterim can ask, which would make the
  product redundant for them.
- **Start failures by diagnosis code.** `CLI_NOT_FOUND` and
  `CLI_NOT_LOGGED_IN` are setup problems; anything else is ours.
- **Whether the phone is used at all.** The card works there and the rest of the
  workspace does not. If people try to drive the whole thing from a phone, that
  is the next responsive investment; if nobody opens it on a phone, the claim
  can come off the site.
