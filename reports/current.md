# Execution Report: P5.3-01 — Decision Status Lifecycle REST Endpoint & Store Actions

**Task ID:** P5.3-01
**Phase:** Phase 5.3 — Decision Lifecycle & Memory Curation UI
**Status:** VERIFIED
**Date:** 2026-08-14
**Author:** Claude Code
**Branch:** `main` (working tree)

---

## 1. Summary

The status lifecycle is exposed end to end: `PATCH /api/v1/projects/:id/memory/decisions/:decisionId/status` validates the status, enforces the project boundary, and returns the updated decision; `ProjectMemoryService.updateDecisionStatus` now publishes `memory.decision_updated` carrying the previous status; and `useMemoryStore` gained `updateDecisionStatus` / `archiveDecision` plus live handling of the new event.

**+59 assertions** across three suites, all green, with every other suite in the repo re-run unchanged. `tsc` clean, `pnpm run build` 7/7.

Three mutation runs confirm the new code is genuinely covered — and two of them exposed a flaw in the **test harnesses**, not the implementation: assertions that threw on missing data, aborting the run and hiding every check after them (§ 5.4). Both files now read defensively.

---

## 2. Files Changed

| File | Change |
| :-- | :-- |
| `packages/shared/src/events.ts` | `MemoryDecisionUpdatedPayload` + `MemoryDecisionUpdatedEvent`; `DecisionStatus` import |
| `apps/server/src/services/ProjectMemoryService.ts` | `updateDecisionStatus` publishes `memory.decision_updated` |
| `apps/server/src/routes/memory.ts` | `PATCH …/decisions/:decisionId/status` |
| `apps/web/src/stores/useMemoryStore.ts` | `updateDecisionStatus`, `archiveDecision`, `memory.decision_updated` handling |
| `apps/web/src/hooks/useSocket.ts` | Listener for the new event type |
| `apps/server/src/routes/__tests__/memory.test.ts` | +21 assertions; defensive reads (§ 5.4) |
| `apps/server/src/services/__tests__/ProjectMemoryService.test.ts` | +14 assertions; defensive reads (§ 5.4) |
| `apps/web/src/stores/__tests__/useMemoryStore.test.ts` | +24 assertions |

Three source files were mutated for negative controls and restored byte-identically (`md5 d7920c72…`, `139ca81d…`, `bc7342f0…`).

**Not modified:** no existing endpoint altered or removed; no cross-project modification permitted. The § 5 prohibitions hold.

---

## 3. Implementation Details

### 3.1 The event carries what the new state cannot

```ts
this.publishMemoryEvent<MemoryDecisionUpdatedPayload>('memory.decision_updated', {
  projectId: updated.projectId,
  decision: updated,
  previousStatus: existing.status
});
```

`previousStatus` is the part worth arguing for. A subscriber receiving only the new state can see *that* a decision is now `ARCHIVED`, but not whether it was retired from active use or merely moved out of `STALE` — and those read very differently in a timeline. The service already holds `existing` for its not-found check, so carrying it costs nothing.

`archiveDecision` delegates to `updateDecisionStatus`, so it publishes through the same path — asserted, so the delegation cannot be quietly replaced with a direct write that skips the event.

### 3.2 The route is the only project guard

`updateDecisionStatus(id, status)` takes a decision id alone and will happily retire a decision in any project. The scope check therefore lives in the route:

```ts
const existing = projectMemoryService.getDecision(decisionId);
if (!existing) { reply.code(404); … }
if (existing.projectId !== id) { reply.code(400); … }
```

This is the same shape as the MCP write boundary (DEC-023): **one line of application code with no database-level backstop**. Mutation A removes it and a cross-project archive succeeds silently.

The rejection message names the decision and the *requested* project, and deliberately **not** the owning project. `IMPLEMENTATION_DRIFT.md` § 8 records that the existing supersede route leaks the owner's id in exactly this situation; there was no reason to repeat it. An assertion pins the non-disclosure so it cannot regress.

### 3.3 Deviation — payload placed in `events.ts`, not `types/memory.ts`

The task specifies `packages/shared/src/types/memory.ts`. The other four `Memory*Payload` interfaces all live in `packages/shared/src/events.ts`, alongside every other event payload; `types/memory.ts` holds domain types and the REST request bodies. Splitting one payload away from its four siblings would make the set harder to find, not easier, so it went with them. Both are re-exported from the package root, so no consumer can tell the difference.

### 3.4 Store

`updateDecisionStatus` PATCHes and then upserts through the same `upsertDecision` / `applyDecisionToBriefing` helpers the other write paths use, so `briefing.activeDecisions` stays correct in **both** directions — a decision leaving `ACTIVE` drops out, and one returning to `ACTIVE` reappears. That reversibility matters: `STALE` is not a terminal state.

`archiveDecision` is a one-line delegation rather than a second fetch path, and the test asserts it sends `{ status: 'ARCHIVED' }` to the same endpoint.

No change was needed in `socketManager`: it forwards on the catch-all by payload `projectId` rather than an allow-list, as verified end to end in P5.2-01 § 4.3. The new event reaches clients by virtue of carrying `projectId`.

---

## 4. Tests / Verification

```
apps/server
  memory.test.ts .................  98/98    (was 77, +21)
  ProjectMemoryService.test.ts ... 231/231   (was 217, +14)

apps/web
  useMemoryStore.test.ts ......... 113/113   (was 89, +24)
  DecisionExplorer.test.ts .......  78/78
  MemoryTimeline.test.ts .........  66/66

packages/mcp-memory-server (regression, shared changed)
  resolver 42/42 · record_decision 82/82 · dogfood_scenario 62/62

tsc --noEmit (web)  0 errors   ·   eslint  0 errors, 2 warnings
pnpm --filter @asterim/shared build  ok   ·   pnpm run build  7 successful, 7 total
```

`apps/server` still reports its **4 pre-existing** `tsc --noEmit` errors (`AuthController`, `AgentService`, `ContextService`, `GeminiProvider`). Confirmed none is in a file this task touched.

### 4.1 Acceptance criteria

| # | Criterion | Result |
| :-- | :-- | :-- |
| 1 | PATCH validates, enforces boundaries, updates SQLite, publishes | **Met** — 21 route assertions incl. persistence re-read; publish asserted in the service suite |
| 2 | Store exposes both actions and maintains `briefing.activeDecisions` | **Met** — both directions asserted |
| 3 | Socket event updates state in real time | **Met at the store layer** — see § 6.1 for what is and is not proven |
| 4 | Build and regressions pass | **Met** — 7/7, every suite green |

### 4.2 The endpoint tests check persistence, not just the response

After each transition the suite re-reads through `GET /decisions?status=…` and `GET /briefing`, so a handler that returned a plausible object without writing would fail. It also asserts the round trip `ACTIVE → STALE → ACTIVE → ARCHIVED`, that `updatedAt` moves forward, and that a rejected cross-project write left the decision exactly as it was.

---

## 5. Negative Controls

| # | Mutation | Result | Verdict |
| :-- | :-- | --: | :-- |
| A | Route's cross-project check removed | 94/98 | caught — 4 failures |
| B | `updateDecisionStatus` publishes nothing | 218/231 | caught — 13 failures |
| C | Store's `decision_updated` ignores the briefing | 112/113 | caught — 1 failure |

### 5.1 Control A

Without the guard, `PATCH /projects/B/decisions/<A's decision>/status` returns **200** and the write lands. Four assertions fail, including the one confirming the decision was untouched afterwards. This is the boundary the task's § 5 forbids crossing, and it rests entirely on those two lines.

### 5.2 Control B

Dropping the publish fails all thirteen event assertions, including the `archiveDecision` delegation and the previous-status field. Criterion 1's "publishes `memory.decision_updated`" is therefore pinned rather than assumed.

### 5.3 Control C

Removing `applyDecisionToBriefing` from the event handler leaves the decision list correct but the briefing stale — an archived decision keeps showing as active. One assertion catches it, which is thin but exact; the same helper is already covered from three other call sites.

### 5.4 Two controls exposed brittle test harnesses

Under mutations A and B the suites reported **91** and **185** assertions instead of 98 and 231. They were not failing early by design — an assertion **threw**:

- `crossProject.json().error.includes(...)` — `error` is absent when the guard passes the request through, so `.includes` threw on `undefined`.
- `captured[0].event.type` — `captured` is empty when nothing is published, so the property access threw.

In both cases `main()` unwound to the catch and every subsequent assertion silently never ran. The mutations were still caught, but the reports understated the damage and would have hidden any *unrelated* regression further down the file.

Both are now read defensively (`String(x ?? '')`, optional chaining). Re-run under the same mutations they report 94/98 and 218/231 — the full suite executes and every consequence is visible.

This is worth recording as a harness-wide concern: these standalone scripts have no per-assertion isolation, so **any** assertion that dereferences possibly-absent data can mask the rest of its file. The pattern appears elsewhere in these suites.

---

## 6. Problems Discovered & Concerns

### 6.1 Criterion 3 is verified at the store, not across a socket

The store applies `memory.decision_updated` correctly (7 assertions), `useSocket` registers the listener, and P5.2-01 proved end to end that a `memory.*` event with a `projectId` reaches a connected client. Composing those three is strong evidence, but **no test in this task drives an actual socket**, so "across connected clients" rests on that composition rather than on a direct observation.

The P5.2-01 probe that did drive a real socket was temporary. If cross-client sync is going to be claimed repeatedly, it is worth making that probe a standing test rather than re-deriving the argument each phase.

### 6.2 The service still has no project scoping

`updateDecisionStatus(id, status)` and `archiveDecision(id)` are callable with a bare decision id from anywhere in the process. Today the REST route is the only caller and it checks; nothing structurally prevents the next caller from not checking.

`supersedeDecision` takes the opposite approach — it validates `projectId` **inside** the service and throws on a mismatch. Two adjacent methods on the same service now differ in where the boundary is enforced, and the weaker of the two is the one the new endpoint depends on. Worth aligning before P5.3-02 adds UI that calls both.

### 6.3 A no-op transition still publishes

`updateDecisionStatus(id, 'ARCHIVED')` on an already-`ARCHIVED` decision writes `updated_at`, so it publishes an event whose `previousStatus` equals the new status. Deliberate — the row genuinely changed — and asserted, but a client rendering "moved from X to Y" should expect `X === Y`. Cheap to filter at the UI layer; recorded so it is a known shape rather than a surprise.

### 6.4 `apps/server/pairing_pin.txt` shows as modified

The file is tracked in git and rewritten by `PairingService` on construction, so running the server-side suites dirties it. Not caused by this task's changes and not reverted, but a tracked file that every test run modifies is noise in every diff. It probably belongs in `.gitignore`.

### 6.5 Carried forward

- **`MemoryStore` is still absent from `STORE_ARCHITECTURE.md`** (P5.2-01 § 6.3) — now four components and eleven actions deep.
- **`supersededBy` is still bidirectional** (drift § 4). The new endpoint does not touch it, but P5.3-02's supersede dialog will.
- **No DOM test environment** (P5.2-02 § 6.3).
- `pnpm run lint` remains red on `@asterim/adapters`. All figures here are local verification.

---

## 7. Recommended Next Step

Proceed to **P5.3-02 — Interactive Supersede & Archive UI Dialogs**. The store now exposes every write the UI needs: `createDecision`, `supersedeDecision`, `updateDecisionStatus`, `archiveDecision`. Four things to settle with it:

1. **Archive needs confirmation; status changes do not.** Archiving is the one action that removes a decision from every agent briefing — it is what a future session will *not* be told. A plain menu item is too quiet for that; `STALE` and back is reversible and can be immediate.
2. **Launch supersede from the timeline.** Lineage is already the primary structure there (`buildLineage`), and superseding is the act that creates a link — doing it where the chain is visible is the natural placement. It is also the write path the Record modal does not exercise.
3. **Align the service boundary** (§ 6.2) before the UI calls both methods, so a supersede and an archive fail the same way for the same reason.
4. **Decide what an archived decision looks like** in the explorer. Right now the status filter can surface it, but the default `all` view mixes retired decisions with live ones at equal weight — which works against the reason for archiving something in the first place.
