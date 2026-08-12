# DESIGN-007 — Authentic Palette Alignment, Legacy Cleanup & Monorepo Build Verification

**Date**: August 12, 2026
**Target**: `@asterim/marketing` (`apps/marketing`)
**Predecessor**: `docs/design-006-report.md` — this task resolves the palette conflict raised in that report's §3
**Method**: Headless Chromium (puppeteer 25.3.0), `/api/` aborted so the page renders logged out. Verification reads **computed background colours** from the live DOM, not source values
**Evidence**: `docs/screenshots/design-007/`

---

## 1. Verification

### Palette — computed from the rendered page

| Element | Computed | Hex | `apps/web` token |
| :--- | :--- | :--- | :--- |
| `.workstation-frame` | `rgb(11, 12, 14)` | `#0b0c0e` | `--color-surface-0` ✅ |
| `.ws-header` | `rgb(18, 20, 23)` | `#121417` | `--color-surface-1` ✅ |
| `.ws-sidebar` | `rgb(18, 20, 23)` | `#121417` | `--color-surface-1` ✅ |
| `.ws-inspector` | `rgb(18, 20, 23)` | `#121417` | `--color-surface-1` ✅ |
| `.ws-main` | `rgb(11, 12, 14)` | `#0b0c0e` | `--color-surface-0` ✅ |
| Active tab | `rgb(25, 28, 32)` | `#191c20` | `--color-surface-2` ✅ |

Scoped tokens resolve exactly: `--ws-surface-0: #0b0c0e` · `--ws-surface-1: #121417` · `--ws-surface-2: #191c20`.

### Legacy alias migration

| File | References migrated |
| :--- | :--- |
| `pages/DocsPage.tsx` | 5 |
| `pages/DownloadPage.tsx` | 3 |
| `pages/PricingPage.tsx` | 3 |
| **Total** | **11 → 0** |

`--accent-green`, `--accent-green-hover`, `--accent-green-bg`, `--accent-green-subtle` are now **entirely absent** from the codebase — declarations and references both.

Emerald still renders on all three pages after alias removal, confirming the migration preserved behaviour rather than silently blanking it: **24 elements on `/docs`, 56 on `/pricing`, 43 on `/download`**. `/docs` compared visually against the DESIGN-003 capture — identical.

### Build

`pnpm build` — **6/6 packages, 0 errors**. Zero undefined CSS variables across the app.

---

## 2. Changes

### R1 — Workstation surfaces
Surfaces are now **scoped tokens on `.workstation-frame`**, not global ones:

```css
.workstation-frame {
  --ws-surface-0: #0b0c0e;
  --ws-surface-1: #121417;
  --ws-surface-2: #191c20;
  --ws-border: rgba(255, 255, 255, 0.08);
}
```

Scoping matters: the sandbox is a reproduction of a *different application* sitting inside the marketing page. Global overrides would have dragged the marketing palette with them; scoped tokens let the sandbox carry the app's neutral greys while the page around it keeps its own obsidian blues. Every `.ws-*` rule and inline surface colour in the component now resolves through these, including the three inside media queries. Panel borders raised `0.06 → 0.08` to match.

### R2 — Legacy alias removal
All 11 references migrated to `--accent-emerald` / `--accent-emerald-hover` / literal `rgba(16, 185, 129, 0.08)`, then the compatibility block introduced in DESIGN-001 was deleted. `--accent-emerald-bg`, `--font-display` and the radius scale remain — those are real tokens still in use, not aliases, so the block is now correctly labelled.

### R3 — Monorepo build
Verified 6/6 above.

---

## 3. Repair — duplicated stylesheet block

Partway through this task `index.css` was found to contain a **40-line duplicated span** (file lines 593–632): a second copy of `/* Workstation Frame Styling */`, `.workstation-frame`, `.workstation-header`, and the DESIGN-003/007 header comment, orphaned immediately before `.surface-card`.

This did not come from an edit I issued — the harness reported the file as modified externally between operations, and the duplicate contained text from my in-flight edit, so it appears to have been introduced by a concurrent write.

Diagnosed by counting distinctive markers (`.workstation-frame {` appearing 4× where 2 were expected), confirmed by diffing the two candidate regions line-for-line, then removed after backing the file up. Post-repair diff shows **40 lines removed, 0 added** — nothing else touched. Duplicate CSS of this kind is silent: the later block wins and the page looks correct, so it survives visual QA indefinitely.

---

## 4. Palette conflict — resolved

DESIGN-006 §3 flagged that requirement 6 of that task specified `#070a10` / `#0d1424` as "matching `apps/web`" when the real app uses `#0b0c0e` / `#121417`. This task resolves it in favour of the real app values. The sandbox is now genuinely pixel-faithful; the surrounding marketing page is unchanged.

---

## 5. Outstanding

- **Hero remains centered** (DESIGN-001 P1-6) — the last unaddressed finding from the original audit, still never scoped into a task.
- **Acts 3 and 5 share a shape** — the only remaining section repetition.
- **Settings and Environment sandbox tabs** are implemented, but the real app's Settings view has more surface area than the reproduction shows.
- `apps/server/pairing_pin.txt` is **still being rewritten by the stale server** on :3000/:4000. It was swept into commit `a24b2bc`.

---

## 6. Files changed

```
M  apps/marketing/src/index.css                                    (scoped ws tokens, alias block removed, duplicate repaired)
M  apps/marketing/src/components/home/AsterimWorkstationSandbox.tsx (inline surfaces → ws tokens)
M  apps/marketing/src/pages/DocsPage.tsx                            (5 aliases migrated)
M  apps/marketing/src/pages/DownloadPage.tsx                        (3 aliases migrated)
M  apps/marketing/src/pages/PricingPage.tsx                         (3 aliases migrated)
```

DESIGN-002 through DESIGN-006 were committed as `9f05763`, `b01a7b3`, `4360270`, `a24b2bc`. This task's changes are uncommitted.
