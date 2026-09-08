# DESIGN-002 — Workstation De-duplication, Hero Refinement & Anti-Card Overhaul

**Date**: August 12, 2026
**Target**: `@asterim/marketing` (`apps/marketing`)
**Predecessor**: `docs/design-001-visual-report.md` (this task resolves P0-1, P0-2, P1-3, P1-6, P1-7, P1-8 and the Satoshi weight caveat from that report)
**Method**: Headless Chromium (puppeteer 25.3.0) against Vite dev on `localhost:5199`; full-page captures after `document.fonts.ready` + full scroll pass, paired with in-page `page.evaluate` probes
**Evidence**: `docs/screenshots/design-002/`

---

## 1. Verification

Every requirement was confirmed by measurement in the rendered page, not by inspection of source.

| Check | Before (DESIGN-001) | After | Requirement |
| :--- | :--- | :--- | :--- |
| `#workstation-sandbox` mounts | 2 | **1** | R1 |
| Duplicate DOM ids | 1 | **0** | R1 (incidental) |
| `/docs?topic=mcp` content | blank panel | **resolves** | R2 |
| `ACT N //` labels in page text | 7 | **0** | R3 |
| `h1` computed weight | `900` (Black) | **`700`** | R4 |
| `h1` computed family | Satoshi | **Satoshi** (unchanged) | R4 |
| Hero CTAs | 3 | **2** | R4 |
| Act 5 card grid | 3 cards | **0** | R5 |
| Navbar @ 375/414/560px, logged out | label wrapped | **32px, single line** | R6 |
| Navbar horizontal overflow | — | **none at any width** | R6 |
| Homepage height @1440 | 7,055px | **6,466px** (−589) | — |

**Builds**: `pnpm build --filter @asterim/marketing` ✅ · full monorepo `pnpm build` ✅ 6/6 packages.

---

## 2. Changes by requirement

### R1 — Sandbox de-duplication
`AsterimWorkstationSandbox` (38.9 KB) previously mounted in both `Act1Hero.tsx:126` and `Act3SandboxSection.tsx`. Act 1 is now its sole home.

Because the component carries `id="workstation-sandbox"` internally (`AsterimWorkstationSandbox.tsx:370`), the double mount also produced **duplicate DOM ids** — invalid HTML that breaks fragment navigation and assistive-tech landmarks. Removing the second mount cleared this as a side effect.

**Act 3 was rebuilt rather than deleted.** It is now an **observability / event-stream** panel. This was a deliberate divergence in *content* (not structure) from a literal reading of "telemetry overview": Act 4 is already a process/CPU telemetry matrix, so a second telemetry readout would have traded a duplicated component for a duplicated concept. Act 3 instead shows the typed event stream — `AgentStarted → ToolCallStarted → ToolCallFinished → DiffCreated → ApprovalRequested → ApprovalGranted → GitStatusChanged → AgentIdle` — using the canonical event names from `blueprint/ADAPTER_SDK.md`, with **time-to-approval** in the footer (the North Star metric from `blueprint/PRODUCT.md`). Different lens on the same thread; supports the Absolute Auditability pillar.

### R2 — Broken footer link
`Footer.tsx:155`: `topic=mcp` → `topic=mcp-skills`, matching the id declared at `DocsPage.tsx:31`.

### R3 — Scaffolding labels stripped
| Section | Was | Now |
| :--- | :--- | :--- |
| Act 2 | `ACT 2 // CONTROL PLANE VS TERMINAL CHAOS` | `CONTROL PLANE` |
| Act 3 | `ACT 3 // INTERACTIVE WORKSTATION SANDBOX` | `OBSERVABILITY` |
| Act 4 | `ACT 4 // MULTI-AGENT SWARM TELEMETRY` | `MULTI-AGENT TELEMETRY` |
| Act 5 | `ACT 5 // SCOPED ENVIRONMENTS & ZERO-LEAK ISOLATION` | `ENVIRONMENTS` |
| Act 6 | `ACT 6 // AST SECURITY GUARD & ZERO-TRUST CLEARANCE` | `SECURITY & APPROVALS` |
| Act 7 | `ACT 7 // LOCAL-FIRST ARCHITECTURE & REMOTE RELAY` | `LOCAL-FIRST ARCHITECTURE` |
| Act 8 | `ACT 8 // GET STARTED LOCAL-FIRST` | `GET STARTED` |

### R4 — Hero CTAs & type weight
`Read Documentation` removed from the hero row (it remains in the navbar, footer, and Act 8); `IconBookOpen` import dropped. Two elements remain: the emerald primary CTA and the `npx asterim` copy snippet.

Weight `800 → 700` applied in `Act1Hero.tsx` and, in `index.css`, to `h1–h6`, `.display-hero`, and `.section-title` — with an inline comment recording the reason, so it is not "corrected" back later:

> Satoshi ships 300/400/500/700/900 — there is no 800. Requesting 800 resolves upward to 900 (Black).

### R5 — Act 5 anti-card overhaul
The 3-column card grid (`Enclave Secret Scoping` / `Project Jail Boundaries` / `Preset Profile Switching`) is gone. Replaced by an open 2-column split: narrative left, live scope switcher right. Selecting `Personal` / `Company (Acme Corp)` / `Client Work` updates workspace root, attached project count, credential enclave, path policy, and attached MCP tools, with a status line confirming the previous enclave was unmounted. Rows are hairline-separated — no nested containers.

### R6 — Mobile navbar
New `@media (max-width: 560px)` block: `white-space: nowrap` on the action buttons, tightened padding, and GitHub + Sign In hidden. **Both remain reachable in the mobile drawer** (`MobileNavDrawer.tsx:148, 208`) — verified before hiding. Result: brand + Get Started + hamburger.

### Supporting: new layout primitive
`.split-panel` added to `index.css` — a reusable open 2-column grid (`1fr / 1.05fr`, 64px gap) collapsing to a single column at 900px. This is the anti-card primitive required by art-direction **Law 4**; Acts 3 and 5 both consume it.

---

## 3. Outstanding

**Carried over from DESIGN-001, not in this scope:**
- **The sandbox does not reflow below ~768px.** The workspace chip still wraps to three lines and the amber "Action Required" pill clips at 375px (DESIGN-001 finding P1-9).
- **Pricing tier panels look unfinished** — square corners, no border, ragged bottom edge (P2-10).
- **`/docs` dead space** below short topics (P2-11).

**New, introduced by this task:**
- **Milder shape repetition.** Acts 3 and 5 now share the split-panel shape, and Acts 2, 6, and 7 still share a side-by-side-panels shape. This is a clear improvement on seven identical scaffolds, but the page has not fully escaped the formula. Acts 6 and 7 are the strongest next candidates for compositional variety.
- **Hero remains centered.** DESIGN-001 P1-6 (art direction calls for asymmetric) was not in DESIGN-002 scope and is unresolved.

---

## 4. Environment note for future visual QA

A **stale Asterim server on ports 3000/4000** (pid 126627/126638) is proxied by Vite, so `/api/v1/auth/me` returns 200 with a user and the marketing site renders **logged in** — showing "Account Portal" instead of Sign In / Get Started. The first capture pass in this task screenshotted the wrong navbar state as a result; the logged-out state was obtained by aborting `/api/` requests via `page.setRequestInterception`.

Kill that server, or block `/api/`, before any future marketing capture. Otherwise the navbar, hero CTAs, and account routes are all validated in the wrong state.

---

## 5. Files changed

```
apps/marketing/src/index.css                             (weights, .split-panel, 560px navbar block)
apps/marketing/src/components/Footer.tsx                 (mcp → mcp-skills)
apps/marketing/src/components/home/Act1Hero.tsx          (weight 700, CTA row, import)
apps/marketing/src/components/home/Act2ControlPlane.tsx  (tag)
apps/marketing/src/components/home/Act3SandboxSection.tsx (rebuilt — event stream)
apps/marketing/src/components/home/Act4SwarmSection.tsx  (tag)
apps/marketing/src/components/home/Act5EnvironmentSection.tsx (rebuilt — split + scope switcher)
apps/marketing/src/components/home/Act6SecurityGuardSection.tsx (tag)
apps/marketing/src/components/home/Act7RemoteRelaySection.tsx (tag)
apps/marketing/src/components/home/Act8CTAQuickstart.tsx (tag)
```

Uncommitted at time of writing.
