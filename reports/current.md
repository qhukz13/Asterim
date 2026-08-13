# Execution Report: P5.1-02 — MCP Memory Server Package & Stdio Scaffold

**Task ID:** P5.1-02
**Status:** VERIFIED
**Date:** 2026-08-13
**Author:** Claude Code
**Branch:** `main` @ `b2b6f7f`

---

## 1. Summary

Created `@asterim/mcp-memory-server` (`packages/mcp-memory-server`) with its build pipeline, installed `@modelcontextprotocol/sdk@1.30.0` and `zod@4.4.3`, implemented the `stdio-guard.ts` stream isolation module, and scaffolded the stdio MCP entrypoint with a working JSON-RPC handshake and an empty `tools/list`.

The package builds to an executable `dist/index.js` with the `#!/usr/bin/env node` shebang, completes an MCP `initialize` exchange over a real child process, and keeps `process.stdout` free of every non-protocol byte — verified positively **and** by negative control (§ 5.2).

All four acceptance criteria are met. Two deviations from the specified manifest were necessary and are documented in § 6.

---

## 2. Files Changed

**Created**

| File | Purpose |
| :-- | :-- |
| `packages/mcp-memory-server/package.json` | Package manifest, `bin`, deps, `engines.node >= 22` |
| `packages/mcp-memory-server/tsconfig.json` | Extends `tsconfig.base.json`, mirrors `packages/shared` |
| `packages/mcp-memory-server/tsup.config.ts` | CJS build, shebang banner, externals |
| `packages/mcp-memory-server/eslint.config.js` | Flat config, matching `packages/shared` |
| `packages/mcp-memory-server/src/stdio-guard.ts` | Console → stderr rebind |
| `packages/mcp-memory-server/src/index.ts` | MCP server entrypoint over stdio |
| `packages/mcp-memory-server/src/__tests__/stdio_scaffold.test.ts` | Spawned-process protocol test |

**Modified**

| File | Change |
| :-- | :-- |
| `pnpm-lock.yaml` | `pnpm install` — 47 packages added for the SDK and its deps |

**Not modified:** no file in `apps/server`, `packages/shared`, or `packages/adapters` was touched; no DDL was altered; no memory tools or project resolution were implemented.

---

## 3. Implementation Details

### 3.1 SDK wiring

`@modelcontextprotocol/sdk@1.30.0` resolved and installed cleanly. Although the SDK is `type: "module"`, it ships `require` conditions for every subpath, so the package stays **CommonJS** like the rest of the repo. Verified against the installed artifact before writing any code:

```
require('@modelcontextprotocol/sdk/server/index.js') → { Server }
require('@modelcontextprotocol/sdk/server/stdio.js') → { StdioServerTransport }
require('@modelcontextprotocol/sdk/types.js')        → { ListToolsRequestSchema, … }
```

The entrypoint uses the **low-level `Server`** rather than `McpServer`, since the scaffold needs only capability negotiation and a request handler; `McpServer`'s zod-based tool registration belongs with the tools in P5.1-04/05. Server metadata is `name: 'asterim-mcp-memory'`, `version: '0.1.0'`, with `capabilities: { tools: {} }` declared now so clients negotiate tool support during `initialize`. `ListToolsRequestSchema` returns `{ tools: [] }`.

`SIGINT`/`SIGTERM` handlers call `server.close()` behind a re-entrancy flag and exit 0.

### 3.2 Build configuration

`tsup.config.ts` mirrors `apps/server/tsup.config.ts`:

- `format: ['cjs']`, `target: 'node22'`, shebang banner.
- `noExternal: ['@asterim/shared', 'asterim']` — workspace packages ship raw TypeScript, so they must be **bundled**; left external, the emitted `require()` would resolve to a `.ts` file at runtime and fail.
- `external: ['node:sqlite', '@modelcontextprotocol/sdk']` — `node:sqlite` is a builtin, and keeping the SDK external avoids inlining `express`/`hono`, which the stdio path never loads.

Result: **19.57 KB**, mode `-rwxr-xr-x`, containing `DatabaseService` and **zero** Fastify or Socket.IO references — the clean dependency closure P5.1-01 predicted, confirmed in the emitted artifact.

### 3.3 Stdio guard

```ts
globalThis.console = new console.Console(process.stderr, process.stderr);
```

Rebinding the whole console rather than patching `console.log` alone also covers `info`, `debug`, `dir`, `table`, and `group`, which Node likewise routes to stdout — so no future log line in any imported module can reach the protocol stream.

Placement is the load-bearing detail. `import './stdio-guard'` is the **first** import in `index.ts`; imports hoist but execute in source order, so a guard listed first runs first. The emitted bundle confirms the ordering survives bundling:

```
line 27: globalThis.console = new console.Console(process.stderr, process.stderr)
line 30: require("@modelcontextprotocol/sdk/server/index.js")
line 56: console.log(`[Database] Using database at: ${this.dbPath}`)
```

The entrypoint deliberately imports `dbService` and prints its `dbPath` to stderr. That serves two purposes: it is genuine operator diagnostics (the first thing to check when an agent reports unfamiliar memory), and it forces `DatabaseService` to load so the guard is exercised for real rather than nominally — which is what makes the test in § 5 non-vacuous.

---

## 4. Tests / Verification

```
$ pnpm install
Packages: +47   Done in 12.3s   EXIT=0

$ pnpm --filter @asterim/mcp-memory-server build
CJS dist/index.js 19.57 KB
CJS ⚡️ Build success in 28ms   EXIT=0

$ pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/stdio_scaffold.test.ts

build artifact
  PASS  dist/index.js exists
  PASS  the bundle starts with the node shebang
  PASS  the bundle is marked executable
  PASS  the stdio guard is emitted before the SDK is required
  PASS  the stdio guard is emitted before the DatabaseService log
  PASS  no Fastify or Socket.IO reached the bundle

stdio transport handshake
  PASS  the server did not exit during handshake
  PASS  the first stdout line is valid JSON
  PASS  the response is JSON-RPC 2.0
  PASS  the response correlates to request id 1
  PASS  the response is a result, not an error
  PASS  serverInfo.name is asterim-mcp-memory
  PASS  serverInfo.version is 0.1.0
  PASS  a protocol version was negotiated
  PASS  tools capability is advertised
  PASS  tools/list returned a parseable frame
  PASS  the tools/list response correlates to request id 2
  PASS  the tools/list response is a result, not an error
  PASS  the scaffold exposes no tools yet

stdout purity
  PASS  every stdout line parses as JSON
  PASS  every stdout frame is a JSON-RPC 2.0 message
  PASS  stdout contains no raw log text

the guard is actually doing work
  PASS  the DatabaseService log was emitted — to stderr
  PASS  the server announced readiness on stderr
  PASS  the database was opened inside the temp directory
  PASS  the temp database file was created

graceful shutdown
  PASS  the server exits cleanly on SIGTERM
  PASS  shutdown was logged to stderr

28/28 assertions passed   EXIT=0

$ pnpm run build
Tasks:    7 successful, 7 total   EXIT=0
```

The new package joined the turbo pipeline automatically (6 → 7 tasks) with no config change, as P5.1-01 predicted.

### 4.1 Supporting checks

| Check | Result |
| :-- | :-- |
| `tsc -p packages/mcp-memory-server/tsconfig.json --noEmit` | 0 errors |
| `eslint src/` in the new package | 0 problems |
| `ProjectMemoryService.test.ts` (Phase 5.0 regression) | 217/217 |
| `memory.test.ts` (Phase 5.0 regression) | 77/77 |

The two Phase 5.0 suites were re-run because `pnpm install` rewrote the lockfile; neither is affected.

---

## 5. Evidence That the Test Is Not Vacuous

This deserves calling out, because the acceptance criterion — "stdout produces clean JSON-RPC with zero stray logging" — is satisfiable by a build in which nothing ever logs.

### 5.1 Positive control

The test asserts that stderr **does** contain `[Database] Using database at`, that the readiness line appears, and that `asterim.db` was actually created in the temp directory. If `DatabaseService` had not loaded, those three assertions fail and the clean-stdout result is correctly reported as meaningless.

### 5.2 Negative control

The guard import was temporarily removed, the package rebuilt, and the suite re-run:

```
  FAIL  the stdio guard is emitted before the SDK is required
  FAIL  the stdio guard is emitted before the DatabaseService log
  FAIL  the first stdout line is valid JSON
        — "[Database] Using database at: /tmp/asterim-mcp-stdio-zZ09Um/asterim.db"
  FAIL  the tools/list response correlates to request id 2 — expected 2, got 1
  FAIL  every stdout line parses as JSON
  FAIL  every stdout frame is a JSON-RPC 2.0 message
  FAIL  stdout contains no raw log text
  FAIL  the DatabaseService log was emitted — to stderr
12/21 assertions passed   EXIT=1
```

The database log becomes the **first stdout frame**, desynchronising every subsequent response (`tools/list` correlates to id 1 instead of 2) — precisely the corruption P5.1-01 predicted. The guard was then restored, rebuilt, and re-verified at 28/28.

---

## 6. Problems Discovered & Concerns

### 6.1 `@types/node@^20.0.0` cannot typecheck this package — changed to `^26.0.0`

The task specified `"@types/node": "^20.0.0"`. That version predates `node:sqlite`, and the package transitively imports `DatabaseService`, which does `import type { DatabaseSync } from 'node:sqlite'`:

```
$ tsc -p tsconfig.json --noEmit
../../apps/server/src/services/DatabaseService.ts(1,35):
  error TS2307: Cannot find module 'node:sqlite' or its corresponding type declarations.
```

`tsup`/esbuild does not typecheck, so the **build passes either way** and no acceptance criterion depended on this — but the package would have been un-typecheckable in an editor or CI from day one, and P5.1-03 will import more of the same source.

Changed to `^26.0.0`, matching both packages this one depends on (`apps/server` and `@asterim/shared` are already `^26.0.0`). Typecheck is now clean. Flagging rather than burying it, since it is a deviation from the written task.

### 6.2 `tsx` added to devDependencies

The task's own verification command #3 is `pnpm --filter @asterim/mcp-memory-server exec tsx …`, but `tsx` was not in the specified devDependency list, so that command could not run. Added at `^4.22.4` to match `apps/server`. No new download — it was already in the store.

### 6.3 `eslint.config.js` added

`turbo run lint` invokes `lint` in every workspace package. Without a flat config the new package would fail the repo-wide lint task. The file is two lines, copied verbatim from `packages/shared/eslint.config.js`.

### 6.4 The `asterim` deep-import is undocumented coupling

The task selected Option B from the P5.1-01 audit — depend on the `asterim` workspace package. It works, and tsup bundles the source correctly. But `apps/server` declares no `exports` map and its `"main"` is `dist/index.js`, the **bundled Fastify server that calls `listen()`**. The import `asterim/src/services/DatabaseService` therefore reaches past the package's public surface into its source tree.

Nothing in either manifest records this. If anyone later adds an `exports` field to `apps/server` — a normal, well-intentioned change — this package breaks with a confusing resolution error. **Recommend a one-line entry in `blueprint/audit/IMPLEMENTATION_DRIFT.md`**, or the `packages/memory-core` extraction (audit Option C) when the phase has room.

### 6.5 The binary is not standalone

`dist/index.js` keeps `@modelcontextprotocol/sdk` external, so it requires the repo's `node_modules` at runtime. That is correct for `claude mcp add` pointing at an absolute path inside the repo, which is the Phase 5.1 use case, but the binary cannot be copied elsewhere. Worth deciding before P5.1-08 documents installation.

Relatedly, `asterim-mcp-memory` is **not** linked into root `node_modules/.bin`, because pnpm links a package's bin into its *dependents* and nothing depends on this package. MCP clients invoke by absolute path, so this is expected rather than a defect.

### 6.6 Pre-existing, unrelated

`pnpm run lint` still fails with 38 errors in `apps/server` files untouched by Phase 5.0/5.1, so CI (`lint` + `build`) remains red on `main`. Every build result in this report is local verification.

---

## 7. Recommended Next Step

Proceed to **P5.1-03 — Project Context Resolver**. The scaffold is ready to receive it: `dbService` is already imported and its path proven honoured via `ASTERIM_DATA_DIR`.

Carry these findings from the P5.1-01 audit (§ 5) into the resolver, all confirmed against the live `~/.asterim/asterim.db`:

1. **Normalize paths.** One project is stored as `/home/qhukz/Documents/Projects/` with a trailing slash; `process.cwd()` never has one, so exact string matching can never resolve it.
2. **Prefer the longest match.** `/home/qhukz/Documents/Projects/` is an ancestor of every other project on this machine, so first-hit traversal returns the wrong project by default, not as a corner case.
3. **Use segment-safe containment,** not `startsWith` — otherwise `…/Asterim` matches a sibling `…/AsterimOld`.
4. **Do not require the path to exist on disk;** one stored path predates a rename.
5. **Fail loudly when nothing matches.** Silently defaulting to the first project would let an agent write a decision into the wrong project's memory — the one property Phase 5.0 enforced at every other layer.

Suggested addition to the P5.1-03 test suite: a fixture database reproducing the nested-project and trailing-slash cases above, since both are present in real user data today and neither is caught by a happy-path test.
