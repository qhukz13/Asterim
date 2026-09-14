import React from 'react';
import { GITHUB_URL, INSTALL_COMMAND, ISSUES_URL, LICENSE, RUN_COMMAND } from '../site';

const SECTIONS = [
  { id: 'install', label: 'Install' },
  { id: 'first-run', label: 'First run' },
  { id: 'security-model', label: 'Security model' },
  { id: 'adapters', label: 'Adapters' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'licence', label: 'Licence' }
];

/**
 * Hand-written from the repository docs (docs/development/setup.md,
 * docs/architecture/agents.md, docs/audit/security-audit.md). Generating this
 * page from those files is task P1-09.
 */
export const DocsPage: React.FC = () => {
  return (
    <main className="page">
      <div className="container docs-layout">
        <nav className="docs-nav" aria-label="Documentation sections">
          {SECTIONS.map(s => (
            <a key={s.id} href={`#${s.id}`}>
              {s.label}
            </a>
          ))}
        </nav>

        <article className="doc">
          <h1>Documentation</h1>
          <p>
            Everything below describes the current release. The full engineering documentation lives in
            the repository under <code>docs/</code>.
          </p>

          <h2 id="install">Install</h2>
          <p>Requirements: Node 22 or newer, Claude Code installed and logged in, Windows 10/11, macOS or Linux.</p>
          <pre>
            <code>{`${INSTALL_COMMAND}\n${RUN_COMMAND}`}</code>
          </pre>
          <p>
            The Core starts on port 3000, prints a local URL, a LAN URL and a six-digit pairing PIN. Open
            the URL in a browser and enter the PIN. To run from source instead, clone the repository and
            follow <code>docs/development/setup.md</code>.
          </p>
          <div className="callout">
            If <code>{INSTALL_COMMAND}</code> reports that the package does not exist, the first public
            release has not been published yet. Run from source, or check the Releases page on GitHub.
          </div>

          <h2 id="first-run">First run</h2>
          <ol>
            <li>Pair: enter the PIN. The wizard shows which agent CLIs were detected on the machine.</li>
            <li>Add a project: type the absolute path of an existing folder. Asterim refuses paths that do not exist.</li>
            <li>Send a task. Claude Code starts in that folder. The transcript shows its messages, tool calls and results.</li>
            <li>
              Approve or deny. Every command and file write that Claude Code would ask about appears as a card
              with the exact command or path. The card expires after five minutes, which counts as a denial.
            </li>
            <li>Review the diff in Changes and commit yourself. The agent never commits.</li>
          </ol>
          <p>
            Closing and reopening the Core resumes each thread's Claude Code session. Clear chat starts a fresh one.
          </p>

          <h2 id="security-model">Security model</h2>
          <ul>
            <li>The Core runs as your user. The agent runs as your user, in the project folder, with your shell environment.</li>
            <li>Asterim adds a gate, not a sandbox. It never passes <code>--dangerously-skip-permissions</code>.</li>
            <li>
              The gate shows what Claude Code asks about in its <em>default</em> permission mode. Read-only tools
              are allowed by Claude Code itself; commands and file writes are asked.
            </li>
            <li>
              A <code>PreToolUse</code> hook or a permission rule in your own Claude Code settings decides before
              Asterim is asked. When that happens the card is withdrawn and the thread log says so. Set{' '}
              <code>ASTERIM_CLAUDE_DISABLE_HOOKS=true</code> to make Asterim's card the only decider for the
              sessions it runs.
            </li>
            <li>
              The dashboard is served over plain HTTP on your LAN and protected by the PIN and a 30-day token.
              Five wrong PINs lock the address out for fifteen minutes. Do not expose the port to the internet.
              Use <code>HOST=127.0.0.1</code> on shared networks.
            </li>
            <li>Every API route requires a token, on every interface.</li>
          </ul>

          <h2 id="adapters">Adapters</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Status</th>
                  <th>How</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Claude Code</td>
                  <td>Working</td>
                  <td>
                    Headless stream-json protocol; permission prompts answered through the CLI's own control
                    protocol; sessions resumed by id.
                  </td>
                </tr>
                <tr>
                  <td>Antigravity (Google)</td>
                  <td>Preview</td>
                  <td>Terminal interface scraped with a state machine; breaks when the TUI changes.</td>
                </tr>
                <tr>
                  <td>Aider, Codex</td>
                  <td>Not supported</td>
                  <td>No adapter. Codex is revisited when its CLI exposes a permission protocol.</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            The adapter interface is documented in <code>docs/architecture/agents.md</code>; the Claude Code adapter is{' '}
            <a href={`${GITHUB_URL}/blob/main/packages/adapters/src/providers/claude/ClaudeAdapter.ts`}>one file</a>.
          </p>

          <h2 id="configuration">Configuration</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Variable</th>
                  <th>Default</th>
                  <th>Effect</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><code>PORT</code></td>
                  <td>3000</td>
                  <td>HTTP and Socket.IO port.</td>
                </tr>
                <tr>
                  <td><code>HOST</code></td>
                  <td><code>::</code></td>
                  <td>Listen on every interface (phone pairing) or <code>127.0.0.1</code> for this machine only.</td>
                </tr>
                <tr>
                  <td><code>ASTERIM_DATA_DIR</code></td>
                  <td><code>~/.asterim</code></td>
                  <td>Database, logs, vault.</td>
                </tr>
                <tr>
                  <td><code>ASTERIM_SOVEREIGN_MODE</code></td>
                  <td>unset</td>
                  <td><code>true</code> disables every outbound connection Asterim could make.</td>
                </tr>
                <tr>
                  <td><code>ASTERIM_CLAUDE_BIN</code></td>
                  <td>auto</td>
                  <td>Path to the Claude Code binary when it is not on PATH.</td>
                </tr>
                <tr>
                  <td><code>ASTERIM_CLAUDE_DISABLE_HOOKS</code></td>
                  <td>unset</td>
                  <td><code>true</code> makes Asterim's card the only permission decider for its sessions.</td>
                </tr>
                <tr>
                  <td><code>MOCK_AGENT</code></td>
                  <td>unset</td>
                  <td><code>true</code> replaces the Antigravity adapter with a scripted mock, for demos.</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h2 id="troubleshooting">Troubleshooting</h2>
          <h3>The wizard says Claude Code was not found</h3>
          <p>
            Install it (<code>npm install -g @anthropic-ai/claude-code</code>), make sure <code>claude</code> runs in a
            new terminal, or set <code>ASTERIM_CLAUDE_BIN</code>. Restart Asterim.
          </p>
          <h3>Sending a message shows "Could not start claude"</h3>
          <p>
            The error text is the CLI's own. "Not logged in" means run <code>claude</code> once interactively and
            sign in. A missing binary means the step above.
          </p>
          <h3>A card disappeared before I answered</h3>
          <p>
            Something in your Claude Code settings decided first. The thread log names it. See the security
            model section for the switch that prevents it.
          </p>
          <h3>"disk I/O error" on start</h3>
          <p>
            A previous Core was force-killed and left <code>asterim.db-wal</code> and <code>asterim.db-shm</code> next
            to the database while another process held them. Make sure no other Asterim process is running,
            then start again. <code>asterim db:status</code> reports the state.
          </p>
          <h3>Reporting a problem</h3>
          <p>
            Open an issue at <a href={ISSUES_URL}>GitHub Issues</a> with your OS, the versions of Node and Claude
            Code, and the last lines of <code>~/.asterim/server.log</code>. Remove anything private first.
          </p>

          <h2 id="privacy">Privacy</h2>
          <p>
            Asterim makes no outbound network connections of its own. It does not collect analytics, crash
            reports or usage data. Your agent (Claude Code) talks to its vendor exactly as it does without
            Asterim; Asterim neither proxies nor inspects that traffic. All data Asterim keeps is in{' '}
            <code>~/.asterim</code> on your machine; delete the directory and it is gone. If an opt-in usage
            ping is ever added, it will be off by default, documented here, and its source will be one file.
          </p>
          <p>
            There is a usage summary, and it is local. <code>asterim stats</code> and the Settings panel show
            how much you have used Asterim — sessions, threads, agent turns, approvals by outcome — computed
            from your own database on demand. It contains no project name, path, prompt or command, and
            Asterim sends it nowhere. Copying it into a conversation is your decision alone.
          </p>

          <h2 id="licence">Licence</h2>
          <p>
            Asterim is released under the {LICENSE} licence. The full text is in the repository's{' '}
            <a href={`${GITHUB_URL}/blob/main/LICENSE`}>LICENSE</a> file.
          </p>
        </article>
      </div>
    </main>
  );
};
