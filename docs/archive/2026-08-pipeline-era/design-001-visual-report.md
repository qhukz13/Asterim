# DESIGN-001 — Rendered Visual Report

**Date**: August 12, 2026
**Target**: `@asterim/marketing` (`apps/marketing`), served from Vite dev on `localhost:5199`
**Method**: Headless Chromium (puppeteer 25.3.0), full-page capture after `document.fonts.ready` + full scroll pass, plus computed-style probes taken in-page
**Evidence**: `docs/screenshots/design-001/` (22 captures + `probe.json`)

Routes captured: `/`, `/pricing`, `/docs`, `/download`.
Viewports: 1440, 1280, 1024, 768, 375 (homepage); 1440 + 375 (other routes).

---

## 1. DESIGN-001 verification — did the token reset actually land?

Both fixes are confirmed **in the rendered page**, not just in source.

| Check | Before | Now (measured) |
| :--- | :--- | :--- |
| `document.fonts.check('800 48px Satoshi')` | n/a — never loaded | `true` |
| Computed `h1` font-family | fell back to Inter | `Satoshi, Geist, Inter, sans-serif` |
| `--accent-green` resolved value | *empty* (undefined) | `#10b981` |
| `--accent-green-bg` resolved value | *empty* (undefined) | `rgba(16, 185, 129, 0.08)` |
| `body` background | — | `rgb(7, 10, 16)` = `#070a10` ✅ |

Satoshi is visibly rendering — the geometric display letterforms in the hero are unmistakably not Inter (`home-1440-fold.png`). The emerald accent now appears where it previously rendered as nothing: the `/docs` active sidebar item has its pill, label, icon, and chevron (`docs-1440-full.png`), `/pricing` shows emerald tier labels and check icons (`pricing-1440-full.png`), `/download` shows accent headings.

**Caveat on weight.** Satoshi ships 300/400/500/700/900 — there is **no 800**. The art direction specifies `font-weight: 800` for display and section headings, so CSS font matching resolves upward to **900 (Black)**. Headings are therefore rendering heavier than the spec intends. This is not faux-bold (no synthesis), but it is not what the doc describes. Decide: declare `700`, or accept `900` and correct the art-direction doc.

---

## 2. Findings

### P0 — Defects

**1. The workstation sandbox is rendered twice.**
`AsterimWorkstationSandbox` (38.9 KB, the single largest component) mounts in **both** `Act1Hero.tsx:126` and `Act3SandboxSection.tsx`, with no props distinguishing them. The identical composition appears at ~600px and again at ~2,600px of a 7,055px page (`home-1440-full.png`). Act 3's heading — "Experience the Workstation. Test real product capabilities live in your browser." — is describing a thing the visitor has already been looking at. This also mounts two copies of the heaviest interactive component on the page.

**2. `/docs?topic=mcp` renders a blank page.**
Footer link "MCP Tools & Skills" (`Footer.tsx:155`) navigates to `?topic=mcp`, but the topic id is `mcp-skills` (`DocsPage.tsx:31`). No branch matches, so the content panel renders **completely empty** with no sidebar selection — reproduced in `docs-topic-mcp.png` vs. the working `docs-topic-mcp-skills.png`. Every other footer topic link resolves correctly. One-word fix.

### P1 — Design direction not yet met

**3. Internal scaffolding is shipping as user-facing copy.**
Seven sections are labelled `ACT 2 //`, `ACT 3 //` … `ACT 8 //` in the visible section tag. "ACT 4 // MULTI-AGENT SWARM TELEMETRY" reads as production notes left in the build. No competitor in your benchmark set numbers their sections to the visitor.

**4. The formulaic scaffold flagged in visual-audit-v2 is still there.**
Six of eight sections are structurally identical: emerald uppercase tag → large heading → lead paragraph → content block. `phase4-5-visual-audit-v2.md` Problem 2 named this exact pattern ("Tag + Title + Cards") as the reason the site reads as component assembly. It was changed from centered to left-aligned; the repetition itself was not addressed.

**5. Act 5 is a 3-column card grid.**
"Enclave Secret Scoping / Project Jail Boundaries / Preset Profile Switching" is precisely the construct banned by art-direction **Law 4 (Anti-Card Policy)** and by DEC-021.

**6. The hero is still centered.**
`asterim-marketing-art-direction.md` and audit v2 both call for an asymmetric composition. The current hero is a centered 2-line headline over centered subhead over centered CTA row — the layout the audit identified as the template trope. The green text fill *was* removed, which was the other half of that finding.

**7. Three competing hero CTAs.**
"Get Started Free" (solid emerald), "Read Documentation" (outline), and an `npx asterim` copy block sit in one row with no clear primary. Two of the three are effectively the same intent.

### P1 — Responsive

**8. Mobile navbar breaks at 375px.**
The "Get Started" button wraps onto two lines inside a 56px-tall bar (`home-375-fold.png`), sitting alongside logo, GitHub icon, sign-in icon, and hamburger — five competing actions. It reads as a layout bug.

**9. The workstation sandbox does not adapt below ~768px.**
At 375px the desktop-density UI is crammed into the viewport: "Company Workspace (Acme Corp)" wraps to three lines in a chip, and the amber "Action Required · Paused for Review" pill is clipped at the right edge. The mobile page is 11,188px tall, largely because these compositions never reflow.

### P2 — Polish

**10. Pricing tier panels look unfinished.** Square corners, no visible border, and unequal content lengths ending on a hard bottom edge (`pricing-1440-full.png`).
**11. Dead space on `/docs`.** Short topics (Quickstart is 3 steps) leave a large void between the content panel and footer — the panel is fixed-height while content is not.

---

## 3. What is genuinely working

- **The workstation composition itself is convincing.** Real file paths, real branch names, a plausible agent transcript, AST guard panel, approval gate with amber paused state. It satisfies art-direction Law 1 ("the website IS the product") better than anything in the earlier audits.
- **Restraint on emerald is holding.** No decorative green text fill, no unanchored radial blobs. Accent is confined to status, active nav, and CTAs.
- **No purple, no violet, no indigo anywhere** in the app — a recurring complaint in earlier rounds, now fully absent.
- **Vertical rhythm is consistent** across sections at every viewport.
- **Footer is clean** and its remaining links all resolve.
- **`/docs` topic content is complete** — all 11 topics have real bodies; the single-topic view is a tabbed reader by design, not missing content.

---

## 4. Recommended order

1. Delete the Act 1 **or** Act 3 sandbox mount (P0-1). Biggest single visual win; also halves the heaviest component.
2. Fix `topic=mcp` → `mcp-skills` (P0-2). One word.
3. Strip the `ACT N //` prefixes (P1-3). One-line change per section, removes the strongest "unfinished" signal.
4. Resolve the Satoshi weight question (700 vs 900) and align the art-direction doc.
5. Break the six-section scaffold — this is the real work, and the thing four prior redesign rounds have not landed.
6. Mobile navbar + sandbox reflow.

---

## Appendix — incident note

During this session the six previously committed screenshots in `docs/screenshots/` (`01_hero_overview.png` … `06.png`) were removed from disk. I did not issue a command targeting them and have not identified the cause. They were restored from `HEAD` via `git checkout -- docs/screenshots/` and verified intact; `git status` shows no deletions outstanding. Flagging it because the cause is unknown, not because the files are at risk.
