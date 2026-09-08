# Landing Page: Audit, System and Copy

## 1. Audit of the previous page (`apps/marketing`, "8 acts", August 2026)

Reviewed from the source and the captures in `docs/archive/screenshots/`.

### Remove

- Every claim that is not true today: "Open-Core v1.0 Released", `npx asterim`, `npm install -g asterim` (not on npm), `brew install asterim/tap/asterim`, AppImage/.deb/.exe downloads "AVAILABLE NOW", "AST Command Safety", "Claude Code 3.7", "Aider v0.72", "Hardware Enclave Scoped", "RISK SCORE 8.4/10", "Mobile push approvals", "E2E relay" as shipped features.
- `AsterimWorkstationSandbox.tsx`: 892 lines of a fabricated dashboard with fake PIDs, fake diffs and fake timings. A fake product screenshot is worse than none.
- The "WITHOUT ASTERIM" chaos strip with invented shell history ("API_KEY exposed in plain-text shell history").
- The Download page and the account portal from navigation (the portal never sends a token; see `docs/audit/security-audit.md`).
- The 8-act scroll narrative: eight sections that each re-explain the product.
- The `Sparkles` icon as the logo, the 💡 emoji in pricing, glowing emerald borders around code pills, gradient CTA panels.
- Inline `style={{}}` objects (108 in one file) in place of the CSS classes that already exist in `index.css`.
- Satoshi from Fontshare as a third font source.

### Keep

- The dark, near-monochrome surface with one emerald accent. It matches the dashboard and the design system.
- Inter + JetBrains Mono.
- The `section-tag / section-title / section-lead` rhythm and the `surface-card` primitive.
- The navbar and mobile drawer structure.
- The Docs page shell (sidebar + content), fed with true content.

### Redesign

- Hero: one sentence that says what it is and for whom, one real screenshot of the approval card, one install command. No topology animation.
- "How it works": three steps that match the real first run (install and pair, add a project and give a task, approve and review the diff).
- Capabilities: five, each a thing that exists and was exercised in the release gate.
- Pricing: one free tier that is the whole product, and a Pro waitlist with an honest "when ten people ask" line.
- FAQ: security model, what leaves the machine, which agents, Windows support, "is this a cloud service" (no).

### Add

- Screenshots taken from the actual dashboard (captured with puppeteer in `tools/e2e`, stored in `apps/marketing/public/screens/`).
- A "Status" line in the footer that names the version and the adapters' status (Claude Code: working; Antigravity: best effort).
- Privacy note and licence links.
- Source link to the exact adapter file, because the audience reads code.

## 2. Design system for the site

Visual personality: a tool page written by engineers for engineers. Restrained, literal, confident. Closer to a well-kept README than to a startup template.

| Token | Value | Note |
| --- | --- | --- |
| Background | `#0b0f14` | Same family as the dashboard `--color-bg-primary`. |
| Surface | `#111721` | Cards, code blocks. |
| Border | `rgba(255,255,255,0.08)` | One border weight everywhere. |
| Text | `#e6e9ee` / `#9aa4b2` / `#6b7480` | Primary / secondary / muted. |
| Accent | `#10b981` | Primary CTA, active states, the approval "Approve" button in screenshots. Nothing else. |
| Danger | `#ef4444` | Only inside product screenshots (the Deny button). |
| Display font | Inter 600 to 700, tracking -0.02em | Headings up to 44 px. No 900 weights. |
| Body font | Inter 400, 16 to 17 px, line-height 1.6 | |
| Mono | JetBrains Mono 13 to 14 px | Install commands, file names, tool names. |
| Radius | 6 px controls, 10 px cards | No pill buttons, no 16 px blobs. |
| Shadow | none | Borders carry the hierarchy. |
| Motion | 120 ms colour transitions on hover/focus only | No scroll animations, no floating elements. |
| Spacing | 8 px base; sections 96 px apart on desktop, 64 px on mobile | |
| Max width | 1080 px content, 720 px for prose | |
| Icons | lucide-react at 16 to 18 px, stroke 1.75 | Never emoji. |
| Screenshots | Real captures, 1 px border, no browser chrome, no glow | |

## 3. Information architecture

```text
NAV        Asterim · How it works · Pricing · Docs · GitHub · [Install]
HERO       H1 (what/for whom) · one paragraph · install command · secondary link to GitHub
           Screenshot: approval card over a real transcript
HOW IT     Three numbered steps with one screenshot each (pair, task, diff)
WORKS
WHAT YOU   Five capabilities, plain sentences, one line each on what it is not
GET
WHY        Three paragraphs: one gate across agents; the record you own; nothing leaves the machine
SECURITY   A short table: what runs where, what is stored, what is sent
PRICING    Free (everything). Pro waitlist card.
FAQ        Six questions
FOOTER     Status line · docs · source · licence · privacy
```

## 4. Copy

**H1.** Run your coding agent. Approve every risky step. Keep the record.

**Sub.** Asterim runs Claude Code on your machine, shows you what it says and does in a browser, and stops it before every command or file write until you say yes. Everything is stored locally.

**Install pill.** `npm install -g asterim` then `asterim`

**Secondary.** View source on GitHub · MIT

**How it works.**
1. Install and pair. Run `asterim`. It prints a URL and a six-digit PIN. Open the URL on this machine or on a phone on the same Wi-Fi and enter the PIN.
2. Add a project and give it a task. Point Asterim at a folder. Type what you want done. Claude Code starts in that folder.
3. Approve, deny, review. Every command and file write shows up as a card with the exact command or path. The Changes view shows the diff. You commit; the agent never does.

**What you get.**
- One approval gate. Claude Code's own permission requests, routed to a card you can answer from any browser on your network.
- A transcript you can read. Messages, tool calls and results as structured events, not scraped terminal text.
- Changes, not surprises. Status, diff, branches, commit and push, in the same window.
- Threads that survive restarts. Each thread remembers its Claude Code session and resumes it.
- A record on your disk. Every approval, denial and diff in a SQLite file you own. Export it, grep it, delete it.

**Why Asterim.** The vendors' own dashboards each supervise one vendor's agent. Asterim is the layer you own across them: the same gate, the same record, for Claude Code today and for Antigravity on a best-effort basis, with a documented adapter interface for the next one. It is open source, it never phones home, and an air-gap switch turns off every outbound connection it could make.

**Security.** Asterim runs as you, on your machine. The agent runs as you too. Asterim adds a gate; it does not add a sandbox. What leaves the machine: the agent's own API calls. What Asterim sends anywhere: nothing. The dashboard is served over plain HTTP on your LAN behind a PIN; do not expose it to the internet.

**Pricing.** Free. All of it, MIT-licensed, no account. Pro (waitlist): reach your workstation from outside your network, more than one machine in one dashboard, priority support. It ships when ten people have asked. Expected $12 to $19 per month.

**FAQ.**
- Which agents work? Claude Code, through its headless protocol. Antigravity (Google's CLI) through its terminal interface, best effort. Aider and Codex are not supported.
- Does it need an account? No. A PIN pairs a browser to your machine.
- Windows? Yes. Windows 10/11, macOS and Linux, Node 22 or newer.
- Is my code uploaded anywhere? Not by Asterim. Your agent talks to its own vendor exactly as it does without Asterim.
- Can I approve from my phone? On the same Wi-Fi, yes: open the dashboard URL, enter the PIN. Off-network access is on the Pro waitlist.
- What if the agent tries something dangerous? Claude Code asks before commands and file writes in its default permission mode. Asterim shows that request and blocks until you answer. Asterim does not run anything the agent did not ask about.

**Footer status line.** Asterim 0.2.0 · Claude Code adapter: working · Antigravity adapter: best effort · Nothing leaves your machine.

## 5. Pages removed

- `/download` (fake). The install command lives in the hero and in Docs → Install.
- `/account/*` (broken). Returns after the account system is rebuilt, if ever.
