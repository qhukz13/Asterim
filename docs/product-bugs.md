# Asterim Master Product Bugs & Flaws Log (`docs/product-bugs.md`)

This document serves as the authoritative, master bug registry of functional flaws, navigation breakage, routing errors, and unexpected user interface behavior in Asterim.

---

## 🐛 Resolved Product Bugs

### BUG-001: Command Palette View Switching Wiping Active Project State (FIXED)

* **Severity**: **Critical (P0)**
* **Status**: **RESOLVED & VERIFIED**
* **Component**: `CommandPalette.tsx` / `RouterSync.tsx`

#### 📷 Visual Evidence of Fix
![BUG-001 Fixed View Navigation](/home/qhukz/.gemini/antigravity-ide/brain/bf1a1deb-a88d-4996-9dae-ed47c3c01887/bug_001_fixed.png)
* *Description*: Selecting "Jump to Terminal View" from `⌘K` now smoothly transitions the active workspace view tab to `terminal` while preserving active project and thread state.

#### 📝 Description & Impact
When a user opened the Command Palette (`⌘K`) inside an active project and selected any view switching command (e.g. "Jump to Terminal View"), the URL changed to `/workspace/project/:projectId/view/terminal`. Because `RouterSync` previously lacked matching logic for `/view/:viewId` without an explicit `:threadId`, it cleared all Zustand workspace state (`setActiveProject(null)`), dumping the user onto the empty "Asterim Workspace" landing card.

#### 🔬 Root Cause & Solution
* Added `VIEW_ROUTE_PATTERN` (`/workspace/project/:projectId/view/:viewId`) to `RouterSync.tsx` so project-level view routing is recognized as a valid workspace route.
* Refactored `CommandPalette.tsx` to preserve `activeThreadId` from `useThreadStore` when navigating views (`/workspace/project/:projectId/thread/:threadId/view/:view`).

---

## 🐛 Active Product Bugs

### BUG-002: View Switching Resets Terminal & Chat Scroll Positions

* **Severity**: **High (P1)**
* **Status**: **OPEN**
* **Component**: `ChatView.tsx` / `TerminalView.tsx` / `useViewStore.ts`

#### 📝 Description & Impact
When a user switches from `Chat` view to `Terminal` view and back, the chat message container loses its scroll offset and resets to top line zero.

#### 🔁 Reproduction Steps
1. Open an active thread with multiple messages.
2. Scroll down to line 150 in the chat window.
3. Switch view tab to `Terminal` (or `Changes`).
4. Switch view tab back to `Chat`.
5. **Result**: Chat window has jumped back to the top of the history list.

#### 🎯 Expected Behavior
Switching view tabs should preserve DOM scroll offsets and active terminal cursor state.

---

### BUG-003: Local PIN Pairing Prompt Friction

* **Severity**: **Medium (P1)**
* **Status**: **OPEN**
* **Component**: `PinScreen.tsx` / `useAuth.ts`

#### 📝 Description & Impact
Opening `http://127.0.0.1:5173` on local desktop requires finding and entering a 6-digit PIN from terminal logs, creating friction for local developers.

#### 🎯 Expected Behavior
Local desktop sessions running on `127.0.0.1` / `localhost` should auto-pair without manual PIN input, while keeping PIN pairing for remote mobile/LAN IP connections.
