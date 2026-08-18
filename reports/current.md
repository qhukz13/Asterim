Task-ID: P10-01
Status: COMPLETE

# Execution Report: P10-01 — Enterprise Fleet Policy Engine, Governance Rules & Structured SIEM Audit Exporter

**Task ID:** P10-01
**Phase:** Phase 10 — Enterprise Fleet Deployment, Air-Gapped Sovereign Appliances & GA Packaging
**Status:** VERIFIED
**Date:** 2026-08-18
**Author:** Claude Code

---

## 1. Summary

The Fleet Policy Engine and the structured SIEM audit exporter are implemented, wired into the
enforcement seams, exposed over REST, and covered by a new 229-assertion suite that passes.

- A versioned migration adds `fleet_policies` and `audit_events` with the two required indexes.
- `FleetPolicyService` resolves rules from `asterim.policy.json` in preference to the database and
  answers three questions — may this model run, may this command reach a PTY, is the air gap
  mandated — failing closed on any policy it cannot parse or compile.
- `AuditLoggerService` records structured events to SQLite *and* an append-only `<dataDir>/audit.log`,
  redacts every string through the vault redactor before either write, and renders JSONL,
  RFC 5424 Syslog and CSV exports.
- `AgentService` refuses a disallowed model before the PTY is spawned and a banned command before it
  is queued on the adapter; `ApprovalManager` treats a banned command as `critical` and honours the
  policy's approval threshold; `SovereignMode` gains a hook so `enforceSovereignMode` actually
  switches the air gap on.
- Four authenticated routes under `/api/v1/enterprise/`.

**Two deviations from the task text**, both forced by the repository as it actually stands, and
neither changes the specified behaviour:

1. **The migration is `apps/server/src/migrations/006_fleet_policies.ts`, not
   `packages/server/src/migrations/004_fleet_policies.sql`.** There is no `packages/server` workspace;
   migrations live in `apps/server/src/migrations/` as TypeScript modules, deliberately (see the
   comment in `migrations/index.ts` — the Core ships as one bundled `dist/index.js`, so a runtime
   `readdir` of loose `.sql` files would not survive `tsup`). Version 4 is already taken by
   `004_pipelines`, and versions are immutable once applied, so this is version 6. The table, column
   and index definitions are exactly those the task specified.
2. **The EventBus subscriptions use the bus's real dotted event names**, not the colon spelling in
   the task (`agent:approval_required` etc.). The bus publishes `agent.approval_request` and
   `client.approval_response`; a subscription to a type nothing publishes would have produced a
   silent, empty audit trail. `agent.started` / `agent.stopped` did not exist at all, so
   `AgentService` now publishes them (constants in `@asterim/shared`) rather than the logger
   inferring lifecycle from the continuous `agent.status` stream.

## 2. Files Changed

| File | Change Type | Purpose |
| :--- | :---: | :--- |
| `apps/server/src/migrations/006_fleet_policies.ts` | Created | `fleet_policies` + `audit_events` tables and the two audit indexes |
| `apps/server/src/migrations/index.ts` | Modified | Registers the migration; `LATEST_SCHEMA_VERSION` becomes 6 |
| `packages/shared/src/types/fleet.ts` | Created | `FleetPolicy`, `FleetPolicyConfig`, `AuditEvent`, `AuditSeverity`, `AuditExportFormat`, violation/lifecycle payloads and constants |
| `packages/shared/src/index.ts` | Modified | Exports `./types/fleet` |
| `apps/server/src/services/enterprise/FleetPolicyService.ts` | Created | Policy resolution (file over database), model allowlist, banned patterns, sovereign enforcement, approval threshold, `updatePolicy` |
| `apps/server/src/services/enterprise/AuditLoggerService.ts` | Created | Dual persistence, redaction, query/count, JSONL + RFC 5424 + CSV export, EventBus subscriptions |
| `apps/server/src/routes/enterprise.ts` | Created | `GET/PUT /policy`, `GET /audit-logs`, `GET /audit-logs/export` |
| `apps/server/src/server.ts` | Modified | Registers the routes, subscribes the audit logger, installs the sovereign-policy hook |
| `apps/server/src/services/AgentService.ts` | Modified | Model gate before session start, command gate before PTY write, violation publishing, lifecycle events |
| `apps/server/src/services/ApprovalManager.ts` | Modified | Fleet rules tighten `evaluateCommandSecurity` |
| `apps/server/src/services/SovereignMode.ts` | Modified | `registerSovereignPolicyHook`, so a policy can mandate the air gap |
| `apps/server/src/services/enterprise/__tests__/FleetGovernance.test.ts` | Created | 229 assertions across migration, policy, audit, export, REST and enforcement |
| `apps/server/package.json` | Modified | New suite appended to the `test` script |

## 3. Implementation Details

### Policy resolution and precedence

`FleetPolicyService.resolve()` stats `<dataDir>/asterim.policy.json` on every question and re-parses
only when its mtime or size moved, so a policy pushed to a running workstation takes effect on the
next command without paying a file read per keystroke. A file that exists wins over the
`fleet_policies` row unconditionally — and a file appearing where there was none invalidates a cached
database policy, which the cache key (`cachedFromFile`) encodes explicitly.

**Fail-closed is the default on every uncertain path.** A file that will not parse, a field of the
wrong type, or a banned pattern that will not compile produces a *locked-down* resolution: the failure
is reported through `getPolicyFailure()`, `validateCommand` and `validateModel` refuse everything, and
the approval threshold collapses to `low`. `isSovereignModeForced()` is the one exception and returns
`false` on an unreadable policy — an unreadable file is not evidence the air gap was demanded, and the
gates that can fail closed already have.

An empty `allowedModels` list is a lockdown, not an absence of rules. `['*']` is the permissive
default; a trailing `*` admits a family (`claude-*` → `claude-opus-5`); matching is case-insensitive.

`updatePolicy` compiles every pattern *before* storing it, because a pattern that does not compile
would lock the whole fleet out of every command the moment it was saved and the request is the last
moment anyone can be told why. It refuses outright (`POLICY_FILE_ENFORCED`) while a policy file is
present, rather than writing a row nothing reads.

`isManaged()` distinguishes a governed installation from an unmanaged one. The approval threshold is
only applied when a policy actually exists — otherwise a single-developer workstation that has never
seen a policy would inherit the default threshold as though an administrator had chosen it and start
demanding approvals nobody configured (DEC-028). Verified: the unmanaged behaviour of
`evaluateCommandSecurity` is unchanged.

### Audit capture, redaction and export

Every event goes to `audit_events` **and** to `<dataDir>/audit.log`, appended one JSON line at a time
with the file re-opened per write (a buffered stream loses its tail on a kill, exactly where the
interesting event would have been) and restricted to `0600` via `enforceOwnerOnly` (DEC-028).

Redaction happens at the sink, not at the call sites: `action`, identity fields, metadata **values and
keys**, and nested structures are all passed through `secretVault.redactSecrets` before either write.
An audit trail is the one stream deliberately copied off the machine, so a credential that leaks into
it leaks furthest; doing it here means a new call site cannot forget. Nothing in the service throws at
its caller — logging instruments paths that are themselves security decisions.

Severity is filtered in TypeScript, not SQL: it is an ordered scale stored as text, and
`severity >= 'HIGH'` in SQLite is a string comparison that would silently admit `INFO` and exclude
`CRITICAL`.

RFC 5424 frames are `<PRI>1 TIMESTAMP HOSTNAME APP-NAME PROCID MSGID SD BOM MSG` with facility 13
(`log audit`), severities 6/4/3/2, identity and metadata as SD-PARAMs under the private-enterprise
SD-ID `asterim@52773`, `"` `\` `]` escaped per § 6.3.3, header tokens stripped to PRINTUSASCII with
per-field length caps, and newlines in the MSG escaped so one event cannot become two frames. CSV
cells are quoted and formula-guarded (`=`, `+`, `-`, `@` prefixed with `'`) — audit text is
attacker-influenced by definition and does not get to be a spreadsheet formula.

### Enforcement seams

- `AgentService.startAgent` validates the provider against the allowlist before anything is spawned.
  Every path into a session (start, restart, crash recovery, chat auto-start) converges there.
- `AgentService` gates both raw commands (`client.command`) and chat content (`client.chat_message`)
  through `enforceCommandPolicy` before `sessionManager.sendCommand`, so a refused command is never
  queued on the adapter. A refusal publishes `policy.violation` (recorded at `CRITICAL`) and an
  `agent.status` error, so the operator is told why rather than watching a command vanish.
- `ApprovalManager.evaluateCommandSecurity` applies the policy last and only ever tightens: a banned
  command becomes `critical` + requires a human; a configured threshold at or below the computed risk
  forces a human. A policy can never lower a risk level or clear a flag.
- `SovereignMode` consults a registered hook, inverted rather than imported so `AiService`,
  `PushService` and `RelayClient` keep not knowing the policy engine (or the database) exists. A hook
  that throws is treated as no answer.

## 4. Verification

Everything below was run in this session. Root `turbo` scripts are blocked in this sandbox, so the CI
gates were run per workspace with `pnpm --filter`, covering every workspace the root scripts would.

| Gate | Command | Result |
| :--- | :--- | :--- |
| New suite | `pnpm --filter asterim exec tsx src/services/enterprise/__tests__/FleetGovernance.test.ts` | **229 passed, 0 failed** |
| Full server suite (31 suites incl. `PipelineEngine`, `SecretVaultService`, `MigrationEngine`, `SovereignMode`) | `pnpm --filter asterim test` | all pass; no `FAIL`, no `Failures:`, no `ERR_PNPM` |
| Typecheck | `pnpm --filter` × `@asterim/shared`, `asterim`, `@asterim/web`, `@asterim/adapters`, `@asterim/marketing`, `@asterim/relay`, `@asterim/mcp-memory-server` | 0 errors |
| Lint | `pnpm --filter asterim lint` | **0 errors**, 328 warnings (all pre-existing `no-explicit-any`) |
| Lint | `pnpm --filter @asterim/shared lint`, `@asterim/web lint` | 0 errors |
| Build | `pnpm --filter` × `@asterim/shared`, `@asterim/adapters`, `@asterim/web`, `asterim`, `@asterim/marketing`, `@asterim/relay` | all succeed (`dist/index.js 1.29 MB`) |

Three lint errors were introduced and fixed during the cycle (`no-useless-assignment` ×2,
`no-irregular-whitespace` on the U+FEFF in a test regex, replaced with `﻿`).

What the new suite actually asserts, by section:

- **Migration** — both tables exist, every specified column exists, both indexes exist, and the
  declared column defaults (`["*"]`, `[]`, `0`, `'HIGH'`, `1`) are what a row written without them
  lands on.
- **Precedence** — a database policy is in force, a file appearing overrides it in the same service
  instance and in a fresh one, and removing the file restores the stored policy.
- **Banned commands** — 6 refused shapes (`rm -rf /`, two `curl|sh` variants, force push, a
  case-inverted match), each naming the pattern that refused it; 4 similar-looking commands permitted.
- **Model allowlist** — exact, case-insensitive and wildcard matches; an omitted model refused with an
  explanatory reason; an empty allowlist admits nothing.
- **Fail-closed** — malformed JSON, an uncompilable pattern and a wrong-typed field each refuse every
  command *and* every model, and collapse the threshold.
- **Audit capture** — a row in SQLite with each column populated, a parseable JSON line in `audit.log`,
  the file appended (not rewritten) on the second event, and `0600` on disk.
- **Redaction** — a secret in the action, in an identity field, in a nested metadata array *and used as
  a metadata key* appears in none of: the returned event, the SQLite row, `audit.log`, or any of the
  three export formats.
- **Export** — every JSONL line parses, ordering is oldest-first; every Syslog frame matches the RFC
  5424 header grammar, PRI is 106 for CRITICAL and 110 for INFO, SD-PARAMs carry identity and metadata,
  quote/bracket/backslash escaping is asserted individually, the BOM precedes the MSG, and a newline in
  an action cannot split a frame; CSV quotes an embedded comma and defuses `=HYPERLINK(...)`.
- **EventBus** — six published events produce exactly six records (a second `subscribe()` is a no-op),
  with the severities and metadata each type is supposed to carry.
- **REST** — 401 on anonymous read and write; 200 read/write round trip; 400 + `INVALID_POLICY` on an
  uncompilable pattern; 409 + `POLICY_FILE_ENFORCED` under a policy file; audit paging with a total;
  severity filtering; JSONL and Syslog exports with correct content types and disposition; 400 +
  `INVALID_FORMAT` on an unknown format.
- **Enforcement** — an unmanaged install's approval behaviour is unchanged; a banned command becomes
  `critical` and requires a human; a configured threshold gates a high-risk command; a low-risk command
  still passes; a policy switches Sovereign Mode on and off and a throwing hook cannot break it.

## 5. Acceptance Criteria Review

- [x] **1. Migration applies cleanly via `MigrationEngine`** — `006_fleet_policies` (renumbered and
  authored as a TypeScript migration; see § 1 deviation 1). The suite reads back both tables, all 21
  columns, both indexes and every column default from a database the engine migrated; the existing
  `MigrationEngine.test.ts` and `CliDatabaseTooling.test.ts` still pass against the new
  `LATEST_SCHEMA_VERSION`.
- [x] **2. `FleetPolicyService` enforces model allowlists and blocks banned commands before execution**
  — `validateModel` is called in `startAgent` before `sessionManager.startSession`; `validateCommand`
  is called in `enforceCommandPolicy` before `sessionManager.sendCommand` on both the command and the
  chat path. Suite sections "validateCommand — banned patterns fail closed", "validateModel — the
  allowlist" and "ApprovalManager — the policy tightens the analysis".
- [x] **3. `AuditLoggerService` records structured events to SQLite and `<dataDir>/audit.log`** —
  "AuditLoggerService — dual persistence": the SQLite row is read back column by column, `audit.log`
  exists, holds one parseable JSON line per event, is appended to, and is `0600`.
- [x] **4. Sensitive credentials are automatically redacted in all audit entries** —
  "AuditLoggerService — secrets never reach the record": redaction is asserted on the returned event,
  the persisted row, the log file and all three export formats, including a secret used as a metadata
  key. Production uses `secretVault.redactSecrets`; the suite substitutes a known redactor so the
  substitution is observable without deriving a vault key.
- [x] **5. Syslog RFC 5424 and JSONL exports generate valid, parseable frames** — "exportLogs — JSON
  Lines" and "exportLogs — Syslog RFC 5424", including header-grammar matching, PRI arithmetic,
  SD-PARAM escaping and BOM placement. CSV is covered too.
- [x] **6. Authenticated REST routes under `/api/v1/enterprise/` function correctly** —
  "/api/v1/enterprise — the authenticated surface", 24 assertions over all four routes including the
  401 and 409 paths. Registered in `server.ts` behind `authMiddleware`.
- [x] **7. `FleetGovernance.test.ts` passes with comprehensive policy and audit assertions** — 229
  passed, 0 failed; wired into `apps/server`'s `test` script.
- [x] **8. Monorepo CI gates pass with 0 errors** — typecheck (7 workspaces), lint (0 errors), test
  (31 suites, all pass), build (6 workspaces). See § 4 for the exact commands.
- [x] **Constraint: banned commands fail closed with an immediate audit event and never reach the PTY**
  — `enforceCommandPolicy` returns before `sendCommand`, publishing `policy.violation` (recorded at
  `CRITICAL` with the matched pattern) and an `agent.status` error. An unreadable policy refuses too.
- [x] **Constraint: audit logs never contain unredacted secrets** — criterion 4.
- [x] **Constraint: 100% pass rate across existing suites** — all 30 pre-existing suites pass unchanged.

## 6. Git Diff Review

Reviewed `git diff` and `git status` file by file.

- 7 files created, 6 modified. No file outside the task's scope was touched.
- The only behavioural changes to existing code are the three enforcement seams (§ 3) plus the
  `stopAgent(threadId, reason)` signature, which gained a defaulted second parameter so
  `agent.stopped` reports why a session ended rather than always claiming the user stopped it. All
  three call sites updated.
- `agent.stopped` is published only when the thread actually held a session config — `stopAgent` also
  runs on a thread that was already stopped, and an audit trail recording sessions that never began is
  one an auditor cannot count.
- No credential handling, git subsystem, adapter or UI code was modified. No new dependency was added.
- `tests/report.md` was already modified in the working tree when this task began and is **not** part of
  this change; it is left untouched and uncommitted.
- One throwaway helper (`scratch/fix-bom.js`) was written during the cycle. `scratch/` is gitignored, so
  it is not in the commit; sandbox rules prevented deleting it afterwards.

## 7. Problems Discovered

1. **The task's file paths do not exist in this repository.** `packages/server/` is not a workspace and
   migrations are not `.sql`. Resolved by following the established migration convention (§ 1).
2. **The task's EventBus event names do not exist.** `agent:approval_required`, `agent:started` and
   `agent:stopped` are published by nothing. Resolved by subscribing to the real names and publishing
   two new lifecycle events from `AgentService` (§ 1).
3. **`apps/server` resolves `@asterim/shared` through `dist/index.d.ts`.** New shared types are
   invisible to the server's `tsc` until `pnpm --filter @asterim/shared build` has run — the first
   server typecheck reported 27 phantom "has no exported member" errors that were purely a stale
   `dist`. Worth knowing for the next task that adds a shared type.
4. **The approval threshold would have changed unmanaged behaviour.** Applying
   `requireApprovalRiskLevel` unconditionally makes every `high`-risk command demand a human on a
   workstation that has never seen a policy, because the column's default is `'HIGH'`. Gated behind
   `isManaged()`.
5. **`no-irregular-whitespace` fires on a U+FEFF inside a regex literal** (but not inside a string,
   where `skipStrings` defaults to true). The RFC 5424 BOM in `AuditLoggerService` is a string constant
   and lints clean; the test's regex was rewritten with `new RegExp('…\\uFEFF')`.

## 8. Architectural Concerns

1. **`AuditService` and `AuditLoggerService` now coexist.** The older one writes workspace-scoped
   `audit_logs` rows for RBAC events; the new one writes installation-scoped `audit_events` for
   security events. They are genuinely different scopes (a command refused before a PTY exists has a
   thread but no workspace membership), but two audit tables is a seam that will confuse someone. A
   later task could fold `audit_logs` into `audit_events` with a `workspace_id` column, behind a
   Change Proposal.
2. **No dashboard surface.** The engine and the exporter are headless — there is no Changes-style panel
   for the policy or the audit stream. If Phase 10 wants operators to see this without `curl`, that is
   a distinct vertical task against `blueprint/DESIGN_SYSTEM.md`.
3. **Policy authorization is authentication-only.** A fleet policy is installation-wide, so there is no
   `workspaceId` for `rbacGuard` to resolve a role against, and inventing one would invent a scope the
   domain model does not have. The real control for a managed fleet is `asterim.policy.json`, which no
   authenticated caller can edit. If an admin-only RBAC scope is wanted for the `PUT`, it needs a
   domain decision first.
4. **The banned-command gate on chat content is a judgment call.** Chat text reaches the same PTY
   stdin, so gating only `client.command` would leave the obvious hole open; but a banned pattern will
   also refuse a message that merely *discusses* the command. Defaults are empty, so only an
   administrator's explicit pattern can trigger it. Flagging it as a product decision rather than a
   technical one.
5. **`blueprint/ROADMAP.md` Phase 10 was cited by the task but no Change Proposal was needed** — nothing
   here contradicts an existing Blueprint domain document; the two deviations are conformance to
   existing repository conventions, not to new architecture.

## 9. Recommended Next Step

P10-02: the air-gapped sovereign appliance packaging — offline model/provider configuration and an
installer profile that ships with `asterim.policy.json` pre-seeded, now that `enforceSovereignMode` is
an enforceable rule rather than only an environment variable. A dashboard surface for the policy and
the audit stream (concern 2) is the natural alternative if Phase 10 wants the governance visible before
it ships.
