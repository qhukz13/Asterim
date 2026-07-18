# Brand Migration Report: Asterim

## Migration Overview

- **From**: AgentDeck
- **To**: Asterim
- **Status**: Completed

## Files Changed

A project-wide text replacement script was executed, modifying **87 files**, including:

- Root `README.md`, `package.json`, `turbo.json`.
- All `blueprint/*.md` files including `PRODUCT.md`, `ARCHITECTURE.md`, `CURRENT_STATE.md`.
- UI strings, source code types (`AgentDeckEvent` to `AsterimEvent`), environment variable descriptions, and configurations in `apps/server`, `apps/web`, and `packages/adapters`.

## Paths Renamed

- `apps/server/C:\Projects\AgentDeck\fsm_debug.log` to `fsm_debug.log` with `Asterim` path.
- `assets/agentdeck_dashboard_mockup.png` to `assets/asterim_dashboard_mockup.png`.

## Files Intentionally Left Unchanged

- The physical root workspace folder `/home/qhukz/Documents/Projects/AgentDeck` was left as `AgentDeck` to prevent breaking the IDE workspace.
- **Update (Phase 2)**: `AGENTDECK_` prefixed environment variables and `.agentdeck` directory paths were subsequently migrated to `ASTERIM_` and `.asterim` respectively to ensure absolute brand consistency.

## Compatibility Notes

- **Packages**: Internal monorepo package names have been updated from `@agentdeck/*` to `@asterim/*`. A `pnpm install` was run to update `pnpm-lock.yaml`.
- **Knowledge Graph**: The legacy `graphify-out/` directory was removed because the previous `graphify` CLI could not be automatically executed to refresh it. The next time the graphify pipeline runs, it will be generated correctly under the Asterim brand.

## Branding Consistency Audit

- **Mixed Branding**: Eliminated. No instances of `AgentDeck (Asterim)` were left.
- **Terminology**: The new terminology ("Asterim is an AI-native workspace for orchestrating autonomous software engineering agents") is active across `README.md` and `blueprint/BRAND.md`.

## Remaining Manual Tasks

1. Verify if any external CI/CD pipelines hardcode the `@agentdeck` package names.
2. The user might want to manually rename their IDE root folder from `AgentDeck` to `Asterim` when it's safe to restart their workspace session.

_Migration is fully internally consistent._
