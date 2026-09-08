# Asterim Public Release & Commercial Legal Readiness Checklist

**Document Version**: 1.0.0 — PUBLIC RELEASE LEGAL FRAMEWORK  
**Author**: Lead Product Architect & Legal Engineering Compliance  
**Date**: August 11, 2026  
**Status**: Administrative & Operational Checklist  
**Target Platform**: `asterim.dev` Public Website & Client Releases  

---

> [!WARNING]
> **DISCLAIMER**: This document serves as an engineering and operational readiness checklist. The items listed below represent structural requirements for commercial product launch. They do NOT constitute formal legal advice and MUST be reviewed by qualified legal counsel prior to public commercial operation.

---

## 1. Public Terms & Policies Checklist

- [ ] **Terms of Service (ToS)**:
  - Account registration terms, acceptable use policy, restrictions on malicious agent prompt engineering or unauthorized server load.
  - Limitation of liability for local code mutations, git history modifications, or automated agent shell executions.
  - Service uptime expectations for cloud identity portal vs offline local engine guarantees.

- [ ] **Privacy Policy**:
  - Clear declaration of data collected via `asterim.dev` (Email, hashed passwords, device metadata, session IPs).
  - Explicit declaration of Local vs Cloud Data Boundaries: Local code files, repository AST symbols, PTY terminal logs, and agent conversations remain strictly on the developer's local machine unless routed through explicit user-configured relay tunnels.
  - Analytics and error tracking disclosure (e.g. Sentry error reporting, telemetry opt-in/opt-out toggles).

- [ ] **Open Source Licensing Disclosures**:
  - Full display of MIT License terms for the Asterim Core Engine (`README.md`, `LICENSE`, `/docs/license`).
  - Third-party open-source attribution notice listing bundled packages (React, Vite, Fastify, xterm.js, Lucide icons, etc.).

- [ ] **Cookie & Consent Management**:
  - Minimal cookie policy declaration (Essential HTTP-only authentication cookies for session management).
  - Consent banner for marketing analytics (if telemetry or analytics scripts are loaded on `asterim.dev`).

- [ ] **Account & Data Deletion Policy**:
  - Self-service account deletion trigger in Account Portal (`/account/settings`).
  - Data purging specification: Permanent deletion of user account credentials, active sessions, trusted device records, and API keys upon request within 30 days.

- [ ] **Refund & Cancellation Policy**:
  - Policy framework for future SaaS subscriptions (Free trial duration, prorated subscription cancellations, billing dispute resolution).

- [ ] **Security Contact & Vulnerability Disclosure**:
  - Public security contact email (`security@asterim.dev` or `SECURITY.md`).
  - Coordinated vulnerability disclosure policy, response timeframe guidelines (24h initial response, 7-day patch target), and safe harbor statement for security researchers.

- [ ] **Data Collection & Retention Specification**:
  - Document exact retention periods for cloud account records (e.g., active device metadata retained while session active; revoked sessions purged after 90 days).

- [ ] **Third-Party Services Disclosure**:
  - Transparent listing of cloud infrastructure vendors (e.g., AWS/GCP hosting, Cloudflare CDN, email verification services).

- [ ] **Commercial & Billing Legal Requirements**:
  - Merchant of Record (MoR) / Tax compliance disclosure (Stripe / LemonSqueezy sales tax, VAT handling for global software sales).

- [ ] **Age & Eligibility Requirements**:
  - Minimum age requirement declaration (13+ / 16+ per COPPA and GDPR compliance).

- [ ] **DMCA / Copyright Contact Requirements**:
  - Designated copyright agent contact information for DMCA takedown requests regarding marketplace skills or documentation content.

---

## 2. Technical Integration Points for Legal Compliance

1. **Footer Links**: `Footer.tsx` must render explicit links to `/terms`, `/privacy`, `/security`, and `/licenses`.
2. **Account Portal Footer**: `AccountLayout.tsx` must include links to Privacy Policy and Account Deletion procedures.
3. **CLI & Desktop License Header**: CLI installation output and desktop app "About" window must display the MIT license notice.
