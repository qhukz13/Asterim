# Asterim engineering handoff

Written 2026-09-10 for the next autonomous session. Everything here was checked
against the repository, not copied from other documents. Where a claim comes
from a document rather than from code or a run, it says so.

Read this file first, then `PROJECT_CONTEXT.md`, then the specific
`docs/architecture/*.md` page for whatever you touch. Where this file and any
other document disagree, this one is newer; fix the older one.

---

## 1. Current repository state

| | |
| --- | --- |
| Branch | `main`, working tree clean |
| Head | `3571322 docs(readme): rewrite around what the product actually does, with real screenshots` |
| Remote | `origin` still points at `https://github.com/qhukz13/AgentDeck.git`. The repository was renamed; GitHub 301-redirects, so pushes work. The canonical URL is `https://github.com/qhukz13/Asterim.git`. |
| Unpushed | 9 commits ahead of `origin/main` as of writing. The founder was asked to run `git push origin main`; a permission classifier blocked the agent from doing it. **Check this first** — if the push has not happened, everything below exists only locally. |
| Node | v24.16.0 on this machine. `engines` requires >= 22. |
| Typecheck | Clean, 11 packages. |
| Lint | 0 errors, ~334 warnings (legacy, mostly `any`). |
| Build | Clean. |
| Source size | ~77,000 lines excluding tests: server 35.9k, web 32.0k, shared 4.6k, adapters 2.5k, marketing 0.9k, mcp-memory-server 0.8k, relay 0.4k. |
| Tests | 58 suites wired across five packages (server 35, web 13, mcp-memory-server 7, adapters 2, relay 1). |

### Known failing tests

One, and only one: `apps/server/src/services/mcp/__tests__/AgentMcpIntegration.test.ts`
ends at **156 of 160 assertions**. The four failures are always the same, and
the cause is node-pty's ConPTY teardown calling `AttachConsole()`, which fails
on this machine (P1-06). It reproduces on every run under Bash, PowerShell, and
a console allocated with `conhost.exe` — two earlier claims that it was
intermittent and that an interactive terminal avoids it are both wrong and were
corrected in `docs/development/testing.md`.

It is a harness defect, not a product defect: the path it covers is exercised
against the real product by `tools/e2e/core-loop.mjs`. The suite runs **last**
in the `&&`-joined chain deliberately. Do not move it back into the middle —
while it sat there, nine suites after it had never run on Windows and were
hiding five real defects.

### Known security issues

Fixed in the last two days, with tests holding each line:

- **S5 (was HIGH, raised to CRITICAL).** The account system was a second front
  door past the pairing PIN. Registering from the LAN with any address and
  password returned a JWT that listed projects and registered an MCP server with
  an arbitrary command, which the supervisor spawns. Now gated behind
  `ASTERIM_ENABLE_ACCOUNTS`, off by default, forced off in sovereign mode, with
  account tokens rejected even if minted earlier
  (`services/AccountsFeature.ts`, `routes/__tests__/accountsDisabled.test.ts`).
- **S19 (HIGH).** One MCP server that exits immediately crash-looped the Core on
  every boot; writing to a dead pipe emitted an unhandled `error`. Fixed in
  `services/mcp/McpStdioClient.ts`.
- **@fastify/static path traversal.** Mitigated by an `onRequest` guard in
  `server.ts` that refuses any raw path containing a traversal segment in any
  encoding. The real fix needs Fastify 5.

Open, and the next session should treat these as findings rather than
accepted risks until someone decides otherwise:

1. **Sovereign mode does not stop mDNS.** `mdnsService.start(port)` runs
   unconditionally at `server.ts:431`, and `services/mDNSService.ts` has no
   sovereign check — it publishes a Bonjour service advertising this
   workstation on the LAN. README, SECURITY.md and the marketing site all say
   Asterim "makes no outbound network connections of its own" and that an
   air-gap switch guarantees it. Multicast DNS is not a connection to a server,
   but it is unsolicited traffic announcing the machine, and it happens in the
   mode that promises silence. Either gate it or correct the three documents.
2. **A pairing token carries every entitlement.** `authMiddleware` resolves any
   valid pairing token to a hard-coded `defaultDevUser` (`acc_dev` / `usr_dev`)
   holding all five entitlements. Measured against the packaged build on
   2026-09-10 with a pairing token: `/api/v1/pipelines` 200,
   `/api/v1/billing/subscription` 200, `/api/v1/desktop/status` 200,
   `/api/v1/skills` 200. "Frozen" in this repository means *not marketed and
   not extended*. It does not mean unreachable.
3. **Five open high advisories on Fastify 4**, all fixed only in majors
   (Fastify 5.7.3, @fastify/static 10.1.2). `pnpm audit --prod` shows no
   criticals; overrides in the root `package.json` cleared 20 of the original 25.
4. **The agent inherits the operator's environment** (S6). Inherent to running
   the operator's own CLI. A deny-list for common secret variables is a P1.
5. **`middleware/rbacGuard.ts` and `middleware/entitlementGuard.ts` have zero
   call sites.** No route enforces an entitlement anywhere. Routes that need
   RBAC import `rbacService` directly. Both middlewares are dead.

### Known technical debt

- **`apps/web/src/App.tsx`, 956 lines, with a Rules-of-Hooks violation.** It
  returns early at line 816 when `!isAuthenticated`, then calls `useThreadStore`
  (826), `useProjectStore` (827), `useChannel` (832), three `useState` and a
  `useEffect` (851-855) and `useViewStore` (918) *after* that return. Hook count
  changes the moment auth flips. It has not been observed to throw, probably
  because pairing arrives in the URL before the first render, but this is a
  latent crash, not a style problem. P1-01 (extracting `ProjectWorkspace`) is
  the tracked fix.
- **`services/AgentService.ts`, 1127 lines, no direct test suite.** It is on the
  critical path of every subsystem. Only its downstream effects are covered.
- **Other untested files that ship:** `ApprovalManager`, `ContextService`,
  `ContextRepository`, `PushService`, `mDNSService`, `RelayClient`,
  `AuthController`, `TokenService`, `PasswordService`, `TerminalService`,
  `WorkspaceService`.
- **~1,530 lines of orphaned web components** with zero importers:
  `DeveloperSettings.tsx` (250), `WorkspaceSettingsModal.tsx` (531),
  `workspace/WorkspaceTabView.tsx` (539), `hooks/useEntitlements.ts` (31),
  `stores/useExecutionStore.ts` (30), `push.ts` (58). Three of those are
  overlapping copies of the same environment-members screen. Because
  `DeveloperSettings` is the only importer of `hooks/usePushNotifications.ts`,
  the entire push-notification UI is unreachable.
- **`hooks/useAuth.ts` exports `loginWithOAuthCode`, which POSTs to
  `/api/v1/auth/oauth/token`** — an endpoint deleted in the audit for accepting
  any code and signing the caller in as the oldest user. It has no callers.
  Dead code pointing at a deleted hole; delete it.
- **`packages/adapters/src/providers/aider/AiderAdapter.ts` is a stub that is
  still registered** in the provider registry. Its `getLaunchCommand` returns
  `node -e 'console.log("Aider stub running")'`. `App.tsx` still types
  `agentType` as `'aider' | 'claude' | 'antigravity'`.
  `PROJECT_CONTEXT.md` says the Aider stub was "removed from the UI", which is
  true and misleading — it is still a selectable provider id at the API.
- **`StartupService.ts:94` reports Antigravity as always present:**
  `antigravity: hasAntigravity || true // fallback to true to prevent UI error`.
  The first-run wizard therefore cannot say "Not found" for Antigravity, which
  is exactly what release-gate row A4 asks it to do.
- **`EnvironmentSettingsView.tsx` renders fabricated data as if it were real.**
  The `skills` sub-tab hard-codes `['caveman', 'cavecrew', 'graphify']` — the
  operator's own personal Claude Code skills. The `agents` sub-tab hard-codes
  profiles naming `gpt-4o` and `claude-3-5-sonnet`. The `knowledge` sub-tab
  promises "local RAG vector search", which does not exist. Real stores
  (`useSkillsStore`, `useProfileStore`, `useMcpStore`) exist and hold the actual
  data. **This is simulated product UI inside the product.** The release gate
  row "No simulated product UI anywhere" was ticked on 2026-09-09 against the
  marketing site only; that tick does not cover the dashboard, and this is the
  correction.
- **`PROJECT_CONTEXT.md` § Status is stale.** It says the e2e passes 10/10 (it
  is 11/11 now, with a deny pass), and lists P0-07, P0-09, P0-11, P0-12 and
  P0-13 as open when all are done. It does not mention the account system being
  switched off.
- **`docs/audit/feature-inventory.md` predates the last two days.** Useful, but
  check anything it says against the code.

### Known incomplete features

`ContextService` / `ContextRepository` (397 lines, routed, called by the
Inspector panel) have no test file. Push notifications are wired end to end but
untested and their UI is unreachable. The relay handshake is never exercised by
any in-repo client. Billing logic is tested against an injected gateway that
never opens a socket. See section 4 for the full table.

---

## 2. What actually works

Separated by how it was established, not by what a document claims.

### Verified by tests and by an end-to-end run against the packaged build

These pass on every run of `tools/e2e/core-loop.mjs` (11/11) and
`tools/e2e/gate-checks.mjs` (4/4), driving the real dashboard with puppeteer
against a tarball installed into a clean prefix with a fresh data directory:

- Pairing a browser with the six-digit PIN. Four wrong PINs are refused with
  401; the fifth returns 429 with `Retry-After: 896`, and the correct PIN is
  refused while the lock holds.
- Adding a project. A folder that does not exist is refused with a message
  naming the path, shown under the button.
- Starting Claude Code in that folder over its headless stream protocol,
  resuming an existing session by id.
- The approval gate, **both ways**. Approving a file write puts the file on disk
  with the content shown on the card. Denying leaves it absent, and the agent
  replies that the write was denied, says what it would have created, and asks
  how to proceed. The same holds for a shell command.
- The approval card at 390x844 with touch emulation: 14px margins, 44px
  buttons, focus on open, Escape denies, file not written afterwards.
- The transcript rendering messages, tool calls and results.
- The Changes view rendering a file's diff.
- A thread surviving a Core restart with its history intact.
- The usage summary in Settings, with its rows and approvals breakdown, and no
  filesystem path anywhere in the panel.
- `asterim stats` printing without starting a server, on both a seeded and the
  operator's real database.
- The local usage summary transmitting nothing: the test replaces
  `net.Socket.prototype.connect`, `net.connect`, `dns.lookup`, `http.request`,
  `https.request` and `fetch` with functions that throw, then runs the whole
  path again.
- The account system being unreachable by default, including for tokens minted
  while it was enabled.

### Verified by tests only (no end-to-end run)

Pipelines, team agents, delegation, worktrees, verification, MCP supervision and
tool invocation, skills, profiles, memory and decisions, secret vault,
environment secrets, desktop daemon, fleet governance, migrations, channel
isolation, sovereign mode, billing signature verification, pairing service, CLI
database tooling. Test line counts per subsystem are in section 4.

### Manually verified, not automated

- `HOST=127.0.0.1` binds loopback only; the LAN address does not connect.
- `GET /api/v1/projects` without a token returns 401 from loopback and from the
  LAN address.
- The packaged tarball carries 13 files, no secrets, no local paths, and a
  correct shebang.
- `asterim db:snapshot` writes a mode-0600 snapshot beside the database.
- The traversal guard refuses literal, percent-encoded, double-encoded and
  backslash forms while ordinary asset and API requests are unaffected.

### Partially working

- **Antigravity adapter.** Labelled *preview* everywhere. It scrapes a TUI with
  a 587-line state machine and breaks when Google changes it. Never exercised
  by any automated test against the real CLI.
- **Contexts.** Routed and used by the Inspector, no tests.
- **Enterprise / fleet governance.** The enforcement half is live — the audit
  logger is subscribed at boot and `FleetPolicyService` is consulted by
  `AgentService` and `ApprovalManager`. The four HTTP governance routes have
  zero UI consumers.
- **Push notifications and mDNS.** Both work, both untested, and the push UI is
  unreachable because its only importer is orphaned.

### Prototype

The cloud relay. `RelayClient.init()` returns early unless `ASTERIM_RELAY_URL`
is set. No in-repo client ever connects through a tunnel. The ECDH handshake is
exercised only inside `apps/relay`'s own tests.

### Dead or stub

`AiderAdapter` (registered stub), `rbacGuard`, `entitlementGuard`,
`loginWithOAuthCode`, `useExecutionStore`, `WorkspaceSettingsModal`,
`WorkspaceTabView`, `DeveloperSettings`, `useEntitlements`, `push.ts`.

### Undocumented

- `packages/mcp-memory-server` is a standalone `asterim-mcp-memory` stdio
  binary. Nothing in `apps/server` spawns it; it reaches the Core through the
  loopback `/api/v1/internal/*` routes. It is only reachable if the operator
  registers it as an MCP server. Treat as foundation, not orphan.
- `services/ai/IAIProvider.ts` is a **second, unrelated provider abstraction**.
  See section 3.

---

## 3. Architecture

### Layout

```
apps/server      35.9k lines   package name `asterim`. Fastify + Socket.IO. The only privileged process.
apps/web         32.0k lines   `@asterim/web`. React 18 + Vite + zustand dashboard.
apps/marketing    0.9k lines   `@asterim/marketing`. React 19 static site, hand-rolled pushState routing.
apps/relay        0.4k lines   `@asterim/relay`. Frozen tunnel server.
packages/shared   4.6k lines   `@asterim/shared`. The contract across the WebSocket boundary.
packages/adapters 2.5k lines   `@asterim/adapters`. Agent SDK and providers.
packages/mcp-memory-server 0.8k  Standalone MCP stdio binary.
```

### Adapters — read this carefully, it is where the vision meets the code

There are **two abstraction layers, one of which is deprecated**, and a third
unrelated one elsewhere.

1. `packages/shared/src/adapters.ts` exports `IAgentAdapter` and `AgentConfig`.
   `IAgentAdapter` is marked `@deprecated` in favour of `IAgentProvider`.
2. `packages/adapters/src/sdk/types.ts` exports the live contract:
   `IAgentProvider`, `AdapterCapabilities` (12 booleans), `LaunchConfig`,
   `NativePermissionAsk`, `IParser`.
3. `BaseAdapter` (337 lines) `implements IAgentProvider` and wraps
   `ProcessManager`, which wraps **node-pty**.

Three providers are registered at import time in `packages/adapters/src/index.ts`:
`antigravity`, `claude`, `aider`.

The structural problem: **`BaseAdapter` encodes the terminal-scraping process
model, and the one provider that actually works escapes it.**
`ClaudeAdapter.start()` (line 246) fully overrides `BaseAdapter.start()` and uses
`child_process.spawn` with pipes, never touching `ProcessManager`. So the "base"
class is the legacy approach and the good provider is the exception.

`IAgentProvider.getLaunchCommand()` returns `{ cmd, args, env }`. **Every
provider must be a local subprocess.** There is no shape in this abstraction for
an agent reached over HTTP, an agent already running elsewhere, or a model
called through an API. That is the single most important architectural fact for
the broader product direction.

`AdapterCapabilities` is the good part. A twelve-boolean capability matrix
already exists and is the right mechanism for the Core to branch on.

### The other provider abstraction

`apps/server/src/services/ai/IAIProvider.ts` is a **different thing that is easy
to mistake for the agent abstraction**. It has six methods:
`generateCommitMessage`, `explainDiff`, `reviewChanges`, `suggestFiles`,
`extractMission`, `configure`. It is a small-AI-helpers interface, not an agent
runtime. Implementations are `GeminiProvider` and `ActiveAgentProvider`.

`ActiveAgentProvider` implements those helpers by shelling out to a CLI, with a
`switch` on the agent type; the `claude` case calls `resolveClaudeLaunch()` and
runs `@anthropic-ai/claude-code --print`, and the default when the session
cannot be read is `'claude'`. This powers the "Auto-Generate Message" button in
the Changes view, which is a **live MVP feature that requires Claude Code
specifically**.

### Server

Every route module is mounted, including the frozen ones: auth, sessions,
devices, apikeys, webhooks, billing, mcp, skills, profiles, delegation,
teamAgents, pipelines, worktrees, workspaces, projects, git, system, ai,
context, memory, security, environmentSecrets, desktop, enterprise, internal.

### Database

`node:sqlite` via `DatabaseService`, WAL mode, six versioned migrations with
checksums in `schema_migrations`. **39 tables.** Migrations 002 to 006 are
entirely for frozen features (team agents, approval governance, pipelines,
pipeline fleet, fleet policies). The MVP touches roughly a dozen tables:
`projects`, `threads`, `events`, `sessions`, `approvals`, `settings`,
`workspaces`, `environments`, `mcp_servers`, `contexts`, `context_entries`,
`project_decisions`.

`asterim.db-wal` must never be moved or deleted; doing so discards
uncheckpointed writes and projects vanish.

### Event system and sockets

`EventBus` (72 lines) is a singleton `EventEmitter` that re-emits every event on
the literal `'*'` channel (ADR-008, known debt). `socketManager` (212 lines)
joins two rooms per client: `projectId` and `workspace:<workspaceId>`, and
broadcasts to both. Every event must carry `projectId` and `threadId` in its
payload or routing and filtering break.

### Actual data flow, one approval

```
Claude Code process
  └─ writes a stream-json line: control_request { subtype: can_use_tool }
ClaudeAdapter (child_process pipe reader)
  └─ calls config.permissionResolver(ask)          [LaunchConfig]
AgentService.requestNativePermission()
  ├─ buildConsequence({ toolName, input, ... })    [services/approvals/consequence.ts]
  ├─ evaluateCommandSecurity(visible subject)      [ApprovalManager]
  └─ ApprovalManager.request(... consequence ...)
       └─ eventBus.publish('agent.approval_request')
            ├─ persisted to `events` and `approvals`
            └─ socketManager → room(projectId) → every paired browser on that thread
ApprovalCard (apps/web/src/components/approvals/ApprovalCard.tsx)
  └─ user clicks, or presses Escape
       └─ socket 'client.approval_response' { actionId, approved, decidedBy }
            └─ AgentService resolves the pending promise
                 └─ ClaudeAdapter writes control_response { behavior: allow|deny }
                      └─ the CLI, which was blocking, proceeds or does not
```

Withdrawal: the CLI may send `control_cancel_request` if its own hooks or rules
decide first. The adapter aborts via `AbortSignal` and the card is withdrawn.
The approval is recorded as `cancelled`, which the usage summary reports as
`withdrawn`.

**The leak to fix:** `buildConsequence` lives in the Core and `switch`es on
Claude Code's exact tool vocabulary — `Bash`, `PowerShell`, `Shell`, `Write`,
`Edit`, `MultiEdit`, `NotebookEdit`, `Read`, `Glob`, `Grep`, `WebFetch`,
`WebSearch`, with a default branch for anything unrecognised. The neutral target
shape (`ApprovalKind`, `ApprovalConsequence` in
`packages/shared/src/types/approval.ts`) is good and provider-neutral. The
translation is simply in the wrong layer.

### Authentication

Device pairing PIN plus an HMAC token is the only working credential (ADR-003).
The PIN regenerates on every start. `PairingService` applies exponential
back-off and a fifteen-minute lockout. Socket.IO middleware accepts pairing
tokens only. The account system is off unless `ASTERIM_ENABLE_ACCOUNTS=true`,
and forced off in sovereign mode.

A pairing token resolves to `defaultDevUser` with all five entitlements.
`ASTERIM_DEV_AUTH_BYPASS=true` plus non-production plus a loopback source grants
the same user with no token at all.

### Agent lifecycle

`AgentService` holds `activeSessions: Map<threadId, sessionId>`,
`pendingStarts: Map<threadId, Promise>`, `crashCounts`, `adapterConfigs`,
`workspaceMonitors` keyed by projectId. Everything is keyed by **thread**, so
concurrent sessions are structurally supported: many threads, one agent each.
There is no global single-agent lock. This has not been verified under
concurrent load, and the dashboard shows one active thread at a time.

### Project system, memory, context

`ProjectManager` owns projects and threads. `ProjectMemoryService` (1139 lines,
the best-tested subsystem in the repo) holds decisions, intents, architectural
rules and drift detection. `ContextService` and `ContextRepository` hold the
per-thread working set. `MemoryRelevanceEngine` and `DecisionExtractor` support
the decision register.

### Frozen subsystems — what "frozen" actually means here

It means *not marketed and not extended*. It does not mean off, hidden or
unreachable. Concretely:

- `team` and `pipelines` are real views mounted in the dashboard's persistent
  view stack. They are absent from `PRIMARY_VIEWS` and `MORE_VIEWS`, so no tab
  offers them, but `ViewType` accepts them and `RouterSync` resolves them, so
  `/workspace/project/:id/view/team` opens a fully wired 498-line explorer.
  Nothing gates them.
- `useSocket.ts` still subscribes `useTeamAgentStore` and `usePipelineStore` to
  live events for every session.
- Environment **membership** UI is fully visible in any non-personal
  environment: invite by email, role assignment, member removal, plus an audit
  sub-tab.
- Their HTTP routes answer 200 to a paired token, as measured above.

---

## 4. Existing broader functionality

Classification legend: **WORKING** (wired, routed, used, tested),
**PARTIAL** (works but with a named gap), **PROTOTYPE** (structurally complete,
never exercised end to end), **UNVALIDATED** (logic tested, integration never
run), **DEAD** (no call sites), **FOUNDATION** (correct groundwork for the
broader product, not currently load-bearing).

| Subsystem | Prod LOC | Test LOC | Route | UI | Gate | Class |
| --- | --- | --- | --- | --- | --- | --- |
| Pipelines | 4,344 | 2,635 | yes | mounted, URL-only | none | WORKING |
| Team agents | 2,908 | 2,608 | yes | mounted, URL-only | none | WORKING |
| Delegation | 2,524 | 2,506 | yes | modal + thread tree, visible | none | WORKING |
| MCP | 2,386 | 3,841 | yes | explorer, visible | mode switch only | WORKING |
| Memory / decisions | 2,047 | 2,806 | yes | explorer, visible | none | WORKING |
| Desktop daemon | 1,168 | 988 | yes | card, in an orphaned parent | `ASTERIM_HEADLESS` | WORKING |
| Worktrees | 1,065 | 585 | yes | via project store | none | WORKING |
| Skills | 927 | 746 | yes | explorer, visible | none | WORKING |
| Profiles | 692 | 783 | yes | selector + manager | none | WORKING |
| Verification | 594 | 1,290 | yes | via pipeline store | none | WORKING |
| Enterprise / fleet policy | 1,518 | 1,025 | yes | **none** | policy file can force sovereign | PARTIAL |
| Contexts | 504 | **0** | yes | Inspector | none | PARTIAL |
| Push notifications | 133 | **0** | yes | unreachable (orphaned parent) | sovereign | PARTIAL |
| mDNS | 84 | **0** | yes | workstation list | **not sovereign-gated** | PARTIAL |
| Relay | 671 | 541 (relay only) | yes | reads URL only | `ASTERIM_RELAY_URL` | PROTOTYPE |
| Billing | 808 | 712 | yes | **none** | Stripe keys → 503 | UNVALIDATED |
| Accounts / JWT | 877 | 187 | yes, 404 by default | dead `loginWithOAuthCode` | `ASTERIM_ENABLE_ACCOUNTS` | DEAD |
| `packages/mcp-memory-server` | 813 | 2,439 | via `/internal/*` | n/a | operator registers it | FOUNDATION |
| `rbacGuard`, `entitlementGuard` | 50 | 0 | n/a | n/a | n/a | DEAD |
| `AiderAdapter` | 41 | 0 | registered | typed in `App.tsx` | none | DEAD (stub) |

Mapped onto the founder's list of eventual capabilities:

| Wanted | What exists today |
| --- | --- |
| one interface for many agents | Registry with three providers, but the list is hard-coded in the web app. See section 6. |
| many concurrent sessions | Server-side yes, keyed by thread. UI shows one. Unverified under load. |
| projects | WORKING |
| tasks | Only as thread prompts. No task entity. Pipelines are the nearest thing. |
| agent communication | `team_agent_messages`, `team_turn_queue`, `AgentTurnLock` — WORKING, unvalidated by users |
| human ↔ agent | WORKING, the strongest part of the product |
| agent ↔ agent | Delegation — WORKING, 2,243 lines, never used by a real user |
| permissions and execution control | WORKING for Claude Code; the vocabulary mapping is Claude-specific |
| persistent project context | WORKING (memory) + PARTIAL (contexts, untested) |
| history | WORKING (`events` table, replayed on socket join) |
| keeping agents aware of context | `McpAgentBridge` injects skills and tools into prompts — WORKING |
| plugins / extensions | No plugin system. MCP and skills are the closest primitives. |
| skills | WORKING as a read-only library |
| MCP servers | WORKING |
| pipelines | WORKING, unvalidated |
| automation | Pipeline triggers exist and are instantiated at boot |
| team collaboration | Membership and invites are live in non-personal environments |
| remote access | PROTOTYPE (relay), never exercised |
| phone / laptop access | LAN + PIN works; the approval card is usable on a phone, the rest of the workspace is not |
| local models and cloud agents | **Nothing.** Every provider must be a local subprocess. |

---

## 5. Product understanding

Asterim is a local-first system for managing an ecosystem of AI agents, cloud
and local, from one application. It owns everything around the agents: the
projects they work in, the tasks they are given, the permissions they run under,
the context they carry, the record of what they did, and the ways they talk to a
human and to each other. Those things outlive any one session, any one agent and
any one vendor.

**Asterim is not a Claude Code wrapper.** Claude Code is the first provider
used to prove the system, chosen because it exposes a real permission protocol
that makes the control claim demonstrable rather than decorative. It is the
first serious provider, not the definition of the product.

The first release is deliberately narrow: one machine, one provider, the
approval loop done properly. That narrowness is a release decision. It is not a
statement about what Asterim is.

---

## 6. Strategic correction

The previous framing — "Claude Code MVP, everything else frozen" — is right
about *scope* and is becoming wrong about *architecture*. The evidence is
specific and checkable.

`docs/decisions/ADR-004-provider-agnostic-architecture.md` makes two promises
the code does not keep:

> "The Core may not assume a provider is a PTY, speaks a text protocol, streams
> tokens, has a session id, supports resume, or asks for permission at all.
> Those are adapter capabilities, and the Core branches on them."

`services/approvals/consequence.ts` lives in the Core and switches on Claude
Code's exact tool names. That is the Core knowing a provider's shape.
`services/ai/providers/ActiveAgentProvider.ts` switches on the agent type and
defaults to `'claude'`, so a live MVP feature is Claude-only.

> "Adding a provider must be: a `BaseAdapter` subclass, a `registerProvider`
> line, an entry in the engine list and binary detection, and a protocol test.
> Nothing in `apps/web`, no schema change, no new route."

Adding a provider today requires editing at least five places, two of them in
`apps/web`:

1. `apps/web/src/App.tsx:225-227` — the union type `'aider' | 'claude' | 'antigravity'`
2. `apps/web/src/App.tsx:421` — dropdown options
3. `apps/web/src/App.tsx:569` — a second `<select>` with the same options
4. `apps/web/src/components/overlays/FirstRunWizard.tsx:5` — `type EngineId`
5. `apps/server/src/services/StartupService.ts:64` — `binaryCache: { claude, aider, antigravity }`, a hard-coded object shape

`globalProviderRegistry.listProviders()` exists and **is never called by the
server**. There is no endpoint that tells the dashboard which providers exist,
so the dashboard duplicates the list by hand.

Two further structural limits:

- `IAgentProvider.getLaunchCommand()` requires every provider to be a local
  subprocess. Cloud agents, remote agents and API-called models have no shape
  in this abstraction at all.
- `BaseAdapter` encodes the terminal-scraping model, and the only provider that
  works overrides its entire process lifecycle. The base class is the legacy
  path.

The risk is not that the MVP is narrow. The risk is drift: each Claude-specific
convenience is individually reasonable, none is individually alarming, and the
accumulation is an application that can only ever host one kind of agent. By the
time a second serious provider arrives, the cost of that accumulation is a
redesign rather than an adapter.

**The correction is not to build providers.** It is to keep the seams honest
while the MVP stays narrow. Concretely, and cheaply:

- Move provider vocabulary out of the Core and into adapters. Each adapter
  translates its own tool names into the existing neutral `ApprovalConsequence`.
  The Core renders what it is given. This is a move, not a new feature.
- Expose the registry. One endpoint listing provider ids, labels, capabilities
  and detection status. The web app renders that list instead of hard-coding it.
- Decide, in writing, what a non-subprocess provider looks like — even if none
  is built. If `getLaunchCommand` is the wrong seam, name the right one now,
  while there is one real implementation to reshape rather than five.

That is the FOUNDATION tier the current labelling scheme is missing. There is no
`FOUNDATION` label anywhere in the documentation today; the tiers are CURRENT,
MVP, POST-MVP and VISION. A useful definition, for the next session to apply
rather than inherit: **FOUNDATION is work that ships no user-visible feature and
buys no MVP time, but whose absence forces a redesign later.** Provider
discovery, consequence translation and the non-subprocess seam are the
candidates.

---

## 7. Recommended next-session starting point

Do not implement this list without judging it first. The sequence is a starting
point, not an instruction set.

1. **Confirm the push happened.** `git log origin/main..HEAD`. If it is not
   empty, the last two days exist only on this machine.
2. **Re-establish ground truth.** `pnpm install && pnpm run typecheck &&
   pnpm run lint && pnpm run build`, then `pnpm run test` and confirm the only
   failure is `AgentMcpIntegration` at 156/160. Then run both e2e harnesses
   against a packaged build on a clean data directory. If any of that does not
   match section 1, stop and find out why before writing code.
3. **Fix the truthfulness defects, because they are cheap and they are lies in
   the product.** The fabricated skills, profiles and "local RAG vector search"
   copy in `EnvironmentSettingsView.tsx`; the always-true Antigravity detection
   in `StartupService.ts:94`; the sovereign-mode mDNS contradiction.
4. **Decide the five-tier boundary and write it down** in `PROJECT_CONTEXT.md`,
   including the missing FOUNDATION tier, and re-label `docs/` accordingly. The
   status section of `PROJECT_CONTEXT.md` is stale and must be corrected in the
   same pass.
5. **Close the provider seams**, in this order, smallest first: expose the
   registry over HTTP and consume it in the web app; move consequence
   translation into the adapters; then write the decision about non-subprocess
   providers.
6. **Decide what "frozen" means at the API layer.** Today it means hidden in
   navigation while the routes answer 200 to any paired token. Either that is
   intended and should be documented, or the frozen routes need a switch like
   the one `AccountsFeature` gave the account system.
7. **Delete the dead code** listed in section 1. It is ~1,600 lines, it has no
   callers, and three files are overlapping copies of one screen.
8. Only then consider P1 work: `App.tsx` extraction (which also fixes the
   Rules-of-Hooks violation), the Fastify 5 upgrade, the secret-variable
   deny-list.

Constraints that still hold: no new `any`; tests are plain `tsx` scripts next to
the code and must be added to the workspace `test` script; agents never commit;
temporary scripts go in `scratch/`; documentation lives only in `docs/`,
`README.md`, `PROJECT_CONTEXT.md`, `CLAUDE.md`.

---

## 8. Open questions

Only the ones the repository genuinely cannot answer.

1. **Has the npm publish happened, and under what account?** `P0-06` needs an
   npm account and an `NPM_TOKEN` secret. Until it does, the install command in
   the README and on the site fails. The repository cannot know this.
2. **Is the cohort running, and what did they say?** Every prioritisation
   decision after Phase 1 is supposed to be driven by the seven hypotheses in
   `docs/product/experiments.md`. If interviews have happened, their answers
   outrank everything in section 7.
3. **Does the founder accept the Fastify 4 advisories for the cohort, or is the
   upgrade a blocker?** This is a risk-tolerance decision, not an engineering
   one.
4. **Is the GitHub repository description meant to stay as it is?** It still
   reads "an AI-native workspace for orchestrating autonomous coding agents,
   managing software projects, and building production-ready applications",
   which is the older, wider framing and contradicts the current positioning.
   Changing it is a settings change nobody has authorised.

Everything else in this document is an engineering decision. Make it.

---

## NEXT SESSION START

**First instruction:**

> Verify the repository matches section 1 of `docs/handoff/ASTERIM_HANDOFF.md`.
> Run `git log origin/main..HEAD`, then `pnpm run typecheck && pnpm run lint &&
> pnpm run build && pnpm run test`, and confirm the only failing suite is
> `AgentMcpIntegration.test.ts` at 156/160. Report any difference before doing
> anything else.
>
> Then fix the three truthfulness defects in section 7 item 3, because they are
> claims the product makes about itself that are not true:
> the hard-coded `['caveman', 'cavecrew', 'graphify']` skills list, the
> hard-coded agent profiles naming `gpt-4o`, and the "local RAG vector search"
> copy — all in `apps/web/src/components/environment/EnvironmentSettingsView.tsx`,
> where the real `useSkillsStore` and `useProfileStore` data is already
> available; the `antigravity: hasAntigravity || true` fallback at
> `apps/server/src/services/StartupService.ts:94`, which makes the first-run
> wizard incapable of reporting Antigravity as missing; and the fact that
> `mdnsService.start(port)` runs unconditionally at `apps/server/src/server.ts:431`
> while README, SECURITY.md and the marketing site all promise that sovereign
> mode makes Asterim silent on the network. For the last one, either gate it or
> correct all three documents — decide which, and say why.
>
> Verify each fix by running it, not by reading it. Then read section 6 and
> propose the five-tier boundary before writing any provider code.
