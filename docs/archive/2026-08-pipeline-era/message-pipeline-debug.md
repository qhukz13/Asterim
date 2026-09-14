# Message Pipeline Debugging

## Pipeline Architecture
1. **Frontend (useSocket.ts)**: 
   - Uses `sendChatMessage` which calls `socket.emit('client_event', { type: 'client.chat_message', ... })`.
   - Listens to `chat.message` and `agent.status` to update React state.
2. **Server (socketManager.ts)**:
   - Receives `client_event`, wraps it, and publishes to `EventBus` (`EVENTBUS_PUBLISH`).
3. **Server (EventBus.ts)**:
   - Distributes events to all listeners.
4. **Server (AgentService.ts)**:
   - Listens to `client.chat_message`.
   - Dispatches it to the `SessionManager` which sends it to the agent PTY.
5. **Adapter (AntigravityParser.ts & TerminalFSM.ts)**:
   - Receives PTY chunks (`PTY_WRITE`).
   - Runs `TerminalFSM` to parse the screen snapshot and detect Agent State (`Idle`, `Working`, etc.).
   - Emits `agent.status` on state changes.
   - Emits `chat.message` **ONLY** when the agent reaches the `Idle` state (after a 300ms debounce).
6. **Server (socketManager.ts)**:
   - Bridges `EventBus` events (like `chat.message` and `agent.status`) to `Socket.IO` rooms.
7. **Frontend (useSocket.ts)**:
   - Receives events via `socket.on('server_event')` and updates `messages` or `agentStatus`.

## Observational Trace (Server Logs)
We injected a simulated `client.chat_message` into the `EventBus` and traced it:

```
32: --- TRIGGERING PIPELINE DEBUG MESSAGE ---
33: [PIPELINE_DEBUG] [EVENTBUS_PUBLISH] ts=1785337213552 messageId=... role=user len=18
34: [PIPELINE_DEBUG] [SOCKET_SEND] ts=1785337213552 messageId=... 
35: [AgentService] Agent session not running... Auto-starting agent...
...
38: [AgentService] Started antigravity for thread ...
41: [PIPELINE_DEBUG] [PTY_WRITE] ts=1785337216705 len=59
...
119: [PIPELINE_DEBUG] [PARSER_COMPLETE] ts=1785337221900 len=1422
120: [PIPELINE_DEBUG] [EVENT_EMIT] ts=1785337221901 messageId=... type=chat.message len=1422
...
124: [PIPELINE_DEBUG] [PTY_WRITE] ts=1785337222062 len=13
...
212: [PIPELINE_DEBUG] [PTY_WRITE] ts=1785337228568 len=64
...
```

### Findings
1. **No Streaming Output**: The parser (`AntigravityFSM`) does **not** emit `chat.message` iteratively while the agent is typing. It waits until the agent finishes processing and returns to the `Idle` state (detected by the prompt `> `).
2. **Missing `PARSER_COMPLETE`**: After the initial `[PARSER_COMPLETE]` (which is just the agent's startup text), the agent processed our command and wrote hundreds of chunks to the PTY. However, it **never emitted a final `PARSER_COMPLETE`**. 
3. **Stuck in Executing**: Because `TerminalFSM` never recognized the `Idle` state at the end of the agent's response, it never triggered the 300ms debounce to fire `onMessageComplete`. The state remains stuck in `Working`. This perfectly matches the bug description: "never leaves Executing" and "response is delayed".

## Root Cause Analysis
The parser is trying to scrape the TUI screen snapshot to extract the final response text between the user prompt and the next idle prompt. 
- If the TUI rendering tears, changes slightly, or the idle prompt is drawn in a way the regex `cleanLastLine` or TUI parser fails to detect, it stays in `Working`.
- If the terminal output scrolls past the buffer window (24 rows), the user prompt or idle prompt markers might be lost.

This architecture requires the parser to perfectly reconstruct the text from terminal rows and wait for `Idle` state. The "streaming" experience is missing entirely, leading to perceived delays or truncations.
