# Execution Report: P5.4-03 — Decision Extraction Queue & Candidate Review UI

**Task ID:** P5.4-03
**Phase:** Phase 5.4 — Intelligent Memory & Continuous Governance
**Status:** VERIFIED
**Date:** 2026-08-14
**Author:** Claude Code

---

## 1. Summary

The staged extraction pipeline is complete end to end: a `candidate_decisions` table, a local transcript extractor, the four-endpoint review lifecycle, store actions, and a review queue in the Decision Explorer. Nothing an extractor proposes can reach `project_decisions` without a person clicking Approve — and that is enforced structurally, not by convention: `approveCandidate` is the only code path between the two tables.

**+149 assertions** across three new suites. Every existing suite in the repository re-run unchanged. `tsc --noEmit` clean on `@asterim/web` and `@asterim/adapters`; `apps/server` holds its 4 pre-existing errors, none in a touched file. `pnpm run build` 7/7.

Four mutation runs, including one for each forbidden change in § 6 of the task. Two implementation bugs were found and fixed by the tests during development (§ 7) — one of them a path-traversal pattern that silently *normalised* an escaping path into a plausible in-project anchor, which is worse than accepting it.

---

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `packages/shared/src/types/memory.ts` | Modified | `CandidateStatus`, `CandidateDecision`, `CreateCandidateInput` |
| `apps/server/src/services/DatabaseService.ts` | Modified | `candidate_decisions` table + two indexes |
| `apps/server/src/services/memory/DecisionExtractor.ts` | Created | Local transcript analysis and anchor safety |
| `apps/server/src/services/ProjectMemoryService.ts` | Modified | `createCandidate`, `getCandidate`, `listCandidates`, `approveCandidate`, `rejectCandidate`; `parseJsonArray` helper |
| `apps/server/src/routes/memory.ts` | Modified | Four candidate endpoints |
| `apps/web/src/stores/useMemoryStore.ts` | Modified | `candidates` state, `fetchCandidates`, `approveCandidate`, `rejectCandidate` |
| `apps/web/src/components/memory/CandidateReviewDrawer.tsx` | Created | Review queue banner and cards |
| `apps/web/src/components/memory/DecisionExplorer.tsx` | Modified | Renders the queue; fetches candidates on project change |
| `apps/server/src/services/memory/__tests__/DecisionExtractor.test.ts` | Created | 60 assertions |
| `apps/server/src/routes/__tests__/memory-candidates.test.ts` | Created | 52 assertions |
| `apps/web/src/components/memory/__tests__/CandidateReview.test.ts` | Created | 37 assertions |
| `docs/screenshots/p5.4-03/candidate-review-1440.png` | Created | Visual evidence of both queue states |

---

## 3. Implementation Details

### 3.1 Extraction is pattern matching, and says so

DEC-028 § 4 requires extraction to run locally without transmitting transcripts, which rules out asking a model. `DecisionExtractor` is therefore a marker-based reader over `chat.message` and `agent.log` rows: a weighted set of decision phrases, a rationale marker set, and a constraint marker set.

The calibration is deliberately conservative. The output is a *queue a human reads*, so a marker that fires on ordinary chatter costs more than one that misses — a queue full of noise is a queue nobody reviews. Assertions cover the negative side explicitly: narration, questions, file listings and stack traces all score zero.

Terminal output is excluded from the transcript. It is command output rather than statements, and mining it produces noise; asserted.

Confidence is capped at 0.95. A regex is never certain, and certainty is what a human's approval confers.

### 3.2 Anchor safety happens at creation

Proposed `filePath` values come from model output, so `extractAnchors` runs every one through `resolveInsideProject` and every commit-ish through `isSafeCommitHash` — the helpers built in P5.4-02, reused rather than reimplemented. A commit hash becomes an anchor only when it accompanies a file; alone it is just a number in a sentence.

This is the point the task's § 5 asks for, and it is deliberately at *write* time rather than read time: a rejected path never enters the database at all.

### 3.3 One path from candidate to memory

`approveCandidate` validates that the candidate exists, belongs to the requesting project, and is still `PENDING`; then calls `createDecision` with `provenance: 'HUMAN_CONFIRMED'` and `confidence: 1.0`, and marks the candidate `APPROVED`.

The provenance is fixed rather than inherited on purpose. Whatever score the extractor arrived at, a person read the candidate and said yes — that is a stronger claim than any heuristic, and it is what DEC-024's provenance field exists to record.

`rejectCandidate` writes one column. It has no reference to `project_decisions` at all, which is what makes forbidden change 3 structurally impossible rather than merely untested.

### 3.4 The briefing stayed synchronous, and so did approval semantics

`createDecision` already publishes `memory.decision_created`, so approval emits it for free and through the same path every other decision uses — asserted, so a future refactor that writes the row directly would fail.

### 3.5 The queue is a banner, not a panel

A candidate is a suggestion, and suggestions should not sit at the same visual weight as decisions a person made. Collapsed, the drawer is a count plus the sentence *"Nothing is recorded until you approve it."* Opened, it is the queue with two one-click outcomes.

It renders nothing at all when the queue is empty or no project is selected — the ordinary state is silence.

---

## 4. Verification

```
SERVER
  DecisionExtractor.test.ts .......  60/60    (new)
  memory-candidates.test.ts .......  52/52    (new)
  memory.test.ts .................. 113/113
  internal.test.ts ................  51/51
  ProjectMemoryService.test.ts .... 231/231
  SovereignMode.test.ts ...........  21/21
  GitDriftDetector.test.ts ........  64/64

WEB
  CandidateReview.test.ts .........  37/37    (new)
  DecisionExplorer.test.ts ........ 130/130
  MemoryTimeline.test.ts .......... 134/134
  useMemoryStore.test.ts .......... 113/113

MCP / ADAPTERS (regression — packages/shared changed)
  resolver 42 · record_decision 82 · dogfood 62 · relay-client 23 · relay_e2e 24 · ProcessManager 23

TYPECHECK
  @asterim/web        0 errors
  @asterim/adapters   0 errors
  asterim             4 errors — all pre-existing, 0 in a file this task touched

BUILD
  pnpm run build   7 successful, 7 total
```

**Negative controls** — each mutation was applied, the suite re-run, and the file restored:

| # | Mutation | Result |
| :-- | :-- | --: |
| A | Candidate path safety check removed | 54/60 — 6 failures, escaping paths reach anchors |
| B | Approval records `AGENT_STATEMENT` at the extractor's confidence | 49/52 — 3 failures |
| C | Extraction also writes into `project_decisions` (forbidden change 1) | 48/52 — 4 failures |
| D | Rejection deletes decisions (forbidden change 3) | 50/52 — 2 failures |

**Visual QA** — `docs/screenshots/p5.4-03/candidate-review-1440.png` shows both states: the collapsed banner with its count and disclaimer, and the expanded queue with rationale, constraints, anchors, suggestion confidence, and Approve / Discard per card.

---

## 5. Acceptance Criteria Review

- [x] **1 — Extraction creates `candidate_decisions` rows with `status: 'PENDING'`.** `POST …/candidates/extract` returns 201 with `extracted: 2`; every returned candidate is `PENDING` with an `extractedAt` and no `reviewedAt` (`memory-candidates.test.ts`). Verified against the database in `DecisionExtractor.test.ts` ("staging creates candidates", "all PENDING"), which also asserts `project_decisions` is unchanged by extraction.
- [x] **2 — Candidate code references pass path safety checks.** `extractAnchors` rejects `../../secrets/keys.json` and `../../../root/config.yaml`, keeps a safe path standing beside an unsafe one, and refuses `HEAD; rm -rf /` as a commit hash. Asserted at both the helper level and through `extractCandidates`, so an unsafe anchor cannot reach a candidate. Mutation A removes the check and 6 assertions fail.
- [x] **3 — Approve creates an ACTIVE, HUMAN_CONFIRMED, confidence-1.0 decision, marks the candidate APPROVED, and emits `memory.decision_created`.** All five asserted individually in `memory-candidates.test.ts`, including the event payload carrying the new decision id, and `reviewedAt` being stamped. Mutation B fails 3 of them.
- [x] **4 — Reject marks the candidate REJECTED with zero modifications to `project_decisions`.** Asserted by comparing the decision count before and after, by asserting no event was published, and by a dedicated case that creates a human decision, rejects every remaining candidate, and confirms it survives. Mutation D fails 2 assertions.
- [x] **5 — The Explorer displays a pending counter and a review drawer with one-click Approve / Discard.** Count badge, disclaimer, per-card Approve and Discard controls with candidate-specific `aria-label`s, and absence when the queue is empty or no project is selected — 20 render assertions plus the screenshot.
- [x] **6 — Suites pass, `tsc --noEmit` 0 errors, `pnpm run build` succeeds.** Full table in § 4. The 4 `apps/server` typecheck errors are pre-existing (`AuthController`, `AgentService`, `ContextService`, `GeminiProvider`) and confirmed to be zero in files this task touched.

---

## 6. Git Diff Review

Ten files: six modified, four created, plus the screenshot directory. No stray artifacts.

Each forbidden change was checked against the diff directly, not just by test:

1. **No auto-write of candidates into `project_decisions`.** `grep` for `createDecision` in the extract handler returns nothing — the handler calls only `createCandidate`.
2. **No external transmission of transcripts.** `grep` for `fetch(`, `axios`, `GoogleGenAI`, `webpush` across `services/memory/` returns nothing. `DecisionExtractor` imports `DatabaseService` and `GitDriftDetector` and nothing else; there is no network primitive it could reach, in sovereign mode or out of it.
3. **No deletion of human-confirmed decisions.** `grep` for `DELETE FROM project_decisions` across `apps/server/src` returns nothing outside test files.

The `candidate_decisions` table is additive, created with `CREATE TABLE IF NOT EXISTS` and two `CREATE INDEX IF NOT EXISTS` statements in the existing idempotent block, so existing databases at `~/.asterim/asterim.db` continue to open unchanged.

---

## 7. Problems Discovered

### 7.1 The path pattern normalised a traversal into a plausible anchor

The first version of `PATH_PATTERN` began with `\b`, which cannot match before a dot. Given `../../secrets/keys.json` it therefore matched from `secrets` — producing `secrets/keys.json`, a path that **resolves happily inside the project** and passes the containment check.

The traversal was not accepted, but something arguably worse happened: the extractor invented an in-project anchor the transcript never named. A reviewer approving that candidate would anchor a decision to a file nobody mentioned.

Fixed by capturing leading `./` and `../` segments so the real path reaches `resolveInsideProject` and is dropped. Two of my own fixtures had to be corrected too — they used extensionless paths (`/etc/passwd`, `id_rsa`) that never matched the pattern at all, so the "and is reported as rejected" assertion was passing on an empty match set and proving nothing.

### 7.2 Prohibitions were queued twice

"Never log the derived key" matches both a constraint marker and a decision marker. It was being attached as a constraint of the preceding decision *and* queued as a candidate of its own. Sentences absorbed as constraints are now marked consumed, so each sentence contributes once.

### 7.3 Rationale detection misses unmarked justifications

"This avoids a native build step" is a rationale in plain English and has no marker, so it is not captured. Rather than extend the marker list indefinitely, the candidate reports `"No rationale was stated in the session."` — and an assertion now pins that behaviour, so the limitation is recorded rather than discovered later. It is the right failure direction: an absent rationale is honest, an invented one is not.

---

## 8. Architectural Concerns

1. **Extraction has no trigger.** `POST …/candidates/extract` exists and nothing calls it — not the UI, not a session-end hook. The queue is therefore always empty in practice until someone POSTs manually. DEC-027 describes extraction as something that happens to session transcripts; deciding *when* (session exit, a button, a schedule) is a product decision that was outside this task's scope but is required for the feature to be reachable.

2. **`candidate_decisions` holds transcript-derived text with no retention policy.** It is the first table containing material lifted from session logs, and rejected candidates persist indefinitely. `PruningService` does not know about it. Worth deciding whether rejected candidates should age out — both for size and because a rejected suggestion is a record of something a user explicitly declined.

3. **Approval discards the extraction provenance.** DEC-027 mandates `HUMAN_CONFIRMED`, which is right, but the resulting decision keeps no pointer to the candidate or the session that proposed it — and `sessionId`/`threadId` are captured on the candidate. "Who first noticed this" is precisely what a reviewer asks months later, and the join is already available. Raised in the P5.4-02 report and now concrete.

4. **The extractor's quality is unmeasured against real transcripts.** Every assertion here uses synthetic text I wrote, which means the suite proves the markers behave as specified, not that the specification matches how agents actually write. A pass over a real session log would be worth doing before the queue is put in front of users.

5. **Carried forward, unchanged:** `MISSING_SPECIFICATION.md` § 4 still describes cross-process broadcasting as undecided (shipped in P5.4-01); `GitProvider.exec` trimming still makes column-based porcelain parsing unsafe (P5.4-02 § 6.1); rules cannot be edited or removed and intent cannot be cleared (P5.3-03); there is still no DOM test environment, so click handlers remain render-asserted only; `pnpm run lint` is red on `@asterim/adapters`.

---

## 9. Recommended Next Step

Close the loop opened by § 8.1: **wire extraction to a trigger**. The natural one is session end — `AgentService` already writes `sessions.status`, and a transition to `stopped`/`exited` is exactly the moment a transcript is complete and the user is most likely to review what just happened. That keeps extraction reactive and local, and it is a small piece of work compared with what it makes reachable.

Second, decide § 8.3 before the queue accumulates history: adding a `candidate_id` (or `session_id`) column to `project_decisions` is trivial now under the existing idempotent `ALTER TABLE` pattern, and a data migration once approvals exist in user databases.

If Phase 5.4 is instead closing, the remaining gap for a milestone report is § 8.4 — the extractor has never been run against a real transcript, only synthetic fixtures, and that is the one claim in this task I cannot make from the evidence I have.
