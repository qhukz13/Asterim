# Market, Competitors and Positioning (September 2026)

This document answers one question: does the problem Asterim was built for still exist, and if so, where can a one-person project win against what shipped in 2026. It was researched fresh on 2026-09-08. Sources are listed at the end.

## 1. What changed since Asterim was conceived (mid-2026)

The original premise (`blueprint/PRODUCT.md`, July 2026): "Autonomous AI coding agents (Claude Code, Aider) lack visibility and safety controls." Since then:

- **Claude Code shipped the dashboard itself.** Agent View (May 2026, research preview) is a multi-session dashboard with background sessions and real-time previews. `/goal` runs outcome-based tasks unattended. Remote Control lets a phone drive a local session, including permission prompts. Auto mode replaces most prompts with a classifier. Managed settings, OpenTelemetry export and a Compliance API cover the enterprise governance story. The CLI exposes background sessions (`claude --bg`, `claude agents`) and a stream-json protocol for hosts like Asterim.
- **OpenAI shipped the Codex app** (February 2026): a desktop app that orchestrates parallel agents in git worktrees with an inline diff reviewer, plus cloud agents. Plus at $20 includes it.
- **Google shipped Antigravity 2.0** (May 2026): IDE, Go CLI, SDK, and an "Agent Manager" for running several agents at once with scheduled background tasks. Free tier for individuals. Asterim's only working adapter wraps this CLI.
- **GitHub shipped the "agent control plane"** for enterprises (GA February 2026): policy, MCP allow-lists, agent session audit logs with `actor_is_agent`.
- **The open-source orchestrator category exploded and then churned.** Vibe Kanban's company shut down (April 2026, community-maintained now). Crystal was deprecated for a paid successor (Nimbalyst). Agent Orchestrator changed owners mid-project. Everything converged on git worktrees as the isolation primitive.

Conclusion: the *visibility* half of the original problem is now solved by the vendors themselves, inside their own tools. The *control* half (a gate on what an agent may do) is solved for single sessions by the vendors too. What is not solved is the layer *across* agents and *across* machines that a developer actually owns.

## 2. Competitive matrix

| Product | Audience | Hosting | Price | Agents | Approvals / HITL | Mobile / remote | Strength | Weakness | Threat to Asterim |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code (Agent View, Remote Control, auto mode) | Claude Code users | Local + Anthropic cloud | Pro $20 to Max $200 | Claude only | Native prompts, classifier, hooks | Phone via Remote Control (Manual/AcceptEdits/Plan only) | Vendor-native, zero setup | Single vendor; Remote Control drops auto mode | **Very high** for single-agent visibility |
| OpenAI Codex app | Codex users | Desktop + OpenAI cloud | Plus $20, Pro $100/$200 | Codex only | Diff reviewer, cloud sandboxes | Cloud tasks from ChatGPT | Parallel worktrees + review in one app | Single vendor | High |
| Google Antigravity 2.0 | Gemini users | Desktop IDE + CLI | Free; AI Pro $19.99, Ultra $100/$200 | Gemini (+Claude in IDE) | Agent Manager, scheduled tasks | — | Free tier, multi-agent manager | Single vendor; TUI churn | High (it is the CLI Asterim wraps) |
| Nimbalyst (ex-Crystal) | Claude Code + Codex users | Local desktop, optional Teams sync | Free; Teams $20/user | Claude Code, Codex, OpenCode, Copilot (alpha) | HITL parallel dispatch | Native iOS app | Only mobile-first option; visual editors | Closed source; young | High (closest positioning) |
| Superset | Teams | Local + remote SSH | Free; Pro $15/user | 7 CLIs | Diff review, automations, MCP | "Coming soon" | Remote hosts, explicit pricing | Heavy IDE-like scope | Medium |
| Conductor | Mac devs | Local (macOS only) | Free | Claude Code, Codex | Diff review, PR flow | — | Polish | macOS only, 2 agents | Medium |
| Vibe Kanban | Kanban fans | Self-hosted web | Free (Apache-2.0), company shut down | 10 CLIs | Column-based approval | Browser | Clear board model | Unfunded | Low |
| Claude Squad / Paneflow | Terminal devs | Local TUI | Free | Any shell agent | Review before push | — | tmux-native | Terminal only, no Windows (Squad) | Low |
| Agent Orchestrator, Bernstein, Baton, Code Conductor, MS Conductor | Automation pipelines | CLI / daemon | Free (OSS) | 26 to 49 adapters | Milestone gates | — | Full plan-to-PR loops | Idle gaps, solo maintenance | Low (different job) |
| Sculptor (Imbue) | Safety-minded devs | Local Docker per agent | Free preview | Model-based agents | Container isolation, merge review | — | Real sandboxing | Not a CLI wrapper | Low |
| Augment Cosmos | Organisations | Managed cloud or self-hosted | Business $100/mo (50 seats) | Claude, Copilot | Checkpoints | — | Audit trails, experts, memory | Paid floor | Low (enterprise) |
| Gas Town / Gas City (Yegge) | Engineers running 20 to 300 agents | Self-managed | Free (MIT) | Any | Merge queue ("Refinery") | — | Scale, git-backed memory (Beads) | Complexity | Low (different scale) |
| OpenClaw, Hermes Agent | General personal agents | Self-hosted | Free + hosting | Own runtimes | Varies | Chat gateways | Data sovereignty, memory | Not coding-specific | Low |
| Lindy, Dust, n8n, Zapier Agents, Sim | Business automation | SaaS / self-host | €24 to €800/mo | Own | Workflow steps | — | Integrations | Not coding | None |

## 3. Market validation, answered plainly

**Is the original problem still real?** Partly. "I cannot see what my agent is doing" is solved per vendor. "I do not trust what my agent will do" is solved per session by the vendors' own permission systems. What remains real: people run more than one agent, from more than one vendor, on more than one machine, and no vendor tool gives them one place that shows all of it and keeps a record they own.

**Has it become more important?** The number of concurrent agents per developer went up (Gas Town runs 20 to 30; the Codex app and Agent View exist because of it). "The bottleneck stops being the model and becomes the operator" is the phrase the category uses. Operator tooling matters more than in 2025.

**Has it become less important?** The single-session, single-vendor version has. Competing with Agent View for Claude-only visibility is a losing fight.

**Have existing products already solved it?** For single-vendor, yes. For cross-vendor local supervision with a persistent, owned record, the open-source options are unfunded or terminal-only, and the funded options (Nimbalyst, Superset) are young and closed.

**Has the market moved in another direction?** Toward parallel worktree sessions with diff review as the unit of work, and toward cloud execution. Asterim's "thread with an approval gate" model is one step behind: it lacks first-class worktree isolation per thread in the UI (the delegation prototype has it internally) and has no cloud story.

**Is Asterim solving a problem users pay to solve?** Evidence of willingness to pay in this exact niche: Nimbalyst Teams $20/user, Superset Pro $15/user, Cosmos $100/mo. Individuals mostly do not pay for a free-CLI wrapper; teams pay for shared visibility, remote execution and audit.

**Who would realistically pay?** A tech lead on a 3 to 15 person team where several people run Claude Code or Codex daily and someone is accountable for what the agents did. Not enterprises yet (GitHub and Anthropic own that), not solo hobbyists.

**Why pay for Asterim instead of tools they already have?** Only if Asterim is the one place that (a) works across Claude Code and at least one other agent, (b) keeps an owned, exportable record of every approval and diff, and (c) can be reached from another machine without a vendor's cloud. Nothing else on the list does all three locally and open-source.

**Strongest current positioning:** undecided on purpose, and decided by Phase 2. The working hypothesis is tested in §5 below. What is safe to say today is the relationship, not the category: *Asterim works with the coding agent you already run — it shows you what the agent is doing, gates what it may do, and keeps the record on your machine.*

**What Asterim should not compete with:** the vendors' own single-agent UX (Agent View, Codex app), cloud execution, enterprise governance consoles, workflow automation platforms, and terminal-native tools for people who want no GUI.

**Smallest valuable launch:** Claude Code running under Asterim's gate on one machine, watched from any browser on the LAN, with the Changes view for review. Free. Nothing else.

**Long-term moat candidates (in order of plausibility):** the owned execution record (approvals, diffs, decisions) as a searchable history across agents; cross-vendor adapters that the vendors have no incentive to build; LAN and self-hosted remote access without a vendor cloud; Project Memory if it becomes the thing users feed into every agent.

## 4. Where Asterim can win (workflow-level, not visual)

1. **One gate for every agent.** Claude Code's permission request, Antigravity's TUI prompt and a future Codex hook all land on the same approval card, with the same risk labels and the same audit row. The vendor tools cannot do this for each other.
2. **The record you own.** Every approval, denial, tool call and diff is in a SQLite file on the developer's disk, exportable, greppable, not in a vendor account. This is the honest version of the "audit" story, aimed at a tech lead, not a CISO.
3. **Watch from the other room, not the other cloud.** The dashboard is a PWA on the LAN. A phone on the same Wi-Fi approves a command without a relay. (The cloud relay stays frozen until this is proven wanted.)
4. **Resume after restart.** Threads remember their Claude Code session id, so closing the laptop does not lose the conversation. Small, but it is what makes a supervisor feel durable.

What would invalidate this: Anthropic opening Agent View to third-party agents, or Nimbalyst going open source. Both are possible; neither has happened.

## 5. Testing the positioning hypothesis (2026-09-09)

The proposed distinction was: **"Coding agents write the code. Asterim manages the environment around them."** It was tested against the market rather than adopted. It survives as a *product definition* and fails as *marketing language*, for two separate reasons.

**"Control plane" and "control layer" were captured in 2026 by enterprise vendors.** Microsoft Agent 365 went generally available on 1 May 2026 as "a unified control plane to observe, govern and secure AI agents"; OpenHands launched an Agent Control Plane for "agent sprawl across modern enterprises"; IBM, Google Cloud Next 2026 and a stream of analyst frameworks use the same phrase. To the audience that matters — a developer running Claude Code on a laptop — "control plane" now signals compliance software bought by someone else. **Conclusion:** keep it as internal architecture vocabulary; never put it on the website.

**"Works with your agent, doesn't replace it" is the category convention, not a differentiator.** "Claude Code GUI" is now its own comparison-article category, with at least four named tools and a Nimbalyst round-up ranking them. Every one of them says the same sentence. Saying it is still *necessary* — a visitor must understand the relationship immediately — but it distinguishes nothing.

**What the category says its own value is:** parallel sessions and searchable history. The reviews describe the pain as "a stack of identical-looking tabs with no notification when the agent finishes" and "history is scrollback that you cannot search across sessions or days". That is direct external support for hypotheses H3 and H1, and for the record being the durable asset. It is also a warning: several products are already chasing it.

**What survives as a real differentiator**, in decreasing confidence:

1. **Local-first with an owned, searchable record** — no account, no telemetry, open source, verifiable air gap. The alternatives are closed desktop apps, several with cloud or team tiers. This is the one that is hard to copy for a company that needs a cloud business.
2. **Reachable from any device on the network without a vendor cloud.**
3. **Provider-agnostic by construction**, already proven against two structurally different agent protocols (ADR-004).

**What does not survive:** "one dashboard for Claude Code" (commodity), "control plane" (enterprise-owned), and any framing whose first sentence is about the UI.

The final positioning is deliberately not chosen here. It is chosen when the first users say which of the seven hypotheses is true (`docs/product/experiments.md`).

## 6. The monetisation question, unanswered on purpose

> Users already pay for Claude Code. Why would they pay for Asterim as well?

This is the central commercial risk and it is not being reasoned away. Precedents exist in both directions: developers do pay for tools that wrap something they already pay for (editors, terminals, git clients), and developers also refuse to pay for open-source wrappers when a free equivalent is one `git clone` away — and in this category free equivalents exist.

Four candidate dimensions, none chosen: **people** (a second person on the same instance), **machines** (remote access, several workstations), **history** (retention, search, export of the record), or **none** — the product stays free and the value is distribution and trust.

The interview script asks about this directly and does not stop at the first "no" (`docs/product/experiments.md` § Interview script, questions 15 to 19). Until those answers exist: no pricing page commitments, no plan grid on the home page, no billing work. The code contains `$19`/`$49` and the old site said `$20`; all three are unvalidated and none should be repeated.

## 7. Sources

- Augment Code, "9 Open-Source Agent Orchestrators for AI Coding (2026)": https://www.augmentcode.com/tools/open-source-agent-orchestrators
- Nimbalyst, "Best Tools for Managing Parallel AI Coding Agents in 2026": https://nimbalyst.com/blog/best-agent-management-tools-2026/
- Lava, "6 AI Agent Workspaces Compared (August 2026)": https://www.lava.so/blog/ai-agent-workspaces-compared
- Geeky Gadgets on Claude Code Agent View, /goal, background sessions (May 2026): https://www.geeky-gadgets.com/claude-code-agent-view-update/
- Anthropic, "How we built Claude Code auto mode": https://www.anthropic.com/engineering/claude-code-auto-mode
- Claude Code docs, permission modes and Remote Control limits: https://code.claude.com/docs/en/permission-modes ; https://clauderemotecontrol.com/claude-code-permission-modes/
- The Next Web on Antigravity 2.0 (May 2026): https://thenextweb.com/news/google-antigravity-2-desktop-cli-sdk-io-2026
- OpenAI, "Introducing the Codex app": https://openai.com/index/introducing-the-codex-app/ ; Codex pricing summaries: https://www.morphllm.com/codex-pricing
- GitHub changelog, Enterprise AI Controls and agent control plane GA: https://github.blog/changelog/2026-02-26-enterprise-ai-controls-agent-control-plane-now-generally-available/
- Claude Code enterprise controls and OpenTelemetry: https://www.eesel.ai/blog/admin-controls-claude-code ; https://generalanalysis.com/guides/claude-code-control-observability-opentelemetry
- Steve Yegge, Gas Town: https://yegge.ai/gastown ; The New Stack on Gas Town in the cloud: https://thenewstack.io/steve-yegges-ai-agent-orchestration-project-gas-town-comes-to-the-cloud-and-brings-the-wasteland-with-it/
- OpenClaw cost analyses: https://kilo.ai/openclaw/how-much-does-it-cost ; https://thunderbit.com/blog/openclaw-pricing-and-plans
- Business agent platforms: https://www.sim.ai/library/best-ai-agent-platforms-2026 ; https://www.lindy.ai/blog/n8n-ai-agents

Added 2026-09-09 for §5 and §6:

- OpenHands Agent Control Plane launch: https://finance.yahoo.com/sectors/technology/articles/openhands-launches-agent-control-plane-135500983.html
- The agent control plane race at Google Cloud Next 2026: https://siliconangle.com/2026/04/22/agent-control-plane-race-hits-overdrive-next-2026-googlecloudnext/
- IBM on the agent control plane: https://www.ibm.com/think/topics/agent-control-plane
- Nimbalyst, "Best Claude Code GUI in 2026: 4 Tools Compared": https://nimbalyst.com/blog/best-claude-code-gui-tools-2026/
- CodeAgentSwarm, "Claude Code GUI: Desktop App, Task Board & Live Diffs (2026)": https://www.codeagentswarm.com/en/guides/claude-code-gui
- "Claude Code GUI vs Terminal": https://vanja.io/claude-code-gui-vs-terminal-a-tale-of-two-workflows/
- claude-code-gui (open source desktop wrapper): https://github.com/markes76/claude-code-gui
