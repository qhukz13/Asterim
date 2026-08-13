# Execution Report: P5.2-03 — Workspace Navigation Overflow Fix & Memory Timeline / Re-entry Briefing

**Task ID:** P5.2-03
**Status:** VERIFIED
**Date:** 2026-08-14
**Author:** Claude Code
**Branch:** `main` (working tree)

---

## 1. Summary

**Part A** — the reported bug is fixed, and it was **reproduced and measured** rather than accepted from the diagnosis. That mattered: the stated root cause is half right. `.workspace-main-content` already had `min-width: 0`; the missing piece was on the tab strip itself, and `overflow-x: auto` alone would not have helped. Measured before: the Environment tab's right edge sat at x=932 against a container ending at x=780, with `scrollWidth === clientWidth` — **there was no overflow to scroll**. After: the strip is constrained, scrolling moves it 176px, and the tab lands at x=756 ≤ 780.

**Part B** — `MemoryTimelineView` and `ReentryBriefingCard` are implemented, with an Explorer/Timeline toggle in the Memory view. **66/66** new assertions, 78/78 and 89/89 existing still green, `tsc` clean, `pnpm run build` 7/7, and a captured screenshot of the timeline.

Two findings worth reading: a negative control **survived** and exposed a vacuous assertion of mine (§ 5.2), and the repo's React-compiler lint rule caught a real impurity in my first draft (§ 6.2).

---

## 2. Files Changed

**Created**

| File | Lines | Purpose |
| :-- | --: | :-- |
| `apps/web/src/components/memory/MemoryTimelineView.tsx` | 268 | Chronological timeline, day grouping, supersession lineage |
| `apps/web/src/components/memory/ReentryBriefingCard.tsx` | 232 | Session handover: intent, rules, recent agent work, recent approvals |
| `apps/web/src/components/memory/__tests__/MemoryTimeline.test.ts` | 285 | Logic + render assertions for both |
| `docs/screenshots/p5.2-03/{nav-before,nav-after,memory-timeline-1440}.png` | — | Visual evidence |
| `scratch/nav-repro.js`, `scratch/shoot-nav.js`, `scratch/shoot-timeline.js` | — | Reproduction harness, kept so the measurements are repeatable |

**Modified**

| File | Change |
| :-- | :-- |
| `apps/web/src/styles/layout.css` | `.view-navigation`, `.view-navigation-tabs`, `.view-navigation-actions` rules |
| `apps/web/src/App.tsx` | Tab strip and actions row given those classes |
| `apps/web/src/components/memory/DecisionExplorer.tsx` | `briefing` prop, `MemoryMode` toggle, timeline branch |
| `apps/web/src/components/memory/__tests__/DecisionExplorer.test.ts` | Updated for the new required prop |

`MemoryTimelineView.tsx` and `ReentryBriefingCard.tsx` were each mutated for negative controls and restored byte-identically (`md5 87f62f8d…` and `74642800…`).

**Not modified:** no tab removed, no route altered, no CSS framework added. The § 5 prohibitions hold.

---

## 3. Implementation Details

### Part A — why `overflow-x: auto` alone was not the fix

A flex item defaults to `min-width: auto`, which means it grows to fit its content and simply extends past its parent. An `overflow-x` on an element that is never narrower than its content does nothing: there is no overflow. Both rules are needed, and in that order of reasoning:

```css
.view-navigation      { min-width: 0; max-width: 100%; overflow: hidden; }
.view-navigation-tabs { flex: 1 1 auto; min-width: 0; overflow-x: auto; overflow-y: hidden; … }
```

Tabs get `flex-shrink: 0` so labels are never compressed into ambiguity, and `.view-navigation-actions` gets `flex-shrink: 0` so the right-hand actions never steal space from the tabs. The scrollbar is styled thin against `--color-border-strong`, consistent with the token set.

The rules went into `layout.css` rather than more inline styles, because they need `::-webkit-scrollbar` pseudo-elements, which inline styles cannot express. `layout.css` is imported in `main.tsx`, so the classes apply app-wide.

### Part B — timeline

`groupDecisionsByDay` buckets by a **local-time** `YYYY-MM-DD` key: a decision recorded at 23:30 belongs to that working day for the person reading it, whatever UTC calls it. Days sort newest first; within a day, decisions sort newest first with `id` breaking ties, matching the server's `created_at DESC, id DESC`.

`buildLineage` resolves supersession in both directions and is the one place in the UI that reads `status` to disambiguate `supersededBy` — the bidirectional field recorded as drift § 4. On a `SUPERSEDED` decision the field names the replacement (`Replaced by …`); on the `ACTIVE` replacement it names what was replaced (`Replaces …`). When the counterpart is not loaded, the link falls back to the raw id and is flagged `resolved: false` so the UI can render it as an id rather than pretend it is a title.

Visually the timeline is a rail: filled node for what is in force, hollow for what is not, superseded titles struck through and dimmed. The screenshot shows both lineage directions on the same page.

### Part B — re-entry briefing

Deliberately **not** a second Decision Explorer. It answers "where did we leave off": current intent, counts in force, the first three rules, then the two projections nothing has rendered until now — `recentAgentWork` (agent type, status, abbreviated session id, relative age) and `recentApprovals` (description, outcome, relative age), with pending approvals called out in the accent.

Ages are relative (`5m ago`, `1d ago`) rather than absolute, because the question is recency, not wall-clock. The clock is injectable so tests assert exact strings.

The briefing appears in **timeline** mode only. In explorer mode the intent and rules already have their own cards; showing both would duplicate them. Explorer answers "what governs this file"; timeline answers "how did this project change its mind, and where did we stop".

---

## 4. Tests / Verification

### 4.1 Part A — measured, not asserted

A reproduction harness renders the real shell structure (`layout.css` + `tokens.css`, sidebars, six tabs, inspector at its 500px maximum) at a 1280px viewport, then scrolls the strip as a user would:

```
BEFORE
  at rest        canScroll=false  scrollLeft=0    lastTabRight=932  mainRight=780  reachable=false
  scrolled       canScroll=false  scrollLeft=0    lastTabRight=932  mainRight=780  reachable=false

AFTER
  at rest        canScroll=true   scrollLeft=0    lastTabRight=932  mainRight=780  reachable=false
  scrolled       canScroll=true   scrollLeft=176  lastTabRight=756  mainRight=780  reachable=true
```

Before, scrolling is a no-op and the tab is stranded 152px under the inspector. After, the strip scrolls and the tab becomes reachable. Captures in `docs/screenshots/p5.2-03/nav-{before,after}.png`.

### 4.2 Part B

```
$ pnpm --filter @asterim/web exec tsx src/components/memory/__tests__/MemoryTimeline.test.ts
  groupDecisionsByDay ............................  9 PASS
  buildLineage ...................................  8 PASS
  render — timeline ..............................  9 PASS
  relativeTime ...................................  8 PASS
  isPendingApproval ..............................  4 PASS
  render — re-entry briefing ..................... 12 PASS
  render — briefing edge cases ...................  9 PASS
  the Memory view switches modes .................  7 PASS
  66/66 assertions passed                           EXIT=0

DecisionExplorer.test.ts   78/78      useMemoryStore.test.ts   89/89
tsc --noEmit  0 errors  ·  eslint  0 errors, 41 warnings  ·  pnpm run build  7/7
```

Timeline screenshot: `docs/screenshots/p5.2-03/memory-timeline-1440.png` — both lineage directions, day headings, agent work and approvals with relative ages, monochrome with the emerald reserved for what is in force.

### 4.3 Acceptance criteria

| # | Criterion | Result |
| :-- | :-- | :-- |
| 1 | Tab bar scrollable, no tab inaccessible | **Met** — measured before/after (§ 4.1) |
| 2 | Chronological ordering with clear supersession | **Met** — 17 assertions, both directions rendered |
| 3 | Briefing shows `recentAgentWork` and `recentApprovals` | **Met** — 21 assertions incl. empty states |
| 4 | Build and typecheck clean | **Met** — 7/7, 0 errors |

---

## 5. Negative Controls

| # | Mutation | Result | Verdict |
| :-- | :-- | --: | :-- |
| A | `buildLineage` stops reading `status`, always emits `replacedBy` | 61/65 | caught — 4 failures |
| B | Day groups no longer sorted | **65/65 → survived** | **exposed a vacuous assertion** |
| C | Briefing ignores `recentAgentWork` | 61/65 | caught — 4 failures |

### 5.1 Control A — the drift-4 trap

Removing the `status` check collapses both directions into "Replaced by", so the active decision claims it was replaced by the very decision it superseded. Four assertions fail, including the rendered `Replaces` text. This is the trap the bidirectional field sets for every consumer, and it is now pinned.

### 5.2 Control B survived, and that was my fault

Deleting the day sort changed nothing: **65/65 still passed**. The assertion `groups are ordered newest day first` was reading a fixture that was already in newest-first order, so `Map` insertion order happened to equal sorted order. It was asserting the fixture, not the function.

A second assertion now feeds the same three days deliberately out of order (`oldest, newest, middle`). With it in place the mutation fails as it should:

```
FAIL  groups are sorted, not merely kept in arrival order
      — expected ["2026-08-14","2026-08-13","2026-08-07"], got ["2026-08-07","2026-08-14","2026-08-13"]
```

Same class of defect as the three found earlier in this phase: a test that stops testing without going red. The only reason it surfaced is that the mutation was run.

---

## 6. Problems Discovered & Concerns

### 6.1 The stated root cause was partly wrong

The task attributes the bug to `view-navigation` lacking `min-width: 0`, `overflow-x: auto`, and container scroll handling. `.workspace-main-content` — the container that actually needed it — **already had `min-width: 0`** (`layout.css:156`). The missing constraint was one level down, on the tab strip.

The distinction is not pedantic. Adding `overflow-x: auto` to the strip *without* `min-width: 0` produces exactly the "before" measurement: the element never becomes narrower than its content, so no overflow exists and the scrollbar never appears. A fix that looked right would have shipped, and the user would have reported the same bug again.

### 6.2 The React compiler lint rule caught a real impurity

My first `ReentryBriefingCard` defaulted the clock as `now = Date.now()` in the parameter list. ESLint rejected it:

```
error  Cannot call impure function during render
`Date.now` is an impure function. Calling an impure function can produce unstable
results that update unpredictably when the component happens to re-render.
```

Correct, and not cosmetic: the ages would shift on any unrelated re-render. Replaced with `useState(() => Date.now())`, read once per mount. Worth knowing that this rule is active in `apps/web` — it is stricter than the rest of the repo's lint config and will catch this class of thing in future UI work.

### 6.3 The briefing is only as fresh as the last fetch

`ReentryBriefingCard` renders `briefing`, which `fetchBriefing` populates on project change. `handleMemoryEvent` keeps `briefing.activeDecisions`, `architecturalRules` and `currentIntent` current, but **`recentAgentWork` and `recentApprovals` have no live update path** — no `memory.*` event carries them, and they derive from the `sessions` and `approvals` tables.

So a session that starts, or an approval that resolves, while the Memory view is open will not appear until the project is switched or the app reloaded. Not a defect against this task, which asked for them to be displayed, but it is a stale-data path in the one view whose purpose is telling you what just happened. Closing it means either re-fetching the briefing on `agent.status`/`approval` events, or a periodic refresh.

### 6.4 Carried forward, still open

- **`MemoryStore` is still absent from `STORE_ARCHITECTURE.md`** (P5.2-01 § 6.3). Four components now depend on it. Needs a Change Proposal; the drafted entry is in that report.
- **No DOM test environment** (P5.2-02 § 6.3). The mode toggle, the status pills and the modal submit path are still rendered-and-typed but not clicked. The `initialMode` prop exists so render tests can reach timeline mode — a workaround for the missing environment, not a substitute.
- **`supersededBy` is still bidirectional** (drift § 4). The timeline is now the second consumer reading `status` to disambiguate it, after the explorer card. The entry's note that a fix is "cheapest before a client is written against the API" is now two clients out of date.
- `pnpm run lint` remains red on `@asterim/adapters`; `apps/server` still has 4 pre-existing `tsc` errors. All figures here are local verification.

---

## 7. Recommended Next Step

Phase 5.2's three vertical slices are in place: store, explorer, timeline + briefing. Before wrapping the milestone:

1. **Verify Part A in the running app.** My measurement uses a faithful reproduction of the shell, not the app itself — the classes, CSS, and structure are the real ones, but the app requires pairing and a project to reach that screen. The reported symptom is fixed in the reproduction; a five-second check with the inspector dragged wide would confirm it end to end, and that is worth doing since it is a user-reported bug.
2. **Close § 6.3 or state it.** The briefing is the view most likely to be read as live.
3. **Raise the two blueprint items** — the `MemoryStore` entry (§ 6.4) and the `supersedes` field split (drift § 4). Both have been deferred through three tasks and both get more expensive with each consumer.

For **Phase 5.3**, the obvious gap is that the memory UI is read-mostly: decisions can be recorded and browsed, but not superseded, archived, or edited from the interface. `supersedeDecision` exists in the store and on the REST surface with no UI. A supersede flow launched from the timeline — where the lineage is already the primary structure — is the natural next slice, and it would exercise the one write path that the explorer's Record modal does not.
