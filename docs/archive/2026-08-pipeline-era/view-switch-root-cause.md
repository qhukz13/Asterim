# P0 View Switching Bug: Root Cause & Resolution

## The Infinite Loop Sequence

The "Maximum update depth exceeded" error was caused by a classic React state-URL synchronization loop between `RouterSync` and `InteractionEngine` when switching threads.

The exact runtime sequence:
1. **User clicks Thread B** in the sidebar.
2. `SessionSidebar` calls `setActiveThreadId('Thread B')`.
3. React renders both `InteractionEngine` and `RouterSync` with `activeThreadId = 'Thread B'` and `activeView = 'terminal'` (the view from Thread A).
4. **InteractionEngine Effect**: Reacts to `activeThreadId` changing. It looks up Thread B's last known view (`chat`) and asynchronously calls `setActiveView('chat')`.
5. **RouterSync Effect (State → URL)**: Reacts to `activeThreadId` changing. It reads the *old* `activeView` (`terminal`) and asynchronously calls `setLocation('/workspace/.../thread_B/view/terminal')`.
6. **Criss-Cross Render**: React processes both updates. The Zustand State is now `chat` (from InteractionEngine), but the browser URL is `terminal` (from RouterSync).
7. **RouterSync Effect 1 (URL → State)**: Sees the URL is `terminal` but state is `chat`. Calls `setActiveView('terminal')`.
8. **RouterSync Effect 2 (State → URL)**: Sees the State is `chat` but URL is `terminal`. Calls `setLocation('/.../view/chat')`.
9. **Ping-Pong**: In the next render, State is `terminal` and URL is `chat`. The effects fire again, endlessly swapping the State and URL until React crashes.

## Why the Previous KeepAlive Approach Did Not Fix It

The previous `ThreadViewCache` and `KeepAlive` implementation focused on the *cost* of rendering and Xterm lifecycle issues. While it successfully mitigated React StrictMode double-mount issues, it didn't address the core problem: the state transitions themselves were fundamentally conflicting. 

By keeping components mounted with `display: none`, the symptoms were obscured or delayed, but the criss-crossing URL/State updates were still firing.

## The New Navigation State Model

### Single Canonical Source of Truth

**The URL must be the single canonical source of truth for navigational state.**

Zustand stores (`ProjectStore`, `ThreadStore`, `ViewStore`) are strictly *reflections* of the URL, acting as a cache so deep components don't have to parse route params. 

### Implementation Rules

1. **URL Driven**: User actions (clicking a thread, clicking a tab) must push a new URL via `wouter`'s `setLocation`, *not* by mutating Zustand directly.
2. **Atomic Routing**: When switching threads, the UI must construct the full URL including the target view: `/workspace/.../thread/{id}/view/{lastKnownView}`.
3. **RouterSync One-Way Sync**: `RouterSync` listens to the URL and synchronizes Zustand (`URL → State`). It does not sync State back to the URL (except for resolving incomplete paths).
4. **No Cascading Effects**: `InteractionEngine` no longer restores views asynchronously. All navigational intent is resolved before the URL is pushed.
