# Asterim Project Memory — MCP Setup Guide

How to connect an AI coding agent to Asterim's Project Memory, so that decisions recorded in one session are available to every session that follows — including sessions in a different tool.

Tool reference and architecture: [`packages/mcp-memory-server/README.md`](../packages/mcp-memory-server/README.md).

---

## 1. What you get

Three tools, over stdio:

| Tool | When the agent uses it |
| :-- | :-- |
| `get_project_briefing` | At the start of a session — what has already been decided here |
| `query_decisions` | Before editing a file — what governs this path |
| `record_decision` | After settling something durable — so the next session inherits it |

Memory is stored in the same SQLite database the Asterim Core server uses (`~/.asterim/asterim.db`). Nothing is sent anywhere: the server is a local process reading a local file.

---

## 2. Prerequisites

1. **Node.js ≥ 22.** The server uses `node:sqlite`.
2. **Asterim has been run at least once**, so `~/.asterim/asterim.db` exists.
3. **The project is registered** in the Asterim dashboard. Resolution matches your working directory against registered project paths — an unregistered directory resolves to nothing and the server exits with a list of the projects it does know.
4. **The server is built:**

   ```bash
   pnpm install
   pnpm --filter @asterim/mcp-memory-server build
   ```

### The path you will need

Every client configuration below points at the built binary by **absolute path**:

```
<ASTERIM_REPO>/packages/mcp-memory-server/dist/index.js
```

Print it:

```bash
node -e "console.log(require('path').resolve('packages/mcp-memory-server/dist/index.js'))"
```

> **Why absolute, and why inside the checkout.** The MCP SDK is left external to the bundle, so `dist/index.js` resolves its dependencies from this repository's `node_modules`. Copying it elsewhere, or installing it globally, will not work. This is a known limitation, not a preference — see § 7.

---

## 3. Claude Code

### Using the CLI

Run this **from inside the project directory** you want the agent to remember:

```bash
claude mcp add asterim-memory -- node /absolute/path/to/Asterim/packages/mcp-memory-server/dist/index.js
```

No project argument is needed. The server resolves the project from the working directory the client launches it in, which is the directory you started Claude Code in.

### Or by file

`~/.claude/mcp.json` (global) or `.mcp.json` in the project root (per-project, checked in):

```json
{
  "mcpServers": {
    "asterim-memory": {
      "command": "node",
      "args": ["/absolute/path/to/Asterim/packages/mcp-memory-server/dist/index.js"]
    }
  }
}
```

To pin a project rather than relying on the working directory:

```json
{
  "mcpServers": {
    "asterim-memory": {
      "command": "node",
      "args": [
        "/absolute/path/to/Asterim/packages/mcp-memory-server/dist/index.js",
        "--project-path",
        "/absolute/path/to/your/project"
      ]
    }
  }
}
```

---

## 4. Cursor

`~/.cursor/mcp.json` (global) or `.cursor/mcp.json` in the project root:

```json
{
  "mcpServers": {
    "asterim-memory": {
      "command": "node",
      "args": ["/absolute/path/to/Asterim/packages/mcp-memory-server/dist/index.js"]
    }
  }
}
```

Prefer the project-local `.cursor/mcp.json` and let resolution use the working directory. If your setup launches MCP servers from a fixed directory rather than the workspace root, pin the project explicitly:

```json
{
  "mcpServers": {
    "asterim-memory": {
      "command": "node",
      "args": ["/absolute/path/to/Asterim/packages/mcp-memory-server/dist/index.js"],
      "env": { "ASTERIM_PROJECT_ID": "your-project-id" }
    }
  }
}
```

Find the id in the Asterim dashboard, or read it off stderr on a successful start.

---

## 5. Antigravity

Antigravity reads MCP server definitions from `~/.gemini/antigravity/mcp/`. Add one file per server:

`~/.gemini/antigravity/mcp/asterim-memory.json`

```json
{
  "mcpServers": {
    "asterim-memory": {
      "command": "node",
      "args": [
        "/absolute/path/to/Asterim/packages/mcp-memory-server/dist/index.js",
        "--project-path",
        "/absolute/path/to/your/project"
      ]
    }
  }
}
```

`--project-path` is spelled out here because a globally-registered server is not necessarily launched from your project directory. If yours is, the argument can be dropped.

---

## 6. Verifying it works

### From the shell

Run from inside a registered project directory:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
  | node /absolute/path/to/Asterim/packages/mcp-memory-server/dist/index.js
```

Expect a JSON-RPC result on **stdout**, and on **stderr**:

```
[asterim-mcp-memory] v0.1.0 ready on stdio
[asterim-mcp-memory] database: /home/you/.asterim/asterim.db
[asterim-mcp-memory] project: Your Project [proj-abc123] → /home/you/code/your-project
```

That third line is the one to check. It is the whole contract: this is the project the agent will read and write.

### From the agent

Ask it to call `get_project_briefing`. On a project with no memory yet you should get empty arrays and `currentIntent: null` — that is success, not failure. Then ask it to record something and call the briefing again.

---

## 7. Troubleshooting

**`Could not determine the Asterim project for '<dir>'`**
The working directory is not inside any registered project path. The message lists every project the database knows, with its path. Either register the project in the dashboard, or pin it with `--project-path` / `ASTERIM_PROJECT_ID`.

**`--project 'x' does not match any registered project`**
The id is wrong. The same message lists the valid ones.

**`Cannot record decision for project 'A' from workspace of project 'B'`**
Working as intended. A server scoped to one project will not write into another. Start a server in the other project instead.

**`Cannot find module '@modelcontextprotocol/sdk/...'`**
The binary is being run outside the repository, or `node_modules` is missing. Point the client at the absolute path inside the checkout and run `pnpm install`.

**The client reports a protocol/parse error**
Something wrote to stdout that was not a protocol frame. Nothing in this package should — `src/stdio-guard.ts` rebinds `console` to stderr before any other module loads. If it happens, capture stderr and file it; it is a bug, not a configuration problem.

**`database is locked`**
A write collided with the Core server writing at the same moment. Since Phase 5.1 the connection waits up to 5 seconds (`PRAGMA busy_timeout = 5000`), so this should now only appear under sustained heavy write load. Retrying the tool call is safe — nothing partial is written.

**The agent sees memory it does not recognise**
Check the `database:` and `project:` lines on stderr. The usual cause is `ASTERIM_DATA_DIR` pointing somewhere unexpected, or a project registered on a parent folder capturing a directory you thought belonged elsewhere.

---

## 8. Limits worth knowing

These are current, deliberate, and documented rather than hidden:

- **Writes are project-scoped; reads are not.** A server scoped to project A refuses to *write* into project B, but will *read* B's memory if asked for it by id. See [DEC-023](../decisions.md).
- **The binary is not relocatable.** It needs the repository's `node_modules` (§ 2).
- **The dashboard does not live-update on an agent's write.** The MCP server runs in its own process with its own event bus, so a decision recorded by an agent reaches the database but not the running Core server's event stream. It appears in the UI on the next fetch, not immediately. Tracked in [`blueprint/audit/MISSING_SPECIFICATION.md`](../blueprint/audit/MISSING_SPECIFICATION.md).
- **Decisions are recorded as `AGENT_STATEMENT` at confidence 0.75** unless the agent states otherwise. That is deliberately weaker than `HUMAN_CONFIRMED`, so that reviewing memory later distinguishes what an agent asserted from what you approved. See [DEC-024](../decisions.md).
