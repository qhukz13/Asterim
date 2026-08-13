# Execution Report: P5.3-02 — Interactive Decision Supersede & Archive UI Dialogs

**Task ID:** P5.3-02
**Phase:** Phase 5.3 — Decision Lifecycle & Memory Curation UI
**Status:** VERIFIED
**Date:** 2026-08-14
**Author:** Claude Code
**Branch:** `main` (working tree)

---

## 1. Summary

Decisions can now be superseded, marked stale, reactivated, and archived from both the Explorer and the Timeline. Supersede and Archive open dialogs; Mark stale and Reactivate apply immediately.

**+41 assertions** (99/99 and 95/95 in the two component suites), every other suite unchanged, `tsc` clean, `pnpm run build` 7/7, plus screenshots of the controls and the archive confirmation.

The controls live in **one shared component** rather than being written into each view. That is the load-bearing decision here: two copies would drift the moment either view gained an action, and one of the negative controls (§ 5.3) is specifically a parity check that catches exactly that.

---

## 2. Files Changed

**Created**

| File | Lines | Purpose |
| :-- | --: | :-- |
| `apps/web/src/components/memory/DecisionActions.tsx` | 153 | `availableActions` rule + the shared control strip |
| `apps/web/src/components/memory/SupersedeDecisionModal.tsx` | 268 | Replacement capture, pre-populated |
| `apps/web/src/components/memory/ArchiveDecisionModal.tsx` | 174 | Archive confirmation |
| `docs/screenshots/p5.3-02/{decision-actions,archive-confirm}-1440.png` | — | Visual evidence |

**Modified**

| File | Change |
| :-- | :-- |
| `apps/web/src/components/memory/DecisionExplorer.tsx` | `DecisionCard` takes `projectId` and renders `DecisionActions`; passes `projectId` to the timeline |
| `apps/web/src/components/memory/MemoryTimelineView.tsx` | `projectId` prop; `TimelineEntry` renders `DecisionActions` |
| `apps/web/src/components/memory/__tests__/DecisionExplorer.test.ts` | +21 assertions |
| `apps/web/src/components/memory/__tests__/MemoryTimeline.test.ts` | +29 assertions |

`DecisionActions.tsx` and `SupersedeDecisionModal.tsx` were mutated for negative controls and restored byte-identically (`md5 4a62ad69…`, `b94eb9d5…`).

**Not modified:** no backend route, no MCP server, no deletion path — every retirement is a status transition. The § 5 prohibitions hold.

---

## 3. Implementation Details

### 3.1 One rule, one component

```ts
export function availableActions(decision: ProjectDecision): DecisionAction[] {
  switch (decision.status) {
    case 'ACTIVE': return ['supersede', 'stale', 'archive'];
    case 'STALE':  return ['reactivate', 'supersede', 'archive'];
    default:       return [];
  }
}
```

`DecisionActions` owns its own dialog state and calls the store directly, so both views get identical behaviour by rendering the same element. It returns `null` when there are no actions **or when `projectId` is null**, so a control that would call the store with a null id never renders.

### 3.2 Terminal states are terminal *in the UI only*

`SUPERSEDED` and `ARCHIVED` offer nothing. The REST surface can still move them and the timeline still shows them — this is a UI judgement, not a data one.

The reason is specific to supersession: offering "Reactivate" on a decision that another decision has already replaced would produce **two live decisions contradicting each other, from one click**, with no prompt and nothing in the system to flag the conflict. Reviving a retired position is a real decision and should go through recording one. Archived decisions are grouped with them for consistency; reactivating those is safe in principle, and § 7 suggests where to put it if it is wanted.

### 3.3 Archive is confirmed; stale is not

Archiving is the only action whose effect is invisible where it matters: the decision leaves every future agent briefing, so the next session is simply never told about it, and nothing announces that absence. The dialog states all three consequences explicitly — retired from briefings, kept in the timeline, nothing deleted — and its escape is labelled "Keep it" rather than "Cancel", because the question is about the decision, not the dialog.

`Mark stale` / `Reactivate` apply directly. They are one click apart from each other in both directions, so a confirmation would be ceremony.

### 3.4 The supersede dialog carries the old decision forward

Constraints and related files are pre-populated, because a replacement usually inherits most of what it replaces and retyping constraints from memory is how they quietly get dropped.

`initialRelatedFiles` does slightly more than read `relatedFiles`. That field is derived from *file-only* code refs, so a decision anchored to `src/auth.ts#hashPassword` has an empty `relatedFiles` and would lose its anchor on being superseded. The helper folds anchor paths back in, strips the symbol, and skips symbol-only anchors so a bare `hashPassword` is never mistaken for a filename. Four assertions cover those cases.

### 3.5 Palette: amber for retirement

`DESIGN_SYSTEM.md` calls for monochrome plus a single emerald accent, and P5.2-02 stayed strictly inside that. This task specifies amber for archive/stale, and `tokens.css` already defines `--color-state-paused: #f59e0b`, used elsewhere in the app (the disconnection banner).

Reading these together: emerald is the *interactive* accent — the primary action, what is in force — while the state colours are a separate documented axis. Retirement is not a primary action and should not look like one, so the archive confirm button is an amber outline rather than a filled emerald button. An assertion pins that it is **not** the emerald primary (`#042114`, the emerald button's text colour), so a future refactor cannot quietly make archiving look like the happy path.

---

## 4. Tests / Verification

```
DecisionExplorer.test.ts ........  99/99   (was 78, +21)
MemoryTimeline.test.ts .........  95/95   (was 66, +29)
useMemoryStore.test.ts ......... 113/113
memory.test.ts (routes) ........  98/98
ProjectMemoryService.test.ts ... 231/231

tsc --noEmit  0 errors  ·  eslint  0 errors, 44 warnings  ·  pnpm run build  7/7
```

### 4.1 Acceptance criteria

| # | Criterion | Result |
| :-- | :-- | :-- |
| 1 | Supersede launchable from active decisions in both views | **Met** — rendered controls asserted in both, plus a parity assertion |
| 2 | Dialog pre-populates and creates the replacement | **Pre-population met** (9 assertions); **creation partly verified** — see § 6.1 |
| 3 | Archive confirms and marks `ARCHIVED` | **Dialog met** (8 assertions); **the write partly verified** — § 6.1 |
| 4 | Stale / Reactivate toggle without dialogs | **Met** — `actionNeedsConfirmation` asserted for all four; controls render per status |
| 5 | Build and typecheck clean | **Met** |

### 4.2 Visual QA

`docs/screenshots/p5.3-02/`. The capture shows all three cases at once: the ACTIVE card offering Supersede / Mark stale / Archive, the STALE card offering Reactivate / Supersede / Archive, and the SUPERSEDED card offering nothing while keeping its lineage line. Amber reads as caution without shouting; the emerald stays on Record decision and the ACTIVE badge.

---

## 5. Negative Controls

| # | Mutation | Result | Verdict |
| :-- | :-- | --: | :-- |
| A | Terminal states return the full action list | 96/99 + 94/95 | caught — 4 failures across both suites |
| B | Supersede dialog stops pre-populating | 92/95 | caught — 3 failures |
| C | `DecisionActions` removed from the Timeline only | 89/95 | caught — 6 failures |

### 5.1 Control A

Making `SUPERSEDED`/`ARCHIVED` mutable fails in both suites — the logic assertions and the rendered-card assertions independently. This is the § 3.2 rule, and it is the one whose violation produces contradictory live decisions.

### 5.2 Control B

Emptying the pre-populated fields fails three assertions, including the one checking constraints are joined one-per-line. Criterion 2's pre-population requirement is pinned rather than assumed.

### 5.3 Control C — the parity assertion earns its place

Removing `DecisionActions` from the Timeline while leaving the Explorer untouched fails six assertions, including:

```
FAIL  the same decision offers the same actions in both views
      — expected [], got ["Supersede","Mark stale","Archive"]
```

That assertion renders one identical decision through both views and compares which labels appear. It exists because "add the same controls to two components" is exactly the requirement that rots — and it fails on divergence in either direction, not just this one.

---

## 6. Problems Discovered & Concerns

### 6.1 The writes themselves are still not exercised

Every dialog is rendered, every control is asserted present or absent, and `parseList` / `initialRelatedFiles` / `availableActions` are tested directly. But **no test clicks anything**: `onClick`, the submit handler, and the store call inside it are typed and rendered, never run. There is still no DOM test environment (raised P5.2-02 § 6.3, unchanged).

So criteria 2 and 3 are marked **partly verified**. What *is* verified: the store actions they call are covered by `useMemoryStore.test.ts` (24 assertions added in P5.3-01), and the endpoint beneath those by `memory.test.ts` (21). The untested span is the wiring — that this button calls that action with these arguments.

The gap has now been carried through three UI tasks and is the reason a plausible-looking regression could ship green. It is the single highest-value thing Phase 5.3 could fix, and it is a repo-level decision (`jsdom` + a renderer), not something to slip into a feature task.

### 6.2 The Explorer shows a raw id where the Timeline shows a title

Visible in the screenshot: the superseded card reads **"Superseded by d1"**. The Timeline resolves the same link to "Replaced by Hash passwords with Argon2id", because `buildLineage` looks the counterpart up in the decision list; `DecisionCard` was written in P5.2-02 before that helper existed and prints `decision.supersededBy` directly.

Now that both views sit side by side under one toggle, the same relationship reads as a title in one and an opaque id in the other. The fix is small — pass the decision list into `DecisionCard` and reuse `buildLineage` — but it is beyond this task's scope, which asked only that terminal decisions render lineage read-only, which they do.

### 6.3 Reactivating an archived decision has no route in the UI

§ 3.2 removes all actions from terminal states, so an archived decision cannot be brought back from the interface, even though `updateDecisionStatus` supports it and the archive dialog **tells the user it can be reactivated** ("it can be reactivated from the decision history").

That sentence is currently a promise about the REST API. Either the dialog's wording should be narrowed, or archived — not superseded — decisions should regain a Reactivate control. I left the capability out rather than the sentence, because the sentence is what makes archiving feel safe, and § 7 proposes where the control belongs.

### 6.4 Carried forward

- **`MemoryStore` still absent from `STORE_ARCHITECTURE.md`** (P5.2-01 § 6.3) — seven components now.
- **Service-layer boundary asymmetry** (P5.3-01 § 6.2): `supersedeDecision` validates the project inside the service and throws; `updateDecisionStatus` does not. The supersede and archive dialogs now call both, so a cross-project failure surfaces differently depending on which the user chose. Nothing in the UI can trigger it today, but it is the kind of divergence that becomes a bug when the relay adds a second client.
- **`supersededBy` remains bidirectional** (drift § 4). The supersede dialog now creates these links from the UI, so the field has gained a writer as well as two readers.
- `pnpm run lint` remains red on `@asterim/adapters`; `apps/server` still has 4 pre-existing `tsc` errors. All figures local.

---

## 7. Recommended Next Step

Proceed to **P5.3-03 — Rules & Intent Curation UI**. Three things to carry in:

1. **Reuse `DecisionActions`' shape, not its code.** Rules and intents have their own lifecycles (an intent is archived by its successor; a rule has severity but no status). A parallel `availableActions` per entity, each with a parity assertion, keeps them honest without forcing one abstraction over three different domains.
2. **Settle § 6.3 while archiving is fresh.** A Reactivate control on `ARCHIVED` — but not `SUPERSEDED` — is a two-line change to `availableActions`, and it makes the archive dialog's promise true. That distinction is also a genuinely useful piece of product reasoning to record.
3. **Intent has no delete or archive path at all.** `createIntent` archives the previous one implicitly, so a project can never return to having *no* intent once one is set. Worth deciding before the UI makes that shape visible, since the briefing already renders "No intent has been set" as a first-class state that becomes unreachable after the first write.

And the standing recommendation from § 6.1: **a DOM test environment would retire the "partly verified" qualifier from this report and the last two.** Every UI task in this phase has ended with the same untested span, and it grows with each one.
