# DESIGN-006 — Exact Asterim Application UI/UX Authenticity Alignment

**Date**: August 12, 2026
**Target**: `@asterim/marketing` (`apps/marketing`)
**Predecessor**: `docs/design-005-report.md`
**Reference used**: the real `apps/web` source (see §2) — the 5 canonical screenshots referenced in the task did not arrive in the message
**Method**: Headless Chromium (puppeteer 25.3.0), `/api/` aborted so the page renders logged out. Verification asserts on **rendered text content and DOM state per tab**, not just on layout
**Evidence**: `docs/screenshots/design-006/`

---

## 1. Verification

Every string named in the task was asserted against the rendered DOM.

| Surface | Asserted | Missing |
| :--- | :--- | :--- |
| Top chrome | `Personal Environment`, `Asterim`, `Main Session`, `Mission:`, `Agent Ready`, `Local Host`, `⌘K` | **0** |
| Left nav | `PROJECTS (3)`, `STD`, `PINNED`, `/home/qhukz/Documents/Projects/Asterim`, `test`, `MainTest`, `Projects`, `New Agent`, `ACTIVE THREADS`, `ast-security-gate`, `auth-feature` | **0** |
| Thread header | `Thread: 6ae1794d`, `Last activity: just now`, `Idle`, `Antigravity (Google)` | **0** |
| Tab strip | exactly `["Chat","Terminal","Changes","Settings","Environment"]` | **0** |
| Chat view | `No messages in active thread`, `Ask for Approval`, `Send` | **0** |
| Terminal view | `qhukz@fedora:~/Documents/Projects/Asterim$` | **0** |
| Changes view | `Changes`, `1 changed`, `pairing_pin.txt`, `Auto-Generate Message`, `Commit Changes` | **0** |
| Settings view | `Agent Engine`, `Antigravity (Google)`, `Workspace AI Settings`, `Save AI Settings` | **0** |
| Environment view | `Personal Environment`, `PERSONAL ENVIRONMENT`, `Company Environment`, `Client Sandbox`, `Experimental Sandbox` | **0** |
| Inspector | `AI CONTEXT & STATE`, `AGENT ACTIVITY`, `Runtime:`, `antigravity`, `Execution State:`, `Ready / Idle`, `ATTACHED CONTEXT`, `(Working Set)`, `ACTIVE CONTEXT FILES (0)`, `No files pinned yet.` | **0** |
| Placeholders | `Filter projects...`, `Ask the agent to do something...`, `Commit summary` | **0** |

Three items first reported as missing were false negatives — `innerText` excludes `placeholder` attributes, and `Agent Engine` is CSS-uppercased. Both confirmed present by attribute and case-insensitive checks.

**Responsive** (`.ws-body` columns): `230px 750px 250px` @1440 · `200px 774px` @1024 · single column @768 and @375 · **no horizontal overflow at any width**.

**Builds**: `pnpm build --filter @asterim/marketing` ✅ · full monorepo ✅ 6/6.

---

## 2. Reference source

The task referenced 5 canonical screenshots; no images were attached to the message. Rather than block, I used the authority the task itself names — **the real `apps/web` source** — and verified every string in the spec against it before building:

| Sandbox region | Real component |
| :--- | :--- |
| Top chrome | `components/TopBar.tsx` |
| Projects pane | `components/NavigationSidebar.tsx` |
| Threads pane | `components/SessionSidebar.tsx` |
| Thread header + tab strip | `App.tsx` (Layer 1 / Layer 2) |
| Chat input bar | `components/ChatInput.tsx` |
| Changes view | `components/git/ChangesView.tsx` |
| Settings | `components/AISettings.tsx` |
| Environment presets | `components/environment/EnvironmentSettingsView.tsx` |
| Inspector | `components/InspectorPanel.tsx` |

Details taken from source rather than invented:
- Approval dropdown options are the real triple — `Ask for Approval` / `Auto-Approve Commands` / `Auto-Deny Commands` (`ChatInput.tsx:47-51`).
- Execution State values are the real ones — `Ready / Idle`, `Computing`, `Action Required` (`InspectorPanel.tsx:219-223`).
- Thread-header state pills are the real strings — `○ Idle`, `● Executing`, `⏸ Paused for Review` (`App.tsx:456-458`).
- Active tab styling matches `App.tsx:526-531`: elevated surface background plus a `2px solid` accent bottom border.
- The four environment presets and their descriptions are copied verbatim from `EnvironmentSettingsView.tsx:351-354`.

---

## 3. Conflict found — requirement 6 vs. the real app

Requirement 6 asks for backgrounds `#070a10` / `#0d1424` **"matching `apps/web`"**. The real app does not use those values. From `apps/web/src/styles/tokens.css`:

```css
--color-surface-0: #0b0c0e;   /* not #070a10 */
--color-surface-1: #121417;   /* not #0d1424 */
--color-surface-2: #191c20;
--color-surface-3: #22262c;
```

The app's surfaces are **neutral grey**; the marketing palette is **blue-tinted**. Borders (`rgba(255,255,255,0.06)` / `0.12`) and accent (`#10b981`) do match exactly.

**What I did:** followed the explicit hex values in requirement 6 — the sandbox sits inside the marketing page, where those tokens are canonical per DESIGN-001, and an inset panel in a different grey would read as a foreign element. The one exception is the active tab, which uses the real `#191c20` surface-2 as specified in requirement 3.

**If you want true pixel fidelity**, the sandbox surfaces should move to `#0b0c0e` / `#121417` / `#191c20`. That is a contained change — say the word. It cannot be both: the marketing palette and the app palette are genuinely different colours.

---

## 4. Prior interactive work preserved

The task's canonical state is a single idle Main Session, which would have discarded the DESIGN-004 approval state machine. Instead the three threads named in requirement 2 carry the three states:

| Thread | State | Behaviour |
| :--- | :--- | :--- |
| `Main Session` | `○ Idle` | Empty chat state, exactly as specified |
| `ast-security-gate` | `⏸ Paused for Review` | Approve / Deny gate — decisions still append audit lines to the terminal |
| `auth-feature` | `● Executing` | Streaming stdout |

Selecting a thread updates the breadcrumb, mission pill, thread id, state pill, Execution State in the inspector, and the terminal stream. All five tabs switch real content.

---

## 5. Defect found and fixed during verification

The diff fixture rendered `+７71904` — a full-width `７` (U+FF17) instead of `7`, which broke monospace alignment in the Changes view. Caught by reading the rendered screenshot rather than the source. Fixed and re-verified.

---

## 6. Outstanding

- **Palette decision** above (§3) — the only open question from this task.
- **Hero remains centered** (DESIGN-001 P1-6) — last unaddressed original-audit finding.
- **Acts 3 and 5 share a shape** — the only remaining section repetition.
- **`--accent-green-*` compatibility layer** still needed by `DocsPage`, `DownloadPage`, `PricingPage` (11 refs).
- `apps/server/pairing_pin.txt` is **still being rewritten by the stale server** on :3000/:4000 and shows as modified. Ironically it is now also the file shown in the sandbox's Changes view. Worth stopping that process.

---

## 7. Files changed

```
M  apps/marketing/src/components/home/AsterimWorkstationSandbox.tsx  (full rewrite against apps/web)
M  apps/marketing/src/index.css                                      (.ws-changes, .ws-preset-grid)
```

Uncommitted, along with DESIGN-002 through DESIGN-005 — five tasks now sitting in the working tree.
