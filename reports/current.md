# Execution Report: P5.1-03 — Project Context Resolver Engine

**Task ID:** P5.1-03
**Status:** VERIFIED
**Date:** 2026-08-13
**Author:** Claude Code
**Branch:** `main` @ `48c4f7c` (working tree — both files untracked)

---

## 1. Summary

`packages/mcp-memory-server/src/resolver.ts` implements the four-tier project resolution hierarchy (`--project` → `--project-path` → `ASTERIM_PROJECT_ID` → CWD auto-detection) with `path.resolve()` normalization, `path.relative()` segment-safe containment, longest-path specificity ranking, and descriptive failure that lists every registered project. `resolver.test.ts` covers it at **41/41 assertions**, and all four acceptance criteria are met.

Verification went beyond re-running the suite: three mutation (negative-control) runs establish which assertions actually hold the implementation up. Two of the three caught their mutation; **one did not**, exposing a coverage gap in the substring-collision case — documented in § 5.1 with a reproduction. The implementation is correct; the *test* for that property is weaker than its name claims.

One defect was found and fixed: the test file introduced **two new ESLint errors**, breaking `turbo run lint` for this package (§ 6.1).

---

## 2. Files Changed

**Created (by the P5.1-03 implementation, verified here)**

| File | Lines | Purpose |
| :-- | --: | :-- |
| `packages/mcp-memory-server/src/resolver.ts` | 176 | Resolution engine + argv parser |
| `packages/mcp-memory-server/src/__tests__/resolver.test.ts` | 341 | Standalone assertion suite |

**Modified during verification**

| File | Change |
| :-- | :-- |
| `packages/mcp-memory-server/src/__tests__/resolver.test.ts` | +2 `eslint-disable-next-line` comments with justification (§ 6.1) |

`resolver.ts` was mutated three times for negative controls and restored byte-identically each time (`md5 ef37a63d1ed6a990e349aec56c42a643` confirmed against a pre-mutation copy). **No file outside `packages/mcp-memory-server` was touched.** No DDL altered, no MCP tools implemented — the § 5 prohibitions hold.

---

## 3. Implementation Details

### 3.1 The four tiers

Each tier resolves and returns; there is no fallthrough on failure. Passing `--project no-such-id` throws rather than silently degrading to CWD detection — correct, since a caller who named a project explicitly and got a *different* one is the exact failure Phase 5.0 guards against everywhere else. Precedence is asserted pairwise in the suite (id > path > env > cwd), not merely per-tier.

### 3.2 Containment (`matchByPath`)

```ts
const rel = path.relative(normalized, target);
return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
```

`rel === ''` is the project root itself; anything descending into it yields a relative path with no `..` prefix. `path.isAbsolute(rel)` covers the Windows cross-drive case, where `path.relative` returns an absolute path instead of `..`.

Specificity ranking is `sort((a, b) => b.normalized.length - a.normalized.length)`, taking `[0]`. Length is a valid proxy for depth here because all candidates already contain the target, so they are necessarily ancestors of one another and the longest is the deepest.

### 3.3 Deviation from the written task — `--project-path` uses containment, not equality

Task § 4 specifies Priority 2 as "Resolve path and match against the `projects` table". The implementation routes it through the same `matchByPath` used for CWD, so `--project-path /workspace/projects/asterim-core/apps` resolves to the project rather than failing.

This is a deliberate superset and is asserted explicitly (`'an explicit path pointing into a project resolves to that project'`). It is the more useful behaviour — an operator pointing at a subdirectory means the enclosing project — and it cannot resolve anything an equality match would have rejected as ambiguous, since longest-match still applies. Flagged because it is a documented deviation, not because it is in doubt.

---

## 4. Tests / Verification

All commands run from the repository root on `main`.

```
$ pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/resolver.test.ts
  CWD auto-detection ............................ 13 PASS
  segment-safe containment .......................  2 PASS
  explicit --project <id> ........................  3 PASS
  explicit --project-path <path> .................  5 PASS
  ASTERIM_PROJECT_ID .............................  6 PASS
  failure messaging ..............................  1 PASS
  argv parsing ...................................  9 PASS
  no registered projects .........................  2 PASS
  41/41 assertions passed                            EXIT=0

$ tsc -p packages/mcp-memory-server/tsconfig.json --noEmit
  0 errors                                           EXIT=0

$ pnpm --filter @asterim/mcp-memory-server build
  CJS dist/index.js 19.57 KB                         EXIT=0

$ pnpm run build
  Tasks: 7 successful, 7 total                       EXIT=0

$ eslint src/   (in packages/mcp-memory-server)
  0 problems                                         EXIT=0   [after the § 6.1 fix]
```

**Regression check** — the P5.1-02 suite was re-run to confirm the new module did not disturb the stdio scaffold:

```
$ pnpm --filter @asterim/mcp-memory-server exec tsx src/__tests__/stdio_scaffold.test.ts
  28/28 assertions passed                            EXIT=0
```

### 4.1 Acceptance criteria

| # | Criterion | Result |
| :-- | :-- | :-- |
| 1 | Four-tier hierarchy implemented | **Met** — each tier asserted, plus pairwise precedence |
| 2 | Normalization, segment-safe containment, longest-path fully covered | **Met with one caveat** — see § 5.1 |
| 3 | `resolver.test.ts` passes 100% of assertions | **Met** — 41/41 |
| 4 | `pnpm run build` completes with 0 errors | **Met** — 7/7 tasks |

---

## 5. Negative Controls — Which Assertions Actually Hold This Up

A suite that is green tells you nothing until you know it can go red. Each of the three load-bearing rules was individually broken, the suite re-run, and the file restored.

| # | Mutation | Suite result | Verdict |
| :-- | :-- | --: | :-- |
| A | `path.relative` containment → raw `target.startsWith(normalized)` | 40/41 | **weak** — 1 catch |
| B | Longest-match `.sort()` removed | 27/41 | **strong** — 14 catches |
| C | Stored-path `path.resolve()` removed | **41/41** | **no catch** |

### 5.1 Control A — the substring-collision test does not test substring collision

Replacing segment-safe containment with `startsWith` was caught by exactly one assertion, and not the one named for it:

```
FAIL  a path outside every project does not match by prefix
      — expected a throw, but the call succeeded
PASS  a sibling sharing a name prefix is not swallowed by the shorter project   <-- still green
```

The sibling assertion stays green under the bug because the fixture registers **both** `asterim-core` and `asterim-core-legacy`. With `startsWith`, the cwd `…/asterim-core-legacy/deep/path` matches both — and the longest-match sort then picks `asterim-core-legacy` anyway. The sort masks the broken containment, so the assertion cannot fail for the reason its name gives.

The genuinely dangerous shape is the one the fixture never builds: the sibling directory exists on disk but is **not** a registered project. Reproduced against the mutated resolver:

```
cwd = /workspace/projects/asterim-core-legacy/src
only registered project = /workspace/projects/asterim-core
RESOLVED to proj-core (/workspace/projects/asterim-core)   <-- WRONG
```

An agent running in an unregistered sibling directory would write its decisions into the neighbouring project's memory. **The shipped implementation is correct and returns a throw here** — the gap is in coverage, not behaviour. One assertion closes it: seed only the shorter sibling and assert the longer path throws.

The `/workspace/projects-elsewhere/thing` assertion is what currently carries this property, and it does so incidentally — it catches prefix matching against the *ancestor* row, not between siblings.

### 5.2 Control C — one normalization is redundant

Removing `path.resolve()` from the stored project path left the suite fully green, including `'the ancestor root itself resolves despite its stored trailing slash'`. That assertion passes either way, because `path.relative()` normalizes its own arguments — `path.relative('/workspace/projects/', '/workspace/projects')` is already `''`.

So the trailing-slash requirement from the P5.1-01 audit is satisfied by `path.relative`, and the explicit `path.resolve()` on the stored path affects only the sort key's length. That is harmless (a trailing slash adds 1 character, while any deeper project path adds at least 2, so it cannot invert the ranking), and the call is worth keeping as defence in depth. Recorded because the assertion's name overstates what it proves.

### 5.3 Control B — specificity ranking is genuinely well covered

Removing the sort collapsed 14 assertions across four groups, every one reporting `got "proj-ancestor"`. This is the property the P5.1-02 report singled out as failing "by default, not as a corner case" on the live database, and the suite is decisive about it.

---

## 6. Problems Discovered & Concerns

### 6.1 Two new ESLint errors — FIXED

The test file's deliberate `require()` calls tripped the repo's flat config:

```
src/__tests__/resolver.test.ts
  27:23  error  A `require()` style import is forbidden  @typescript-eslint/no-require-imports
  28:64  error  A `require()` style import is forbidden  @typescript-eslint/no-require-imports
✖ 2 problems
```

`turbo run lint` runs `lint` in every workspace package, so this made `@asterim/mcp-memory-server` fail a CI gate that P5.1-02 left clean.

The `require()` is *correct and necessary* — `DatabaseService` exports a singleton constructed at import time, and ESM bindings hoist above the `ASTERIM_DATA_DIR` assignment, which would open the user's real `~/.asterim/asterim.db` instead of the temp fixture. Converting to `await import()` is not available either: the package is CommonJS, so top-level await will not compile.

Fixed with two targeted `eslint-disable-next-line` comments carrying the reason, matching existing precedent in `apps/server/src/services/__tests__/ProjectMemoryService.test.ts:1042`. Package lint is now 0 problems.

### 6.2 The resolver is not reachable from the entrypoint

`src/index.ts` contains no reference to `resolver`, and the built bundle is unchanged at **19.57 KB** with zero occurrences of `resolveProjectContext`. The module is exercised only by its test.

This is correct per task § 5 — wiring belongs with the tools in P5.1-04 — but it means acceptance criterion 4 (`pnpm run build` passes) provides **no coverage of this module whatsoever**; it type-checks under `tsc --noEmit` and is validated by the suite alone. Worth stating plainly so the green build is not read as more than it is.

Consequence for P5.1-04: `parseResolveOptionsFromArgv(process.argv.slice(2))` must be called in `index.ts`, and a resolution failure must be surfaced on **stderr** and exit non-zero — throwing an uncaught exception whose stack reaches stdout would corrupt the JSON-RPC stream that P5.1-02's stdio guard exists to protect.

### 6.3 `--project` consumes the following token unconditionally

`read()` returns `argv[i + 1]` whenever `arg === '--project'`, without checking whether that token is itself a flag:

```
parseResolveOptionsFromArgv(['--project', '--project-path', '/w/p'])
  → { explicitProjectId: '--project-path' }
```

The result is a loud, correctly-formatted "does not match any registered project" error rather than a wrong resolution, so the blast radius is a confusing message — not misrouted memory. Low priority, but a one-line guard (`next && !next.startsWith('--')`) would remove it. Not covered by the suite.

Relatedly, `--project=` with an empty value is silently ignored (the `if (id)` truthiness check), falling through to CWD detection. Same reasoning: safe, mildly surprising.

### 6.4 One assertion is not portable to Windows

Line 149 compares a resolved path against a POSIX literal:

```ts
equal('the resolved path is normalized', resolveProjectContext({ cwd: '/workspace/projects' }).path, '/workspace/projects');
```

On Windows `path.resolve('/workspace/projects')` yields `C:\workspace\projects`, so this assertion fails there. The containment logic itself is portable — every fixture path picks up the same drive prefix, so relative containment and ranking are unaffected — and all other assertions compare ids, not paths.

This matters because `tasks/current.md` references files as `file:///c:/Projects/Asterim/…`, indicating the orchestrator runs on Windows. **All results in this report are from Linux** (`/home/qhukz/Documents/Projects/Asterim`). Fix is `path.resolve('/workspace/projects')` on the expected side of the comparison.

### 6.5 Carried forward from P5.1-02, still open

- **6.4 (prior report)** — the `asterim/src/services/DatabaseService` deep import reaches past `apps/server`'s public surface, and `resolver.ts` now relies on it too. Still unrecorded in `blueprint/audit/IMPLEMENTATION_DRIFT.md`; the recommendation stands, with one more dependent than before.
- **6.6 (prior report)** — repo-wide `pnpm run lint` remains red on `main` from pre-existing violations. Confirmed again this run: `@asterim/adapters` fails with 24 errors / 25 warnings (`no-useless-escape` in regex literals), which halts the turbo lint pipeline before `asterim`'s known 38 errors are reached. Untouched by and unrelated to Phase 5.0/5.1. Every result above is local verification; **CI is not green on `main` and P5.1-03 does not change that.**

---

## 7. Recommended Next Step

Proceed to **P5.1-04 — MCP Memory Tools**. Before it, two small items from this verification are worth folding in:

1. **Close the § 5.1 coverage gap** — one assertion seeding only the shorter sibling and expecting a throw. It is the one property here whose failure mode is silent cross-project memory writes, and it is currently the only rule not actually pinned by a test.
2. **Fix the § 6.4 assertion** for Windows, since the orchestrator runs there and the suite would report a spurious failure on first run.

For P5.1-04 itself, carrying from § 6.2: call `resolveProjectContext` once at startup in `index.ts`, cache the result for the process lifetime, and route resolution failure to stderr with a non-zero exit — never to stdout. The resolved `ResolvedProject.id` is what every memory tool must scope its queries by; nothing downstream should re-derive it from `process.cwd()`.
