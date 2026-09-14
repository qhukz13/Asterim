# DESIGN-003 — Workstation Mobile Reflow, Hero Elevation & Pricing/Docs Polish

**Date**: August 12, 2026
**Target**: `@asterim/marketing` (`apps/marketing`)
**Predecessor**: `docs/design-002-report.md` — this task closes the mobile-reflow item carried over from DESIGN-001 (P1-9) and the two P2 polish items (P2-10 pricing panels, P2-11 docs void)
**Method**: Headless Chromium (puppeteer 25.3.0) against Vite dev on `localhost:5199`, with `/api/` requests aborted so the site renders **logged out** (see DESIGN-002 §4). Full-page captures after `document.fonts.ready` + scroll pass, plus computed-style and geometry probes
**Evidence**: `docs/screenshots/design-003/`

---

## 1. Verification

| Check | Before | After | Req |
| :--- | :--- | :--- | :--- |
| Page horizontal overflow @375 | present | **none** (`scrollWidth` 375 = viewport) | R1c |
| Page horizontal overflow @414/768/1024/1440 | — | **none at every width** | R1c |
| Workspace chip lines @375 | 3 | **1** (ellipsised) | R1a |
| Status pill @375 | clipped at frame edge | **fits** — swaps to short label | R1a |
| `.ws-body` columns @375 | `230px 1fr 250px` | **`341px`** (single column) | R1b |
| Mission pill @375 | clipped | **hidden** | R1a |
| `.workstation-frame` box-shadow | 2 layers | **3 layers** (drop + ring + emerald bloom) | R2 |
| Pricing card border-radius | `0px` | **`12px`** | R3 |
| Pricing card border / padding | none / none | **`1px` / `28px`** | R3 |
| Pricing card background | transparent | **`rgb(13, 20, 36)`** = `#0d1424` | R3 |
| Pricing CTA vertical alignment | drifted with copy length | **identical — all three at `643px`** | R3 |
| Highlighted tier border | `var(--border-accent)` | **`rgba(16,185,129,0.4)`** | R3 |
| `/docs` page height @1440 | 1,255px | **1,176px** | R4 |

**Builds**: `pnpm build --filter @asterim/marketing` ✅ · full monorepo ✅ 6/6.

---

## 2. Root cause found: two more undefined CSS classes

Requirement 3 described the pricing panels as "square unbordered". The cause was not styling drift — **`.surface-card` was referenced by six components and never defined in `index.css`**, so those panels rendered with no border, no radius, and no padding. `.status-badge` (and its `.available` / `.beta` / `.planned` variants) was likewise undefined, so the capability pills rendered as bare text.

This is the same failure mode as the `--accent-green-*` tokens found in DESIGN-001: a class name referenced across the codebase with no definition anywhere, failing silently because CSS does not error on unknown classes.

Defining both fixed **`/pricing` and `/download` simultaneously** — `DownloadPage.tsx:76` uses `.surface-card` too and had the same invisible-panel defect, which was not in the task scope and had not been separately reported.

Remaining users of `.surface-card` are the four unmounted legacy components (`OpenSourceSection`, `CapabilitiesGrid`, `PlatformMatrixSection`, `ProblemSolutionSection`), which are dead code — see §5.

---

## 3. Changes by requirement

### R1 — Sandbox mobile reflow
The sandbox's layout was expressed entirely in **inline styles**, which media queries cannot reach. Layout-critical declarations were moved from inline `style` props into classes in `index.css`; presentational inline styles were left alone to keep the diff contained.

New shell classes: `.ws-header`, `.ws-header-left/right`, `.ws-chip`, `.ws-chip-label`, `.ws-breadcrumb`, `.ws-mission`, `.ws-host`, `.ws-kbd`, `.ws-body`, `.ws-sidebar`, `.ws-main`, `.ws-tabs`, `.ws-inspector`.

Two breakpoints:
- **≤1024px** — inspector drops to a full-width row beneath the main pane (`grid-column: 1 / -1`); sidebar narrows to 200px; mission pill capped at 260px.
- **≤768px** — single column. Header wraps to auto height; breadcrumb, mission, host, and `⌘K` hidden; chip label ellipsised at 170px; tab strip becomes horizontally scrollable with hidden scrollbar.

`min-width: 0` on all three grid children is the load-bearing fix for R1c — without it, grid children are sized by their content and force the frame wider than the viewport regardless of `overflow: hidden` on the parent.

**Long status labels** cannot be shortened by CSS alone, so each status renders two spans (`.ws-status-full` / `.ws-status-short`) with one hidden per breakpoint: "Action Required · Paused for Review" → "Review", "Working (Claude Code 3.7)" → "Working".

### R2 — Hero elevation
Three-layer aura applied to `.workstation-frame` exactly as specified. Verified computed:
`rgba(0,0,0,0.9) 0 32px 96px, rgba(255,255,255,0.08) 0 0 0 1px, rgba(16,185,129,0.05) 0 0 32px`.

Release pill: padding `5px 16px` → `7px 16px`, `line-height: 1` on the container with `1.2` on the label, tracking eased `0.06em` → `0.04em`, dot given `flex-shrink: 0`. The literal `🟢` emoji was removed — it duplicated the emerald status dot beside it and rendered as a platform-dependent colour outside the palette.

### R3 — Pricing
`.surface-card` and `.status-badge` defined (see §2). Highlighted tier border set to the specified `rgba(16,185,129,0.4)`. CTA alignment fixed by giving the tier description `min-height: 4.2rem` (three lines at the current scale) so the button row starts at the same offset in all three columns — measured identical at 643px.

### R4 — Docs layout void
Content panel `min-height` 600px → 500px with explicit `height: auto`. Separately, the page wrapper's `min-height: calc(100vh - 80px)` was the larger contributor to the void; it was replaced with `flex: 1`, letting the `.marketing-container` flex column size the page instead of a hard viewport calculation.

**Honest limitation:** a gap between panel and footer remains (~90px, down from ~170px). It cannot be fully removed without letting the footer ride up mid-viewport on short topics, which looks worse. The page still fills the viewport by design; what changed is that the panel no longer reserves 600px it does not use.

---

## 4. Outstanding

- **Hero remains centered** — DESIGN-001 P1-6; art direction calls for asymmetric. Not yet scoped.
- **Shape repetition** — Acts 3 and 5 share the split-panel shape; Acts 2, 6, and 7 share a side-by-side-panels shape (DESIGN-002 §3).
- **Elements wider than the viewport inside scroll containers** at ≤414px: the Act 4 telemetry `<table>` and the sandbox tab strip. Both sit in `overflow-x: auto` parents and cause **no page-level overflow**; horizontal scrolling a wide data table is the intended behaviour, but worth a decision if you would rather they collapse to a card list on phones.
- **`.surface-card` remains referenced by four dead components** — harmless now that the class exists, but they are still unmounted and still misleading to anyone reading the codebase.

---

## 5. Files changed

```
apps/marketing/src/index.css                                   (.ws-* shell + 2 breakpoints, .surface-card, .status-badge, frame aura)
apps/marketing/src/components/home/AsterimWorkstationSandbox.tsx (inline layout → classes, dual status labels)
apps/marketing/src/components/home/Act1Hero.tsx                (release pill polish)
apps/marketing/src/pages/PricingPage.tsx                       (highlight border, CTA alignment)
apps/marketing/src/pages/DocsPage.tsx                          (panel + wrapper height)
```

Uncommitted at time of writing. Note `apps/marketing/src/components/Footer.tsx` and the Act 2–8 tag edits from DESIGN-002 are also still uncommitted.
