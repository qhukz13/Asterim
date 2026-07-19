# Contributing to Asterim

First off, thank you for considering contributing to Asterim! It's people like you that make Asterim such a great tool.

## Project Philosophy

Asterim is an **Architecture-First** project. This means we value thoughtful design, clear boundaries, and comprehensive documentation over moving fast and breaking things. We believe that a well-designed system is easier to maintain, scale, and contribute to.

Our core philosophies are:
1. **Architecture First, Implementation Second**: Never write code without understanding where it fits in the broader system.
2. **Local-First Security**: Data privacy is paramount.
3. **Premium UX**: Every interaction should feel polished and deliberate.

## The Blueprint (Source of Truth)

The `blueprint/` directory contains the definitive requirements, architecture, and design specifications for Asterim. It is the **ultimate source of truth**.

Before starting any work, you **MUST**:
1. Read `blueprint/AI_CONTEXT.md` to understand the documentation map.
2. Ensure your proposed changes align with the Product Specification (`blueprint/PRODUCT.md`) and Architecture (`blueprint/ARCHITECTURE.md`).
3. If your implementation requires deviating from the Blueprint, you must first propose a change to the Blueprint itself. **Documentation must remain synchronized with the codebase at all times.**

## Development Workflow

We use a standard Node.js + `pnpm` + `turbo` monorepo stack.

### Prerequisites
- Node.js (v18+)
- `pnpm` (v9+)

### Setup
```bash
git clone https://github.com/qhukz13/Asterim.git
cd Asterim
pnpm install
```

### Running Locally
```bash
# Start all development servers
pnpm run dev
```

### Formatting & Linting
We strictly enforce code styling using Prettier and ESLint.
```bash
pnpm run format
pnpm run lint
```

## Branching Strategy & Pull Requests

We use a simple Feature Branch workflow.

1. **Branch Naming**: Use descriptive names (e.g., `feat/add-relay-auth`, `fix/terminal-rendering`, `docs/update-architecture`).
2. **Commit Messages**: We encourage conventional commits.
3. **Pull Requests**:
   - Always open your PR against the `main` branch.
   - Fill out the provided Pull Request Template completely.
   - Ensure all CI checks (linting, building) pass.
   - If your PR affects UI/UX, attach screenshots or videos.
   - **Crucially**: Check the "Blueprint updated" box if you modified system behavior.

## Coding Standards

- **TypeScript Everywhere**: We rely on strict typing to prevent runtime errors. Avoid `any` unless absolutely necessary.
- **Monorepo Boundaries**: Respect the boundaries between `apps/web`, `apps/server`, and `packages/*`. Do not create circular dependencies.
- **Documentation**: If you write a complex function, add a JSDoc comment. If you build a new system, document its design in the `blueprint/`.

Thank you for helping us build Asterim!
