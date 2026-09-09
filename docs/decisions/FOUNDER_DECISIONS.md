# Founder Decisions

Sorted by when they actually have to be answered, so that implementation is never interrupted for a decision that can wait. Close an item by editing it in place.

The strategic correction of 2026-09-09 answered the biggest one: Asterim is a local-first control layer for AI coding agents (product), shipping first as a narrow Claude Code MVP. That is recorded in `docs/product/overview.md` and closes the former FD-1.

---

## Blocking now

**None.** Every Phase 1 task can proceed without a founder decision, with one exception that has a workaround (FD-A below). This section should normally stay empty.

---

## Before the soft launch

### FD-A: npm name and publication

The name `asterim` was free on npm as of 2026-09-08. Claiming it costs minutes; leaving it costs the possibility of losing it, and blocks P0-06.

**Options.** (a) Claim the name now, publish `0.2.0` when Phase 1 P0 closes. (b) Claim the name, soft-launch from source, publish before Phase 3. (c) Do nothing.

**Recommendation.** (b). The first 10 to 25 users can clone and build; the npm package matters for strangers, which is Phase 3. But claim the name today either way.

**Needs from you.** An npm account and a publish token in repository secrets.

### FD-B: licence metadata mismatch

`LICENSE` says MIT; the GitHub repository displays Apache-2.0; the site and README say MIT.

**Recommendation.** MIT, and fix the GitHub metadata. Five minutes, and it is a trust signal on a page where trust is the product.

### FD-C: repository name and remote

The git remote still points at `qhukz13/AgentDeck`. The product has been Asterim for months.

**Recommendation.** Rename the repository to `Asterim` (GitHub redirects the old URL) and update the remote.

### FD-D: how the first users reach you

The site and README point at GitHub Discussions and Issues. The experiment also needs a direct channel for day-3 check-ins and day-14 calls.

**Recommendation.** Discussions for public questions; a personal e-mail or a small Discord for the cohort. Decide before the first invitation goes out.

### FD-E: Antigravity visible or hidden in the MVP

It works, badly, and is the second provider that keeps the architecture honest (ADR-004).

**Options.** (a) Visible, labelled PREVIEW, only when the binary is detected. (b) Hidden behind a setting. (c) Removed from the UI entirely.

**Recommendation.** (a). It is honest, costs nothing, and a user who has `agy` installed is exactly the person whose feedback on multi-provider matters.

---

## Before the public launch

### FD-F: telemetry beyond the local summary

Phase 1 ships a local usage summary with no network calls (P0-11). At public-launch scale, interviews stop scaling.

**Options.** (a) Opt-in anonymous events. (b) None ever; interviews and issues only. (c) Local metrics the user can voluntarily export, which is what Phase 1 does.

**Recommendation.** Ship (c), decide between (a) and (b) with the Phase 2 evidence in hand. Do not make network telemetry a launch requirement; it contradicts the trust model that is part of the value proposition.

### FD-G: domain

`asterim.dev` does not resolve. The site currently has nowhere to live.

**Recommendation.** Register it if the name survives Phase 2; host the static build on GitHub Pages or Cloudflare Pages. A soft launch can run entirely from the repository.

### FD-H: pricing and the monetisation dimension

Deliberately unanswered. The interview script (`docs/product/experiments.md`) asks it directly. Code contains `$19`/`$49`, the old site said `$20`, none of it validated.

**Recommendation.** Decide nothing until the Phase 2 report. The honest default is free and open source, with monetisation attached to whichever dimension users name.

---

## After launch

### FD-I: disposition of the frozen subsystems

ADR-005 keeps them, tied to hypotheses H3 and H6. The enterprise fleet-policy and SIEM code is the one subsystem with no route back and can be archived to a branch now.

**Recommendation.** Decide at the end of Phase 2, with the report. Not on a timer.

### FD-J: the account and billing system

Broken end to end and unreachable from the product. Reviving it requires the full list in `docs/architecture/authentication.md`.

**Recommendation.** Nothing until FD-H has an answer.
