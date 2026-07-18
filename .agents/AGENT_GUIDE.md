# Technical Onboarding & Navigation

## Repository Layout
Asterim is a monorepo.
- `apps/server`: Core Node.js runtime.
- `apps/web`: React PWA client.
- `packages/shared`: Shared types and interfaces.
- `packages/adapters`: Agent communication adapters.

## Finding the Source of Truth
Do not guess where rules are defined. Navigate the Product Specification:

- **Product Documentation**: `blueprint/PRODUCT.md`
- **Architecture**: `blueprint/ARCHITECTURE.md`
- **Design System**: `blueprint/DESIGN_SYSTEM.md`
- **Engineering Standards**: `blueprint/ENGINEERING.md`

## Navigation Rule
This guide must strictly navigate the repository. Do not repeat architectural decisions here. If you need to know *why* the Event Bus exists, read the Architecture document.
