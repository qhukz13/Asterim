# [P5.6-04] — Stripe Checkout, Customer Portal & Cryptographic Webhook Security

**Task ID:** P5.6-04  
**Phase:** Phase 5.6 — SaaS Foundation & Commercial Beta Release  
**Assigned Agent:** Claude Code  
**Orchestrator:** Antigravity  
**Status:** ASSIGNED  
**Date:** 2026-08-15  

---

## 1. Objective

Implement `BillingService.ts` for Stripe Checkout and Customer Portal session creation, expose authenticated `/api/v1/billing` REST endpoints, harden `/api/v1/webhooks/stripe` with cryptographic HMAC signature verification (`STRIPE_WEBHOOK_SECRET`), and ensure plan updates automatically provision feature entitlements in SQLite.

---

## 2. Why This Task Exists

Asterim requires commercial subscription readiness for its public beta launch. Developers on the Community (Free) plan must be able to upgrade to Pro or Team tiers via Stripe Checkout, manage billing details via Stripe Customer Portal, and have subscription webhooks securely update their local or SaaS account entitlements with cryptographic proof of payment.

---

## 3. Context

* **Blueprint Reference**: `blueprint/ROADMAP.md` Phase 5 Deliverable 3.
* **Phase 5 Reconciliation**: [`docs/phase5-reconciliation.md`](file:///c:/Projects/Asterim/docs/phase5-reconciliation.md) (§2.3 & §4 Task P5.6-04).
* **Existing Primitives**:
  - [`apps/server/src/services/PlanService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/PlanService.ts): Defines tiers (`free`, `pro`, `team`, `enterprise`) and `updateAccountPlan()`.
  - [`apps/server/src/services/EntitlementService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/EntitlementService.ts): Checks feature flags and usage limits against `feature_entitlements`.
  - [`apps/server/src/routes/webhooks.ts`](file:///c:/Projects/Asterim/apps/server/src/routes/webhooks.ts): Existing webhook listener skeleton.

---

## 4. Repository Evidence

Inspect:
* [`apps/server/src/services/PlanService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/PlanService.ts)
* [`apps/server/src/services/EntitlementService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/EntitlementService.ts)
* [`apps/server/src/services/DatabaseService.ts`](file:///c:/Projects/Asterim/apps/server/src/services/DatabaseService.ts)
* [`apps/server/src/routes/webhooks.ts`](file:///c:/Projects/Asterim/apps/server/src/routes/webhooks.ts)
* [`apps/server/src/index.ts`](file:///c:/Projects/Asterim/apps/server/src/index.ts)
* [`apps/server/package.json`](file:///c:/Projects/Asterim/apps/server/package.json)

---

## 5. Implementation Scope

1. **`BillingService.ts` (`apps/server/src/services/BillingService.ts`)**:
   - `createCheckoutSession({ accountId, planId, successUrl, cancelUrl })`:
     - Validate `planId` against available plans (`pro`, `team`).
     - Look up account in SQLite `accounts` table.
     - When `STRIPE_SECRET_KEY` is configured: create Stripe Checkout Session with `client_reference_id: accountId`, `metadata: { accountId, planId }`, and `customer: stripeCustomerId || undefined`.
     - When `STRIPE_SECRET_KEY` is unconfigured: throw structured `STRIPE_NOT_CONFIGURED` error or support mock/development mode if explicitly enabled.
   - `createPortalSession({ accountId, returnUrl })`:
     - Look up `stripe_customer_id` for the account. If missing, throw `NO_CUSTOMER_RECORD`.
     - When Stripe is configured: create Stripe Billing Portal session URL.
   - `getSubscriptionOverview(accountId)`:
     - Return account's `current_plan_id`, `subscription_status`, `billing_status`, `stripe_customer_id`, and active feature entitlements.

2. **Billing REST Routes (`apps/server/src/routes/billing.ts`)**:
   - `POST /api/v1/billing/checkout` — Authenticated; accepts `{ planId, successUrl, cancelUrl }`, returns `{ checkoutUrl, sessionId }`.
   - `POST /api/v1/billing/portal` — Authenticated; accepts `{ returnUrl }`, returns `{ portalUrl }`.
   - `GET /api/v1/billing/subscription` — Authenticated; returns subscription & entitlement summary.
   - Register route in `apps/server/src/index.ts`.

3. **Cryptographic Stripe Webhook Signature Verification (`apps/server/src/routes/webhooks.ts`)**:
   - Implement `verifyStripeSignature(rawBody: string | Buffer, signatureHeader: string, secret: string, toleranceSeconds = 300)`:
     - Extract `t=timestamp,v1=signature` from `stripe-signature` header.
     - Compute `HMAC-SHA256(timestamp + "." + rawBody, secret)` and compare using `crypto.timingSafeEqual`.
     - Reject timestamps older than `toleranceSeconds` (prevent replay attacks).
   - When `STRIPE_WEBHOOK_SECRET` is set on server, reject unverified payloads with HTTP 400 (`{ error: 'Invalid webhook signature' }`).
   - When `STRIPE_WEBHOOK_SECRET` is unset (development mode), process payload with logged notice.
   - Handle events:
     - `customer.subscription.created` & `customer.subscription.updated`:
       - Extract `accountId` from `metadata.accountId` (or `client_reference_id`), `planId`, and `customer`.
       - Call `planService.updateAccountPlan(accountId, planId, customerId)`.
     - `customer.subscription.deleted`:
       - Call `planService.updateAccountPlan(accountId, 'free')`.
     - `invoice.payment_failed`:
       - Update `accounts` table setting `billing_status = 'past_due'`.

4. **Automated Unit Test Suite (`apps/server/src/services/__tests__/BillingService.test.ts`)**:
   - Test signature verification with valid HMAC signatures, forged signatures, expired timestamps, and missing headers.
   - Test checkout session creation and error handling.
   - Test customer portal generation.
   - Test webhook event dispatch: subscription created/updated updates account plan and syncs entitlements in SQLite; subscription deleted downgrades account to `free`.
   - Wire `BillingService.test.ts` into `apps/server/package.json` `"test"` script.

---

## 6. Explicitly Forbidden Changes

* Do **NOT** require credit cards or block access to Community (Free) edition.
* Do **NOT** make outbound network calls to Stripe during unit tests (use mocked responses or test helpers).
* Do **NOT** log or store raw customer credit card numbers or Stripe private keys in database rows.

---

## 7. Acceptance Criteria

1. `verifyStripeSignature()` correctly validates genuine Stripe webhook signatures and rejects forged or replayed signatures in constant time.
2. `POST /api/v1/webhooks/stripe` updates SQLite `accounts` and `feature_entitlements` tables accurately across subscription lifecycles (`created`, `updated`, `deleted`, `payment_failed`).
3. `POST /api/v1/billing/checkout` and `POST /api/v1/billing/portal` return valid URLs or descriptive configuration errors when unconfigured.
4. `GET /api/v1/billing/subscription` returns accurate plan and entitlement states.
5. `BillingService.test.ts` passes with comprehensive assertions.
6. Monorepo CI gates pass with 0 errors: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test` (24 test suites), `pnpm run build`.

---

## 8. Definition of Done

- [ ] `BillingService.ts` implemented
- [ ] `/api/v1/billing` routes registered and functional
- [ ] Stripe webhook signature verification active
- [ ] `BillingService.test.ts` passing
- [ ] `pnpm run test` passes across all packages
- [ ] Monorepo CI gates pass: typecheck, lint, test, build

---

## 9. Verification Commands

```bash
# Run new Billing unit test suite
pnpm --filter asterim exec tsx src/services/__tests__/BillingService.test.ts

# Run all server test suites
pnpm --filter asterim exec tsx src/routes/__tests__/internal.test.ts

# Run full monorepo CI pipeline
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
```

---

## 10. Self-Review Requirements

- Verify timing-safe comparison (`crypto.timingSafeEqual`) is used for webhook signatures.
- Verify `feature_entitlements` table is correctly populated upon subscription update.

---

## 11. Required Report

Write report to `reports/current.md` matching `.agents/templates/REPORT_TEMPLATE.md`.
