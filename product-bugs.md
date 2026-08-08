# Product Bugs Registry

## 🐛 Open & In-Progress Bugs

### BUG-007: Sync Changes Button Execution & Status Synchronization Failure
- **Severity**: High (Top Priority)
- **Component**: Git Subsystem (`GitProvider.ts`, `RemoteManager.ts`, `GitService.ts`, `ChangesView.tsx`)
- **Symptom**: Clicking the `Sync Changes` button spins temporarily and resets to `Sync Changes` without pushing commits to the remote origin or updating the ahead/behind status.
- **Investigation Notes for Later Fix**:
  1. Non-interactive subprocess credential prompts during `git push` (`could not read Username`) when SSH/credential store is unconfigured.
  2. Potential state mismatch between WebSocket `git.action` event handler and HTTP REST fallback `POST /api/v1/projects/:id/git/push`.
  3. Real-time status polling sync in `GitService.ts` when `ahead` is updated to 0.
- **Status**: [ ] Open / Pending Fix

---

## 📋 Resolved Historical Bugs

- **BUG-001**: WebSocket Connection Timeout on Project Switch (Fixed)
- **BUG-002**: Diff Viewer Truncation on Horizontal Scroll (Fixed)
- **BUG-003**: Fastify Empty JSON Body 400 Bad Request on REST Sync Route (Fixed)
- **BUG-004**: Environment Deletion Failure in Danger Zone (Fixed)
- **BUG-005**: "Open Project" Button Navigation Failure (Fixed)
- **BUG-006**: Environment Switcher Project Counts Displaying 0 (Fixed)
