# P1-01: Extract `ProjectWorkspace` from `App.tsx`

**Objective.** `App.tsx` becomes a small root; the thread workspace, tab strip, approval overlay and question overlay are separate modules with class-based styling.

**Context.** `apps/web/src/App.tsx` is about 1,200 lines: root component, `ProjectWorkspace`, `ApprovalOverlay`, `QuestionOverlay`, the tab strip, the settings view, and dozens of inline style objects. Every UX change touches it. The tab strip was made data-driven in the audit (`PRIMARY_VIEWS`, `MORE_VIEWS`, `.view-tab`); the rest was not.

**Why this exists.** Technical debt D5; prerequisite for P1-02 (approval card) and P1-07 (responsive pass).

**Files and systems involved.** `apps/web/src/App.tsx` → `src/App.tsx` (root only), `src/workspace/ProjectWorkspace.tsx`, `src/workspace/ViewTabs.tsx`, `src/workspace/ThreadHeader.tsx`, `src/overlays/ApprovalOverlay.tsx`, `src/overlays/QuestionOverlay.tsx`, `src/workspace/SettingsView.tsx`; styles into `src/styles/workspace.css`.

**Current behaviour.** Works; unreadable.

**Desired behaviour.** Identical behaviour and appearance (pixel-level differences only where an inline style is replaced by an equivalent class). No new features.

**Implementation requirements.**
- Move, do not rewrite: keep hook order, keep `useSocket` usage, keep the `overlays` prop composition.
- Replace inline `style={{}}` on structural elements with classes in `workspace.css` using tokens; keep dynamic styles (widths from `usePanelStore`) inline.
- Remove the emoji-free status pill logic into `ThreadHeader.tsx`.
- Delete `window.__ZUSTAND_STORES` and the `subscribeToStore` debug calls from the root (keep them behind `import.meta.env.DEV`).

**Constraints.** No behaviour change; the e2e smoke must pass unchanged. No new dependencies. Preserve the `PRIMARY_VIEWS` / `MORE_VIEWS` model.

**Edge cases.** The mobile bottom nav; the "Disconnected" banner; the `TERMINAL_ACTION_REQUIRED` approval variant used by Antigravity.

**Acceptance criteria.**
- [ ] `App.tsx` under 200 lines.
- [ ] No file in `src/workspace` or `src/overlays` over 400 lines.
- [ ] `tools/e2e/core-loop.mjs` passes 10/10 before and after.
- [ ] No visual regression in the four e2e screenshots beyond spacing rounding.

**Testing requirements.** e2e smoke; typecheck; lint warnings in touched files reduced, not increased.

**Done definition.** Merged with the screenshots regenerated.
