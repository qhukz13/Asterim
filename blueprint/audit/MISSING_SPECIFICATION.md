# Missing Specification

The following features or implementations exist in the codebase but are currently lacking deep coverage in the Blueprint.

## 1. Antigravity Adapter
- **Implementation**: The `packages/adapters/src/AntigravityAdapter.ts` exists and handles complex state transitions.
- **Missing Spec**: The specific edge cases, regexes, and security assumptions for Google Antigravity are not defined in `ARCHITECTURE.md`.

## 2. Event Pruning Logic
- **Implementation**: `PruningService.ts` deletes logs older than 7 days or caps at 25,000.
- **Missing Spec**: The data retention policy is an implementation detail that should be elevated to a Product Requirement in `PRODUCT.md` (e.g., "The system MUST NOT grow local storage unbounded").

## 3. PTY ANSI Parsing
- **Implementation**: The Client UI strips or parses ANSI codes to display terminal streams.
- **Missing Spec**: The exact support matrix for ANSI codes (colors, cursor movements, screen clearing) is undefined in `DESIGN_SYSTEM.md`.
