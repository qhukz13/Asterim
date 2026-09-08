# Asterim Marketing Website — Experience Redesign Strategy

**Goal**: Transform `@asterim/marketing` from a generic AI/SaaS landing page into a **distinctive, premium, product-led experience** that feels like an authentic window into the real Asterim application.

---

## 1. Design Principles & Visual Language

1. **Product Before Marketing**: Show the actual application interface (`apps/web`) instead of marketing widgets, fake counters, or abstract node diagrams.
2. **Real Product UI Compositions**: Reconstruct realistic Workstation UI surfaces (Environment Switcher, Project Sidebar, Active Agent Session, PTY Terminal, Changes/Diff Inspector, Security Approval Modal).
3. **Restrained Visual Polish**:
   - Deep dark background (`#080c14`), subtle elevated surfaces (`#0f172a`), extremely restrained borders (`rgba(255, 255, 255, 0.05)`).
   - Emerald green (`#10b981`) used strictly for active execution states, primary CTAs, approved clearance, and active tab highlights.
   - Large typography (`Inter` / `JetBrains Mono`) with generous whitespace.
4. **Cinematic Story Narrative**: Replace feature spreadsheet card grids with a progressive 8-act visual narrative.

---

## 2. The 8-Act Homepage Story Narrative

```text
Act 01: HERO STATEMENT & WORKSTATION COMPOSITION
  ↓ [Large Headline + CTAs + Realistic Workstation Shell]
Act 02: THE TERMINAL CHAOS PROBLEM
  ↓ [Loose Unmonitored Tabs vs Managed Control Plane]
Act 03: LIVE AGENT WORKFLOW DEMO (AGENT IN ACTION)
  ↓ [Agent → Action → Diff → AST Check → Approval → Complete]
Act 04: REAL ENVIRONMENT ISOLATION
  ↓ [Personal → Company → Client Scoped Context Switcher]
Act 05: COMMAND SECURITY GUARD
  ↓ [Real AST Shell Syntax Scanner & Sandbox Bounds]
Act 06: MULTI-SURFACE ECOSYSTEM
  ↓ [Desktop Workstation → Web Portal → Mobile Control]
Act 07: OPEN CORE & PRIVACY GUARANTEE
  ↓ [100% Local Engine & Open Core Trust]
Act 08: FINAL QUICKSTART & DOWNLOAD
  ↓ [CLI Quickstart & Platform Download CTAs]
```

---

## 3. Detailed Component Redesign Architecture

### Hero Experience (`HeroSection.tsx`)
- **Headline**: "You already have AI agents. Asterim gives you the system to control them."
- **CTAs**: `Download Workstation` (Primary Emerald) + `Documentation` (Secondary Subtle).
- **Hero Visual**: A large, crisp, realistic composition of the **Asterim Workstation UI Shell** showing:
  - Left: Navigation Sidebar (Active Environment pill `Company`, Project tree `asterim-monorepo`, pinned repositories).
  - Center: Active Agent Session tab (`Claude Code v0.4.5`), terminal log stream, and interactive code diff preview (`+ SecurityGuard.ts`).
  - Right: Inspector panel with active MCP servers and AST security status.

### Demo 1: Agent in Action Workflow (`AgentWorkflowDemo.tsx`)
- An immersive step-by-step interactive workflow simulator:
  1. `1. AGENT INITIATED` -> PTY output stream appends logs.
  2. `2. TOOL EXECUTED` -> File edit tool generates a color-coded code diff (`apps/server/src/ApprovalManager.ts`).
  3. `3. SECURITY INTERCEPTION` -> AST scanner flags `rm -rf` / destructive execution request.
  4. `4. APPROVAL REQUIRED` -> User clicks `Authorize Execution` or `Block Command`.
  5. `5. EXECUTION COMPLETED` -> Agent finishes task and sweeps subprocess tree.

### Demo 2: Authentic Environment Switcher (`EnvironmentScopeDemo.tsx`)
- Interactive preset toggle (`Personal (Local)`, `Company (Enterprise)`, `Client (Sandbox)`):
  - `Personal`: Shows `~/Projects/side-apps`, local Ollama LLMs, zero API key requirements.
  - `Company`: Shows `/home/dev/work/asterim`, scoped Anthropic key, PostgreSQL MCP, GitHub MCP, strict team policies.
  - `Client`: Shows `/mnt/sandboxes/client-audit`, read-only OAuth tokens, container sandbox isolation.

### Demo 3: AST Security Scanner (`SecurityGuardDemo.tsx`)
- Selectable test commands (`rm -rf /var/log/asterim.log`, `git commit -m "feat: ast"`, `curl | bash`).
- Displays real AST syntax tree nodes, sandbox path bounds check, risk level badge, and interactive Approve/Reject clearance controls.

---

## 4. What Will Be Removed vs What Will Be Rebuilt

| What Will Be Removed | What Will Be Rebuilt |
| :--- | :--- |
| Abstract 4-node "Control Plane Architecture Topology" diagram in Hero | Large, beautiful, realistic composition of the **Asterim Workstation UI shell** (`apps/web`) |
| Dense micro-inspector cards with fake metrics (`PID 4912`, `RAM 42MB`, `60 FPS / 16ms`) | **Immersive Agent Workflow Simulator** showing real log streams, code diffs, and security approval prompts |
| Repetitive 3-column rounded card grids across multiple sections | Open, typography-driven architectural panels with generous whitespace and clear hierarchy |
| Unanchored radial background glows | Structured control-plane lines and subtle dark surface elevations (`#0f172a`) |

---

## 5. Responsive & Performance Constraints

- **Responsive Viewports**: Tested at 1440px, 1280px, 1024px, 768px, and 375px. Mobile views collapse complex multi-pane workstation compositions into focused tabbed preview cards with >= 40px touch targets.
- **Performance**: Zero external WebGL or video dependencies. Pure React + CSS transforms + SVG icons. Fast initial build (< 1.5s).
- **Product Truth Discipline**: Every feature tagged with explicit status (`AVAILABLE NOW`, `BETA`, `PHASE 5 BETA`, `PLANNED`).
