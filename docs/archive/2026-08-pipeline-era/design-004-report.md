# DESIGN-004 — Interactive Workstation Simulation Engine & Telemetry State Machine

**Date**: August 12, 2026
**Target**: `@asterim/marketing` (`apps/marketing`)
**Predecessor**: `docs/design-003-report.md`
**Method**: Headless Chromium (puppeteer 25.3.0) against Vite dev on `localhost:5199`, `/api/` aborted so the site renders logged out. Unlike prior tasks this run **drives the UI** — clicking sessions, tabs, and approval buttons — and asserts on resulting DOM state
**Evidence**: `docs/screenshots/design-004/`

---

## 1. Verification — interactions driven, not just rendered

| Interaction | Asserted result | Outcome |
| :--- | :--- | :--- |
| Default load | branch `security/ast-interception`, Approve + Deny both present | ✅ |
| **Approve** click | status pill → `Executing…`, banner → clearance granted | ✅ |
| Approve + 1.5s | status pill → `Task Completed`, terminal gains `pty_exit: code 0` | ✅ |
| Terminal after Approve | contains `CLEARANCE GRANTED` and `pty_exec` | ✅ |
| **Deny** click | status pill → `Execution Halted` | ✅ |
| Terminal after Deny | contains `COMMAND BLOCKED` and `never reached the shell` | ✅ |
| Switch → `feature/agent-auth` | branch + `Working (Claude Code 3.7)` | ✅ |
| Switch → `diff/git-review` | branch + `Task Completed` + Antigravity | ✅ |
| Switch → `security/ast-interception` | branch + `Action Required · Paused for Review` + Aider | ✅ |
| Changes tab on session 3 | file `apps/mobile/src/push.ts`, `@@` hunk, counts `+8 −2` | ✅ |
| Horizontal overflow @375/768/1024/1440 | none | ✅ |

**Builds**: `pnpm build --filter @asterim/marketing` ✅ · full monorepo ✅ 6/6.

---

## 2. Changes by requirement

### R1 — Multi-session state machine
`THREADS_DATA` restructured around the three specified sessions, with a new `branch` field surfaced in the header breadcrumb:

| Session | Branch | Agent | Status |
| :--- | :--- | :--- | :--- |
| 1 | `feature/agent-auth` | Claude Code 3.7 | `working` — streaming stdout |
| 2 | `security/ast-interception` | Aider v0.72 | `approval` — paused at gate |
| 3 | `diff/git-review` | Antigravity | `completed` — diff review |

Selecting a session updates branch, mission, adapter badge, status pill, transcript, attached context, terminal stream, and diff — all already keyed off `activeThreadId`, so the existing selection machinery carried the change.

**Judgment call:** the sandbox opens on **session 2 (the interception gate)** rather than session 1. The approval loop is the product's core differentiator and the Golden Loop from `blueprint/PRODUCT.md`; opening on a passive log would weaken the hero. This also preserves the pre-existing default behaviour. Easy to flip if you disagree — it is one line.

### R2 — Interactive AST approval gate
The gate now renders the specified command `rm -rf ./build && pnpm deploy` with a risk score, and both buttons resolve real state:

- **Approve** → `approvalState: approved`, status `Executing…`, appends to the terminal stream:
  `ast_guard: CLEARANCE GRANTED by developer` / `pty_exec: rm -rf ./build && pnpm deploy`, then after 1.5s settles to `Task Completed` with `pty_exit: code 0 · release published`.
- **Deny** → `approvalState: denied`, status `Execution Halted` (hazard red), appends a red audit trail: `COMMAND BLOCKED by developer`, `<cmd> — never reached the shell`, `audit: event persisted to local store`.

New `extraTerminalLines` state holds decision-appended audit lines per thread. Terminal lines are colour-coded by kind (`✗` hazard red, `✓` emerald, `ast_guard` amber, timestamped blue).

### R3 — High-fidelity diff viewer
`DiffBlock` rewritten to mirror `apps/web/src/components/git/ChangesView.tsx` conventions:
- **Dual gutters** — old and new line numbers, derived by parsing the `@@ -18,9 +18,14 @@` hunk header and advancing counters per row (adds increment new only, deletes increment old only, context increments both).
- `+` rows `rgba(16,185,129,0.12)` / `−` rows `rgba(239,68,68,0.12)`, hunk headers dimmed.
- Header shows the real file path and **computed** `+8 −2` counts rather than hardcoded text.
- `white-space: pre` with an `overflow-x: auto` parent so indentation is preserved without causing page overflow.

### R4 — Housekeeping
Deleted `OpenSourceSection.tsx`, `CapabilitiesGrid.tsx`, `PlatformMatrixSection.tsx`, `ProblemSolutionSection.tsx`. Import-graph check confirmed zero importers before removal; build passes after.

### Incidental fixes found while verifying
- **The five viewport tabs were decorative** — nothing switched on `activeTab`. R2 requires appending to "the terminal stream" and R3 requires a diff view, so Chat / Terminal / Changes now render distinct content. Changes on a session with no patch shows an explicit empty state rather than nothing.
- **Status pills wrapped to two lines** at frame widths below ~1280px; `white-space: nowrap` added to all five.
- **Doubled icons** — the commit badge rendered `✓ ✓` and the approval banner `⚠ ⚠`, because the string carried a glyph *and* an icon component sat beside it. Glyphs removed from the strings.

---

## 3. Scope note — three target files were dead code

`demo/AgentStreamTab.tsx`, `demo/SecurityGuardTab.tsx`, and `demo/EnvironmentTab.tsx` were listed as targets but are **transitively unmounted**: their only importer is `InteractiveProductDemo.tsx`, which nothing imports. Editing them would have produced no user-visible change, so the functionality was built in `AsterimWorkstationSandbox.tsx` — the component actually on the page — instead.

The remaining dead cluster is now:

```
components/home/InteractiveProductDemo.tsx   (imports the 4 demo tabs)
components/home/demo/AgentStreamTab.tsx
components/home/demo/SecurityGuardTab.tsx
components/home/demo/EnvironmentTab.tsx
components/home/demo/MobileTunnelTab.tsx
components/home/HeroSection.tsx
components/home/WhyAsterimSection.tsx
```

Seven files, all unreachable. I did not delete them because the task named exactly four files — say the word and they go in one commit. They are the last remaining users of the legacy `--accent-green-*` aliases, so removing them also lets the compatibility layer in `index.css` be deleted.

---

## 4. Outstanding

- **Hero remains centered** (DESIGN-001 P1-6) — still unscoped.
- **Shape repetition** — Acts 3/5 share the split shape; Acts 2/6/7 share the paired-panel shape.
- **Act 4 telemetry table and sandbox tab strip scroll horizontally** inside their containers at ≤414px. No page-level overflow; a decision, not a defect.
- **Settings and Environment tabs** still show the chat pane. Only Chat / Terminal / Changes were required here.

---

## 5. Files changed

```
M  apps/marketing/src/components/home/AsterimWorkstationSandbox.tsx
D  apps/marketing/src/components/home/OpenSourceSection.tsx
D  apps/marketing/src/components/home/CapabilitiesGrid.tsx
D  apps/marketing/src/components/home/PlatformMatrixSection.tsx
D  apps/marketing/src/components/home/ProblemSolutionSection.tsx
```

`index.css` needed no change this task. Uncommitted, along with DESIGN-002 and DESIGN-003.
