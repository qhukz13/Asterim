# Phase 4.5 — Marketing Website Refinement Plan

**Target**: Refine `@asterim/marketing` into a high-precision, professional developer product experience.  
**Reference Quality Standard**: Linear, Cursor, Vercel, Raycast.  

---

## Prioritized Implementation Roadmap

### P0 — Professionalism Blockers

1. **Design Tokens & System Consolidation (`index.css`)**
   - Establish CSS variables for colors, surface elevations, borders, spacing tokens, and typography sizes.
   - Replace arbitrary inline `style={{ ... }}` blocks with clean reusable utility classes (`.section-container`, `.card-surface`, `.heading-hero`, `.heading-2`, `.text-subhead`).

2. **Card Container Consolidation & Content Streamlining**
   - Unify `WhyAsterimSection` and `ProblemSolutionSection` into a single high-impact control plane architecture showcase, eliminating repetitive card containers.
   - Simplify `CapabilitiesGrid` to highlight the 5 core product pillars with high contrast typography and clean icon layouts.

3. **High-Fidelity Interactive Product Demonstrations**
   - Refine `AgentStreamTab`, `SecurityGuardTab`, `EnvironmentTab`, and `MobileTunnelTab` into pixel-perfect interactive previews modeling the exact UI elements of `apps/web`:
     - Clean PTY terminal log stream with line numbers and status metrics.
     - AST command guard preview with real syntax diffs and Approve/Reject controls.
     - Scope switcher for Personal, Company, and Client environment presets.
     - Mobile approval push notification card with cloud relay status.

---

### P1 — Product Experience & Credibility Improvements

1. **Dedicated Download Page Polish (`DownloadPage.tsx`)**
   - Streamline Linux, macOS, and Windows distribution options into a structured tabbed/grid platform layout with single global CLI quickstart header.

2. **Documentation Reader UX (`DocsPage.tsx`)**
   - Refine `DocsPage.tsx` with clean sidebar search, active topic breadcrumbs, code block copy snippets, and structured markdown typography.

3. **Color Restraint & Visual Hierarchy**
   - Restrain emerald green accent (`#10b981`) to primary CTAs, active tab highlights, and live execution status indicators. Reduce background glow opacity to 4-6%.

---

### P2 — Accessibility, Interaction & Micro-Polish

1. **Accessibility & ARIA Attributes**
   - Add explicit `:focus-visible` focus rings, `role="tab"`, `role="tabpanel"`, and `aria-selected` attributes across all interactive elements.

2. **Production Verification**
   - Ensure `pnpm --filter @asterim/marketing build` compiles cleanly with 0 TypeScript/ESLint errors.
