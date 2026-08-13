# Execution Report: P5.3-03 — Architectural Rules & Intent Management UI

**Task ID:** P5.3-03
**Phase:** Phase 5.3 — Decision Lifecycle & Memory Curation UI
**Status:** VERIFIED
**Date:** 2026-08-14
**Author:** Claude Code
**Branch:** `main` (working tree)

---

## 1. Summary

Rules and intent are now curated from the UI: `CreateRuleModal` and `UpdateIntentModal`, reachable from the Explorer's panels and from the Re-entry Briefing, with empty states that make the *first* rule and the *first* intent reachable. `supersededBy` resolves to the counterpart's title in the Explorer, closing the inconsistency raised in P5.3-02 § 6.2.

**+56 assertions** (116/116 and 134/134), all other suites unchanged, `tsc` clean, `pnpm run build` 7/7, with screenshots.

Three mutation runs. **Two of them survived**, and both exposed assertions of mine that were passing for the wrong reason — one comparing against an unfiltered view, one matching the component's own placeholder text (§ 5). Both are fixed and now fail as they should. A third gap led to extracting a pure helper so an untestable claim became testable (§ 5.4).

A structural prerequisite came first: the Explorer and Timeline were **mutually importing** each other, and resolving titles would have deepened that. The shared pure helpers now live in their own module (§ 3.1).

---

## 2. Files Changed

**Created**

| File | Lines | Purpose |
| :-- | --: | :-- |
| `apps/web/src/components/memory/decisionHelpers.ts` | 96 | `anchorLabels`, `provenanceLabel`, `buildLineage` — extracted to break the import cycle |
| `apps/web/src/components/memory/CreateRuleModal.tsx` | 268 | Rule capture, severity, scope pattern |
| `apps/web/src/components/memory/UpdateIntentModal.tsx` | 232 | Intent capture, pre-populated |
| `docs/screenshots/p5.3-03/{curation-panels,add-rule-dialog}-1440.png` | — | Visual evidence |

**Modified**

| File | Change |
| :-- | :-- |
| `DecisionExplorer.tsx` | Title resolution on cards; Update/Set intent and Add rule controls; empty states; `initialStatusFilter` test affordance; imports helpers |
| `MemoryTimelineView.tsx` | Imports helpers, re-exports `buildLineage` |
| `ReentryBriefingCard.tsx` | Optional `projectId` enabling the same two controls |
| `SupersedeDecisionModal.tsx` | Imports `anchorLabels` from the helper module |
| Both component test suites | +56 assertions; two corrected (§ 5) |

Four files were mutated for negative controls and restored byte-identically.

**Not modified:** no schema, no REST route, no component removed. The § 5 prohibitions hold.

---

## 3. Implementation Details

### 3.1 Breaking a cycle that the task required touching

`DecisionExplorer` imported `MemoryTimelineView` (the component), and `MemoryTimelineView` imported `anchorLabels`/`provenanceLabel` back from `DecisionExplorer`. That already worked only by accident of module evaluation order.

Resolving titles in the Explorer needs `buildLineage`, which lived in `MemoryTimelineView` — so doing it the direct way would have added a **value** dependency to a cycle that previously only carried functions. The three pure helpers now live in `decisionHelpers.ts`, which imports nothing local and therefore cannot participate in a cycle. Both components re-export what they used to own, so every existing importer and test kept working unchanged.

This was not tidying for its own sake: it is the prerequisite for the task's third requirement.

### 3.2 Title resolution, built from the full list

```ts
const lineage = useMemo(() => buildLineage(decisions), [decisions]);
```

Deliberately `decisions`, not `visible`. A decision's counterpart is frequently filtered out — filtering to `ACTIVE` hides every superseded decision by definition — and it is still the thing the surviving card's link should name. Mutation A (§ 5.1) is exactly this substitution.

Unresolved links keep the raw id and render it in monospace, so an identifier never masquerades as a title. The id is preserved as the `title` attribute in both cases.

### 3.3 Empty states are where curation actually starts

The Explorer previously rendered nothing when a project had no intent, and `RuleList` returned `null` with no rules. Both were dead ends: the first rule and the first intent were unreachable from the UI.

Both now render with a control and a sentence explaining what the thing is for. The Briefing card does the same. Without a `projectId` all controls disappear and the panels stay read-only — asserted in both suites.

### 3.4 The intent dialog says what it actually does

There is no update path underneath: `createIntent` archives whatever was active and writes a new row. A correction and a change of direction are the same operation.

So the dialog changes its wording with the situation — "Set project intent" / "Set intent" when there is none, "Update project intent" / "Replace intent" plus *"Saving archives the current intent and makes this the active one"* when there is. Pre-population is what makes a small correction practical; saying "archives" rather than "updates" is what stops it being a surprise.

### 3.5 Severity colour

`error` → red, `warning` → amber, and **`info` stays neutral** rather than taking the blue the task offered as an alternative. `tokens.css` has no blue in its state set, and introducing a third hue into panels the design system asks to keep monochrome-plus-state would be the "cliché" the task's § 2 warns against. `info` is not a warning; neutral says that.

---

## 4. Tests / Verification

```
DecisionExplorer.test.ts ....... 116/116   (was 99, +17)
MemoryTimeline.test.ts ......... 134/134   (was 95, +39)
useMemoryStore.test.ts ......... 113/113
memory.test.ts (routes) ........  98/98
ProjectMemoryService.test.ts ... 231/231

tsc --noEmit  0 errors  ·  eslint  0 errors, 60 warnings  ·  pnpm run build  7/7
```

### 4.1 Acceptance criteria

| # | Criterion | Result |
| :-- | :-- | :-- |
| 1 | Add rules with title, statement, severity, scope | **Dialog and defaults met**; the submit path itself untested — § 6.1 |
| 2 | Set/update intent with pre-population and non-goals | **Met** — pre-population asserted with a corrected fixture (§ 5.2) |
| 3 | Both views resolve superseded links to titles | **Met** — Timeline since P5.2-03, Explorer now, both asserted and visible in the capture |
| 4 | Build and typecheck clean | **Met** |

### 4.2 Visual QA

`docs/screenshots/p5.3-03/`. The capture shows the intent panel with **Update intent**, the rules panel with **Add rule** and per-rule severity (`error` in red, `info` neutral), and both directions of the resolved lineage: *"Supersedes Hash passwords with bcrypt"* on the active decision and *"Superseded by Hash passwords with Argon2id"* on the retired one — where P5.3-02's capture showed a bare `d1`.

---

## 5. Negative Controls

| # | Mutation | Result | Verdict |
| :-- | :-- | --: | :-- |
| A | `buildLineage(visible)` instead of `buildLineage(decisions)` | **survived** → 115/116 after fixing | **exposed a vacuous assertion** |
| B | Intent dialog stops pre-populating | **survived** → 127/130 after fixing | **exposed a vacuous assertion** |
| C | Severity colours collapsed; blank scope stops defaulting | 129/130 | half caught — the other half was untestable (§ 5.4) |

### 5.1 Control A — the assertion never filtered anything

My first "lineage resolves across the whole list, not the filtered view" assertion rendered with default filters, where `visible === decisions`. It could not distinguish the two.

`DecisionExplorerViewProps` gained `initialStatusFilter`, mirroring the existing `initialMode`, so a render test can reach a genuinely filtered view. The assertion now filters to `ACTIVE` — which hides the superseded counterpart entirely — and is preceded by a guard confirming the filter really took effect (`Showing 1 of 2`, counterpart text absent) so it cannot silently stop filtering later. Under the mutation it now fails.

### 5.2 Control B — the fixture matched the placeholders

Worse, and instructive. The intent pre-population assertions read:

```ts
check('the goal is pre-populated', updateHtml.includes('Migrate authentication to Argon2id'));
check('constraints are pre-populated one per line', updateHtml.includes('No downtime\nExisting sessions stay valid'));
```

Every one of those strings is also the component's **placeholder text**, which I wrote. So the assertions matched the placeholder attributes and passed with the fields completely empty. Three assertions, all testing nothing.

The fixture now uses values unlike any placeholder ("Retire the legacy billing importer", "Keep the CSV export byte-identical"), with a comment recording why. Under the mutation all three fail.

This is a failure mode worth naming beyond this task: **a fixture that reuses the component's own example text cannot distinguish a populated field from an empty one.** The same shape would apply to any placeholder-bearing form in this codebase.

### 5.3 Control C — colour caught, default not

The severity half failed immediately. The scope-pattern half did not, because the fallback lived inside the submit handler, which no test can reach without a DOM.

### 5.4 Extracting `resolveScopePattern`

Rather than leave "blank means project-wide" as an untested claim behind a click, the fallback moved into an exported pure function. Four assertions cover empty, whitespace-only, supplied, and untrimmed input; re-running the mutation now fails two of them. It is a small example of the general workaround for § 6.1 — pull decisions out of handlers until the handler is only wiring.

---

## 6. Problems Discovered & Concerns

### 6.1 The submit handlers remain untested — fourth task running

Both new dialogs render, validate their disabled state, and pre-populate correctly. Neither has its `onSubmit` executed by any test, because there is still no DOM environment (raised P5.2-02 § 6.3; carried through P5.2-03, P5.3-02, and now here).

What that leaves unverified is narrow but real: that `CreateRuleModal` calls `createRule` with the assembled object, and `UpdateIntentModal` calls `createIntent` with the parsed lists. The store actions themselves are covered, and § 5.4 shows the pattern for clawing individual decisions back into testable functions — but that is a workaround, and each task adds more surface it does not cover.

Four consecutive reports have now ended with this paragraph. It is the single change that would most improve confidence in this phase's output.

### 6.2 Rules cannot be edited or removed

`ProjectMemoryService` exposes `createRule` and `listRules` and nothing else — no update, no delete, no status. So a rule with a typo is permanent, and a rule that stops applying stays in every future agent briefing forever.

Decisions got a full lifecycle in P5.3-01/02 precisely because retiring them matters. Rules are stated to be *stronger* than decisions — "rules you must not break" — and have no retirement path at all. This is a gap in the domain model rather than the UI, and it will look like a UI omission to the first user who makes a typo.

### 6.3 A project can never return to having no intent

`createIntent` archives the previous intent and writes a new one; there is no way to clear it. The briefing renders "No intent has been set" as a first-class state, and after the first save that state becomes permanently unreachable.

Raised as a suggestion in P5.3-02 § 7 and now concrete: the UI makes intent-setting easy and intent-clearing impossible. Either the empty state should be reachable again, or it should be understood as first-run-only.

### 6.4 Carried forward

- **`MemoryStore` still absent from `STORE_ARCHITECTURE.md`** (P5.2-01 § 6.3) — nine components now.
- **`supersededBy` remains bidirectional** (drift § 4). Both views now resolve it correctly, so the *display* problem is solved — the underlying two-meanings-one-field problem is not, and `buildLineage` remains the single place that reads `status` to compensate.
- **Service boundary asymmetry** (P5.3-01 § 6.2), unchanged.
- `pnpm run lint` red on `@asterim/adapters`; `apps/server` has 4 pre-existing `tsc` errors. All figures local.

---

## 7. Recommended Next Step

Phase 5.3 has delivered what it set out to: decisions have a full lifecycle, rules and intent can be curated, and memory is legible in two views. Before calling it complete, two things are worth closing because they are cheap now and awkward later:

1. **A DOM test environment** (§ 6.1). Not a feature task — a repo decision that retires the "partly verified" qualifier from four reports and covers the handlers the next phase will only add more of.
2. **Rule retirement** (§ 6.2). A rule that cannot be withdrawn is a worse problem than a decision that cannot be, because rules are the stronger claim. It needs a service method and a route before any UI, so it belongs in a backend slice rather than being improvised in a component.

**For Phase 5.4 or 6**, the natural next subject is the gap between the two halves of what has been built: an agent records decisions through MCP, a human curates them through this UI, and *neither knows what the other did*. Specifically —

- Agent writes still do not reach the running Core's event bus (`MISSING_SPECIFICATION.md` § 4, open since P5.1-05), so a decision recorded by an agent does not appear in this UI until a refetch.
- Nothing surfaces *which* agent session produced a decision, though `AGENT_STATEMENT` provenance and `recentAgentWork` both exist and could be joined.

Closing the first is the prerequisite for the memory UI feeling live rather than periodically correct, and it is the oldest unaddressed item in the phase.
