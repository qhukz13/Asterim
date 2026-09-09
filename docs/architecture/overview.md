# Architecture Overview

## Where this sits in the product

Asterim is a control layer above coding agents (`docs/product/overview.md`). The conceptual model, which the implementation below serves:

```text
   You → Asterim → { Projects, Tasks, Context, Permissions, History } → Agent Runtime → providers
```

The durable concepts belong to Asterim and outlive any session, agent or vendor. The Agent Runtime is the seam: one interface, many providers, of which the MVP implements one seriously (ADR-004). Everything in this document is the **CURRENT** implementation of that model, not the model itself; when the two disagree, the model is the ambition and this document is the truth.

## WHAT

Three runtimes and two shared packages in a pnpm/turbo monorepo:

```text
                       ┌──────────────────────────────┐
  browser / phone ───▶ │  apps/web  (React 18 + Vite) │  dashboard PWA, served by the Core
                       └──────────────┬───────────────┘
                     REST /api/v1/*   │   Socket.IO (events, rooms per project)
                       ┌──────────────▼───────────────┐
                       │  apps/server  (package `asterim`, Fastify, Node 22)      │
                       │  EventBus · AgentService · ApprovalManager · Git · SQLite│
                       └───────┬──────────────┬───────┘
                               │ child process│
                  ┌────────────▼───┐   ┌───────▼─────────┐
                  │ Claude Code CLI│   │ Antigravity CLI │   (packages/adapters)
                  └────────────────┘   └─────────────────┘

  apps/marketing   static website (React 19), no backend dependency at launch
  apps/relay       cloud relay (frozen)
  packages/shared  events, domain types, crypto helpers: the contract across the socket
  packages/mcp-memory-server  MCP server exposing Project Memory to agents (kept, not marketed)
```

## WHY

One privileged local process (the Core) owns everything stateful: the SQLite database, the agent processes, git, the approval queue. The dashboard is a thin client that can run on any device on the LAN. Adapters isolate vendor protocols so the rest of the system sees one event stream.

## WHERE (map of the Core)

| Directory | Responsibility |
| --- | --- |
| `apps/server/src/server.ts` | Boot: logger, Fastify, CORS, auth middleware, security headers, static dashboard, route registration, recovery passes, listen. |
| `apps/server/src/index.ts` | Entrypoint: CLI subcommands (`db:status`, `db:snapshot`, `data:clone`) or boot the server. |
| `apps/server/src/services/EventBus.ts` | Singleton Node EventEmitter; also re-emits every event on `'*'` (ADR-008). Everything asynchronous goes through it. |
| `apps/server/src/sockets/socketManager.ts` | Socket.IO: pairing-token handshake, rooms per `projectId` and `workspace:<id>`, history replay, persistence of non-transient events to `events`. |
| `apps/server/src/services/AgentService.ts` | Agent lifecycle per thread; permission resolution for native adapters; crash restart (3 attempts); provider session ids. |
| `apps/server/src/services/ApprovalManager.ts` | Pending approvals (memory + `approvals` table), timeout, cancel, recovery; risk heuristics. |
| `apps/server/src/services/git/` | `GitService` over focused managers over a CLI `GitProvider`. |
| `apps/server/src/services/DatabaseService.ts`, `migrations/` | `node:sqlite`, WAL, versioned migrations 001–006. |
| `apps/server/src/middleware/authMiddleware.ts` | Pairing tokens and account JWTs; loopback-only dev bypass. |
| `apps/server/src/services/PairingService.ts` | PIN, HMAC tokens, brute-force lockout. |
| `apps/server/src/services/security/` | Secret vault (settings and environment credentials at rest, log redaction). |
| `apps/server/src/routes/` | 25 route files, all under `/api/v1/`. Core loop uses `projects`, `git`, `system`, `auth`, `ai`, `memory`. Frozen: `teamAgents`, `pipelines`, `enterprise`, `desktop`, `delegation`, `worktrees`, `billing`, `webhooks`, `apikeys`, `devices`, `sessions`. |
| Frozen subsystems | `services/ai/TeamAgentService.ts`, `services/pipeline/`, `services/enterprise/`, `services/desktop/`, `services/ai/AgentDelegationService.ts`, `RelayClient.ts`, `PushService.ts`, `mDNSService.ts`. Present, tested, hidden. Disposition per subsystem in ADR-005. |

## HOW: the core loop

```text
1. Pair       POST /api/v1/auth/pair {pin} → HMAC token (30 days) → Socket.IO handshake auth.token
2. Project    POST /api/v1/projects {name, path}  (path must exist)
3. Thread     POST /api/v1/projects/:id/threads
4. Start      socket client_event {type:'client.command', payload:{command:'start', agentType, projectId, threadId}}
5. Message    client_event {type:'client.chat_message', payload:{content, projectId, threadId}}
              → AgentService → adapter stdin
6. Output     adapter → EventBus (agent.stream, chat.message, agent.tool_call, agent.tool_result, agent.status)
              → socketManager → room projectId → dashboard; persisted to `events` (streams are buffered, not persisted)
7. Approval   adapter permission ask → AgentService.requestNativePermission → ApprovalManager.requestApproval
              → agent.approval_request → dashboard card → client.approval_response → promise resolves → adapter answers the CLI
8. Diff       GET /api/v1/git/:projectId/status|diff → Changes view; commit is a human action
9. Resume     provider session id in `settings` → next start passes --resume
```

## CONTRACT

- Every event carries `projectId` and `threadId` in the payload; routing and filtering depend on both.
- REST is authenticated by `Authorization: Bearer <pairing token | JWT>`; sockets by the pairing token only.
- The Core binds `HOST` (`::` by default) and must be safe on a LAN: no unauthenticated route under `/api/v1/` except `/auth/pair`, `/auth/login`, `/auth/register`, `/auth/refresh`, `/webhooks/stripe`; `/health` is public.
- `~/.asterim/asterim.db` from any earlier version must keep opening: schema changes are versioned migrations that are additive.
- The Core never commits, pushes or runs anything on the user's behalf without an explicit client event.
- The Core may not assume anything about a provider's shape: not a PTY, not a text protocol, not streaming, not a session id, not that it asks permission at all. Those are `AdapterCapabilities` and the Core branches on them (ADR-004). This is what keeps a single-provider MVP from becoming a single-provider product.
- Asterim makes no outbound network connections of its own. Adding one is a product decision (`docs/product/overview.md` § Principles), not an implementation detail.

## MODIFYING

- New behaviour that spans processes: add an event type to `packages/shared/src/events.ts` first, then producer, then consumer.
- New route: under `/api/v1/`, registered in `server.ts`, authenticated by default (do not add to the allow-list).
- New table or column: a new numbered migration in `apps/server/src/migrations/`, registered in `index.ts`; never edit an applied migration.
- New adapter: see `docs/architecture/agents.md`.

## DO NOT

- Do not read settings or the database at module import time (the CLI entrypoint must not open the database).
- Do not persist `agent.stream` or `agent.log` events (they are buffered in memory on purpose).
- Do not add dependencies to the Core for things Node 22 has (`node:sqlite`, `fetch`, `crypto`).
- Do not revive the frozen subsystems in the primary navigation. They are frozen pending the first-users experiment (ADR-002 as amended, ADR-005), not merely unfinished.
