# Execution Report: P5.2-02 — Project Decision Explorer UI Component

**Task ID:** P5.2-02
**Status:** VERIFIED
**Date:** 2026-08-14
**Author:** Claude Code
**Branch:** `main` (working tree)

---

## 1. Summary

The Decision Explorer is implemented and wired into the project workspace as a **Memory** view, with the Record Decision modal, status/text/file filtering, and a provenance treatment that makes DEC-024's distinction visible rather than merely stored.

**78/78 assertions** in a new suite; `tsc --noEmit` clean; `pnpm run build` 7/7. Because a green build says nothing about how a UI looks, the component was also rendered and **screenshotted at 1440px and 768px** — captures in `docs/screenshots/p5.2-02/`.

Two structural findings shaped the work. The task's design guidance is written in Tailwind class names (`bg-neutral-900`, `border-neutral-800`) and **this app has no Tailwind** — it styles with inline objects over the CSS custom properties in `tokens.css` (§ 6.1). And the component had to be split into a presentational view plus a store-connected container, because zustand v5 serves `getInitialState` as its server snapshot, which makes any store-reading component untestable under `react-dom/server` (§ 3.2).

---

## 2. Files Changed

**Created**

| File | Lines | Purpose |
| :-- | --: | :-- |
| `apps/web/src/components/memory/DecisionExplorer.tsx` | 703 | Explorer view + container, filtering, provenance/anchor rendering |
| `apps/web/src/components/memory/RecordDecisionModal.tsx` | 265 | Human-confirmed decision capture |
| `apps/web/src/components/memory/__tests__/DecisionExplorer.test.ts` | 428 | Pure-logic + server-render assertions |
| `docs/screenshots/p5.2-02/decision-explorer-{1440,768}.png` | — | Visual QA captures |
| `scratch/decision-explorer.html`, `scratch/shoot-explorer.js` | — | The QA harness, kept so the captures are reproducible |

**Modified**

| File | Change |
| :-- | :-- |
| `apps/web/src/App.tsx` | Memory tab button; persistent view mount; `IconStar` import |
| `apps/web/src/stores/useViewStore.ts` | `'memory'` added to `ViewType` and `availableViews` |

`DecisionExplorer.tsx` was mutated three times for negative controls and restored byte-identically (`md5 9a28c4c85e1f0a723cc733f6fcfe4b5c`).

**Not modified:** no backend route, no MCP server, no CSS framework added. The § 5 prohibitions hold.

---

## 3. Implementation Details

### 3.1 Where it lives

`WorkspaceTabView.tsx` — one of the two files the task offered — is the **workspace settings** screen (members / projects / audit / settings). Project memory is project-scoped, so it does not belong there.

It was added instead to the project **view system**: `'memory'` joins `ViewType`, a Memory tab sits beside Chat / Terminal / Changes, and the component mounts in the persistent-view block alongside `ChangesView`. That means the URL `/workspace/project/:id/view/memory` works through the existing `RouterSync`, which is what `WORKSPACE_V2.md` requires of a view — the URL is the source of truth, not a local tab flag.

Mounting persistently (rather than conditionally) follows the established pattern and preserves filter text across tab switches. The cost is that the two fetches fire on project change even if the user never opens Memory; that matches how `ChangesView` already behaves.

### 3.2 View / container split

`DecisionExplorerView` takes all data as props. `DecisionExplorer` reads `useMemoryStore`, runs the project-change effect, and renders the view.

This is what `UI_PRINCIPLES.md` asks for — views render, they do not own business data — but the immediate reason was testability. Zustand v5's `useStore` passes `getInitialState` as the `useSyncExternalStore` server snapshot, so under `react-dom/server` a store-reading component renders **initial** state regardless of what `setState` was called with. The first version of the suite failed 20 assertions for exactly this reason, all of them reporting an empty explorer. Splitting the component made the render assertions real.

### 3.3 Making DEC-024 visible

DEC-024 records agent writes as `AGENT_STATEMENT` at 0.75 so a reviewer can tell them from what a human approved. That is worth nothing if both render identically.

`provenanceLabel` produces `Agent · 75%`, `Human · 100%`, `Repository · 90%`, `Inferred · 30%`. Human-confirmed decisions carry the **emerald accent**; everything else stays neutral. The rule is deliberately narrow: the accent means *a person stood behind this*. A 32px confidence meter sits inside the badge — enough to compare two cards at a glance, not a gauge.

The screenshots show the two side by side: emerald `Human · 100%` with a filled meter against a grey `Agent · 75%`.

### 3.4 Filtering

`filterDecisions` is exported as a pure function and does the work: status pill, case-insensitive text across title/summary/rationale/**constraints**, and substring file matching across `relatedFiles` **and** code-ref paths. All three compose — a decision must satisfy every active filter.

Searching constraints matters more than it sounds: a constraint is the part of a decision that governs future work, so "what did we say about logging keys" is a realistic question, and it is the field a naive implementation omits.

### 3.5 Empty states

Two distinct ones, because they call for different actions. A project with no decisions explains what the view is for; a project whose filters match nothing says so and reports how many exist. Collapsing them into one message is a real usability bug and is covered by negative control C.

### 3.6 The modal

Title / summary / rationale required; constraints and related files parsed from newlines **or** commas with blanks dropped. Submission sets `provenance: 'HUMAN_CONFIRMED'`, `confidence: 1.0` in code rather than offering them as fields — a decision typed by a person in this form is exactly what human-confirmed means, and a field the user could contradict would undermine the distinction § 3.3 exists to draw.

---

## 4. Tests / Verification

```
$ pnpm --filter @asterim/web exec tsx src/components/memory/__tests__/DecisionExplorer.test.ts
  filterDecisions — status ....................... 7 PASS
  filterDecisions — text search .................. 9 PASS
  filterDecisions — file path .................... 6 PASS
  filterDecisions — combined ..................... 1 PASS
  anchorLabels ................................... 6 PASS
  provenanceLabel ................................ 6 PASS
  parseList ...................................... 5 PASS
  render — decision card ......................... 7 PASS
  render — provenance distinction (DEC-024) ...... 6 PASS
  render — superseded relationship ............... 3 PASS
  render — intent and rules ...................... 5 PASS
  render — empty and error states ................ 5 PASS
  render — counts ................................ 2 PASS
  project change resets and reloads .............. 8 PASS
  78/78 assertions passed                          EXIT=0

$ pnpm --filter @asterim/web exec tsx src/stores/__tests__/useMemoryStore.test.ts   89/89   (P5.2-01 regression)
$ pnpm --filter @asterim/web exec tsc --noEmit ...................................  0 errors
$ pnpm --filter @asterim/web build ...............................................  built
$ pnpm run build .................................................................  7 successful, 7 total
$ eslint src/components/memory src/stores/useMemoryStore.ts ......................  0 errors, 22 warnings
```

Warnings are all the app's pre-existing `no-explicit-any` category.

### 4.1 Acceptance criteria

| # | Criterion | Result |
| :-- | :-- | :-- |
| 1 | Renders decisions, intent and constraints from the store | **Met** — asserted by server-render, and visible in the captures |
| 2 | Provenance and confidence visibly distinguished on every card | **Met** — badge scoped assertion + screenshots |
| 3 | Status, text and file filtering accurate | **Met** — 23 filter assertions incl. combined |
| 4 | Modal submits human-confirmed decisions | **Partly verified** — see § 6.3 |
| 5 | Project switch resets and reloads | **Met** — 8 assertions against the store; the effect itself is unrun under SSR (§ 6.3) |
| 6 | `pnpm run build` 0 errors | **Met** — 7/7 |

### 4.2 Visual QA

`blueprint/DESIGN_SYSTEM.md` compliance is a visual claim, so it was checked visually rather than asserted from a build. The view was rendered to standalone HTML with `tokens.css` and captured with the repo's puppeteer at 1440px and 768px.

Both confirm: monochrome surfaces, single emerald accent used only for the primary action / ACTIVE status / human provenance, hairline borders, no gradients or glows, filter bar wrapping cleanly at 768px with no horizontal overflow.

The first capture attempt came out tiled and unreadable — the standalone page gave `height: 100%` nothing to resolve against. That was a fault in my harness, not the component; fixed by giving the host page a height and capturing the viewport rather than `fullPage`.

---

## 5. Negative Controls

| # | Mutation | Result | Verdict |
| :-- | :-- | --: | :-- |
| A | File filter ignores `codeRefs`, matching only `relatedFiles` | 76/78 | caught — 2 failures |
| B | `HUMAN_CONFIRMED` returns `isHuman: false` — the two provenances render identically | 76/78 | caught — 2 failures |
| C | Empty state no longer distinguishes "nothing recorded" from "nothing matched" | 76/78 | caught — 2 failures |

**B** is the one worth naming: it is the DEC-024 regression this component exists to prevent, and it is a one-character change. The suite catches it both at the logic layer and at the rendered-badge layer, the latter scoped to the badge markup — an earlier version of that assertion searched the whole document and passed for the wrong reason, because the accent-coloured "Record decision" button also matched.

---

## 6. Problems Discovered & Concerns

### 6.1 The task's styling guidance does not match this application

The task specifies `bg-neutral-900`, `bg-neutral-950`, `border-neutral-800` — Tailwind utility classes. **`apps/web` has no Tailwind**: no dependency, no config, no `@tailwind` directives, and no component in the app uses such a class. Styling is inline `style={{}}` objects referencing the custom properties in `apps/web/src/styles/tokens.css`.

Written literally, those class names would have produced entirely unstyled markup that still passed `tsc` and `pnpm run build` — the failure would only have appeared on screen.

The component therefore uses the app's real convention and the design tokens, which is also what `CLAUDE.md` requires ("Colors come from CSS custom properties … use the tokens, don't hardcode hex values"). The *intent* of the guidance — monochrome surfaces, one emerald accent, no cliché tropes — is honoured and verified in § 4.2.

Worth noting for future UI tasks: existing overlays (`AddProjectModal`, `ConnectWorkstationModal`) hardcode hex values like `#10b981` and `#cbd5e1` rather than using tokens. The new components use tokens throughout; the older ones are drift nobody has recorded.

### 6.2 Two token vocabularies coexist

`tokens.css` defines `--color-text-primary`, `--color-accent-primary`, and so on. `index.css` re-exports a legacy alias set (`--text-primary`, `--error-color`, `--accent-color`), and `ContextView.tsx` — one of the files the task pointed at as a reference — uses the legacy names.

Counted across `apps/web/src/components`: 24 uses of `--color-text-primary` against 1 of `--text-primary`; 37 of `--color-accent-primary` against 1 of `--accent-color`. The new components follow the dominant `--color-*` set. The aliases are harmless today but are a second vocabulary for the same values, and `ContextView` is the reference a future task is most likely to copy.

### 6.3 What the tests cannot reach

The repository has no DOM test environment, so this suite runs pure logic plus `react-dom/server`. That leaves three things asserted only indirectly:

- **Click handlers** — the status pills, the rationale toggle, and the Record button are verified to render with the right labels and `aria` state, not to respond. The rationale assertion checks it is *collapsed* by default (its text absent from the markup) and that a control to reveal it exists.
- **Modal submission** — `parseList` is tested directly, and the modal renders, but the submit path (`createDecision` → close) needs an event loop. Acceptance criterion 4 is therefore **partly verified**: the store action it calls is covered by P5.2-01's 89 assertions, and the wiring between them is not.
- **The project-change effect** — `useEffect` does not run under `renderToStaticMarkup`. The suite verifies the sequence the effect performs (reset, then fetch briefing and decisions for the new project, 8 assertions) by calling the store directly. That the effect fires with the right dependency is not covered.

Closing these needs a DOM environment (`jsdom` + a renderer). That is a repo-level decision beyond this task, and it is the same gap every UI task in this codebase will hit.

### 6.4 `MemoryStore` is still absent from `STORE_ARCHITECTURE.md`

Raised in the P5.2-01 report § 6.3 and still open. Two components now depend on it. The proposed blueprint entry is in that report; it needs a Change Proposal, which is not something to do inside a feature task.

### 6.5 `supersededBy` is bidirectional, and the UI has to guess

`IMPLEMENTATION_DRIFT.md` § 4 records that `supersededBy` names the replacement on a `SUPERSEDED` decision and the *replaced* decision on the `ACTIVE` one. The card therefore reads `status` to choose between "Superseded by" and "Supersedes" — the exact "consumer should not have to read `status`" problem that entry predicted, now with a consumer.

Both directions are asserted, so the behaviour is pinned. But the drift entry's recommendation — a distinct `supersedes` field, "cheapest before a client is written against the API" — has now become more expensive: this is that client.

### 6.6 Pre-existing, unchanged

`pnpm run lint` remains red on `@asterim/adapters`; `apps/server` still has 4 `tsc --noEmit` errors. All figures above are local verification.

---

## 7. Recommended Next Step

Proceed to **P5.2-03 — Memory Timeline & Re-entry Briefing**. Four things carry forward:

1. **Reuse `DecisionCard` rather than restyling it.** The timeline is the same decision in a different arrangement; two divergent renderings of provenance would defeat § 3.3 within one phase.
2. **The briefing already has the data.** `fetchBriefing` returns `recentAgentWork` and `recentApprovals`, which nothing renders yet — the P5.1-06 live probe found 5 of each in the real database. A Re-entry Briefing is exactly their consumer, and no new endpoint is needed.
3. **Decide on a DOM test environment** (§ 6.3). The timeline will have more interaction than the explorer, and the untested surface compounds.
4. **Raise the `STORE_ARCHITECTURE.md` proposal** (§ 6.4) before a third component depends on the store.

One design note for the timeline: the explorer answers "what governs this file". A timeline answers "how did this project change its mind", which makes the supersede chain the primary structure rather than an afterthought on a card — and that is the view where § 6.5's ambiguous back-link will hurt most.
