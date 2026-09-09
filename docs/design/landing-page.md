# Landing Page: Strategy, Audit and Direction

Three passes are recorded here. The first (August 2026) was decorative and untruthful. The second (2026-09-08) made it truthful. The third, specified in §6, is the one that has to make it good.

---

## 1. Pass one audit: the August site

Removed on 2026-09-08. It claimed an npm package, a Homebrew tap, AppImage and `.exe` downloads all "AVAILABLE NOW", a v1.0 release, "AST command safety", "Claude Code 3.7", "Hardware Enclave Scoped", a "RISK SCORE 8.4/10", and contained an 892-line fabricated dashboard with invented process ids and diffs. None of it existed. It also carried the decorative failure set: emerald glow, gradient panels, an eight-act scroll narrative, a `Sparkles` logo, an emoji in the pricing notice, and 100+ inline style objects per file.

Kept from it: the dark near-monochrome surface with a single emerald accent, Inter plus JetBrains Mono, and the section rhythm.

---

## 2. Pass two: what shipped on 2026-09-08

Truthful, restrained, class-based, real screenshots, five documented facts in one file (`apps/marketing/src/site.ts`). Every sentence maps to a release-gate row.

## 3. Pass two audit: why it is still not good enough

The first failure was **decorative**. This one is **structural**, and structural is the harder tell that a page was machine-made: it is the default SaaS template.

| Symptom | Present? | Detail |
| --- | --- | --- |
| Generic SaaS layout | **Yes** | Feature-card grid, three-column "why", accordion FAQ, two-card pricing. The default template, in order. |
| Excessive cards | **Yes** | Seven card containers on one page. |
| Excessive hierarchy levels | **Yes** | Eyebrow, title, lead, card icon, card title, card body, card footnote — six or seven levels per section. |
| Excessive sections | **Yes** | Seven body sections; the reader is asked to scroll through claims. |
| Repetitive CTAs | **Yes** | Install appears four times. |
| Meaningless icons | **Mild** | Five feature icons that decorate rather than inform. |
| Screenshots that do not demonstrate value | **Yes — the worst of them** | Real captures, but shown as thumbnails in a three-column grid where nothing is legible. A screenshot nobody can read is decoration. |
| Unnecessary animation | No — inverted | There is none at all, which is its own failure: nothing on the page explains the mechanism in motion. |
| Gradients, glow, glassmorphism, blobs, fake dashboards, emoji, AI filler copy | No | Fixed in pass two; keep it that way. |
| Fake feature density | **Partly** | Five features presented as a list of claims instead of one thing shown working. |

Two more, against the product brief rather than the aesthetic list:

- **The hero does not answer the only question a Claude Code user has**: *why do I need this if I already have the agent?* It states what Asterim does, never the relationship to what they already run.
- **A pricing table implies a business model that does not exist.** Pricing is an open question (FD-H). Showing two plan cards pre-commits an answer the first users are supposed to give.

---

## 4. Quality bar

References for **quality only**, never for visual identity: Linear, Vercel, Raycast, Cursor, Claude. What is actually worth taking from them:

- One idea per screen, with enough whitespace that the idea has nowhere to hide.
- Typography carries the hierarchy; containers do not.
- Product imagery is large, legible and real. When these companies show the product, you can read it.
- Motion exists only where it explains a mechanism, and it is short.
- Fewer sections than you think, each earning its place.

What not to take: their palettes, their shapes, their voice, their scale of claim.

## 5. The rule on simulation

Ranked, best first:

1. **A real capture** — screenshot or screen recording of the actual product.
2. **An obvious diagram** — clearly a diagram, animated if that explains the mechanism.
3. **Nothing.**
4. **Never**: an interactive imitation of the product UI. That is what the August site did, and no caption redeems it.

Anything not currently shipping carries a status word: **AVAILABLE NOW** (default, so it need not be printed), **BETA**, **PREVIEW**, **PLANNED**. Antigravity is PREVIEW. Pro is PLANNED. Simulated visuals, if any ever appear, say so in the caption.

---

## 6. Pass three direction

### Structure: five sections, not seven

Ordered by the questions a visitor actually asks.

```text
1  HERO            What is this, and why do I need it if I already run Claude Code?
2  THE MOMENT      One large, real view of the approval card in context, with the
                   mechanism in three lines beside it. Replaces the feature grid.
3  HOW IT WORKS    Install and pair → give a task → approve and review.
                   One meaningful motion piece showing the four states of a gated action.
4  LOCAL-FIRST     The what-runs-where table. This is the differentiator and it is factual.
5  TRY IT          One install command, the honest money line, FAQ, footer.
```

The dedicated `/pricing` page stays for anyone who looks for it; the home page carries one sentence instead of a plan grid: free, open source, no account, and a line about what a paid tier might one day be, marked PLANNED.

### Hero

Must state the relationship before the capability. Structure:

```text
[relationship line]   Works with the Claude Code you already run.
[headline]            See what your coding agent is doing.
                      Approve what matters. Keep the record.
[sub]                 Asterim runs Claude Code on your machine and puts a window and a
                      gate around it: every command and file write stops until you decide,
                      and everything that happened stays in a database you own.
[action]              $ npm install -g asterim        [Source]
[meta]                Open source, MIT. Node 22+. No account. Nothing leaves your machine.
```

Alternative headline to test with the first users: *"Your coding agent, with a workspace around it."* All hero copy is v1 and revisable after Phase 2 — the wedge is not decided yet (`docs/product/experiments.md`).

Words that stay banned: "the future of", "supercharge", "unlock the power", "AI-powered", "command center", "seamlessly", "revolutionise". Two more are banned for specific reasons: **"control plane"**, which enterprise vendors captured in 2026 and which now signals compliance software, and **"GUI for Claude Code"**, which is a crowded commodity category the product should not file itself into.

### The moment

The single most important thing on the page. A full-width, legible capture of the workspace with the approval card open, showing a real command and a real path. Beside it, three lines of the mechanism:

```text
The agent asks       Claude Code will not run a command or write a file without permission.
Asterim holds        The request stops here and waits. Nothing runs meanwhile.
You decide           Approve, or deny with a reason the agent reads and answers.
```

### Motion, once

One sequence, about ten seconds, showing the four states of a gated action: proposed → held → decided → continued. Preference order from §5: a real screen recording first; a clearly diagrammatic animation second. It must respect `prefers-reduced-motion` and must not autoplay anything with sound. No other animation on the page.

### Screenshots

Two or three, full-width, each captioned with what to look at. No thumbnail grids. Regenerate them from `tools/e2e/core-loop.mjs` so they are always the current product.

### CTAs

Three total: nav, hero, and the close. Not four.

### Definition of done for pass three

- A Claude Code user understands within five seconds that this works with, not instead of, what they already run.
- Nothing on the page is a claim that a section elsewhere does not show.
- Every screenshot is legible at the size it is displayed.
- Section count is five; card containers are at most three; hierarchy is at most four levels per section.
- One motion piece, and it explains the gate.
- Every non-shipping thing carries a status word.

### Sequencing

The cheap half — relationship line, larger screenshots, removing the pricing grid from the home page, status labels, deduplicated CTAs — is worth doing now (P1-11). The full restructure and the motion piece belong before Phase 3, when the positioning the page argues for has actually been decided by the first users.
