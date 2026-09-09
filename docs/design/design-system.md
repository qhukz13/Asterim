# Design System (dashboard)

Supersedes `blueprint/DESIGN_SYSTEM.md`, `blueprint/UI_PRINCIPLES.md` and `blueprint/BRAND.md` where they disagree.

## Principles

1. **Monochrome surfaces, one accent.** Emerald (`--color-accent-primary`) means "active", "approve", "go". Amber means "waiting on you". Red means "deny" or "error". Nothing else is coloured.
2. **The card is the product.** The approval card gets the most design attention: exact command or path, one primary action, one destructive action, a visible timer, keyboard reachable.
3. **Nothing moves unless it means something.** Transitions ≤ 200 ms, on colour and border only. No glow, no gradients, no blur except the modal backdrop.
4. **Text over icons.** Icons (from `components/icons/Icons.tsx`, 14 to 18 px) accompany labels; they never replace them. No emoji anywhere in the interface.
5. **Five tabs.** Chat, Terminal, Changes, Memory, Settings. Everything else is under "More" or behind a URL.
6. **Say what happened.** Every failure the user can see must name the cause in plain words (`Could not start claude: Not logged in`), never a green pill over a dead session.

## Tokens (`apps/web/src/styles/tokens.css`)

| Group | Tokens | Rule |
| --- | --- | --- |
| Backgrounds | `--color-bg-primary`, `--color-surface-1`, `--color-surface-2` | Three levels only. |
| Borders | `--color-border-subtle`, `--color-border-default`, `--color-border-strong` | One hairline weight; strong is for focus and active. |
| Text | `--color-text-primary`, `--color-text-secondary`, `--color-text-muted` | |
| Accent | `--color-accent-primary`, `--color-accent-hover` | Primary buttons, active tab underline, working indicator. |
| States | `--color-state-working`, `--color-state-paused`, `--color-state-completed`, `--color-state-error` (+ `-bg`) | Status pills, approval card header. |
| Type | `--font-family-sans` (Inter), `--font-family-mono` (JetBrains Mono); `--font-size-xs` … `--font-size-xl` | Body 14 px in the dashboard. |
| Radius | `--radius-sm` 6, `--radius-md` 10, `--radius-full` | Pills only for status. |
| Spacing | `--spacing-1` … `--spacing-8` (4 px base) | |

## Components (reuse before inventing)

| Component | File | Use for |
| --- | --- | --- |
| `.view-tab` | `styles/layout.css` | Thread view tabs. Underline active state. |
| `CustomDropdown` | `components/CustomDropdown.tsx` | Any select. |
| `.dialog-overlay` + `.dialog-box` | `index.css` | Every modal, including the approval card. |
| `ApprovalCard` | `components/approvals/ApprovalCard.tsx` | The approval. Never reimplement it; extend the consequence type instead. |
| `ConfirmDialog` | `components/overlays/ConfirmDialog.tsx` | Every destructive action. |
| `DiagnosticsPanel` | `components/diagnostics/DiagnosticsPanel.tsx` | The "is my setup right?" surface. |
| `btn-primary`, `btn-deny`, `btn-approve` | `index.css` | Primary, destructive, confirm. |
| `WorkspaceShell` | `components/WorkspaceShell.tsx` | The only page layout. |
| `EmptyWorkspace` | `components/EmptyWorkspace.tsx` | Empty state pattern: icon, one sentence, primary action, secondary action. |

## Two patterns that carry the product

**The approval card.** It must answer three questions before it offers a button: what kind of action this is, what it targets, and what exactly will change. Creating a file and overwriting one are different decisions and never render the same. The agent's own words appear when they add something and are suppressed when they only repeat the path. Neither button is pre-selected, Escape denies, and the buttons do not act for 300 ms after the card appears so that a click already in flight cannot answer a card nobody has read.

**Destructive confirmation.** Name the thing being removed, say what is deleted, say what is *not* touched, and focus Cancel. `ConfirmDialog` implements all four; use it rather than a bespoke dialog, and never `window.confirm`.

**Failures.** Every failure a user can see names a cause and offers at least one thing to try (`Diagnosis` from the Core). A message from Asterim is labelled "Asterim", never "Agent Assistant" — attributing a tool failure to the model tells the user something false about what happened.

## States every view must have

Loading (skeleton or spinner with a label), empty (what to do next), error (what failed, how to retry). Changes, Memory and the thread list are missing some of these (task P1-08).

## Known violations to remove

- `.nav-btn` in `index.css` carries a blue/violet gradient hover (legacy). Not used by the tab strip anymore; delete when the sidebar stops using it.
- `ChatView` status pills use hard-coded `#06b6d4` (cyan) for "Running". Replace with `--color-state-working`.
- Inline style objects throughout `App.tsx`; migrate to classes as `ProjectWorkspace` is extracted (P1-01).

## Marketing site

Uses its own smaller token set (`apps/marketing/src/index.css`) chosen to match these values. Same accent, same fonts, same restraint. See `docs/design/landing-page.md`.
