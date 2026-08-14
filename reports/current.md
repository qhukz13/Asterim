# Execution Report: SEC-01 — Sovereign Mode Air-Gap Switch & Environment Sanitization

**Task ID:** SEC-01
**Phase:** Phase 5.4-S — Security Hardening Gate
**Status:** VERIFIED
**Date:** 2026-08-14
**Author:** Claude Code
**Branch:** `main` (working tree)

---

## 1. Summary

`ASTERIM_SOVEREIGN_MODE=true` (or `--sovereign`) now closes every outbound path the Core opens on its own initiative: no relay socket, no push gateway request, and — beyond the task's scope list, per DEC-028 § 3 — no remote LLM call. `GET /api/v1/system` reports the mode. Agent subprocesses no longer inherit internal `ASTERIM_*` configuration.

**+44 assertions** across two new suites, both driving the real code with its network primitives replaced by recorders, since "no connection was opened" cannot be proved from a return value. All existing suites unchanged, `pnpm run build` 7/7.

Two things beyond the written scope:

- **The task's four items would have left a hole.** `GeminiProvider` posts the diff — project source — to Google, and DEC-028 § 3 explicitly requires sovereign mode to enforce local execution. It was not in § 4's list. An air-gap that still permits an outbound LLM call is not an air-gap, so it is gated (§ 3.4).
- **Environment scrubbing does not protect the loopback token**, and the task names it as an example of what scrubbing protects. It is not an environment variable — it lives in `server.json` inside the one directory deliberately preserved (§ 6.1).

---

## 2. Files Changed

**Created**

| File | Lines | Purpose |
| :-- | --: | :-- |
| `apps/server/src/services/SovereignMode.ts` | 33 | The switch, plus once-per-subsystem announcement |
| `apps/server/src/services/__tests__/SovereignMode.test.ts` | 247 | Switch semantics, relay, push, AI provider, system route |
| `packages/adapters/src/sdk/__tests__/ProcessManager.test.ts` | 176 | Sanitization rule and its wiring into `start()` |

**Modified**

| File | Change |
| :-- | :-- |
| `apps/server/src/services/RelayClient.ts` | Returns from `init()` before generating keys or opening a socket |
| `apps/server/src/services/PushService.ts` | Returns from `sendPushNotification` before reading subscriptions |
| `apps/server/src/services/ai/AiService.ts` | Forces `ActiveAgentProvider` in sovereign mode (DEC-028 § 3) |
| `apps/server/src/routes/system.ts` | `sovereignMode` in the payload |
| `packages/adapters/src/sdk/ProcessManager.ts` | `sanitizeAgentEnv` + applied at spawn |
| `packages/adapters/package.json` | `tsx` devDependency, so the suite can run |

Four files were mutated for negative controls and restored.

**Not modified:** relay pairing is untouched when the switch is off — asserted in both directions. No telemetry or cloud dependency added. The § 5 prohibitions hold.

---

## 3. Implementation Details

### 3.1 The switch is read live

`isSovereignMode()` reads `process.env` and `process.argv` on every call rather than caching at import. Callers include module-scope singletons whose construction order is not something an air-gap should depend on, and a cached value would make the switch order-dependent and effectively untestable. An assertion pins the live read.

The contract is the exact string `'true'` — `'1'` and `'TRUE'` do not enable it, also asserted, so the boundary is documented rather than incidental.

### 3.2 Guards sit before the work, not before the send

`RelayClient.init()` returns before generating its key pair, and `sendPushNotification` returns before reading the subscription table. An air-gapped host should not prepare to talk to a relay, and should not assemble a payload for a gateway it will not contact. Placing the check at the last moment before the network call would work but would leave the intent ambiguous.

### 3.3 Sanitization is an allow-list

```ts
export const INHERITABLE_ASTERIM_ENV = new Set(['ASTERIM_DATA_DIR']);
```

The task's snippet is a deny-by-prefix with one exception, which is the same behaviour; making the exception an explicit named set is what keeps it correct as variables are added. A deny-list only protects against the names someone remembered — and this codebase added `ASTERIM_SOVEREIGN_MODE` today. An assertion covers a variable "nobody has invented yet".

`ASTERIM_DATA_DIR` is preserved deliberately: an agent's own MCP memory server resolves the database through it, so stripping it would break project memory for exactly the agents this protects.

Sanitized values are spread **before** `options.env`, so an adapter that passes a variable deliberately still wins. Asserted, because a sanitizer that silently overrides an explicit choice is a bug of its own.

### 3.4 Deviation — the AI provider is gated too

`AiService` resolves `ai_provider` from settings; `gemini` sends the diff to Google through `@google/genai`. The task's § 4 lists only `RelayClient`, `PushService`, `ProcessManager` and the system route.

DEC-028 § 3 — the decision this task implements, cited in its own § 2 — says sovereign mode "enforces local CLI execution via `ActiveAgentProvider`". Acceptance criteria 1 and 2 are about zero outbound traffic. Leaving the LLM path open would satisfy the letter of § 4 and defeat the feature.

In sovereign mode a non-`agent` provider is replaced with `agent` and the substitution is logged, so a user who configured Gemini learns why it is not being used rather than wondering. Mutation D removes this and the assertion fails.

---

## 4. Tests / Verification

```
SovereignMode.test.ts .......  21/21   (new)
ProcessManager.test.ts ......  23/23   (new)

GitDriftDetector 64 · memory routes 113 · internal 51 · ProjectMemoryService 231
MCP dogfood 62 · relay_e2e 24

tsc --noEmit (adapters)  0 errors
apps/server tsc: 4 pre-existing errors, none in a touched file
pnpm run build:  7 successful, 7 total
```

### 4.1 Acceptance criteria

| # | Criterion | Result |
| :-- | :-- | :-- |
| 1 | Sovereign mode disables outbound relay sockets | **Met** — `io()` recorded; zero calls, including from the module singleton |
| 2 | `PushService` makes zero network requests | **Met** — `sendNotification` recorded; zero calls |
| 3 | `ProcessManager` strips `ASTERIM_*` tokens | **Met** — rule and wiring both asserted; `ASTERIM_DATA_DIR` preserved |
| 4 | `GET /api/v1/system` returns `sovereignMode` | **Met** — both values, rest of payload intact |
| 5 | Suites pass, build clean | **Met** |

### 4.2 Proving a negative

"No connection is opened" has no return value to inspect, so both suites replace the network primitive at the module loader — `socket.io-client`'s `io`, `web-push`'s `sendNotification`, `node-pty`'s `spawn` — with recorders, and assert the recorder was never called. That is as close to proof as is available without a packet filter, and it exercises the real code path rather than a mocked service.

Each subsystem is also asserted in the **off** state, so the tests distinguish "the guard works" from "the subsystem is broken".

### 4.3 The relay test had to import under sovereign mode

`RelayClient` exports a singleton constructed at module scope, which calls `init()` immediately. The first version of the test required the module before entering the sovereign block, so the singleton connected and the assertion measured the import rather than the guard — it failed with `expected 0, got 1`.

The `require` now happens **inside** the sovereign block, which makes it a stronger test: the singleton itself is constructed under the switch, which is what happens in production.

Worth stating plainly: because that singleton connects on import, **sovereign mode must be set before the process starts**. As an environment variable or CLI flag it always is, but it cannot be toggled at runtime.

---

## 5. Negative Controls

| # | Mutation | Result | Verdict |
| :-- | :-- | --: | :-- |
| A | `RelayClient` guard removed | 20/21 | caught — 2 sockets opened (singleton + instance) |
| B | `PushService` guard removed | 20/21 | caught — a push request was made |
| C | Env scrub becomes a deny-list of two known names | 20/23 | caught — 3 failures |
| D | AI provider gate removed | 20/21 | caught — `gemini` selected under sovereign mode |

**C is the informative one.** Replacing the allow-list with `ASTERIM_RELAY_URL || ASTERIM_SOVEREIGN_MODE` still passes the two assertions those names cover, and leaks `ASTERIM_LOOPBACK_TOKEN` and `ASTERIM_ANYTHING_ADDED_LATER`. That is exactly how a deny-list decays: it keeps passing the tests written when it was correct.

---

## 6. Problems Discovered & Concerns

### 6.1 Scrubbing the environment does not protect the loopback token

Criterion 3 names `ASTERIM_LOOPBACK_TOKEN` as an example of what sanitization removes. **No such environment variable exists.** The P5.4-01 relay puts the token in `~/.asterim/server.json` — inside `ASTERIM_DATA_DIR`, the one variable deliberately preserved so agents can find the memory database.

So an agent subprocess can read the token from disk regardless of this task. Its `0600` mode protects it from *other users*, not from a child process running as the same user — which is every agent Asterim spawns.

That is not necessarily wrong: the relay only accepts `memory.*` events from loopback, and the agent could record those through its own MCP server anyway. But **environment sanitization should not be described as protecting that token**, and if the token is meant to be a real boundary against agent code, the file is where the boundary has to be.

### 6.2 Sovereign mode does not reach agent subprocesses

`ASTERIM_SOVEREIGN_MODE` is stripped by § 3.3, so a spawned agent — and any MCP server it spawns — cannot see that the host is air-gapped. Today nothing downstream consults it and the MCP server only talks to loopback, so no leak follows.

But the two rules are in tension: sanitization says "agents see no internal configuration", and an air-gap says "everything under this roof is offline". If any spawned component ever gains outbound behaviour, it will not inherit the switch. The cleanest resolution is to add `ASTERIM_SOVEREIGN_MODE` to `INHERITABLE_ASTERIM_ENV` — it is a constraint, not a secret — but that is a DEC-028 amendment rather than something to decide inside this task.

### 6.3 mDNS still advertises on the LAN

`mDNSService.start()` publishes the workstation over Bonjour and is not gated. DEC-028 lists relay, push and LLM execution, not discovery, so this is in scope of the *mandate*'s spirit but not its letter.

For a genuinely air-gapped deployment, broadcasting the host's existence and port to every device on the segment is arguably the one remaining outbound signal. It is also LAN-only and disabling it would break local device pairing, which § 5 warns against. Flagged for a decision rather than changed unilaterally.

### 6.4 `git fetch` and `git push` remain available

`RemoteManager` shells out to git, which reaches the network. This is correct under DEC-028 § 1 — "unless explicitly and consciously transmitted by the user" — since a fetch is a user action, not a background beacon. Recorded so that "sovereign mode blocks all network access" is not read into the feature: it blocks what *Asterim* initiates.

### 6.5 Carried forward

- **`MISSING_SPECIFICATION.md` § 4** still says cross-process broadcasting is undecided, though P5.4-01 decided and shipped it.
- **`GitProvider.exec` trims its output**, making column-based porcelain parsing unsafe (P5.4-02 § 6.1) — `StatusManager` is correct only by accident of its `-b` flag.
- **Rules cannot be edited or removed; intent cannot be cleared** (P5.3-03 § 6.2, § 6.3).
- **No DOM test environment** (P5.2-02 § 6.3).
- `pnpm run lint` red on `@asterim/adapters`; `apps/server` has 4 pre-existing `tsc` errors. All figures local.

---

## 7. Recommended Next Step

**Proceed with P5.4-03** (Decision Extraction Queue & Candidate Review UI). The security gate is satisfied for the paths DEC-028 names, and the two open questions above (§ 6.2, § 6.3) are decisions rather than defects — neither blocks extraction work.

Three things to carry in, given P5.4-03 handles session transcripts:

1. **DEC-028 § 4 binds it directly.** Candidate extraction must process session logs *locally* — so whatever performs the extraction has to respect `isSovereignMode()` the same way `AiService` now does. If extraction uses `AiService`, it inherits the gate; if it calls a provider directly, it needs its own.
2. **Transcripts are the most sensitive thing yet staged.** Decisions hold reasoning; session logs hold terminal output, file contents and commands. A `candidate_decisions` table populated from them raises the value of § 6.1's question about what an agent subprocess can reach.
3. **Apply the P5.4-02 anchor guards at write time.** `resolveInsideProject` and `isSafeCommitHash` exist; candidates derived from model output should pass through them when they are created, not only when they are read.

Finally, § 6.1 deserves a decision before the phase closes: either the loopback token stops being described as environment-protected, or it moves behind something a same-user subprocess cannot read.
