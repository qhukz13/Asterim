# PR3 — Top Bar Extended Design Review (Control Plane Refinement)

## Executive Summary

Asterim is **an operating system and control plane for AI-driven software development teams**, not another IDE.

This refinement shifts the TopBar design from a traditional IDE file/thread header into a **Control Plane Header** optimized for managing engineering outcomes, tracking active agent missions, and providing rich execution feedback.

---

## 1. Mental Model: Mission-First Control Hierarchy

### IDE Mental Model vs AI Control Plane Mental Model
* **IDE Mental Model (Editor-Centric)**: `Project / Folder / File.ts` — Focuses on where code lives and raw file editing.
* **Control Plane Mental Model (Outcome-Centric)**: `Project / Mission / Active Task` — Focuses on **what engineering goal the AI agent is pursuing** and **what state the execution is in**.

### Hierarchy Comparison

| Structure | Context Provided | Manager Ergonomics | Decision |
| :--- | :--- | :--- | :--- |
| `Project / Thread` | Identifies chat session ID | Low — fails to state the engineering goal being solved | ❌ Rejected |
| **`Project / Mission`** | **Identifies codebase & active engineering goal** | **High — answers "What is the agent building/fixing?"** | **✅ CHOSEN** |
| `Mission / Thread` | Omits codebase repository context | Medium — loses project repository boundary | ❌ Rejected |

**Conclusion**: The top-left breadcrumb displays `Project Name / Active Mission Title` (`asterim / Terminal PTY Hardening`).

---

## 2. Reclaiming Prime Center Visual Real Estate

The center of the TopBar is the most valuable visual real estate in the entire workspace.

### Comparison: Search Box vs Active Objective Summary

* **Option 1: Command Palette Trigger in Center**
  * *Critique*: Placing a search box in the center wastes prime focus on an inactive input field. It forces the user's eyes to jump down into the main body to find out what goal the agent is working on.
* **Option 2: Active Objective & Mission Progress in Center (CHOSEN)**
  * *Rationale*: Placing the **Active Objective Summary** (`🎯 Mission: Harden Terminal PTY Buffer Execution`) directly in the center gives engineering leads constant visual grounding over the high-level objective.
  * *Command Palette Handling*: The `⌘K` launcher is placed compactly in the top bar as a sleek action key (`⌘K`), preserving center focus for the active mission objective.

---

## 3. Rich Agent Execution State Pill

Rather than a static color dot, the Agent Execution Pill is upgraded into a **Rich Control Signal** communicating state, agent runtime, execution time, and approval urgency without visual noise.

### Execution States & Rich Content

1. **Working (Active Computation)**:
   - `⚡ Working (Claude Code) · 1m 24s` — Cyan glow indicator.
2. **Paused for Review (Human-in-the-Loop Gate)**:
   - `⚠️ Action Required · Approval Waiting (4:52)` — Amber pulse timer indicator.
3. **Completed (Goal Achieved)**:
   - `✓ Mission Complete · 12 Changes` — Emerald badge.
4. **Waiting / Error**:
   - `⏳ Waiting for Input` (Purple) or `❌ Process Failed` (Rose).

---

## 4. Future-Proofing for SaaS & Team Collaboration (1-Year Horizon)

The control plane header is designed to scale seamlessly to Phase 3 (Teams) and Phase 5 (SaaS):
* **Workspace Scoping**: Easily prepends `Org / Workspace` when multi-tenancy is active.
* **Multi-Agent Swarm Status**: Accommodates multiple active parallel agent indicators when swarm features arrive.
* **Workstation Health**: Accommodates local vs remote cloud relay status gracefully.

---

## 5. Refined Control Plane ASCII Wireframe

```
+-----------------------------------------------------------------------------------------------------------------------------------------------+
|  [A] asterim / Terminal PTY Hardening      🎯 Mission: Refactor PTY Buffer & Throttling      ⚡ Working (Claude Code) · 1m 24s  |  🟢 Local Host  |  ⌘K  |
+-----------------------------------------------------------------------------------------------------------------------------------------------+
```

### Layout Mappings & Spacing Scale:

* **Left Zone (Location Context)**:
  * `[A]` Brand Icon + `project-name / mission-title` (`fontSize: 12px`, `fontWeight: 600`, `color: var(--color-text-primary)`).
* **Center Zone (Prime Objective Focus)**:
  * `🎯 Mission: [Title]` (`fontSize: 12px`, `color: var(--color-text-secondary)`, `background: var(--color-surface-2)`, `padding: 4px 14px`, `borderRadius: var(--radius-full)`).
* **Right Zone (Control Signals & Health)**:
  * **Rich Agent Execution Pill**: `padding: 4px 10px`, `borderRadius: var(--radius-full)`, `fontSize: 11px`, `fontWeight: 600`.
  * **Workstation Status**: `fontSize: 11px`, `color: var(--color-text-muted)`.
  * **Command Launcher Key**: Compact `⌘K` button (`background: var(--color-surface-2)`, `border: 1px solid var(--color-border-subtle)`).

---

## 🧪 Implementation Scope for PR3

* Modify `apps/web/src/components/TopBar.tsx` to render the Control Plane header layout using design tokens.
* Pass project name, thread/mission title, and active agent execution status cleanly from `App.tsx` (without altering stores or logic).
* Update `apps/web/src/styles/layout.css` for 48px header elevation.

---

## 🛑 Status: Ready for Implementation

Conceptual refinement complete. Proceeding to implementation of PR3!
