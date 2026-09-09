# P1-11: Landing page, pass three

**Objective.** The home page stops reading as a SaaS template and starts demonstrating the product, and it answers "why do I need this if I already run Claude Code?" in the first five seconds.

**Context.** Pass one was decorative and untruthful; pass two (2026-09-08) made it truthful but landed on the default template: seven sections, seven card containers, a five-item feature grid, three-column prose, an accordion FAQ, a two-card pricing table, four Install CTAs, and thumbnail screenshots nobody can read. The full audit and the target structure are in `docs/design/landing-page.md` §3 and §6.

**Why this exists.** The structural tell is the one that makes a page look machine-made, and the page currently argues by listing claims rather than by showing the mechanism. It also implies a pricing model that has not been decided (FD-H).

**Files and systems involved.** `apps/marketing/src/pages/Home.tsx`, `src/index.css`, `src/site.ts`, `src/components/*`, `apps/marketing/public/screens/*`, and `tools/e2e/core-loop.mjs` (which generates the screenshots).

**Current behaviour.** Seven body sections in the order: hero, how it works, five feature cards, three-column why, security table, pricing cards, FAQ.

**Desired behaviour.** Five sections: hero (with the relationship line), the moment (one large legible approval capture plus the three-line mechanism), how it works (three steps plus one motion piece), local-first (the what-runs-where table), try it (install, one honest money line, FAQ, footer).

### Split delivery

**Now (cheap, no new assets):**
- Add the relationship line above the headline: "Works with the Claude Code you already run."
- Replace the five-card feature grid and the three-column "why" with the moment section and one large screenshot.
- Remove the two-card pricing grid from the home page; one sentence instead, with the Pro line marked PLANNED. Keep `/pricing`.
- Screenshots full-width and captioned; delete the thumbnail grid.
- Reduce Install CTAs from four to three.
- Status words: Antigravity PREVIEW wherever it is named.

**Before Phase 3 (needs an asset and a decided position):**
- The motion piece: a real ten-second screen recording of proposed → held → decided → continued, or a clearly diagrammatic animation. Never an interactive imitation of the UI. Respect `prefers-reduced-motion`.
- Final headline, chosen with evidence from the first users.

**Constraints.** No gradients, glow, glassmorphism, blobs, emoji, or decorative icons. No claim that another section does not show. No simulated product UI. Keep the existing token set; do not introduce a second visual language.

**Edge cases.** 390 px width; `prefers-reduced-motion`; screenshots on a high-DPI display; the page with images blocked.

**Acceptance criteria.**
- [ ] Five body sections; at most three card containers; at most four hierarchy levels per section.
- [ ] The relationship to Claude Code is stated above the fold.
- [ ] Every screenshot is legible at its displayed size.
- [ ] No pricing grid on the home page; the money line names no price as committed.
- [ ] Three Install CTAs.
- [ ] Every non-shipping capability carries a status word.
- [ ] Lighthouse-equivalent check: no layout shift from the images; page under 400 KB excluding screenshots.

**Testing requirements.** Rebuild, capture home, pricing and docs at 1280 and 390 with `tools/`, and review against `docs/design/landing-page.md` § Definition of done.

**Done definition.** Both halves shipped, screenshots regenerated from the current product, and the audit table in `docs/design/landing-page.md` §3 updated with what is now false about it.
