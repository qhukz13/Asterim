# Execution Report: P5.2-01 — Project Memory Store & Real-Time Event Integration

**Task ID:** P5.2-01
**Status:** VERIFIED
**Date:** 2026-08-14
**Author:** Claude Code
**Branch:** `main` (working tree)

---

## 1. Summary

`useMemoryStore` is implemented with all eight REST actions plus `handleMemoryEvent`, and `useSocket` routes the four `memory.*` events into it. **89/89 assertions** in a new standalone suite; `tsc --noEmit` clean; `pnpm run build` 7/7.

Real-time updating was not taken on trust. A probe against a **running server** — pair by PIN, join the project room, POST a decision over REST — confirmed `memory.decision_created` and `memory.rule_created` arrive at a connected Socket.IO client with `projectId` intact. Acceptance criterion 3 holds end to end, with no backend change.

That probe also settled a contradiction. `blueprint/audit/IMPLEMENTATION_DRIFT.md` § 7 stated that `socketManager` forwards only an allow-list of event types and that `memory.*` was excluded. **No such allow-list exists** — it subscribes to `'*'` and routes by payload. Acting on the old text would have meant adding forwarding code that duplicates what is already there. § 7 has been corrected (§ 6.2).

Two other deviations from the task text, both flagged below: the endpoint prefix is `/api/v1/...`, not `/api/...` (§ 6.1), and the `Create*Input` types the task names are server-internal, so wire-contract types were added to `@asterim/shared` instead (§ 3.2).

---

## 2. Files Changed

**Created**

| File | Lines | Purpose |
| :-- | --: | :-- |
| `apps/web/src/stores/useMemoryStore.ts` | 372 | Project Memory state, REST actions, live event application |
| `apps/web/src/stores/__tests__/useMemoryStore.test.ts` | 390 | Standalone assertion suite with a recording `fetch` stub |

**Modified**

| File | Change |
| :-- | :-- |
| `apps/web/src/hooks/useSocket.ts` | Four `memory.*` listeners; routed to the store ahead of the thread filter |
| `packages/shared/src/types/memory.ts` | +5 request-body contract types (§ 3.2) |
| `apps/web/package.json` | +`tsx` devDependency, so the suite can be run at all |
| `blueprint/audit/IMPLEMENTATION_DRIFT.md` | § 7 corrected — it described forwarding behaviour that does not exist (§ 6.2) |

`useMemoryStore.ts` was mutated three times for negative controls and restored byte-identically (`md5 36b44896b5b5fb67a53f59d057bf6d5e`).

**Not modified:** no backend route, no database table, no socket authentication. The § 5 prohibitions hold.

---

## 3. Implementation Details

### 3.1 Store shape and scoping

The store holds one project's memory at a time and records which in `projectId`. Every fetch adopts the project it was asked for; `handleMemoryEvent` discards any event whose `payload.projectId` does not match.

Socket rooms are already keyed by project, so a foreign event should never arrive — but the cost of being wrong is displaying one project's decisions as another's, which is precisely the confusion project memory exists to prevent. The guard is three lines and is covered by three assertions.

`fetchBriefing` also adopts `briefing.architecturalRules` and `briefing.currentIntent` into `rules` and `activeIntent`, since the briefing already carries them. A view that wants everything makes one request, not three.

### 3.2 Deviation — wire contract types, not the server's `Create*Input`

The task names `CreateDecisionInput`, `CreateRuleInput`, `CreateIntentInput`, `SupersedeDecisionInput`. The first three exist only in `apps/server/src/services/ProjectMemoryService.ts`; the fourth does not exist anywhere. None is exported from `@asterim/shared`.

The web app cannot import them: reaching into `apps/server` source from the browser bundle is the coupling already recorded as drift § 9, and duplicating them into `apps/web` is the anti-pattern `CLAUDE.md` names explicitly.

Five types were therefore added to `packages/shared/src/types/memory.ts` — the correct home for a cross-boundary contract — named `CreateDecisionRequest`, `SupersedeDecisionRequest`, `CreateRuleRequest`, `CreateIntentRequest`, `CreateCodeRefRequest`.

They are **not** renamed copies. The service's `Create*Input` types carry `projectId`; the request bodies do not, because the route reads it from the URL path. That difference is real and is asserted (`the body carries no projectId — the path does`). The `Request` suffix keeps the two distinguishable at a glance, which a same-named pair in two packages would not.

### 3.3 Idempotent application

The same decision arrives twice on the happy path — once as the POST response, once as the socket event that write produced. Both `createDecision` and `handleMemoryEvent` therefore **upsert by id** rather than prepend, and re-sort to the server's `created_at DESC, id DESC`. Without this, every write the user makes appears twice in the explorer.

`briefing.activeDecisions` is maintained alongside: a decision entering as `ACTIVE` is added, and one leaving `ACTIVE` (superseded, archived) is removed, so the briefing never shows two live decisions where one has just retired the other.

`memory.decision_superseded` carries `decision` only when the replacement was created in the same operation. The handler marks the old decision either way and adds the replacement only when it was actually sent — asserted in both directions.

### 3.4 Socket routing

Memory events are handled **before** the thread filter in `handleInternalEvent`, following the `file.changed` precedent. They are project-scoped, not thread-scoped: a decision belongs to the project whichever thread happened to be open when an agent recorded it. Placed after the filter, they would still pass today (the payloads carry no `threadId`), but only by accident.

### 3.5 Reads vs writes

Fetches swallow their error into `state.error` so a passive view can render it. Writes set `error` **and** reject, because a caller submitting a form needs to know whether it was accepted. Both surface the server's own `{ error }` message — a rejected decision says which field was wrong, which a bare status code would lose.

---

## 4. Tests / Verification

```
$ pnpm --filter @asterim/web exec tsx src/stores/__tests__/useMemoryStore.test.ts
  initial state ..................................  7 PASS
  fetchBriefing .................................. 10 PASS
  fetchDecisions .................................  3 PASS
  fetchRules and fetchIntent .....................  6 PASS
  error handling .................................  6 PASS
  createDecision ................................. 10 PASS
  supersedeDecision ..............................  5 PASS
  createRule and createIntent ....................  7 PASS
  isMemoryEvent ..................................  6 PASS
  handleMemoryEvent — decision_created ...........  5 PASS
  handleMemoryEvent — ordering and scoping .......  4 PASS
  handleMemoryEvent — decision_superseded ........  6 PASS
  handleMemoryEvent — rules and intent ...........  7 PASS
  events before any fetch ........................  2 PASS
  reset ..........................................  6 PASS
  89/89 assertions passed                            EXIT=0

$ pnpm --filter @asterim/web exec tsc --noEmit ....  0 errors
$ pnpm --filter @asterim/web build ...............  built, PWA precache 11 entries
$ pnpm run build .................................  7 successful, 7 total
```

**Regression suites** — re-run because `packages/shared` changed:

```
resolver 42/42 · stdio_scaffold 28/28 · retrieval_tools 71/71
record_decision 82/82 · dogfood_scenario 62/62
ProjectMemoryService 217/217 · memory routes 77/77
```

`eslint` on the three changed web files: 0 errors, 23 warnings — all pre-existing categories in this app (`no-explicit-any` on socket payloads, which `useSocket` already uses throughout).

### 4.1 Acceptance criteria

| # | Criterion | Result |
| :-- | :-- | :-- |
| 1 | Store represents the `@asterim/shared` domain models | **Met** — every field typed from shared; no local redefinition |
| 2 | REST methods call the `/memory/*` endpoints with error handling | **Met** — exact URLs, methods and bodies asserted; server error text surfaced |
| 3 | Socket listener updates state in real time | **Met** — and verified against a running server (§ 4.3) |
| 4 | `pnpm run build` 0 errors | **Met** — 7/7 |

### 4.2 The test asserts requests, not just results

The `fetch` stub **records** every call, so the suite checks the exact URL, method, headers and body the store sends — not merely that it did something with the response. A mock that only returned canned data would have passed just as happily with the wrong endpoint prefix, which is the one mistake the task text would have led to.

### 4.3 End-to-end socket verification

A temporary probe started the real server on a temp data dir, paired via `pairing_pin.txt` for a socket token, joined the project room, and created a decision and a rule over REST:

```
POST /decisions -> 201
events received over socket: memory.decision_created, memory.rule_created
payload keys of first: projectId, decision
projectId present: proj-e2e
```

This is the claim the whole task rests on, and it was contradicted by the blueprint, so reading the code was not enough. The probe was removed after use.

---

## 5. Negative Controls

| # | Mutation | Result | Verdict |
| :-- | :-- | --: | :-- |
| A | Endpoint prefix `/api/v1/...` → `/api/...` (the task's stated path) | 80/89 | caught — 9 failures |
| B | Project scoping guard removed from `handleMemoryEvent` | 86/89 | caught — 3 failures |
| C | `upsertDecision` becomes a plain append | 87/89 | caught — 2 failures |

**A** is the most valuable: it is the exact error the task text invites, and nine assertions reject it. **B** confirms the scoping guard is tested and not decorative. **C** shows the echo-duplication case is pinned — the mutation makes every user-made decision appear twice, and the suite says so.

---

## 6. Problems Discovered & Concerns

### 6.1 The task's endpoint prefix is wrong

The task says the routes are under `/api/projects/:projectId/memory` "(or `/memory`)". They are all under **`/api/v1/projects/:id/memory/...`** — eight of them, matching `CLAUDE.md`'s statement that REST routes live under `/api/v1/...`. The store uses `/api/v1`, the tests assert it, and mutation A proves the assertion bites.

### 6.2 `IMPLEMENTATION_DRIFT.md` § 7 described behaviour that does not exist — corrected

The entry read: *"`socketManager` forwards only a specific set of event types to project rooms, and `memory.*` is not among them,"* with the recommended action *"Add the four types to the Socket.IO forwarding set when a memory UI is built."*

`socketManager.setupEventBusBridge` contains no allow-list. It subscribes to `'*'` and routes anything carrying a `projectId` to that project's room. All four memory payloads carry one. Verified against a running server (§ 4.3).

Had I followed the blueprint instead of reading the code, this task would have shipped forwarding logic duplicating what already runs. The entry was rewritten to describe the actual behaviour and retargeted at the real, unspecified issue: those payloads embed **full decision objects with every code ref**, and the same catch-all both broadcasts them and writes them into the `events` table. A decision's full text is duplicated into the event log on every write and again on every supersede — and that log is subject to `PruningService` retention designed for transient agent telemetry, not durable reasoning.

This is the second stale entry found in that file in two tasks (§ 3 last task). The audit documents are being trusted as normative while drifting from the code they describe. **Worth a pass over the remaining entries before Phase 5.2 builds further on them.**

### 6.3 `MemoryStore` is not in `STORE_ARCHITECTURE.md`

`blueprint/STORE_ARCHITECTURE.md` enumerates the permitted stores; `MemoryStore` is not among them, and `CLAUDE.md` requires that hierarchy to be respected and forbids inventing architecture without a Change Proposal.

The store was implemented as assigned — Phase 5.2 is a sanctioned phase and this task explicitly commissions the file — and written to fit the documented pattern rather than beside it. **I did not edit the blueprint**, since that requires a Change Proposal from `.agents/templates/`. Proposed entry, for whoever raises it:

> ### MemoryStore
> * **Ownership:** Project decisions, architectural rules, active intent, and the re-entry briefing.
> * **Lifetime:** Exists while a Project is selected.
> * **Persistence:** SQLite (via `/api/v1/projects/:id/memory/*`).
> * **Synchronization:** EventBus (`memory.*` over Socket.IO).
> * **Parent Store:** ProjectStore.
> * **Responsibilities:** Serving the Decision Explorer and Memory Timeline. *Rule:* holds project-scoped memory only; it never mirrors thread or execution state.

### 6.4 `reset()` is not yet called anywhere

The store exposes `reset()` for project switches, but nothing invokes it — no component consumes the store yet. Until P5.2-02 wires it, switching projects leaves the previous project's decisions in state until a fetch replaces them.

The consequences are bounded: `handleMemoryEvent` rejects foreign events, so nothing *corrupts*. But a view mounted before its first fetch resolves would briefly render the previous project's memory. **`reset()` must be called on project change in P5.2-02** — most naturally from the same effect that triggers `fetchBriefing`.

### 6.5 `@asterim/shared` must be rebuilt before dependents typecheck

`packages/shared/package.json` sets `"main": "src/index.ts"` but `"types": "dist/index.d.ts"`. Adding a type to shared therefore does nothing for consumers until `pnpm --filter @asterim/shared build` regenerates the declarations — `tsc --noEmit` in `apps/web` failed with "has no exported member" until it was rebuilt, despite the source being correct.

Turbo's `dependsOn` handles this for `pnpm run build`, so CI is unaffected. It is a trap for anyone typechecking a single package during development, and it is not documented.

### 6.6 Pre-existing, unchanged

`pnpm run lint` remains red on `@asterim/adapters`; `apps/server` still has 4 `tsc --noEmit` errors. Neither is touched by this task. All figures above are local verification.

---

## 7. Recommended Next Step

Proceed to **P5.2-02 — Decision Explorer UI**. The store is ready to be consumed; three things should land with the first component:

1. **Call `reset()` on project change** (§ 6.4), from the same effect that calls `fetchBriefing`.
2. **Raise the `STORE_ARCHITECTURE.md` Change Proposal** (§ 6.3). Phase 5.2 will add at least a Memory Timeline and a Re-entry Briefing view; settling where memory sits in the hierarchy before three components depend on it is cheaper than after.
3. **Decide what the explorer reads.** `fetchBriefing` already returns rules, intent, and *active* decisions in one request. `fetchDecisions` is only needed for non-ACTIVE history — worth being deliberate about, since calling both on mount issues two requests where one suffices.

For the UI itself, `DESIGN_SYSTEM.md` governs: monochrome surfaces, single emerald accent, no gradients. A decision carries `provenance` and `confidence`, and per **DEC-024** those exist precisely so a reviewer can tell what an agent asserted from what a human approved. The explorer should make that distinction visible — an `AGENT_STATEMENT` at 0.75 should not look identical to a `HUMAN_CONFIRMED` at 1.0.
