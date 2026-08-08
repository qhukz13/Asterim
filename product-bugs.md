# Product Bugs Registry

## 🐛 Open & In-Progress Bugs

### BUG-007: Sync Changes Button Fails Silently or Returns Error
- **Severity**: High (Top Priority)
- **Component**: Git Subsystem (`GitProvider.ts`, `RemoteManager.ts`, `ChangesView.tsx`)
- **Symptom**: Clicking `Sync Changes` button spins temporarily and resets to `Sync Changes` without updating sync status or showing diagnostic errors when push fails.
- **Root Cause**: `GitProvider.ts` swallowed subprocess non-zero exit codes when `stdout` was present, preventing `RemoteManager.push()` from catching `git push` errors (such as non-interactive credential prompts or missing upstream branches).
- **Fix**: Restricted non-zero stdout fallbacks in `GitProvider.ts` to `git diff --no-index` commands only, ensuring all mutating Git commands (`push`, `pull`, `commit`) properly throw exit code errors and surface actionable UI diagnostic alerts.
- **Status**: [x] Fixed & Verified

---

## 📋 Resolved Historical Bugs

- **BUG-001**: WebSocket Connection Timeout on Project Switch (Fixed)
- **BUG-002**: Diff Viewer Truncation on Horizontal Scroll (Fixed)
- **BUG-003**: Fastify Empty JSON Body 400 Bad Request on REST Sync Route (Fixed)
- **BUG-004**: Environment Deletion Failure in Danger Zone (Fixed)
- **BUG-005**: "Open Project" Button Navigation Failure (Fixed)
- **BUG-006**: Environment Switcher Project Counts Displaying 0 (Fixed)
