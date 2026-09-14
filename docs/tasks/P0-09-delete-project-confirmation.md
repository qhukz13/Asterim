# P0-09: Confirm before deleting a project

**Objective.** Deleting a project from the sidebar asks for confirmation and explains what is removed.

**Context.** `DELETE /api/v1/projects/:id` removes the project row and its threads/events immediately. The sidebar's delete control (`apps/web/src/components/NavigationSidebar.tsx`, the project row menu) calls it on a single click. Path validation on add was done in the audit; the delete side was not.

**Why this exists.** Release gate row A5 and the UX bar in `docs/product/overview.md` ("destructive-action confirmation where appropriate").

**Files and systems involved.** `apps/web/src/components/NavigationSidebar.tsx`, `apps/web/src/hooks/useProjects.ts` (delete call), `apps/web/src/index.css` (`.dialog-overlay`, `.dialog-box`), `apps/server/src/services/ProjectManager.ts` (`removeProject`).

**Current behaviour.** Click → gone. Threads, their transcripts and approvals are deleted from the database. Files on disk are untouched (correct).

**Desired behaviour.** Click → a dialog: "Remove *Name* from Asterim? Its N threads and their history are deleted. Files in `path` are not touched." Buttons: Cancel (focused), Remove (destructive). Escape cancels. On success the sidebar refreshes and, if it was the active project, the URL goes to `/`.

**Implementation requirements.**
- Reuse `.dialog-overlay` / `.dialog-box`; no new dialog component.
- Fetch the thread count from the store (threads are already loaded for the active project; for others, show "its threads").
- Keep the API unchanged.

**Constraints.** No `window.confirm`. Keyboard reachable.

**Edge cases.** Deleting the project whose agent is running (stop it first via `client.command stop`, then delete); deleting the last project (show the empty workspace).

**Acceptance criteria.**
- [ ] Delete requires an explicit second action.
- [ ] Text names the project and the path and states files are untouched.
- [ ] A running agent in that project is stopped before deletion.
- [ ] Escape and Cancel leave everything as it was.

**Testing requirements.** Manual gate row A5; add the dialog copy to `docs/design/design-system.md` as the destructive-confirmation pattern.

**Done definition.** Dialog shipped, gate row ticked, screenshot in `docs/screenshots/e2e/`.
