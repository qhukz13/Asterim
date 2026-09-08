import React from 'react';
import { Check, Database, FileDiff, MessageSquareText, RotateCcw, ShieldCheck } from 'lucide-react';
import { InstallCommand } from '../components/InstallCommand';
import { GithubIcon } from '../components/GithubIcon';
import { DISCUSSIONS_URL, GITHUB_URL, INSTALL_COMMAND, LICENSE } from '../site';

interface HomeProps {
  navigate: (path: string) => void;
}

const FEATURES = [
  {
    icon: ShieldCheck,
    title: 'One approval gate',
    body: "Claude Code's own permission requests, routed to a card you can answer from any browser on your network.",
    not: 'Not a sandbox. The agent runs as you; the gate decides what it may do.'
  },
  {
    icon: MessageSquareText,
    title: 'A transcript you can read',
    body: 'Messages, tool calls and results as structured events, not scraped terminal text.',
    not: 'Not a chat app. Claude Code does the work; Asterim shows it.'
  },
  {
    icon: FileDiff,
    title: 'Changes, not surprises',
    body: 'Status, diff, branches, commit and push, in the same window. You commit; the agent never does.',
    not: 'Not a git client for everything. Enough to review and ship what the agent changed.'
  },
  {
    icon: RotateCcw,
    title: 'Threads that survive restarts',
    body: 'Each thread remembers its Claude Code session and resumes it after the Core restarts.',
    not: 'Not cloud sync. The session lives on this machine.'
  },
  {
    icon: Database,
    title: 'A record on your disk',
    body: 'Every approval, denial and diff in a SQLite file you own. Export it, grep it, delete it.',
    not: 'Not analytics. Nothing about it is sent anywhere.'
  }
];

const FAQ = [
  {
    q: 'Which agents work?',
    a: "Claude Code, through its headless stream protocol. Antigravity (Google's CLI) through its terminal interface, best effort. Aider and Codex are not supported."
  },
  {
    q: 'Does it need an account?',
    a: 'No. A six-digit PIN pairs a browser to your machine. There is no sign-up and no server of ours involved.'
  },
  {
    q: 'Windows?',
    a: 'Yes. Windows 10 and 11, macOS and Linux, Node 22 or newer.'
  },
  {
    q: 'Is my code uploaded anywhere?',
    a: 'Not by Asterim. Your agent talks to its own vendor exactly as it does without Asterim. Asterim itself makes no outbound connections; an air-gap switch guarantees it.'
  },
  {
    q: 'Can I approve from my phone?',
    a: 'On the same Wi-Fi, yes: open the dashboard URL on the phone and enter the PIN. Off-network access is on the Pro waitlist.'
  },
  {
    q: 'What if the agent tries something dangerous?',
    a: 'Claude Code asks before commands and file writes in its default permission mode. Asterim shows that request and blocks until you answer. Asterim does not run anything the agent did not ask about, and it never passes the flag that skips permissions.'
  }
];

export const Home: React.FC<HomeProps> = ({ navigate }) => {
  return (
    <main>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <h1 className="hero-title">Run your coding agent. Approve every risky step. Keep the record.</h1>
            <p className="hero-sub">
              Asterim runs Claude Code on your machine, shows you what it says and does in a browser, and
              stops it before every command or file write until you say yes. Everything is stored locally.
            </p>
            <div className="hero-actions">
              <InstallCommand command={INSTALL_COMMAND} />
              <a href={GITHUB_URL} className="btn" target="_blank" rel="noopener noreferrer">
                <GithubIcon size={15} />
                Source
              </a>
            </div>
            <p className="hero-meta">
              Open source, {LICENSE}. Node 22+. Claude Code required. No account.
            </p>
          </div>
          <figure>
            <img
              className="shot"
              src="/screens/approval-card.png"
              alt="Asterim approval card asking to allow a file write, with Deny and Approve buttons"
              width={1280}
              height={800}
            />
            <figcaption className="shot-caption">The gate: Claude Code asked to write a file; nothing happens until you decide.</figcaption>
          </figure>
        </div>
      </section>

      <section className="section" id="how-it-works">
        <div className="container">
          <span className="eyebrow">How it works</span>
          <h2 className="section-title">Three steps, under five minutes</h2>
          <ol className="steps">
            <li className="step">
              <div className="step-num">01</div>
              <h3>Install and pair</h3>
              <p>
                Run <code>asterim</code>. It prints a URL and a six-digit PIN. Open the URL on this machine
                or on a phone on the same Wi-Fi and enter the PIN.
              </p>
            </li>
            <li className="step">
              <div className="step-num">02</div>
              <h3>Add a project, give it a task</h3>
              <p>
                Point Asterim at a folder. Type what you want done. Claude Code starts in that folder and
                the transcript fills in as it works.
              </p>
              <img className="shot" src="/screens/transcript.png" alt="A thread transcript with the agent's messages" loading="lazy" />
            </li>
            <li className="step">
              <div className="step-num">03</div>
              <h3>Approve, deny, review</h3>
              <p>
                Every command and file write shows up as a card with the exact command or path. The
                Changes view shows the diff. You commit; the agent never does.
              </p>
              <img className="shot" src="/screens/changes.png" alt="The Changes view listing modified files" loading="lazy" />
            </li>
          </ol>
        </div>
      </section>

      <section className="section" id="what-you-get">
        <div className="container">
          <span className="eyebrow">What you get</span>
          <h2 className="section-title">Five things, all of them working today</h2>
          <p className="section-lead">Each was exercised in the release gate before it was written here.</p>
          <div className="features">
            {FEATURES.map(f => (
              <div className="feature" key={f.title}>
                <f.icon size={18} className="feature-icon" />
                <h3>{f.title}</h3>
                <p>{f.body}</p>
                <div className="not">{f.not}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" id="why">
        <div className="container">
          <span className="eyebrow">Why Asterim</span>
          <h2 className="section-title">The layer you own, across vendors</h2>
          <div className="why-grid">
            <div>
              <h3>One gate for every agent</h3>
              <p>
                The vendors' own dashboards each supervise one vendor's agent. Asterim puts the same
                card and the same risk labels in front of Claude Code today and Antigravity on a
                best-effort basis, with a documented adapter interface for the next one.
              </p>
            </div>
            <div>
              <h3>The record you own</h3>
              <p>
                Approvals, denials, tool calls and diffs land in a SQLite file in your home directory,
                not in a vendor account. It is yours to search, export or delete.
              </p>
            </div>
            <div>
              <h3>Nothing leaves the machine</h3>
              <p>
                Asterim is open source and never phones home. Sovereign mode turns off every outbound
                connection it could make, and the code that would make them is a single switch.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="security">
        <div className="container">
          <span className="eyebrow">Security model</span>
          <h2 className="section-title">What runs where</h2>
          <p className="section-lead">
            Asterim runs as you, on your machine. The agent runs as you too. Asterim adds a gate; it
            does not add a sandbox.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Runs</th>
                  <th>Stores</th>
                  <th>Sends</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Asterim Core</td>
                  <td>On your machine, as your user, on your LAN behind a PIN</td>
                  <td>Projects, threads, events, approvals in <code>~/.asterim/asterim.db</code></td>
                  <td>Nothing</td>
                </tr>
                <tr>
                  <td>Dashboard</td>
                  <td>In any browser on the same network</td>
                  <td>The pairing token, in that browser</td>
                  <td>Only to your Core</td>
                </tr>
                <tr>
                  <td>Claude Code</td>
                  <td>As a child process of the Core, in the project folder</td>
                  <td>Its own session files, as always</td>
                  <td>Its own API calls to Anthropic, as always</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="hero-meta">
            The dashboard is served over plain HTTP on your LAN. Do not expose it to the internet. Set{' '}
            <code>HOST=127.0.0.1</code> on shared networks.
          </p>
        </div>
      </section>

      <section className="section" id="pricing">
        <div className="container">
          <span className="eyebrow">Pricing</span>
          <h2 className="section-title">Free. All of it.</h2>
          <div className="plans">
            <div className="plan featured">
              <div className="plan-name">Asterim</div>
              <div className="plan-price">
                $0<small>forever, {LICENSE}</small>
              </div>
              <ul>
                {['Claude Code adapter with the approval gate', 'Transcript, Terminal, Changes', 'Threads that resume', 'The record, on your disk', 'No account, no telemetry'].map(item => (
                  <li key={item}>
                    <Check size={14} />
                    {item}
                  </li>
                ))}
              </ul>
              <a
                href="/docs#install"
                className="btn btn-primary"
                onClick={e => {
                  e.preventDefault();
                  navigate('/docs#install');
                }}
              >
                Install
              </a>
            </div>
            <div className="plan">
              <div className="plan-name">Pro (waitlist)</div>
              <div className="plan-price">
                TBD<small>expected $12 to $19 / month</small>
              </div>
              <ul>
                {['Reach your workstation from outside your network', 'More than one machine in one dashboard', 'Priority support'].map(item => (
                  <li key={item}>
                    <Check size={14} />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="note">Ships when ten people have asked for it. Say so in Discussions and we will count you.</div>
              <a href={DISCUSSIONS_URL} className="btn" target="_blank" rel="noopener noreferrer">
                Ask for Pro
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="section" id="faq">
        <div className="container">
          <span className="eyebrow">FAQ</span>
          <h2 className="section-title">Questions people ask first</h2>
          <div className="faq">
            {FAQ.map(item => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
};
