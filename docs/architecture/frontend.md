# Frontend (`apps/web`)

## WHAT

A React 18 + Vite PWA served by the Core as static files. It pairs with one Core, joins Socket.IO rooms, renders the transcript, the approval card, the terminal, the Changes view and the frozen prototype views, and issues client events.

## WHY

A browser is the only client that runs on every device on the LAN without an install. The PWA manifest lets a phone add it to the home screen.

## WHERE

| Piece | Path |
| --- | --- |
| Entry, root component, project workspace, tab strip, approval and question overlays | `src/App.tsx` (1,200 lines; extraction is task P1-01) |
| Socket client, event → state, history replay | `src/hooks/useSocket.ts` |
| Auth (pairing token per backend), backend URL resolution | `src/hooks/useAuth.ts`, `src/utils/auth.ts` |
| Stores (zustand) | `src/stores/*`: global `useWorkspaceStore`, `usePanelStore`, `useCommandPaletteStore`, `useInspectorStore`; scoped `useProjectStore` → `useThreadStore` → `useExecutionStore` + `useViewStore` |
| URL ↔ store sync | `src/Router.tsx` (wouter): `/workspace/project/:projectId/thread/:threadId/view/:viewId` |
| Views | `ChatView.tsx`, `XTerminal.tsx`, `components/git/ChangesView.tsx`, `components/memory/*`, `components/mcp/*`, `components/skills/*`, `components/environment/*`; frozen: `teamAgents/*`, `pipelines/*`, `delegation/*`, `desktop/*` |
| Shell and chrome | `components/WorkspaceShell.tsx`, `TopBar.tsx`, `NavigationSidebar.tsx`, `SessionSidebar.tsx`, `InspectorPanel.tsx`, `CommandPalette.tsx` |
| First run | `components/overlays/FirstRunWizard.tsx` (detects installed CLIs from `/api/v1/system`) |
| Styles | `src/index.css` (legacy, large), `src/styles/tokens.css` (design tokens), `src/styles/layout.css` (shell, tab strip) |
| Tests | `src/**/__tests__/*.test.ts` (pure logic, no DOM) |

## HOW

- **Backend address.** `window.location.origin` unless a remote workstation is selected. In Vite dev the proxy forwards `/api`, `/ws` and `/socket.io` to the Core. Tokens are stored per backend under `asterim_token_<origin>`.
- **Events in.** `useSocket` joins `join_project` and `join_workspace`, receives `session.history` (last 1,000 persisted events plus buffered streams), then live events. It derives messages, agent status per thread, the pending approval and the pending question. Any `agent.status` other than `waiting_approval` clears the approval card (this is how a withdrawn approval disappears).
- **Events out.** `client_event` with `client.command` (`start`, `stop`, `restart`), `client.chat_message`, `client.approval_response`, `client.question_response`, `client.terminal_*`, `client.stdin`.
- **Tab strip.** `PRIMARY_VIEWS` (Chat, Terminal, Changes, Memory, Settings) and `MORE_VIEWS` (MCP servers, Skills, Environment) in `App.tsx`; frozen views are routable by URL only.
- **Engine choice.** Per thread, from the header dropdown; default from `localStorage.asterim_default_agent` set by the wizard. Options: `claude`, `antigravity`.

## CONTRACT

- The URL is the single source of truth for navigation; stores follow it.
- `InspectorStore` holds only a selection reference, never data.
- Colours come from `tokens.css` custom properties; one accent (`--color-accent-primary`, emerald); animations ≤ 200 ms; no emoji as UI.
- The composer is disabled while a thread is `startup`, `working` or `waiting_approval`.

## MODIFYING

- Add a view: extend `ViewType` in `useViewStore.ts`, mount it in `App.tsx`, add it to `PRIMARY_VIEWS` or `MORE_VIEWS`, handle it in the command palette.
- Add an event: handle it in `useSocket.ts` in the `handleInternalEvent` switch and register the socket listener next to the others.
- Prefer a class in `layout.css`/`index.css` over an inline style object; the `.view-tab` class is the model.

## DO NOT

- Do not hard-code a backend port anywhere; use the origin or the selected workstation.
- Do not put business data in `InspectorStore`.
- Do not add tabs to the primary strip without removing one; five is the budget at 1280 px.
- Do not switch tabs on the user's behalf when they send a message.
- Do not use `alert()`/`confirm()`; use the dialog components.
